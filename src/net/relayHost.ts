import { type HostMessage, parseClientMessage } from '../shared/protocol'
import { randomUUID } from '../shared/randomId'
import { generateRoomCode } from '../shared/roomCode'
import {
  closePeer,
  countReceived,
  countSent,
  logEvent,
  resetDiagnostics,
  setFacts,
  upsertPeer,
} from './diagnostics'
import { CLOSE, type HostToRelay, parseJson, roomPath } from './relayProtocol'
import { type RelaySocket, openRelaySocket, relayRoomUrl } from './relaySocket'
import type { ConnId, HostHandlers, HostTransport } from './transport'

/** How many times to re-roll the room code when the relay says it's taken. */
const MAX_CODE_ATTEMPTS = 5

/**
 * A resuming host keeps asking for its old code a few times before rolling a
 * new one, because every phone in the room is pointed at the old code. With
 * the key this should succeed first time; the retries cover a key that was
 * lost along with the browser's storage.
 */
const RESUME_ATTEMPTS = 3
const RESUME_RETRY_MS = 1200

const BASE_RETRY_MS = 800
const MAX_RETRY_MS = 8000

/**
 * The secret that makes a room code ours on the relay. Stored so that a host
 * coming back — from a suspend, a reload, or a resumed game — can reclaim the
 * code its phones are pointed at, while anyone else who rolls it is refused.
 */
const KEY_STORAGE = 'artslicer:relay-host'

/**
 * Hosts a room on the WebSocket relay. Phones dial the same code, and the
 * relay carries frames between them; the game itself still lives here.
 *
 * Unlike a WebRTC host, losing the socket loses every phone with it — the
 * relay sends them all away — so this reconnects on its own and lets each
 * phone's retry bring it back, much as it does after a suspend.
 */
