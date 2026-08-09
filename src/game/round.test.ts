import { describe, expect, it } from 'vitest'

import { BUILD_MS, RESULTS_MS, type RoomState, VOTE_MS, createRoom } from '../shared/gameState'
import { emptyScene } from '../shared/scene'
import { POINTS_PER_VOTE, WINNER_BONUS } from './scoring'
import { ballotFor, reduce } from './reducer'

const T0 = 1_000_000

function lobbyWith(ids: string[]): RoomState {
  let state = createRoom('ACDF')
  ids.forEach((id, index) => {
    state = reduce(state, {
      type: 'JOIN',
      playerId: id,
      secret: `s-${id}`,
      name: id,
      avatarId: 'fox',
      now: T0 + index,
    }).state
  })
  return state
}

function started(ids: string[]): RoomState {
  const state = lobbyWith(ids)
  return reduce(state, { type: 'START', playerId: ids[0]!, now: T0 }).state
}

function submitAll(state: RoomState, ids: string[], now = T0): RoomState {
  for (const id of ids) {
    state = reduce(state, {
      type: 'SUBMIT',
      playerId: id,
      scene: emptyScene(),
      entryId: `e-${id}`,
      now,
    }).state
  }
  return state
}

describe('starting a game', () => {
  it('opens the first round with a prompt and a build deadline', () => {
    const state = started(['a', 'b'])
    expect(state.phase).toBe('building')
    expect(state.prompt).not.toBe('')
    expect(state.deadline).toBe(T0 + BUILD_MS)
    expect(state.roundIndex).toBe(0)
  })
})

describe('building', () => {
  it('waits while any connected player has not submitted', () => {
    let state = started(['a', 'b', 'c'])
    state = submitAll(state, ['a', 'b'])
    expect(state.phase).toBe('building')
  })

  it('moves to voting as soon as everyone has submitted', () => {
    let state = started(['a', 'b', 'c'])
    state = submitAll(state, ['a', 'b', 'c'])
    expect(state.phase).toBe('voting')
    expect(state.deadline).toBe(T0 + VOTE_MS)
  })

  it('moves on when the clock runs out, even with entries missing', () => {
    let state = started(['a', 'b', 'c'])
    state = submitAll(state, ['a', 'b'])
    state = reduce(state, { type: 'TICK', now: T0 + BUILD_MS }).state
    expect(state.phase).toBe('voting')
  })

  it('does not wait on a player who disconnected mid-round', () => {
    let state = started(['a', 'b', 'c'])
    state = reduce(state, { type: 'DISCONNECT', playerId: 'c' }).state
    state = submitAll(state, ['a', 'b'])
    expect(state.phase).toBe('voting')
  })

  it('replaces an earlier submission without creating a second entry', () => {
    let state = started(['a', 'b'])
    state = submitAll(state, ['a'])
    state = reduce(state, {
      type: 'SUBMIT',
      playerId: 'a',
      scene: { pieces: [], bg: 3 },
      entryId: 'ignored',
      now: T0,
    }).state
    expect(state.submissions).toHaveLength(1)
    expect(state.submissions[0]!.entryId).toBe('e-a')
    expect(state.submissions[0]!.scene.bg).toBe(3)
  })

  it('refuses a submission once the phase has moved on', () => {
    let state = started(['a', 'b'])
    state = submitAll(state, ['a', 'b'])
    const result = reduce(state, {
      type: 'SUBMIT',
      playerId: 'a',
      scene: emptyScene(),
      entryId: 'x',
      now: T0,
    })
    expect(result.rejection?.code).toBe('invalid')
  })
})

describe('voting', () => {
  it('hides a player’s own entry from their ballot', () => {
    let state = started(['a', 'b', 'c'])
    state = submitAll(state, ['a', 'b', 'c'])
    expect(ballotFor(state, 'a').map((entry) => entry.entryId)).toEqual(['e-b', 'e-c'])
  })

  it('refuses a vote for your own entry', () => {
    let state = started(['a', 'b'])
    state = submitAll(state, ['a', 'b'])
    const result = reduce(state, { type: 'VOTE', playerId: 'a', entryId: 'e-a', now: T0 })
    expect(result.rejection?.code).toBe('invalid')
  })

  it('refuses a vote for an entry that does not exist', () => {
    let state = started(['a', 'b'])
    state = submitAll(state, ['a', 'b'])
    const result = reduce(state, { type: 'VOTE', playerId: 'a', entryId: 'nope', now: T0 })
    expect(result.rejection?.code).toBe('invalid')
  })

  it('lets a player change their mind, counting only the last vote', () => {
    let state = started(['a', 'b', 'c'])
    state = submitAll(state, ['a', 'b', 'c'])
    state = reduce(state, { type: 'VOTE', playerId: 'a', entryId: 'e-b', now: T0 }).state
    state = reduce(state, { type: 'VOTE', playerId: 'a', entryId: 'e-c', now: T0 }).state
    expect(state.votes['a']).toBe('e-c')
  })

  it('scores as soon as everyone has voted', () => {
    let state = started(['a', 'b'])
    state = submitAll(state, ['a', 'b'])
    state = reduce(state, { type: 'VOTE', playerId: 'a', entryId: 'e-b', now: T0 }).state
    state = reduce(state, { type: 'VOTE', playerId: 'b', entryId: 'e-a', now: T0 }).state
    expect(state.phase).toBe('roundResults')
  })

  it('skips voting entirely when fewer than two entries arrived', () => {
    let state = started(['a', 'b'])
    state = submitAll(state, ['a'])
    state = reduce(state, { type: 'TICK', now: T0 + BUILD_MS }).state
    // Nothing to choose between, so go straight to results.
    expect(state.phase).toBe('roundResults')
  })
})

