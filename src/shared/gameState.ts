/** Types describing the room as the host sees it, and as clients see it. */

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
}

export interface RoomState {
  roomCode: string
  phase: Phase
  players: Player[]
  /** Whose "start" is honored. Null when the room is empty. */
  leaderId: PlayerId | null
  roundIndex: number
}

export const MAX_PLAYERS = 8
export const MIN_PLAYERS_TO_START = 2
export const MAX_NAME_LENGTH = 12

export function createRoom(roomCode: string): RoomState {
  return {
    roomCode,
    phase: 'lobby',
    players: [],
    leaderId: null,
    roundIndex: 0,
  }
}

export function toPublicPlayer(player: Player, leaderId: PlayerId | null): PublicPlayer {
  return {
    id: player.id,
    name: player.name,
    avatarId: player.avatarId,
    connected: player.connected,
    score: player.score,
    isLeader: player.id === leaderId,
  }
}

export function publicPlayers(state: RoomState): PublicPlayer[] {
  return state.players.map((player) => toPublicPlayer(player, state.leaderId))
}

/**
 * Names are shown on a shared screen in a room full of people, so trim
 * whitespace, collapse runs, and cap the length before anything is displayed.
 */
export function sanitizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
}
