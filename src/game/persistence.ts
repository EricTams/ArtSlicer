import { RECOVERY_GRACE_MS, type RoomState } from '../shared/gameState'

const STORAGE_KEY = 'artslicer.host'
const ALIVE_KEY = 'artslicer.host.alive'

/**
 * How long the host can be away before its game is over rather than
 * interrupted. A refresh or a crash is back within seconds; someone coming
 * back after this has gone to start a new game, not to rejoin the old one.
 */
const MAX_ABSENCE_MS = 2 * 60 * 1000

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
 * Marks the host as still running.
 *
 * The snapshot is only written when the state actually changes, and a build
 * phase can pass two and a half minutes without one — nobody submitting is a
 * room where nothing happens. Judging absence by the snapshot's own age would
 * read a quiet round as an abandoned game and throw it away on the next
 * refresh. This is the separate, cheap answer to "was the host here a moment
 * ago", which is the question actually being asked.
 */
export function touchRoom(): void {
  try {
    localStorage.setItem(ALIVE_KEY, String(Date.now()))
  } catch {
    // Storage unavailable: absence falls back to the snapshot's own age.
  }
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

    // How long the host has been gone, not how long since the game last moved.
    const beat = Number(localStorage.getItem(ALIVE_KEY))
    const lastAlive = Number.isFinite(beat) && beat > 0 ? Math.max(beat, saved.savedAt) : saved.savedAt
    if (Date.now() - lastAlive > MAX_ABSENCE_MS) {
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
    localStorage.removeItem(ALIVE_KEY)
  } catch {
    // Nothing to do — a stale entry simply expires on age.
  }
}