describe('scoring a round', () => {
  it('awards votes plus a bonus to the outright winner', () => {
    let state = started(['a', 'b', 'c'])
    state = submitAll(state, ['a', 'b', 'c'])
    state = reduce(state, { type: 'VOTE', playerId: 'a', entryId: 'e-b', now: T0 }).state
    state = reduce(state, { type: 'VOTE', playerId: 'c', entryId: 'e-b', now: T0 }).state
    state = reduce(state, { type: 'VOTE', playerId: 'b', entryId: 'e-a', now: T0 }).state

    const score = (id: string) => state.players.find((p) => p.id === id)!.score
    expect(score('b')).toBe(2 * POINTS_PER_VOTE + WINNER_BONUS)
    expect(score('a')).toBe(POINTS_PER_VOTE)
    expect(score('c')).toBe(0)
    expect(state.lastRoundWinners).toEqual(['b'])
  })

  it('gives the bonus to everyone tied at the top', () => {
    let state = started(['a', 'b'])
    state = submitAll(state, ['a', 'b'])
    state = reduce(state, { type: 'VOTE', playerId: 'a', entryId: 'e-b', now: T0 }).state
    state = reduce(state, { type: 'VOTE', playerId: 'b', entryId: 'e-a', now: T0 }).state

    expect(state.lastRoundWinners.sort()).toEqual(['a', 'b'])
    for (const player of state.players) {
      expect(player.score).toBe(POINTS_PER_VOTE + WINNER_BONUS)
    }
  })

  it('names no winner when nobody voted', () => {
    let state = started(['a', 'b'])
    state = submitAll(state, ['a', 'b'])
    state = reduce(state, { type: 'TICK', now: T0 + BUILD_MS + VOTE_MS }).state
    expect(state.phase).toBe('roundResults')
    expect(state.lastRoundWinners).toEqual([])
    expect(state.players.every((p) => p.score === 0)).toBe(true)
  })
})

describe('advancing between rounds', () => {
  function toResults(ids: string[]): RoomState {
    let state = started(ids)
    state = submitAll(state, ids)
    state = reduce(state, { type: 'VOTE', playerId: ids[0]!, entryId: `e-${ids[1]}`, now: T0 }).state
    state = reduce(state, { type: 'VOTE', playerId: ids[1]!, entryId: `e-${ids[0]}`, now: T0 }).state
    return state
  }

  it('holds the results until their time is up', () => {
    const state = toResults(['a', 'b'])
    const held = reduce(state, { type: 'TICK', now: state.deadline! - 1 }).state
    expect(held.phase).toBe('roundResults')
  })

  it('starts the next round with a fresh prompt and cleared entries', () => {
    const state = toResults(['a', 'b'])
    const next = reduce(state, { type: 'TICK', now: state.deadline! }).state

    expect(next.phase).toBe('building')
    expect(next.roundIndex).toBe(1)
    expect(next.submissions).toEqual([])
    expect(next.votes).toEqual({})
    expect(next.prompt).not.toBe(state.prompt)
    // Scores carry across rounds.
    expect(next.players.every((p) => p.score > 0)).toBe(true)
  })

  it('ends the game after the last round', () => {
    let state = toResults(['a', 'b'])
    state = { ...state, roundIndex: state.totalRounds - 1 }
    state = reduce(state, { type: 'TICK', now: state.deadline! }).state
    expect(state.phase).toBe('finalResults')
    expect(state.deadline).toBeNull()
  })

  it('stops ticking once the game is over', () => {
    let state = toResults(['a', 'b'])
    state = { ...state, roundIndex: state.totalRounds - 1 }
    state = reduce(state, { type: 'TICK', now: state.deadline! }).state
    const after = reduce(state, { type: 'TICK', now: T0 + 10 * RESULTS_MS }).state
    expect(after).toBe(state)
  })
})
