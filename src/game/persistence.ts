import { RECOVERY_GRACE_MS, type RoomState } from '../shared/gameState'

const STORAGE_KEY = 'artslicer.host'

/**
 * A game older than this is assumed abandoned rather than interrupted — the
 * laptop was closed and reopened later, not refreshed mid-round.
 */
const MAX_AGE_MS = 30 * 60 * 1000

interface Saved {
  savedAt: number
  /**
   * Time left in the current phase at save time. Deadlines are absolute, so
   * restoring one directly would have the reducer blow through every phase it
   * had slept past; storing the remainder keeps the round fair.
   */
  remainingMs: number | null
  state: RoomState
}

/**
 * The host tab is a single point of failure: a refresh or a crash would
 * otherwise strand a room full of phones. Snapshotting on every transition
 * lets the host reclaim the same room code and pick the round back up.
 */
export function saveRoom(state: RoomState): void {
  // Nothing worth resuming before the game starts or after it ends.
  if (state.phase === 'lobby' || state.phase === 'finalResults') {
    clearRoom()
    return
  }

  try {
    const payload: Saved = {
      savedAt: Date.now(),
      remainingMs: state.deadline === null ? null : Math.max(0, state.deadline - Date.now()),
      state,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Storage full or unavailable: the game continues, it just can't be resumed.
  }
}

/** Returns a resumable room, with its deadline shifted to be relative to now. */
export function loadRoom(): RoomState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const saved = JSON.parse(raw) as Partial<Saved>
    if (typeof saved.savedAt !== 'number' || !saved.state?.roomCode) return null
    if (Date.now() - saved.savedAt > MAX_AGE_MS) {
      clearRoom()
      return null
    }

    const state = saved.state
    return {
      ...state,
      deadline:
        saved.remainingMs === null || saved.remainingMs === undefined
          ? null
          : Date.now() + saved.remainingMs,
      // Everyone has to reconnect; their phones retry on their own. Until they
      // are back, the first one to return must not be able to end the round on
      // everyone else's behalf.
      recoveringUntil: Date.now() + RECOVERY_GRACE_MS,
      players: state.players.map((player) => ({ ...player, connected: false })),
    }
  } catch {
    return null
  }
}

export function clearRoom(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do — a stale entry simply expires on age.
  }
}
