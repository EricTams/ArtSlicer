import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BUILD_MS, type RoomState, createRoom } from '../shared/gameState'
import { clearRoom, loadRoom, saveRoom } from './persistence'

/** Minimal localStorage so these pure functions can be tested without a DOM. */
function installStorage() {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  })
  return data
}

function midGame(): RoomState {
  return {
    ...createRoom('ACDF'),
    phase: 'building',
    prompt: 'a very tired dog',
    deadline: Date.now() + BUILD_MS,
    players: [
      {
        id: 'p1',
        secret: 's',
        name: 'Sam',
        avatarId: 'fox',
        connected: true,
        score: 300,
        joinedAt: 1,
      },
    ],
  }
}

beforeEach(() => {
  installStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('saveRoom', () => {
  it('stores a game that is mid-round', () => {
    saveRoom(midGame())
    expect(loadRoom()?.roomCode).toBe('ACDF')
  })

  it('stores nothing for a lobby or a finished game', () => {
    saveRoom({ ...midGame(), phase: 'lobby' })
    expect(loadRoom()).toBeNull()

    saveRoom({ ...midGame(), phase: 'finalResults' })
    expect(loadRoom()).toBeNull()
  })

  it('clears a previous save once the game ends', () => {
    saveRoom(midGame())
    saveRoom({ ...midGame(), phase: 'finalResults' })
    expect(loadRoom()).toBeNull()
  })
})

describe('loadRoom', () => {
  it('keeps scores and the prompt', () => {
    saveRoom(midGame())
    const restored = loadRoom()!
    expect(restored.prompt).toBe('a very tired dog')
    expect(restored.players[0]!.score).toBe(300)
  })

  it('marks everyone disconnected so their phones must reconnect', () => {
    saveRoom(midGame())
    expect(loadRoom()!.players.every((p) => !p.connected)).toBe(true)
  })

  it('rebases the deadline instead of restoring an absolute one that has passed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)

    const state = { ...midGame(), deadline: 1_000_000 + 60_000 }
    saveRoom(state)

    // The host was away for five minutes — far past the original deadline.
    vi.setSystemTime(1_000_000 + 5 * 60_000)
    const restored = loadRoom()!

    // The round resumes with the time that was left, not already expired.
    expect(restored.deadline).toBe(Date.now() + 60_000)
  })

  it('ignores a save that is too old to be an interrupted game', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    saveRoom(midGame())

    vi.setSystemTime(1_000_000 + 31 * 60 * 1000)
    expect(loadRoom()).toBeNull()
  })

  it('returns null rather than throwing on a corrupt entry', () => {
    localStorage.setItem('artslicer.host', 'not json')
    expect(loadRoom()).toBeNull()
  })

  it('returns null when nothing was saved', () => {
    expect(loadRoom()).toBeNull()
  })
})

describe('clearRoom', () => {
  it('removes a stored game', () => {
    saveRoom(midGame())
    clearRoom()
    expect(loadRoom()).toBeNull()
  })
})
