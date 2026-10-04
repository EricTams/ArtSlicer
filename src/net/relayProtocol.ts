/**
 * What the relay and the app say to each other, around the game's own frames.
 *
 * The relay never reads a game message. It knows who is the host and who is a
 * phone, and it carries strings between them; validating what is inside stays
 * the host's job, exactly as it was when the bytes came over a DataChannel.
 * Shared by both ends so neither can drift from the other.
 */

/** relay → host */
export type RelayToHost =
  /** The room is ours; phones can now reach it. */
  | { t: 'ready' }
  | { t: 'open'; c: string }
  | { t: 'msg'; c: string; d: string }
  | { t: 'close'; c: string }

/** host → relay */
export type HostToRelay =
  | { t: 'send'; c: string; d: string }
  | { t: 'all'; d: string }
  | { t: 'kick'; c: string }

/** relay → phone */
export type RelayToClient = { t: 'ready'; c: string } | { t: 'msg'; d: string }

/** phone → relay */
export type ClientToRelay = { t: 'msg'; d: string }

/**
 * Answered by the relay without waking the room, so a heartbeat costs nothing
 * and the relay can still tell which sockets have gone quiet.
 */
export const PING = 'ping'
export const PONG = 'pong'

/** Both ends ping this often; the relay reaps a socket silent for HEARTBEAT_TIMEOUT_MS. */
export const HEARTBEAT_MS = 15_000
export const HEARTBEAT_TIMEOUT_MS = 45_000

/**
 * Why the relay closed a socket. A rejection is sent as a close code rather
 * than an HTTP status, because a browser hides the status of a failed upgrade
 * behind a bare 1006.
 */
export const CLOSE = {
  badRequest: 4000,
  /** Another host holds this code. The host re-rolls. */
  taken: 4001,
  /** The host went away. Phones retry until it is back. */
  hostGone: 4002,
  /** The same host connected again, from a fresh socket. */
  replaced: 4003,
  /** No host has claimed this code. Phones retry: the host may still be loading. */
  noHost: 4004,
  /** Nothing heard for longer than a heartbeat allows. */
  silent: 4005,
  full: 4009,
  /** The host removed this phone from the room. */
  kicked: 4010,
} as const

export function parseEnvelope(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null
  const value = parseJson(raw)
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/** Null for anything that is not JSON, so a bad frame is dropped rather than thrown. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** The relay's path for a room, so both ends build it the same way. */
export function roomPath(code: string): string {
  return `/room/${encodeURIComponent(code)}`
}
