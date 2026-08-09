import type { ErrorCode } from '../shared/protocol'
import type { Scene } from '../shared/scene'
import {
  BUILD_MS,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  type Player,
  type PlayerId,
  RESULTS_MS,
  type RoomState,
  type Submission,
  VOTE_MS,
  activePlayers,
  sanitizeName,
} from '../shared/gameState'
import { shufflePrompts } from './prompts'
import { tallyRound } from './scoring'

/**
 * Everything that can change the room. The reducer is pure — no React, no
 * PeerJS, no timers — so the whole game is testable without a browser. The
 * host drives time forward by sending TICK; the reducer decides what that
 * means.
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
  | { type: 'START'; playerId: PlayerId; now: number }
  | { type: 'SUBMIT'; playerId: PlayerId; scene: Scene; entryId: string; now: number }
  | { type: 'VOTE'; playerId: PlayerId; entryId: string; now: number }
  | { type: 'TICK'; now: number }
  | { type: 'RESTART'; playerId: PlayerId }

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
      return start(state, event.playerId, event.now)
    case 'SUBMIT':
      return submit(state, event)
    case 'VOTE':
      return vote(state, event)
    case 'TICK':
      return { state: advanceIfDue(state, event.now) }
    case 'RESTART':
      return restart(state, event.playerId)
  }
}

/**
 * Back to the lobby with the same room and players, scores cleared. Keeps the
 * room code alive so nobody has to rescan the QR code between games.
 */
function restart(state: RoomState, playerId: PlayerId): ReduceResult {
  if (state.phase !== 'finalResults') {
    return { state, rejection: { code: 'invalid', message: 'The game is not over yet.' } }
  }
  if (state.leaderId !== playerId) {
    return { state, rejection: { code: 'invalid', message: 'Only the first player can restart.' } }
  }

  return {
    state: {
      ...state,
      phase: 'lobby',
      roundIndex: 0,
      prompt: '',
      promptPool: [],
      submissions: [],
      votes: {},
      deadline: null,
      lastRoundPoints: {},
      lastRoundWinners: [],
      // Players who dropped out during the last game don't carry into the new
      // one, so a stale name isn't stuck on the lobby screen forever.
      players: state.players.filter((p) => p.connected).map((p) => ({ ...p, score: 0 })),
    },
  }
}

// --- lobby ------------------------------------------------------------------