export function createRelayHost(
  relayBase: string,
  handlers: HostHandlers,
  /** Reclaim this exact code when resuming an interrupted game. */
  preferredCode?: string,
): HostTransport {
  const connections = new Set<ConnId>()
  resetDiagnostics()

  let socket: RelaySocket | null = null
  let destroyed = false
  let codeAttempt = 0
  let resumeAttempt = 0
  let dropAttempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  /** The code phones are pointed at, and so the one a reconnect has to reclaim. */
  let wantedCode = preferredCode

  function claim(): void {
    if (destroyed) return
    retryTimer = null

    const resuming = Boolean(wantedCode) && resumeAttempt < RESUME_ATTEMPTS
    const code = resuming ? wantedCode! : generateRoomCode()
    const key = storedKeyFor(code) ?? randomUUID()
    const url = relayRoomUrl(relayBase, roomPath(code), { role: 'host', key })

    setFacts({
      role: 'host',
      roomCode: code,
      hostId: `relay ${new URL(relayBase).host}`,
      myId: null,
      broker: 'connecting',
    })
    logEvent(`Claiming ${code} on the relay${resuming ? ' (resuming)' : ''}`)

    socket = openRelaySocket(url, {
      onOpen() {
        // Not ready yet: the relay may still turn the code away.
      },
      onFrame(frame) {
        switch (frame['t']) {
          case 'ready':
            wantedCode = code
            resumeAttempt = 0
            codeAttempt = 0
            dropAttempt = 0
            storeKey(code, key)
            setFacts({ broker: 'open', attempt: 0, lastError: null })
            logEvent(`Room ${code} is open for phones`, 'good')
            handlers.onReady(code)
            return

          case 'open': {
            const id = frame['c']
            if (typeof id !== 'string') return
            connections.add(id)
            upsertPeer(id, { channel: 'open', ice: null, route: 'relay' })
            logEvent(`Phone connected (${short(id)}) — ${connections.size} on the line`, 'good')
            handlers.onConnect(id)
            return
          }

          case 'msg': {
            const id = frame['c']
            const data = frame['d']
            if (typeof id !== 'string' || typeof data !== 'string') return
            countReceived()
            // Silently drop malformed frames: a phone on a stale cached bundle
            // should not be able to crash the host everyone else is playing on.
            const message = parseClientMessage(parseJson(data))
            if (message) handlers.onMessage(id, message)
            return
          }

          case 'close': {
            const id = frame['c']
            if (typeof id !== 'string') return
            lose(id, 'dropped')
            return
          }
        }
      },
      onDrop(closeCode, reason) {
        socket = null
        if (destroyed) return
        setFacts({ broker: 'disconnected', lastError: `relay ${closeCode}: ${reason || 'closed'}` })
        logEvent(`Relay closed (${closeCode}${reason ? `: ${reason}` : ''})`, 'warn')

        // Whatever happened, the relay has let go of every phone.
        for (const id of [...connections]) lose(id, 'lost with the relay')

        handleDrop(closeCode, resuming)
      },
    })
  }

  function handleDrop(code: number, resuming: boolean): void {
    if (code === CLOSE.taken) {
      if (resuming) {
        resumeAttempt += 1
        retryTimer = setTimeout(claim, RESUME_RETRY_MS)
        return
      }
      codeAttempt += 1
      if (codeAttempt < MAX_CODE_ATTEMPTS) {
        claim()
        return
      }
      handlers.onFailure({ kind: 'unknown', detail: 'Could not find a free room code.' })
      return
    }

    if (code === CLOSE.replaced) {
      // This same room opened in another tab. Taking it back would only start
      // the two tabs fighting over it, so this one stands down.
      handlers.onFailure({
        kind: 'unknown',
        detail: 'This room was opened in another tab or window.',
      })
      return
    }

    if (code === CLOSE.badRequest) {
      handlers.onFailure({ kind: 'unknown', detail: 'The relay refused this room.' })
      return
    }

    // The network, a relay deploy, or a heartbeat that lapsed. All of them come
    // back by themselves, and the phones are waiting on the same code.
    handlers.onFailure({ kind: 'network' })
    reconnectSoon()
  }

  function reconnectSoon(): void {
    if (destroyed || retryTimer) return
    dropAttempt += 1
    const delay = Math.min(BASE_RETRY_MS * 2 ** (dropAttempt - 1), MAX_RETRY_MS)
    setFacts({ attempt: dropAttempt })
    logEvent(`Reconnecting to the relay in ${delay}ms`, 'warn')
    retryTimer = setTimeout(claim, delay)
  }

  function lose(id: ConnId, how: string): void {
    if (!connections.delete(id)) return
    closePeer(id)
    logEvent(`Phone ${how} (${short(id)}) — ${connections.size} left`, 'warn')
    handlers.onDisconnect(id)
  }

  function send(frame: HostToRelay): void {
    if (socket?.send(frame)) countSent()
  }

  /**
   * The host cannot re-dial anyone — phones dial it — so coming back to the
   * foreground its whole job is to make sure it is reachable again.
   */
  function onVisible(): void {
    if (document.visibilityState !== 'visible' || destroyed) return
    if (socket?.open) {
      socket.probe()
      return
    }
    if (!socket && retryTimer) {
      // Waiting out a backoff the background may have stretched; go now.
      clearTimeout(retryTimer)
      retryTimer = null
      dropAttempt = 0
      logEvent('Back in the foreground — reconnecting to the relay now', 'warn')
      claim()
    }
  }

  claim()
  document.addEventListener('visibilitychange', onVisible)

  return {
    send(id, message: HostMessage) {
      if (connections.has(id)) send({ t: 'send', c: id, d: JSON.stringify(message) })
    },
    broadcast(message: HostMessage) {
      if (connections.size > 0) send({ t: 'all', d: JSON.stringify(message) })
    },
    disconnect(id) {
      if (connections.delete(id)) {
        closePeer(id)
        send({ t: 'kick', c: id })
      }
    },
    destroy() {
      destroyed = true
      document.removeEventListener('visibilitychange', onVisible)
      if (retryTimer) clearTimeout(retryTimer)
      logEvent('Room closed')
      setFacts({ broker: 'closed' })
      for (const id of connections) closePeer(id)
      connections.clear()
      socket?.close()
      socket = null
    },
  }
}

function storedKeyFor(code: string): string | null {
  try {
    const raw = localStorage.getItem(KEY_STORAGE)
    if (!raw) return null
    const saved = JSON.parse(raw) as { code?: unknown; key?: unknown }
    return saved.code === code && typeof saved.key === 'string' ? saved.key : null
  } catch {
    return null
  }
}

function storeKey(code: string, key: string): void {
  try {
    localStorage.setItem(KEY_STORAGE, JSON.stringify({ code, key }))
  } catch {
    // Without storage a reload rolls a new code; the game still works.
  }
}

/** Connection IDs are long and only their tail distinguishes one phone. */
function short(id: ConnId): string {
  return id.slice(-6)
}
