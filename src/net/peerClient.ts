import Peer, { type DataConnection } from 'peerjs'

import { roomCodeToPeerId } from '../shared/roomCode'
import { type ClientMessage, parseHostMessage } from '../shared/protocol'
import { toFailure, watchIce } from './peerHost'
import { peerOptions } from './peerOptions'
import type { ClientHandlers, ClientTransport } from './transport'

const BASE_RETRY_MS = 800
const MAX_RETRY_MS = 8000

/**
 * Connects a phone to the host. Reconnection is a first-class concern here,
 * not polish: phones lock their screens and browsers suspend background tabs,
 * both of which tear down a DataChannel mid-game.
 */
export function createPeerClient(roomCode: string, handlers: ClientHandlers): ClientTransport {
  const hostId = roomCodeToPeerId(roomCode)
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

    current.on('open', () => {
      if (destroyed) return
      const dc = current.connect(hostId, { reliable: true })
      conn = dc

      dc.on('open', () => {
        if (destroyed) return
        attempt = 0
        handlers.onOpen()
      })

      dc.on('data', (data) => {
        const message = parseHostMessage(data)
        if (message && !destroyed) handlers.onMessage(message)
      })

      dc.on('close', () => {
        if (!destroyed) scheduleRetry()
      })

      watchIce(dc, () => {
        if (!destroyed) handlers.onFailure({ kind: 'ice-failed' })
      })
    })

    current.on('error', (err) => {
      if (destroyed) return
      const failure = toFailure(err)
      // A missing host may just mean the laptop tab is still loading, so keep
      // retrying rather than declaring the room dead on the first miss.
      if (failure.kind === 'room-not-found' || failure.kind === 'network') {
        handlers.onFailure(failure)
        scheduleRetry()
        return
      }
      handlers.onFailure(failure)
    })
  }

  connect()

  /**
   * iOS Safari suspends background tabs and silently kills the DataChannel;
   * coming back to the foreground is the reliable moment to notice.
   */
  const onVisible = (): void => {
    if (document.visibilityState === 'visible' && !destroyed && !conn?.open) {
      attempt = 0
      connect()
    }
  }
  document.addEventListener('visibilitychange', onVisible)

  return {
    send(message: ClientMessage) {
      if (conn?.open) conn.send(message)
    },
    destroy() {
      destroyed = true
      document.removeEventListener('visibilitychange', onVisible)
      if (retryTimer) clearTimeout(retryTimer)
      conn?.close()
      peer?.destroy()
      peer = null
      conn = null
    },
  }
}
