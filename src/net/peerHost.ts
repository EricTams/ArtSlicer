import Peer, { type DataConnection } from 'peerjs'

import { generateRoomCode, roomCodeToPeerId } from '../shared/roomCode'
import {
  closePeer,
  countReceived,
  countSent,
  logEvent,
  registerSampler,
  resetDiagnostics,
  sampleRoute,
  setFacts,
  upsertPeer,
} from './diagnostics'
import { peerOptions } from './peerOptions'
import { revivalFor, survivedSuspend } from './revival'
import { type ClientMessage, type HostMessage, parseClientMessage } from '../shared/protocol'
import type { ConnId, ConnectionFailure, HostTransport } from './transport'

export interface HostHandlers {
  /** The room code was claimed on the broker and phones can now connect. */
  onReady(roomCode: string): void
  onConnect(conn: ConnId): void
  onMessage(conn: ConnId, message: ClientMessage): void
  onDisconnect(conn: ConnId): void
  onFailure(failure: ConnectionFailure): void
}

/** How many times to re-roll the room code when the broker says it's taken. */
const MAX_CODE_ATTEMPTS = 5

/**
 * When resuming, the old peer may still be registered for a moment after the
 * tab that held it went away, so retry the same code before giving up on it.
 */
const RESUME_ATTEMPTS = 3
const RESUME_RETRY_MS = 1200

/**
 * Hosts a room by claiming `artslicer-<CODE>` as its peer ID on the PeerJS
 * broker. Because the ID *is* the room code, phones can derive it from the QR
 * link alone — no lookup service, no database.
 */
export function createPeerHost(
  handlers: HostHandlers,
  /** Reclaim this exact code when resuming an interrupted game. */
  preferredCode?: string,
): HostTransport & { destroy(): void } {
  const connections = new Map<ConnId, DataConnection>()
  resetDiagnostics()
  let peer: Peer | null = null
  let destroyed = false
  let attempt = 0
  let resumeAttempt = 0
  /** The code phones are pointed at, and so the one a resume has to reclaim. */
  let activeCode: string | null = preferredCode ?? null
  let wantedCode = preferredCode

  function claim(): void {
    if (destroyed) return

    attempt += 1
    // Keep asking for the saved code until it frees up; only then fall back to
    // a fresh one, because every phone in the room is pointed at the old code.
    const resuming = Boolean(wantedCode) && resumeAttempt < RESUME_ATTEMPTS
    const roomCode = resuming ? wantedCode! : generateRoomCode()
    activeCode = roomCode
    const hostId = roomCodeToPeerId(roomCode)
    const current = new Peer(hostId, peerOptions())
    peer = current
    setFacts({ role: 'host', roomCode, hostId, myId: hostId, broker: 'connecting' })
    logEvent(`Claiming ${hostId}${resuming ? ' (resuming)' : ''}`)

    current.on('open', () => {
      if (destroyed) return
      setFacts({ broker: 'open', attempt })
      logEvent(`Room ${roomCode} is open for phones`, 'good')
      handlers.onReady(roomCode)
    })

    current.on('connection', (conn) => {
      if (destroyed) {
        conn.close()
        return
      }
      registerConnection(conn)
    })

    current.on('error', (err) => {
      if (destroyed) return
      setFacts({ lastError: `${err.type ?? 'error'}: ${err.message ?? '?'}` })
      logEvent(`Error — ${err.type ?? 'error'}: ${err.message ?? '?'}`, 'bad')

      if (err.type === 'unavailable-id') {
        // Resuming: the previous tab's peer may not have been released yet, so
        // wait and ask for the same code again before abandoning it.
        if (resuming) {
          resumeAttempt += 1
          current.destroy()
          setTimeout(() => claim(), RESUME_RETRY_MS)
          return
        }
        // The public broker is shared with every other PeerJS app and its docs
        // warn that manually-set IDs collide, so re-roll rather than give up.
        if (attempt < MAX_CODE_ATTEMPTS) {
          current.destroy()
          claim()
          return
        }
      }

      handlers.onFailure(toFailure(err))
    })

    current.on('disconnected', () => {
      // Lost the broker (not the peers). Existing games keep working, but new
      // players can't join until signaling is back.
      setFacts({ broker: 'disconnected' })
      logEvent('Lost the broker — no new phones can join until it is back', 'warn')
      if (!destroyed) current.reconnect()
    })
  }

  function registerConnection(conn: DataConnection): void {
    const id = conn.connectionId
    connections.set(id, conn)
    upsertPeer(id, { channel: 'connecting' })

    conn.on('open', () => {
      upsertPeer(id, { channel: 'open' })
      logEvent(`Phone connected (${short(id)}) — ${connections.size} on the line`, 'good')
      if (!destroyed) handlers.onConnect(id)
    })

    conn.on('data', (data) => {
      const message = parseClientMessage(data)
      countReceived()
      // Silently drop malformed frames: a phone on a stale cached bundle
      // should not be able to crash the host everyone else is playing on.
      if (message && !destroyed) handlers.onMessage(id, message)
    })

    conn.on('close', () => {
      connections.delete(id)
      closePeer(id)
      logEvent(`Phone dropped (${short(id)}) — ${connections.size} left`, 'warn')
      if (!destroyed) handlers.onDisconnect(id)
    })

    conn.on('error', (err) => {
      connections.delete(id)
      closePeer(id)
      setFacts({ lastError: `conn ${short(id)}: ${err.message}` })
      logEvent(`Phone errored (${short(id)}): ${err.message}`, 'bad')
      if (!destroyed) handlers.onDisconnect(id)
    })

    watchIce(conn, () => {
      if (!destroyed) handlers.onDisconnect(id)
    })
  }

  /** Forget a connection and tell the game its seat emptied. */
  function drop(id: ConnId): void {
    const conn = connections.get(id)
    connections.delete(id)
    closePeer(id)
    conn?.close()
    logEvent(`Phone lost to the suspend (${short(id)}) — ${connections.size} left`, 'warn')
    if (!destroyed) handlers.onDisconnect(id)
  }

  function reapDead(): void {
    for (const [id, conn] of [...connections]) {
      const pc = conn.peerConnection as RTCPeerConnection | undefined
      if (!survivedSuspend(pc?.iceConnectionState)) drop(id)
    }
  }

  /**
   * A phone hosting the room is a phone that will be locked, or swapped away
   * from to read the group chat. hostRoom already keeps the game clock honest
   * across that — deadlines move out by the gap nobody could play. The
   * connections had no such protection: they die in the background and nothing
   * was putting them back, so the room stayed on screen with every phone
   * quietly unable to reach it.
   *
   * The host cannot re-dial anyone — phones dial it, never the other way
   * round — so its whole job here is to become reachable again and let each
   * phone's own foreground reconnect do the rest.
   */
  function onVisible(): void {
    if (document.visibilityState !== 'visible' || destroyed) return

    const revival = revivalFor(peer)

    if (revival === 'reclaim') {
      logEvent('Back in the foreground with no peer — reclaiming the room', 'warn')
      // Ask for the code already on screen and on every phone, not a new one.
      for (const id of [...connections.keys()]) drop(id)
      wantedCode = activeCode ?? undefined
      resumeAttempt = 0
      attempt = 0
      claim()
      return
    }

    if (revival === 'reconnect') {
      logEvent('Back in the foreground with the broker down — reconnecting', 'warn')
      setFacts({ broker: 'connecting' })
      peer?.reconnect()
    }

    reapDead()
  }

  claim()
  document.addEventListener('visibilitychange', onVisible)

  return {
    send(id, message: HostMessage) {
      const conn = connections.get(id)
      if (conn?.open) {
        conn.send(message)
        countSent()
      }
    },
    broadcast(message: HostMessage) {
      for (const conn of connections.values()) {
        if (conn.open) {
          conn.send(message)
          countSent()
        }
      }
    },
    disconnect(id) {
      connections.get(id)?.close()
      connections.delete(id)
    },
    destroy() {
      destroyed = true
      document.removeEventListener('visibilitychange', onVisible)
      logEvent('Room closed')
      setFacts({ broker: 'closed' })
      for (const id of connections.keys()) closePeer(id)
      for (const conn of connections.values()) conn.close()
      connections.clear()
      peer?.destroy()
      peer = null
    },
  }
}

