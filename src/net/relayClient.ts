import { type ClientMessage, parseHostMessage } from '../shared/protocol'
import { normalizeRoomCode } from '../shared/roomCode'
import {
  closePeer,
  countReceived,
  countSent,
  logEvent,
  resetDiagnostics,
  setFacts,
  upsertPeer,
} from './diagnostics'
import { CLOSE, type ClientToRelay, parseJson, roomPath } from './relayProtocol'
import { type RelaySocket, openRelaySocket, relayRoomUrl } from './relaySocket'
import type { ClientHandlers, ClientTransport } from './transport'

const BASE_RETRY_MS = 800
const MAX_RETRY_MS = 8000

/**
 * Connects a phone to its host through the WebSocket relay.
 *
 * The same shape as the WebRTC client: reconnection is the main event, since
 * phones lock and browsers freeze background tabs. What changes is that there
 * is no path to negotiate — if the phone loaded the page, it can reach the
 * relay, on cellular or anywhere else.
 */
export function createRelayClient(
  relayBase: string,
  roomCode: string,
  handlers: ClientHandlers,
): ClientTransport {
  const code = normalizeRoomCode(roomCode)
  const url = relayRoomUrl(relayBase, roomPath(code), { role: 'client' })
  resetDiagnostics()
  setFacts({ role: 'client', roomCode: code, hostId: `relay ${new URL(relayBase).host}` })
  logEvent(`Joining room ${code} through the relay`)

  let socket: RelaySocket | null = null
  /** This phone's id on the relay, once it has said ready. */
  let myId: string | null = null
  let destroyed = false
  let attempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleRetry(): void {
    if (destroyed || retryTimer) return
    attempt += 1
    handlers.onReconnecting(attempt)
    // Back off so a host that is genuinely gone isn't hammered by every phone
    // in the room at once.
    const delay = Math.min(BASE_RETRY_MS * 2 ** (attempt - 1), MAX_RETRY_MS)
    setFacts({ attempt })
    logEvent(`Retry ${attempt} in ${delay}ms`, 'warn')
    retryTimer = setTimeout(() => {
      retryTimer = null
      connect()
    }, delay)
  }

  function connect(): void {
    if (destroyed) return
    const previous = socket
    socket = null
    previous?.close()
    setFacts({ broker: 'connecting' })

    const current: RelaySocket = openRelaySocket(url, {
      onOpen() {
        setFacts({ broker: 'open' })
      },
      onFrame(frame) {
        if (frame['t'] === 'ready' && typeof frame['c'] === 'string') {
          myId = frame['c']
          attempt = 0
          setFacts({ myId, attempt: 0, lastError: null })
          upsertPeer(myId, { label: `host ${code}`, channel: 'open', route: 'relay' })
          logEvent('Connected to host', 'good')
          handlers.onOpen()
          return
        }
        if (frame['t'] === 'msg' && typeof frame['d'] === 'string') {
          countReceived()
          const message = parseHostMessage(parseJson(frame['d']))
          if (message) handlers.onMessage(message)
        }
      },
      onDrop(closeCode, reason) {
        // A socket this transport has already replaced has nothing to report.
        if (socket !== current) return
        socket = null
        if (myId) closePeer(myId)
        myId = null
        if (destroyed) return
        setFacts({ broker: 'closed', lastError: `relay ${closeCode}: ${reason || 'closed'}` })
        logEvent(`Relay closed (${closeCode}${reason ? `: ${reason}` : ''})`, 'warn')

        switch (closeCode) {
          case CLOSE.noHost:
            // The host may simply not have claimed its code yet.
            handlers.onFailure({ kind: 'room-not-found' })
            scheduleRetry()
            return
          case CLOSE.full:
            handlers.onFailure({ kind: 'unknown', detail: 'That room is full.' })
            return
          case CLOSE.badRequest:
            handlers.onFailure({ kind: 'unknown', detail: reason || 'The relay refused this room.' })
            return
          default:
            // The host left or reconnected, the network blinked, or the relay
            // was redeployed. All of them are worth another try.
            scheduleRetry()
        }
      },
    })
    socket = current
  }

  connect()

  /**
   * Coming back to the foreground is the reliable moment to notice a socket
   * that died while the tab was frozen.
   */
  const onVisible = (): void => {
    if (document.visibilityState !== 'visible' || destroyed) return
    if (socket?.open) {
      socket.probe()
      return
    }
    if (!socket) {
      logEvent('Back in the foreground with no connection — reconnecting')
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
      attempt = 0
      connect()
    }
  }
  document.addEventListener('visibilitychange', onVisible)

  return {
    send(message: ClientMessage) {
      const frame: ClientToRelay = { t: 'msg', d: JSON.stringify(message) }
      if (myId && socket?.send(frame)) countSent()
    },
    destroy() {
      destroyed = true
      logEvent('Transport torn down')
      setFacts({ broker: 'closed' })
      if (myId) closePeer(myId)
      document.removeEventListener('visibilitychange', onVisible)
      if (retryTimer) clearTimeout(retryTimer)
      socket?.close()
      socket = null
    },
  }
}
