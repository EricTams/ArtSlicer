import type { PlayerId } from '../shared/gameState'
import { randomUUID } from '../shared/randomId'

const STORAGE_KEY = 'artslicer.identity'

/**
 * Real players are on separate phones, so one identity per browser is right.
 * Local playtesting is the exception: `?as=alice` namespaces the stored
 * identity so several tabs on one laptop act as distinct players.
 */
function storageKey(): string {
  const slot = new URLSearchParams(window.location.search).get('as')
  return slot ? `${STORAGE_KEY}.${slot}` : STORAGE_KEY
}

export interface Identity {
  playerId: PlayerId
  /** Proves seat ownership to the host when reclaiming after a disconnect. */
  secret: string
  name: string
  avatarId: string
  /**
   * The room this name and avatar were last used in.
   *
   * What separates coming back from starting again. Arriving at the same room
   * is a phone that locked or a tab that refreshed, and it should take its seat
   * without being asked anything. Arriving at a different one is a new game,
   * where whoever is holding the phone may not be who held it last.
   */
  lastRoom?: string
  /**
   * When that room was last played in, so the front door can offer the way
   * back to it — and stop offering once it is plainly over.
   */
  lastRoomAt?: number
}

/**
 * How long the front door keeps offering a room the phone was playing in.
 *
 * Long enough to cover a whole game and a break in the middle of one, since
 * the seat itself is held for as long as the host is up. Short enough that a
 * game from another evening is not still being offered — the room code is long
 * gone by then, and a button that leads nowhere is worse than no button.
 */
const REJOIN_WINDOW_MS = 30 * 60 * 1000

/**
 * The room this phone should be offered a way back into, if any.
 *
 * Closing the app and opening it again lands on the front door rather than on
 * the game — the join link is a URL the player no longer has — so this is what
 * the seat they still hold looks like from the menu.
 */
export function rejoinableRoom(identity: Identity, now = Date.now()): string | null {
  if (!identity.name || !identity.lastRoom) return null
  // Stored before the time was kept: no way to tell an interrupted game from
  // one that finished last week, so it is not offered.
  if (typeof identity.lastRoomAt !== 'number') return null
  return now - identity.lastRoomAt <= REJOIN_WINDOW_MS ? identity.lastRoom : null
}

function randomId(): string {
  return randomUUID()
}

/**
 * Whether this identity should take its seat without being asked anything.
 *
 * Only in the room it was last used in. That is a phone coming back from a
 * locked screen or a refreshed tab, and stopping to ask would cost the player
 * the seat, the score and the picture they were halfway through. Anywhere else
 * is a new game, and a name worth confirming.
 */
export function shouldRejoinSilently(identity: Identity, roomCode: string): boolean {
  return Boolean(identity.name) && identity.lastRoom === roomCode
}

/**
 * A stable identity that survives a refresh or a locked screen. Without this
 * a phone that sleeps mid-game comes back as a brand new player and loses its
 * seat, score, and artwork.
 */
export function loadIdentity(): Identity {
  const stored = peekIdentity()
  if (stored) return stored

  const identity: Identity = { playerId: randomId(), secret: randomId(), name: '', avatarId: '' }
  saveIdentity(identity)
  return identity
}

/**
 * The stored identity, or nothing.
 *
 * Asking without minting one, which is what the front door needs: a player
 * only looking at the menu should not be handed a seat's worth of credentials
 * they never asked for.
 */
export function peekIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(storageKey())
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<Identity>
    if (typeof parsed.playerId !== 'string' || typeof parsed.secret !== 'string') return null

    return {
      playerId: parsed.playerId,
      secret: parsed.secret,
      name: typeof parsed.name === 'string' ? parsed.name : '',
      avatarId: typeof parsed.avatarId === 'string' ? parsed.avatarId : '',
      // Absent on an identity stored before rooms were remembered, which
      // reads as "no room" and so offers the choice rather than assuming.
      lastRoom: typeof parsed.lastRoom === 'string' ? parsed.lastRoom : undefined,
      lastRoomAt: typeof parsed.lastRoomAt === 'number' ? parsed.lastRoomAt : undefined,
    }
  } catch {
    // Private browsing or a corrupt entry: no identity to be had.
    return null
  }
}

export function saveIdentity(identity: Identity): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(identity))
  } catch {
    // Storage unavailable — the session still works, it just can't reconnect
    // into the same seat after a refresh.
  }
}
