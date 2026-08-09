import type { Phase, PlayerId, PublicPlayer } from './gameState'
import type { Scene } from './scene'

/**
 * Bumped whenever the wire format changes incompatibly. GitHub Pages caches
 * aggressively, so a phone can easily be running yesterday's bundle against
 * today's host; the host checks this and tells them to refresh rather than
 * failing in some confusing downstream way.
 */
export const PROTOCOL_VERSION = 2

/**
 * Client -> Host. Every message is an *intent*, never a fact: the client asks
 * to vote, it never announces its own score.
 */
export type ClientMessage =
  | {
      t: 'hello'
      protocol: number
      playerId: PlayerId
      /** Proves this client owns the seat when reclaiming after a disconnect. */
      secret: string
      name: string
      avatarId: string
      clientTime: number
    }
  | { t: 'start' }
  | { t: 'submit'; scene: unknown }
  | { t: 'vote'; entryId: string }
  | { t: 'ping'; clientTime: number }

/** An entry as shown on a ballot — deliberately without its author. */
export interface BallotEntry {
  entryId: string
  scene: Scene
}

/** An entry once authorship is revealed, at results time. */
export interface RevealedEntry extends BallotEntry {
  playerId: PlayerId
  votes: number
  points: number
}

/** Host -> Client. The host is the single source of truth. */
export type HostMessage =
  | { t: 'welcome'; you: PlayerId; roomCode: string; hostTime: number }
  | {
      t: 'state'
      phase: Phase
      roomCode: string
      players: PublicPlayer[]
      you: PlayerId
      roundIndex: number
      totalRounds: number
      canStart: boolean
      prompt: string
      /** Absolute epoch ms on the host's clock; null when the phase is untimed. */
      deadline: number | null
      /** Present during voting: everyone's entry except the recipient's own. */
      ballot?: BallotEntry[]
      /** The entry this player voted for, so their phone can show it back. */
      yourVote?: string
      /** Present at results: entries with authors and scores revealed. */
      reveal?: RevealedEntry[]
      winners?: PlayerId[]
      /** True once this player's scene is in for the round. */
      youSubmitted: boolean
    }
  | { t: 'pong'; clientTime: number; hostTime: number }
  | { t: 'error'; code: ErrorCode; message: string }

export type ErrorCode =
  | 'room-full'
  | 'protocol-mismatch'
  | 'bad-secret'
  | 'game-in-progress'
  | 'invalid'

/**
 * DataChannel payloads are untyped at runtime, so validate the shape of
 * anything arriving over the wire before the game logic touches it. Scenes are
 * passed through as `unknown` and sanitized separately, where the piece
 * manifest is available to check ids against.
 */
export function parseClientMessage(data: unknown): ClientMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const msg = data as Record<string, unknown>

  switch (msg['t']) {
    case 'hello':
      if (
        typeof msg['protocol'] !== 'number' ||
        typeof msg['playerId'] !== 'string' ||
        typeof msg['secret'] !== 'string' ||
        typeof msg['name'] !== 'string' ||
        typeof msg['avatarId'] !== 'string' ||
        typeof msg['clientTime'] !== 'number'
      ) {
        return null
      }
      return {
        t: 'hello',
        protocol: msg['protocol'],
        playerId: msg['playerId'],
        secret: msg['secret'],
        name: msg['name'],
        avatarId: msg['avatarId'],
        clientTime: msg['clientTime'],
      }

    case 'start':
      return { t: 'start' }

    case 'submit':
      if (!('scene' in msg)) return null
      return { t: 'submit', scene: msg['scene'] }

    case 'vote':
      if (typeof msg['entryId'] !== 'string') return null
      return { t: 'vote', entryId: msg['entryId'] }

    case 'ping':
      if (typeof msg['clientTime'] !== 'number') return null
      return { t: 'ping', clientTime: msg['clientTime'] }

    default:
      return null
  }
}

export function parseHostMessage(data: unknown): HostMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const msg = data as Record<string, unknown>

  switch (msg['t']) {
    case 'welcome':
    case 'state':
    case 'pong':
    case 'error':
      // The host is trusted (it is the server), so a tag check is enough here;
      // clients only ever render this data.
      return msg as unknown as HostMessage
    default:
      return null
  }
}