function join(state: RoomState, event: Extract<GameEvent, { type: 'JOIN' }>): ReduceResult {
  const existing = state.players.find((p) => p.id === event.playerId)

  if (existing) {
    // Reclaiming a seat after a disconnect (screen lock, tab suspend, refresh).
    // The secret is what stops another client from stealing the seat.
    if (existing.secret !== event.secret) {
      return {
        state,
        rejection: { code: 'bad-secret', message: 'That seat belongs to someone else.' },
      }
    }
    const players = state.players.map((p) =>
      p.id === event.playerId
        ? {
            ...p,
            connected: true,
            name: sanitizeName(event.name) || p.name,
            avatarId: event.avatarId,
          }
        : p,
    )
    return { state: withLeader({ ...state, players }) }
  }

  // New players may only arrive in the lobby; a game in progress is closed.
  if (state.phase !== 'lobby') {
    return {
      state,
      rejection: { code: 'game-in-progress', message: 'That game has already started.' },
    }
  }

  if (state.players.length >= MAX_PLAYERS) {
    return {
      state,
      rejection: { code: 'room-full', message: `This room is full (${MAX_PLAYERS} players).` },
    }
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

function start(state: RoomState, playerId: PlayerId, now: number): ReduceResult {
  if (state.phase !== 'lobby') {
    return {
      state,
      rejection: { code: 'game-in-progress', message: 'The game is already running.' },
    }
  }
  if (state.leaderId !== playerId) {
    return {
      state,
      rejection: { code: 'invalid', message: 'Only the first player can start the game.' },
    }
  }
  if (connectedCount(state) < MIN_PLAYERS_TO_START) {
    return {
      state,
      rejection: { code: 'invalid', message: `Need at least ${MIN_PLAYERS_TO_START} players.` },
    }
  }

  return { state: beginRound({ ...state, promptPool: shufflePrompts(), roundIndex: 0 }, now) }
}

// --- round play -------------------------------------------------------------

function submit(state: RoomState, event: Extract<GameEvent, { type: 'SUBMIT' }>): ReduceResult {
  if (state.phase !== 'building') {
    return { state, rejection: { code: 'invalid', message: 'The build phase is over.' } }
  }
  if (!state.players.some((p) => p.id === event.playerId)) {
    return { state, rejection: { code: 'invalid', message: 'You are not in this game.' } }
  }

  const existing = state.submissions.find((entry) => entry.playerId === event.playerId)
  // Resubmitting replaces the previous scene but keeps the entry id, so a vote
  // already cast against it stays valid.
  const submissions = existing
    ? state.submissions.map((entry) =>
        entry.playerId === event.playerId ? { ...entry, scene: event.scene } : entry,
      )
    : [
        ...state.submissions,
        { playerId: event.playerId, entryId: event.entryId, scene: event.scene },
      ]

  return { state: advanceIfDue({ ...state, submissions }, event.now) }
}

function vote(state: RoomState, event: Extract<GameEvent, { type: 'VOTE' }>): ReduceResult {
  if (state.phase !== 'voting') {
    return { state, rejection: { code: 'invalid', message: 'Voting is not open.' } }
  }

  const entry = state.submissions.find((submission) => submission.entryId === event.entryId)
  if (!entry) {
    return { state, rejection: { code: 'invalid', message: 'That entry is not in this round.' } }
  }
  if (entry.playerId === event.playerId) {
    return { state, rejection: { code: 'invalid', message: 'You cannot vote for your own.' } }
  }

  const votes = { ...state.votes, [event.playerId]: event.entryId }
  return { state: advanceIfDue({ ...state, votes }, event.now) }
}

/**
 * The single place phases move forward. Called on every tick and after any
 * event that could complete a phase early, so a round ends the moment everyone
 * is done rather than waiting out the clock.
 */
function advanceIfDue(state: RoomState, now: number): RoomState {
  const expired = state.deadline !== null && now >= state.deadline

  const active = activePlayers(state)
  /**
   * "Everyone is done" is only meaningful when the room is actually assembled.
   * Two cases make it vacuously true and would race through whole rounds:
   * nobody is connected at all, or the room is still recovering from a host
   * restart and only the first phone back has reported in. In both, the clock
   * is the only thing allowed to advance a phase.
   */
  const notAssembled =
    active.length === 0 || (state.recoveringUntil !== null && now < state.recoveringUntil)

  switch (state.phase) {
    case 'building': {
      const waiting = active.filter(
        (player) => !state.submissions.some((entry) => entry.playerId === player.id),
      )
      if (!expired && (notAssembled || waiting.length > 0)) return state
      return beginVoting(state, now)
    }

    case 'voting': {
      // Players who submitted nothing still vote; players who left do not.
      const waiting = active.filter((player) => !(player.id in state.votes))
      if (!expired && (notAssembled || waiting.length > 0)) return state
      return scoreRound(state, now)
    }

    case 'roundResults':
      if (!expired) return state
      return state.roundIndex + 1 >= state.totalRounds
        ? { ...state, phase: 'finalResults', deadline: null }
        : beginRound({ ...state, roundIndex: state.roundIndex + 1 }, now)

    default:
      return state
  }
}

function beginRound(state: RoomState, now: number): RoomState {
  const [prompt, ...rest] = state.promptPool
  // Reshuffle rather than run dry if a very long game exhausts the pool.
  const pool = rest.length ? rest : shufflePrompts()

  return {
    ...state,
    phase: 'building',
    prompt: prompt ?? shufflePrompts()[0]!,
    promptPool: pool,
    submissions: [],
    votes: {},
    lastRoundPoints: {},
    lastRoundWinners: [],
    deadline: now + BUILD_MS,
  }
}

function beginVoting(state: RoomState, now: number): RoomState {
  // With fewer than two entries there is nothing to choose between, so skip
  // straight to the results rather than showing a one-option ballot.
  if (state.submissions.length < 2) {
    return scoreRound({ ...state, phase: 'voting', votes: {} }, now)
  }
  return { ...state, phase: 'voting', votes: {}, deadline: now + VOTE_MS }
}

function scoreRound(state: RoomState, now: number): RoomState {
  const { points, winners } = tallyRound(state.submissions, state.votes)

  return {
    ...state,
    phase: 'roundResults',
    players: state.players.map((player) => ({
      ...player,
      score: player.score + (points[player.id] ?? 0),
    })),
    lastRoundPoints: points,
    lastRoundWinners: winners,
    deadline: now + RESULTS_MS,
  }
}

// --- helpers ----------------------------------------------------------------

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

/** The ballot a given player should see: everyone's entry except their own. */
export function ballotFor(state: RoomState, playerId: PlayerId): Submission[] {
  return state.submissions.filter((entry) => entry.playerId !== playerId)
}
