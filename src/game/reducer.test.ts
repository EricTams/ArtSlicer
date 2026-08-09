import { describe, expect, it } from 'vitest'

import { MAX_PLAYERS, type RoomState, createRoom } from '../shared/gameState'
import { type GameEvent, canStart, connectedCount, reduce } from './reducer'

function join(
  state: RoomState,
  id: string,
  overrides: Partial<Extract<GameEvent, { type: 'JOIN' }>> = {},
): RoomState {
  return reduce(state, {
    type: 'JOIN',
    playerId: id,
    secret: `secret-${id}`,
    name: id,
    avatarId: 'fox',
    now: 1000,
    ...overrides,
  }).state
}

describe('joining', () => {
  it('adds a player and makes the first one leader', () => {
    const state = join(createRoom('ACDF'), 'p1')
    expect(state.players).toHaveLength(1)
    expect(state.leaderId).toBe('p1')
  })

  it('keeps the leader when later players join', () => {
    let state = join(createRoom('ACDF'), 'p1', { now: 1 })
    state = join(state, 'p2', { now: 2 })
    expect(state.leaderId).toBe('p1')
  })

  it('rejects a blank name', () => {
    const result = reduce(createRoom('ACDF'), {
      type: 'JOIN',
      playerId: 'p1',
      secret: 's',
      name: '   ',
      avatarId: 'fox',
      now: 1,
    })
    expect(result.rejection?.code).toBe('invalid')
    expect(result.state.players).toHaveLength(0)
  })

  it('disambiguates duplicate names so the shared screen stays readable', () => {
    let state = join(createRoom('ACDF'), 'p1', { name: 'Sam' })
    state = join(state, 'p2', { name: 'sam' })
    expect(state.players.map((p) => p.name)).toEqual(['Sam', 'sam 2'])
  })

  it('rejects players once the room is full', () => {
    let state = createRoom('ACDF')
    for (let i = 0; i < MAX_PLAYERS; i++) state = join(state, `p${i}`, { now: i })

    const result = reduce(state, {
      type: 'JOIN',
      playerId: 'overflow',
      secret: 's',
      name: 'Late',
      avatarId: 'fox',
      now: 99,
    })
    expect(result.rejection?.code).toBe('room-full')
    expect(result.state.players).toHaveLength(MAX_PLAYERS)
  })

  it('refuses new players once the game is under way', () => {
    let state = join(join(createRoom('ACDF'), 'p1', { now: 1 }), 'p2', { now: 2 })
    state = reduce(state, { type: 'START', playerId: 'p1', now: 5000 }).state

    const result = reduce(state, {
      type: 'JOIN',
      playerId: 'p3',
      secret: 's',
      name: 'Late',
      avatarId: 'fox',
      now: 3,
    })
    expect(result.rejection?.code).toBe('game-in-progress')
  })
})

describe('reclaiming a seat', () => {
  it('restores a disconnected player with the right secret, keeping their score', () => {
    let state = join(join(createRoom('ACDF'), 'p1', { now: 1 }), 'p2', { now: 2 })
    state = reduce(state, { type: 'START', playerId: 'p1', now: 5000 }).state
    state = { ...state, players: state.players.map((p) => (p.id === 'p2' ? { ...p, score: 300 } : p)) }
    state = reduce(state, { type: 'DISCONNECT', playerId: 'p2' }).state
    expect(state.players.find((p) => p.id === 'p2')?.connected).toBe(false)

    const rejoined = join(state, 'p2', { name: 'p2' })
    const player = rejoined.players.find((p) => p.id === 'p2')
    expect(player?.connected).toBe(true)
    expect(player?.score).toBe(300)
  })

  it('refuses a reclaim with the wrong secret', () => {
    const state = join(createRoom('ACDF'), 'p1')
    const result = reduce(state, {
      type: 'JOIN',
      playerId: 'p1',
      secret: 'wrong',
      name: 'Impostor',
      avatarId: 'cat',
      now: 5,
    })
    expect(result.rejection?.code).toBe('bad-secret')
    expect(result.state.players[0]?.name).toBe('p1')
  })
})

describe('disconnecting', () => {
  it('frees the slot entirely when it happens in the lobby', () => {
    let state = join(join(createRoom('ACDF'), 'p1', { now: 1 }), 'p2', { now: 2 })
    state = reduce(state, { type: 'DISCONNECT', playerId: 'p2' }).state
    expect(state.players).toHaveLength(1)
  })

  it('promotes the next-longest-connected player when the leader leaves', () => {
    let state = join(createRoom('ACDF'), 'p1', { now: 1 })
    state = join(state, 'p2', { now: 2 })
    state = join(state, 'p3', { now: 3 })

    state = reduce(state, { type: 'DISCONNECT', playerId: 'p1' }).state
    expect(state.leaderId).toBe('p2')
  })

  it('leaves no leader once everyone is gone', () => {
    let state = join(createRoom('ACDF'), 'p1')
    state = reduce(state, { type: 'DISCONNECT', playerId: 'p1' }).state
    expect(state.leaderId).toBeNull()
    expect(connectedCount(state)).toBe(0)
  })
})

describe('starting', () => {
  it('needs two connected players', () => {
    const state = join(createRoom('ACDF'), 'p1')
    expect(canStart(state)).toBe(false)
    const result = reduce(state, { type: 'START', playerId: 'p1', now: 5000 })
    expect(result.rejection?.code).toBe('invalid')
    expect(result.state.phase).toBe('lobby')
  })

  it('only honors the leader', () => {
    const state = join(join(createRoom('ACDF'), 'p1', { now: 1 }), 'p2', { now: 2 })
    const result = reduce(state, { type: 'START', playerId: 'p2', now: 5000 })
    expect(result.rejection?.code).toBe('invalid')
    expect(result.state.phase).toBe('lobby')
  })

  it('moves to building when the leader starts a full-enough room', () => {
    const state = join(join(createRoom('ACDF'), 'p1', { now: 1 }), 'p2', { now: 2 })
    const result = reduce(state, { type: 'START', playerId: 'p1', now: 5000 })
    expect(result.rejection).toBeUndefined()
    expect(result.state.phase).toBe('building')
  })

  it('does not count disconnected players toward the minimum', () => {
    let state = join(join(createRoom('ACDF'), 'p1', { now: 1 }), 'p2', { now: 2 })
    state = reduce(state, { type: 'START', playerId: 'p1', now: 5000 }).state
    state = reduce(state, { type: 'DISCONNECT', playerId: 'p2' }).state
    // Back to a lobby-like roster: one connected player is not enough.
    const lobbyAgain: RoomState = { ...state, phase: 'lobby' }
    expect(canStart(lobbyAgain)).toBe(false)
  })
})
