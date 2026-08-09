import { createPeerHost } from '../net/peerHost'
import type { ConnId, ConnectionFailure, HostTransport } from '../net/transport'
import { isKnownPiece } from '../render/pieces'
import { type ClientMessage, PROTOCOL_VERSION, type RevealedEntry } from '../shared/protocol'
import { type PlayerId, type RoomState, createRoom, publicPlayers } from '../shared/gameState'
import { sanitizeScene } from '../shared/scene'
import { loadRoom, saveRoom } from './persistence'
import { ballotFor, canStart, reduce } from './reducer'
import { tallyRound } from './scoring'

export interface HostRoomHandlers {
  onStateChange(state: RoomState): void
  onReady(roomCode: string): void
  onFailure(failure: ConnectionFailure): void
}

/** How often the host checks whether the current phase has run out of time. */
const TICK_MS = 250

/**
 * Owns the authoritative room: applies the pure reducer to messages arriving
 * from phones, then broadcasts the result. All game truth lives here, and the
 * host owns every deadline so no phone can rush or stall a round.
 */
export function createHostRoom(handlers: HostRoomHandlers) {
  // A game interrupted mid-round is picked back up under its original room
  // code, so the phones already pointed at it simply reconnect.
  const resumed = loadRoom()
  let state: RoomState = resumed ?? createRoom('')
  let transport: HostTransport | null = null

  /** Which player each live connection is authenticated as. */
  const connToPlayer = new Map<ConnId, PlayerId>()

  function setState(next: RoomState): void {
    if (next === state) return
    state = next
    saveRoom(state)
    handlers.onStateChange(state)
    broadcastState()
  }

  function broadcastState(): void {
    const players = publicPlayers(state)
    const startable = canStart(state)
    const reveal = state.phase === 'roundResults' ? buildReveal() : undefined

    // `you`, the ballot, and the player's own vote all differ per recipient,
    // so this cannot be a single broadcast frame.
    for (const [conn, playerId] of connToPlayer) {
      transport?.send(conn, {
        t: 'state',
        phase: state.phase,
        roomCode: state.roomCode,
        players,
        you: playerId,
        roundIndex: state.roundIndex,
        totalRounds: state.totalRounds,
        canStart: startable && state.leaderId === playerId,
        prompt: state.prompt,
        deadline: state.deadline,
        ...(state.phase === 'voting'
          ? {
              ballot: ballotFor(state, playerId).map((entry) => ({
                entryId: entry.entryId,
                scene: entry.scene,
              })),
              yourVote: state.votes[playerId],
            }
          : {}),
        ...(reveal ? { reveal, winners: state.lastRoundWinners } : {}),
        youSubmitted: state.submissions.some((entry) => entry.playerId === playerId),
        canRestart: state.phase === 'finalResults' && state.leaderId === playerId,
      })
    }
  }

  /** Authorship and scores, revealed only once voting has closed. */
  function buildReveal(): RevealedEntry[] {
    const { votesByEntry } = tallyRound(state.submissions, state.votes)
    return state.submissions
      .map((entry) => ({
        entryId: entry.entryId,
        scene: entry.scene,
        playerId: entry.playerId,
        votes: votesByEntry[entry.entryId] ?? 0,
        points: state.lastRoundPoints[entry.playerId] ?? 0,
      }))
      .sort((a, b) => b.votes - a.votes)
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
        apply(conn, reduce(state, { type: 'START', playerId, now: Date.now() }))
        return
      }

      case 'restart': {
        const playerId = connToPlayer.get(conn)
        if (!playerId) return
        apply(conn, reduce(state, { type: 'RESTART', playerId }))
        return
      }

      case 'submit': {
        const playerId = connToPlayer.get(conn)
        if (!playerId) return

        // Clients are not trusted: clamp the scene and reject unknown piece
        // ids before this ever reaches the shared screen.
        const scene = sanitizeScene(message.scene, isKnownPiece)
        if (!scene) {
          transport?.send(conn, {
            t: 'error',
            code: 'invalid',
            message: 'That artwork could not be read.',
          })
          return
        }

        apply(
          conn,
          reduce(state, {
            type: 'SUBMIT',
            playerId,
            scene,
            entryId: crypto.randomUUID().slice(0, 8),
            now: Date.now(),
          }),
        )
        return
      }

      case 'vote': {
        const playerId = connToPlayer.get(conn)
        if (!playerId) return
        apply(
          conn,
          reduce(state, {
            type: 'VOTE',
            playerId,
            entryId: message.entryId,
            now: Date.now(),
          }),
        )
        return
      }

      case 'ping':
        transport?.send(conn, {
          t: 'pong',
          clientTime: message.clientTime,
          hostTime: Date.now(),
        })
        return
    }
  }

  function apply(conn: ConnId, result: ReturnType<typeof reduce>): void {
    if (result.rejection) {
      transport?.send(conn, { t: 'error', ...result.rejection })
      return
    }
    setState(result.state)
  }

  transport = createPeerHost(
    {
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
    },
    resumed?.roomCode,
  )

  // Time only moves forward here. Phases also end early when everyone is done,
  // which the reducer handles on the triggering event itself.
  const timer = setInterval(() => {
    if (state.deadline === null) return
    setState(reduce(state, { type: 'TICK', now: Date.now() }).state)
  }, TICK_MS)

  return {
    getState: () => state,
    destroy() {
      clearInterval(timer)
      transport?.destroy()
      transport = null
    },
  }
}
