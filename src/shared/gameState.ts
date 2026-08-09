/** Types describing the room as the host sees it, and as clients see it. */

import type { Scene } from './scene'

export type PlayerId = string

export type Phase =
  | 'lobby'
  | 'building'
  | 'voting'
  | 'roundResults'
  | 'finalResults'

/** Everything the host knows about a player, including private fields. */
export interface Player {
  id: PlayerId
  /** Proves seat ownership on reconnect so nobody can hijack a PlayerId. */
  secret: string
  name: string
  avatarId: string
  connected: boolean
  score: number
  /** Join order decides leader succession. */
  joinedAt: number
}

/** The subset of a player that is safe to broadcast to everyone. */
export interface PublicPlayer {
  id: PlayerId
  name: string
  avatarId: string
  connected: boolean
  score: number
  isLeader: boolean
  /** Drives the host's "waiting for…" display during a round. */
  submitted: boolean
  voted: boolean
}

export interface Submission {
  playerId: PlayerId
  /**
   * Opaque per-round handle used for voting. Ballots carry this instead of the
   * author's id so a curious player can't read authorship off the wire before
   * the reveal.
   */
  entryId: string
  scene: Scene
}

export interface RoomState {
  roomCode: string
  phase: Phase
  players: Player[]
  /** Whose "start" is honored. Null when the room is empty. */
  leaderId: PlayerId | null
  roundIndex: number
  totalRounds: number
  prompt: string
  /** Shuffled once per game and drawn from the front, so prompts never repeat. */
  promptPool: string[]
  submissions: Submission[]
  /** Voter id to the entry they picked. */
  votes: Record<PlayerId, string>
  /** Absolute epoch ms for the current phase, or null when untimed. */
  deadline: number | null
  /** Points earned in the round just scored, for the results screen. */
  lastRoundPoints: Record<PlayerId, number>
  lastRoundWinners: PlayerId[]
}

export const MAX_PLAYERS = 8
export const MIN_PLAYERS_TO_START = 2
export const MAX_NAME_LENGTH = 12
export const DEFAULT_ROUNDS = 3

/** Phase durations. Building dominates; the rest keep the game moving. */
export const BUILD_MS = 150_000
export const VOTE_MS = 45_000
export const RESULTS_MS = 9_000

export function createRoom(roomCode: string): RoomState {
  return {
    roomCode,
    phase: 'lobby',
    players: [],
    leaderId: null,
    roundIndex: 0,
    totalRounds: DEFAULT_ROUNDS,
    prompt: '',
    promptPool: [],
    submissions: [],
    votes: {},
    deadline: null,
    lastRoundPoints: {},
    lastRoundWinners: [],
  }
}

export function publicPlayers(state: RoomState): PublicPlayer[] {
  return state.players.map((player) => ({
    id: player.id,
    name: player.name,
    avatarId: player.avatarId,
    connected: player.connected,
    score: player.score,
    isLeader: player.id === state.leaderId,
    submitted: state.submissions.some((entry) => entry.playerId === player.id),
    voted: player.id in state.votes,
  }))
}

/** Players who are actually in the round — a disconnected phone can't build. */
export function activePlayers(state: RoomState): Player[] {
  return state.players.filter((player) => player.connected)
}

/**
 * Names are shown on a shared screen in a room full of people, so trim
 * whitespace, collapse runs, and cap the length before anything is displayed.
 */
export function sanitizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
}
