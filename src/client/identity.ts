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
  try {
    const raw = localStorage.getItem(storageKey())
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>
      if (typeof parsed.playerId === 'string' && typeof parsed.secret === 'string') {
        return {
          playerId: parsed.playerId,
          secret: parsed.secret,
          name: typeof parsed.name === 'string' ? parsed.name : '',
          avatarId: typeof parsed.avatarId === 'string' ? parsed.avatarId : '',
          // Absent on an identity stored before rooms were remembered, which
          // reads as "no room" and so offers the choice rather than assuming.
          lastRoom: typeof parsed.lastRoom === 'string' ? parsed.lastRoom : undefined,
        }
      }
    }
  } catch {
    // Private browsing or a corrupt entry: fall through to a fresh identity.
  }

  const identity: Identity = { playerId: randomId(), secret: randomId(), name: '', avatarId: '' }
  saveIdentity(identity)
  return identity
}

export function saveIdentity(identity: Identity): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(identity))
  } catch {
    // Storage unavailable — the session still works, it just can't reconnect
    // into the same seat after a refresh.
  }
}
