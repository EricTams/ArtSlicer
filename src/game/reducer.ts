import type { ErrorCode } from '../shared/protocol'
import {
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  type Player,
  type PlayerId,
  type RoomState,
  sanitizeName,
} from '../shared/gameState'

/**
 * Everything that can change the room. The reducer is pure — no React, no
 * PeerJS, no timers — so the whole game is testable without a browser.
 */
export type GameEvent =
  | {
      type: 'JOIN'
      playerId: PlayerId
      secret: string
      name: string
      avatarId: string
      now: number
    }
  | { type: 'DISCONNECT'; playerId: PlayerId }
  | { type: 'START'; playerId: PlayerId }

export type Rejection = { code: ErrorCode; message: string }

export interface ReduceResult {
  state: RoomState
  /** Set when the event was refused; state is returned unchanged. */
  rejection?: Rejection
}

export function reduce(state: RoomState, event: GameEvent): ReduceResult {
  switch (event.type) {
    case 'JOIN':
      return join(state, event)
    case 'DISCONNECT':
      return disconnect(state, event.playerId)
    case 'START':
      return start(state, event.playerId)
  }
}

function join(state: RoomState, event: Extract<GameEvent, { type: 'JOIN' }>): ReduceResult {
  const existing = state.players.find((p) => p.id === event.playerId)

  if (existing) {
    // Reclaiming a seat after a disconnect (screen lock, tab suspend, refresh).
    // The secret is what stops another client from stealing the seat.
    if (existing.secret !== event.secret) {
      return { state, rejection: { code: 'bad-secret', message: 'That seat belongs to someone else.' } }
    }
    const players = state.players.map((p) =>
      p.id === event.playerId
        ? { ...p, connected: true, name: sanitizeName(event.name) || p.name, avatarId: event.avatarId }
        : p,
    )
    return { state: withLeader({ ...state, players }) }
  }

  // New players may only arrive in the lobby; a game in progress is closed.
  if (state.phase !== 'lobby') {
    return { state, rejection: { code: 'game-in-progress', message: 'That game has already started.' } }
  }

  if (state.players.length >= MAX_PLAYERS) {
    return { state, rejection: { code: 'room-full', message: `This room is full (${MAX_PLAYERS} players).` } }
  }

  const name = sanitizeName(event.name)
  if (!name) {
    return { state, rejection: { code: 'invalid', message: 'Pick a name first.' } }
  }

  const player: Player = {
    id: event.playerId,
    secret: event.secret,
    name: dedupeName(name, state.players),
    avatarId: event.avatarId,
    connected: true,
    score: 0,
    joinedAt: event.now,
  }

  return { state: withLeader({ ...state, players: [...state.players, player] }) }
}

function disconnect(state: RoomState, playerId: PlayerId): ReduceResult {
  const player = state.players.find((p) => p.id === playerId)
  if (!player) return { state }

  // In the lobby a leaver is really gone, so free the slot. Mid-game we keep
  // the seat (and its score and artwork) so a locked phone can come back.
  const players =
    state.phase === 'lobby'
      ? state.players.filter((p) => p.id !== playerId)
      : state.players.map((p) => (p.id === playerId ? { ...p, connected: false } : p))

  return { state: withLeader({ ...state, players }) }
}

function start(state: RoomState, playerId: PlayerId): ReduceResult {
  if (state.phase !== 'lobby') {
    return { state, rejection: { code: 'game-in-progress', message: 'The game is already running.' } }
  }
  if (state.leaderId !== playerId) {
    return { state, rejection: { code: 'invalid', message: 'Only the first player can start the game.' } }
  }
  if (connectedCount(state) < MIN_PLAYERS_TO_START) {
    return {
      state,
      rejection: { code: 'invalid', message: `Need at least ${MIN_PLAYERS_TO_START} players.` },
    }
  }
  return { state: { ...state, phase: 'building', roundIndex: 0 } }
}

/**
 * The leader is the longest-connected player. Recomputed after every roster
 * change so the room is never stuck waiting on someone who already left.
 */
function withLeader(state: RoomState): RoomState {
  const current = state.players.find((p) => p.id === state.leaderId)
  if (current?.connected) return state

  const successor = state.players
    .filter((p) => p.connected)
    .sort((a, b) => a.joinedAt - b.joinedAt)[0]

  return { ...state, leaderId: successor?.id ?? null }
}

/** Two players named "Sam" on a shared screen is confusing; make it "Sam 2". */
function dedupeName(name: string, players: Player[]): string {
  const taken = new Set(players.map((p) => p.name.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name

  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${name} ${suffix}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return name
}

export function connectedCount(state: RoomState): number {
  return state.players.filter((p) => p.connected).length
}

export function canStart(state: RoomState): boolean {
  return state.phase === 'lobby' && connectedCount(state) >= MIN_PLAYERS_TO_START
}
