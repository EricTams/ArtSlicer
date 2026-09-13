import { upsertPeer } from '../net/diagnostics'
import { createPeerHost } from '../net/peerHost'
import type {
  ClientHandlers,
  ClientTransport,
  ConnId,
  ConnectionFailure,
  HostTransport,
} from '../net/transport'
import { isKnownPiece } from '../render/pieces'
import {
  type ClientMessage,
  type HostMessage,
  PROTOCOL_VERSION,
  type RevealedEntry,
} from '../shared/protocol'
import { type PlayerId, type RoomState, createRoom, publicPlayers } from '../shared/gameState'
import { randomUUID } from '../shared/randomId'
import { BUILD_SHA } from '../version'
import { sanitizeScene } from '../shared/scene'
import { loadRoom, saveRoom, touchRoom } from './persistence'
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
 * How often to record that the host is still here. Frequent enough that the
 * two-minute absence test is answering about the host rather than about the
 * last thing that happened in the game, rare enough not to touch storage on
 * every tick.
 */
const ALIVE_EVERY_MS = 5_000

/**
 * A tick this far behind schedule means the tab was suspended rather than
 * merely busy. Well above normal timer jitter and background throttling.
 */
const SUSPENSION_THRESHOLD_MS = 5_000

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

  /**
   * The player hosting on this device, if any. They are treated as an ordinary
   * connection so their messages run through exactly the same validation as a
   * remote phone's — there is no privileged local path to drift out of sync.
   */
  const LOCAL_CONN: ConnId = 'local'
  let localHandlers: ClientHandlers | null = null

  function sendTo(conn: ConnId, message: HostMessage): void {
    if (conn === LOCAL_CONN) localHandlers?.onMessage(message)
    else transport?.send(conn, message)
  }

  function disconnectConn(conn: ConnId): void {
    if (conn !== LOCAL_CONN) transport?.disconnect(conn)
  }

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
      sendTo(conn, {
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

  /**
   * The player this connection is authenticated as, or nothing — having first
   * told it so. Silence here is how a client that has lost its seat goes on
   * submitting into a room that is not listening, with no symptom anywhere
   * near the cause.
   */
  function seatedPlayer(conn: ConnId): PlayerId | null {
    const playerId = connToPlayer.get(conn)
    if (playerId) return playerId
    sendTo(conn, {
      t: 'error',
      code: 'not-seated',
      message: 'You are not seated in this room.',
    })
    return null
  }

  function handleMessage(conn: ConnId, message: ClientMessage): void {
    switch (message.t) {
      case 'hello': {
        if (message.protocol !== PROTOCOL_VERSION || message.build !== BUILD_SHA) {
          /*
           * Almost always a phone holding a stale cached bundle from Pages —
           * or a fresh one that arrived after a deploy the host has not picked
           * up. Either way the two are not the same game, and letting them
           * play anyway is how a room ends up disagreeing about what happened.
           *
           * Neither side is told it is the stale one, because either could be:
           * a host open since before a deploy is the old one, and a phone that
           * just loaded is the new one.
           */
          sendTo(conn, {
            t: 'error',
            code: 'protocol-mismatch',
            message: 'This room is running a different version. Reload the page and rejoin.',
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
          sendTo(conn, { t: 'error', ...result.rejection })
          return
        }

        // Drop any older connection for this player, otherwise a reconnecting
        // phone leaves a zombie socket that still receives broadcasts.
        for (const [otherConn, playerId] of connToPlayer) {
          if (playerId === message.playerId && otherConn !== conn) {
            connToPlayer.delete(otherConn)
            disconnectConn(otherConn)
          }
        }

        connToPlayer.set(conn, message.playerId)
        // Name the connection in the debug panel: on a host with five phones
        // on the line, "Priya" locates a problem and a connection ID does not.
        const seated = result.state.players.find((player) => player.id === message.playerId)
        upsertPeer(conn, { label: seated?.name ?? message.playerId })
        sendTo(conn, {
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
        const playerId = seatedPlayer(conn)
        if (!playerId) return
        apply(conn, reduce(state, { type: 'START', playerId, now: Date.now() }))
        return
      }

      case 'restart': {
        const playerId = seatedPlayer(conn)
        if (!playerId) return
        apply(conn, reduce(state, { type: 'RESTART', playerId }))
        return
      }

      case 'submit': {
        const playerId = seatedPlayer(conn)
        if (!playerId) return

        // Clients are not trusted: clamp the scene and reject unknown piece
        // ids before this ever reaches the shared screen.
        const scene = sanitizeScene(message.scene, isKnownPiece)
        if (!scene) {
          sendTo(conn, {
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
            entryId: randomUUID().slice(0, 8),
            now: Date.now(),
          }),
        )
        return
      }

      case 'vote': {
        const playerId = seatedPlayer(conn)
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
        sendTo(conn, {
          t: 'pong',
          clientTime: message.clientTime,
          hostTime: Date.now(),
        })
        return
    }
  }

  function apply(conn: ConnId, result: ReturnType<typeof reduce>): void {
    if (result.rejection) {
      sendTo(conn, { t: 'error', ...result.rejection })
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
  let lastTick = Date.now()
  let lastBeat = 0
  const timer = setInterval(() => {
    const now = Date.now()
    const gap = now - lastTick
    lastTick = now

    // Only while there is a game to come back to; saveRoom clears the snapshot
    // in the lobby and at the final scores, and a heartbeat without one would
    // outlive it.
    const resumable = state.phase !== 'lobby' && state.phase !== 'finalResults'
    if (resumable && now - lastBeat >= ALIVE_EVERY_MS) {
      lastBeat = now
      touchRoom()
    }

    // A gap far larger than the interval means this tab was suspended — the
    // host backgrounded the page or the laptop slept. Timers stop, but
    // Date.now() does not, so the deadline would look long expired and the
    // reducer would blow through phases. Push deadlines out by the gap instead:
    // time nobody could play is not play time.
    if (gap > SUSPENSION_THRESHOLD_MS) {
      setState(reduce(state, { type: 'SUSPENDED', gap }).state)
      return
    }

    if (state.deadline === null) return
    setState(reduce(state, { type: 'TICK', now }).state)
  }, TICK_MS)

  return {
    getState: () => state,

    /**
     * Connects the player hosting on this device. Returns the same
     * ClientTransport shape a remote phone gets, so the player UI cannot tell
     * the difference and no second code path exists.
     */
    attachLocalClient(clientHandlers: ClientHandlers): ClientTransport {
      localHandlers = clientHandlers
      // Asynchronous so the caller finishes wiring up before messages arrive.
      queueMicrotask(() => localHandlers?.onOpen())

      return {
        send(message) {
          handleMessage(LOCAL_CONN, message)
        },
        destroy() {
          // Only if this is still the live client. A replacement may already
          // have attached and taken the seat, and tearing down then would drop
          // the player who is sitting in it — the same reason the remote path
          // checks whether another connection has taken the seat over.
          if (localHandlers !== clientHandlers) return
          localHandlers = null
          const playerId = connToPlayer.get(LOCAL_CONN)
          connToPlayer.delete(LOCAL_CONN)
          if (playerId) setState(reduce(state, { type: 'DISCONNECT', playerId }).state)
        },
      }
    },

    destroy() {
      clearInterval(timer)
      localHandlers = null
      transport?.destroy()
      transport = null
    },
  }
}

export type HostRoom = ReturnType<typeof createHostRoom>
