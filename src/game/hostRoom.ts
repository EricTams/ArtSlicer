import { createPeerHost } from '../net/peerHost'
import type { ConnId, ConnectionFailure, HostTransport } from '../net/transport'
import { type ClientMessage, PROTOCOL_VERSION } from '../shared/protocol'
import { type PlayerId, type RoomState, createRoom, publicPlayers } from '../shared/gameState'
import { canStart, reduce } from './reducer'

export interface HostRoomHandlers {
  onStateChange(state: RoomState): void
  onReady(roomCode: string): void
  onFailure(failure: ConnectionFailure): void
}

/**
 * Owns the authoritative room: applies the pure reducer to messages arriving
 * from phones, then broadcasts the result. All game truth lives here.
 */
export function createHostRoom(handlers: HostRoomHandlers) {
  let state: RoomState = createRoom('')
  let transport: HostTransport | null = null

  /** Which player each live connection is authenticated as. */
  const connToPlayer = new Map<ConnId, PlayerId>()

  function setState(next: RoomState): void {
    if (next === state) return
    state = next
    handlers.onStateChange(state)
    broadcastState()
  }

  function broadcastState(): void {
    const players = publicPlayers(state)
    const startable = canStart(state)
    // `you` differs per recipient, so this can't be a single broadcast frame.
    for (const [conn, playerId] of connToPlayer) {
      transport?.send(conn, {
        t: 'state',
        phase: state.phase,
        roomCode: state.roomCode,
        players,
        you: playerId,
        roundIndex: state.roundIndex,
        canStart: startable && state.leaderId === playerId,
      })
    }
  }

  function handleMessage(conn: ConnId, message: ClientMessage): void {
    switch (message.t) {
      case 'hello': {
        if (message.protocol !== PROTOCOL_VERSION) {
          // Almost always a phone holding a stale cached bundle from Pages.
          transport?.send(conn, {
            t: 'error',
            code: 'protocol-mismatch',
            message: 'Your game is out of date. Close the tab and reopen the link.',
          })
          return
        }

        const result = reduce(state, {
          type: 'JOIN',
          playerId: message.playerId,
          secret: message.secret,
          name: message.name,
          avatarId: message.avatarId,
          now: Date.now(),
        })

        if (result.rejection) {
          transport?.send(conn, { t: 'error', ...result.rejection })
          return
        }

        // Drop any older connection for this player, otherwise a reconnecting
        // phone leaves a zombie socket that still receives broadcasts.
        for (const [otherConn, playerId] of connToPlayer) {
          if (playerId === message.playerId && otherConn !== conn) {
            connToPlayer.delete(otherConn)
            transport?.disconnect(otherConn)
          }
        }

        connToPlayer.set(conn, message.playerId)
        transport?.send(conn, {
          t: 'welcome',
          you: message.playerId,
          roomCode: state.roomCode,
          hostTime: Date.now(),
        })
        setState(result.state)
        broadcastState()
        return
      }

      case 'start': {
        const playerId = connToPlayer.get(conn)
        if (!playerId) return
        const result = reduce(state, { type: 'START', playerId })
        if (result.rejection) {
          transport?.send(conn, { t: 'error', ...result.rejection })
          return
        }
        setState(result.state)
        return
      }

      case 'ping':
        transport?.send(conn, { t: 'pong', clientTime: message.clientTime, hostTime: Date.now() })
        return
    }
  }

  transport = createPeerHost({
    onReady(roomCode) {
      state = { ...state, roomCode }
      handlers.onStateChange(state)
      handlers.onReady(roomCode)
    },
    onConnect() {
      // Nothing to do until the client identifies itself with `hello`.
    },
    onMessage: handleMessage,
    onDisconnect(conn) {
      const playerId = connToPlayer.get(conn)
      connToPlayer.delete(conn)
      if (!playerId) return
      // Another connection may already have taken over this seat (fast
      // reconnect); only mark the player gone if none remains.
      if ([...connToPlayer.values()].includes(playerId)) return
      setState(reduce(state, { type: 'DISCONNECT', playerId }).state)
    },
    onFailure: handlers.onFailure,
  })

  return {
    getState: () => state,
    destroy() {
      transport?.destroy()
      transport = null
    },
  }
}