/**
 * PeerJS reports a dead DataChannel slowly. Watching ICE directly surfaces the
 * no-TURN failure mode fast enough to show a useful message.
 *
 * The same listener feeds the debug panel, because ICE is where a join that
 * "just doesn't work" actually dies, and the state it dies in is the whole
 * diagnosis: `checking` forever means the two devices never found a path.
 */
export function watchIce(conn: DataConnection, onFailed: () => void): void {
  const pc = conn.peerConnection as RTCPeerConnection | undefined
  if (!pc) return
  const id = conn.connectionId

  // The panel asks for the route when somebody opens it; only a live
  // connection can answer, so each one lends it a sampler while it lasts.
  const unregister = registerSampler(() => void sampleRoute(pc, id))
  conn.on('close', unregister)

  upsertPeer(id, { ice: pc.iceConnectionState })
  pc.addEventListener('iceconnectionstatechange', () => {
    const state = pc.iceConnectionState
    upsertPeer(id, { ice: state })
    logEvent(`ICE ${state} (${short(id)})`, iceTone(state))
    // Connected is the moment a candidate pair exists to report.
    if (state === 'connected' || state === 'completed') void sampleRoute(pc, id)
    if (state === 'failed') {
      unregister()
      onFailed()
    }
  })
}

function iceTone(state: RTCIceConnectionState): 'good' | 'warn' | 'bad' | 'info' {
  if (state === 'connected' || state === 'completed') return 'good'
  if (state === 'failed') return 'bad'
  if (state === 'disconnected') return 'warn'
  return 'info'
}

/** Connection IDs are long and only their tail distinguishes one phone. */
function short(id: ConnId): string {
  return id.slice(-6)
}

export function toFailure(err: { type?: string; message?: string }): ConnectionFailure {
  switch (err.type) {
    case 'peer-unavailable':
      return { kind: 'room-not-found' }
    case 'browser-incompatible':
      return { kind: 'unsupported' }
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return { kind: 'network' }
    default:
      return { kind: 'unknown', detail: err.message ?? err.type ?? 'unknown error' }
  }
}
