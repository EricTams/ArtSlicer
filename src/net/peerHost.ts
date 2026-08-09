import Peer, { type DataConnection } from 'peerjs'

import { generateRoomCode, roomCodeToPeerId } from '../shared/roomCode'
import { peerOptions } from './peerOptions'
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
 * Hosts a room by claiming `artslicer-<CODE>` as its peer ID on the PeerJS
 * broker. Because the ID *is* the room code, phones can derive it from the QR
 * link alone — no lookup service, no database.
 */
export function createPeerHost(handlers: HostHandlers): HostTransport & { destroy(): void } {
  const connections = new Map<ConnId, DataConnection>()
  let peer: Peer | null = null
  let destroyed = false
  let attempt = 0

  function claim(): void {
    if (destroyed) return

    attempt += 1
    const roomCode = generateRoomCode()
    const current = new Peer(roomCodeToPeerId(roomCode), peerOptions())
    peer = current

    current.on('open', () => {
      if (destroyed) return
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

      // The public broker is shared with every other PeerJS app and its docs
      // warn that manually-set IDs collide, so re-roll rather than give up.
      if (err.type === 'unavailable-id' && attempt < MAX_CODE_ATTEMPTS) {
        current.destroy()
        claim()
        return
      }

      handlers.onFailure(toFailure(err))
    })

    current.on('disconnected', () => {
      // Lost the broker (not the peers). Existing games keep working, but new
      // players can't join until signaling is back.
      if (!destroyed) current.reconnect()
    })
  }

  function registerConnection(conn: DataConnection): void {
    const id = conn.connectionId
    connections.set(id, conn)

    conn.on('open', () => {
      if (!destroyed) handlers.onConnect(id)
    })

    conn.on('data', (data) => {
      const message = parseClientMessage(data)
      // Silently drop malformed frames: a phone on a stale cached bundle
      // should not be able to crash the host everyone else is playing on.
      if (message && !destroyed) handlers.onMessage(id, message)
    })

    conn.on('close', () => {
      connections.delete(id)
      if (!destroyed) handlers.onDisconnect(id)
    })

    conn.on('error', () => {
      connections.delete(id)
      if (!destroyed) handlers.onDisconnect(id)
    })

    watchIce(conn, () => {
      if (!destroyed) handlers.onDisconnect(id)
    })
  }

  claim()

  return {
    send(id, message: HostMessage) {
      const conn = connections.get(id)
      if (conn?.open) conn.send(message)
    },
    broadcast(message: HostMessage) {
      for (const conn of connections.values()) {
        if (conn.open) conn.send(message)
      }
    },
    disconnect(id) {
      connections.get(id)?.close()
      connections.delete(id)
    },
    destroy() {
      destroyed = true
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
 */
export function watchIce(conn: DataConnection, onFailed: () => void): void {
  const pc = conn.peerConnection as RTCPeerConnection | undefined
  if (!pc) return
  pc.addEventListener('iceconnectionstatechange', () => {
    if (pc.iceConnectionState === 'failed') onFailed()
  })
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
