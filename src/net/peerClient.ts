import Peer, { type DataConnection } from 'peerjs'

import { roomCodeToPeerId } from '../shared/roomCode'
import { type ClientMessage, parseHostMessage } from '../shared/protocol'
import {
  closePeer,
  countReceived,
  countSent,
  logEvent,
  resetDiagnostics,
  setFacts,
  upsertPeer,
} from './diagnostics'
import { watchIce } from './peerHost'
import { peerOptions } from './peerOptions'
import { type ClientHandlers, type ClientTransport, isRecoverable, toFailure } from './transport'

const BASE_RETRY_MS = 800
const MAX_RETRY_MS = 8000

/**
 * Connects a phone to the host. Reconnection is a first-class concern here,
 * not polish: phones lock their screens and browsers suspend background tabs,
 * both of which tear down a DataChannel mid-game.
 */
export function createPeerClient(roomCode: string, handlers: ClientHandlers): ClientTransport {
  const hostId = roomCodeToPeerId(roomCode)
  resetDiagnostics()
  setFacts({ role: 'client', roomCode, hostId })
  logEvent(`Joining room ${roomCode} (peer ${hostId})`)

  let peer: Peer | null = null
  let conn: DataConnection | null = null
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

    peer?.destroy()
    const current = new Peer(peerOptions())
    peer = current
    setFacts({ broker: 'connecting' })

    current.on('open', (id) => {
      if (destroyed) return
      setFacts({ broker: 'open', myId: id })
      logEvent(`Broker open, dialling ${hostId}`, 'good')

      const dc = current.connect(hostId, { reliable: true })
      conn = dc
      // The phone has exactly one connection, and it is the host — labelled as
      // such so the panel reads the same on both sides of the room.
      upsertPeer(dc.connectionId, { label: `host ${roomCode}`, channel: 'connecting' })

      dc.on('open', () => {
        if (destroyed) return
        attempt = 0
        setFacts({ attempt: 0, lastError: null })
        upsertPeer(dc.connectionId, { channel: 'open' })
        logEvent('Connected to host', 'good')
        handlers.onOpen()
      })

      dc.on('data', (data) => {
        const message = parseHostMessage(data)
        countReceived()
        if (message && !destroyed) handlers.onMessage(message)
      })

      dc.on('close', () => {
        closePeer(dc.connectionId)
        logEvent('Channel closed', 'warn')
        if (!destroyed) scheduleRetry()
      })

      watchIce(dc, () => {
        if (destroyed) return
        handlers.onFailure({ kind: 'ice-failed' })
        // PeerJS closes a connection whose ICE failed, and a close schedules
        // its own retry — but `close()` returns before emitting unless the
        // connection had opened. A first join that never got that far emits
        // nothing at all, so without this the phone simply stops here.
        scheduleRetry()
      })
    })

    // Losing the broker does not drop an established game, but it does stop a
    // fresh join dead — worth telling apart from the host being gone.
    current.on('disconnected', () => setFacts({ broker: 'disconnected' }))
    current.on('close', () => setFacts({ broker: 'closed' }))

    current.on('error', (err) => {
      if (destroyed) return
      const failure = toFailure(err)
      setFacts({ lastError: `${err.type ?? 'error'}: ${err.message ?? failure.kind}` })
      logEvent(`Error — ${failure.kind}: ${err.message ?? err.type ?? '?'}`, 'bad')
      handlers.onFailure(failure)
      // A missing host may just mean the laptop tab is still loading, so keep
      // retrying rather than declaring the room dead on the first miss.
      if (isRecoverable(failure)) scheduleRetry()
    })
  }

  connect()

  /**
   * iOS Safari suspends background tabs and silently kills the DataChannel;
   * coming back to the foreground is the reliable moment to notice.
   */
  const onVisible = (): void => {
    if (document.visibilityState === 'visible' && !destroyed && !conn?.open) {
      logEvent('Back in the foreground with no channel — reconnecting')
      attempt = 0
      connect()
    }
  }
  document.addEventListener('visibilitychange', onVisible)

  return {
    send(message: ClientMessage) {
      if (conn?.open) {
        conn.send(message)
        countSent()
      }
    },
    destroy() {
      destroyed = true
      logEvent('Transport torn down')
      setFacts({ broker: 'closed' })
      if (conn) closePeer(conn.connectionId)
      document.removeEventListener('visibilitychange', onVisible)
      if (retryTimer) clearTimeout(retryTimer)
      conn?.close()
      peer?.destroy()
      peer = null
      conn = null
    },
  }
}
