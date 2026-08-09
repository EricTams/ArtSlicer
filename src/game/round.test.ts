import { describe, expect, it } from 'vitest'

import {
  BUILD_MS,
  RECOVERY_GRACE_MS,
  RESULTS_MS,
  type RoomState,
  VOTE_MS,
  createRoom,
} from '../shared/gameState'
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
      scene: { pieces: [], bg: '#336699' },
      entryId: 'ignored',
      now: T0,
    }).state
    expect(state.submissions).toHaveLength(1)
    expect(state.submissions[0]!.entryId).toBe('e-a')
    expect(state.submissions[0]!.scene.bg).toBe('#336699')
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
    state = reduce(state, {
      type: 'VOTE',
      playerId: ids[0]!,
      entryId: `e-${ids[1]}`,
      now: T0,
    }).state
    state = reduce(state, {
      type: 'VOTE',
      playerId: ids[1]!,
      entryId: `e-${ids[0]}`,
      now: T0,
    }).state
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

describe('playing again', () => {
  function finished(): RoomState {
    let state = started(['a', 'b'])
    state = submitAll(state, ['a', 'b'])
    state = reduce(state, { type: 'VOTE', playerId: 'a', entryId: 'e-b', now: T0 }).state
    state = reduce(state, { type: 'VOTE', playerId: 'b', entryId: 'e-a', now: T0 }).state
    state = { ...state, roundIndex: state.totalRounds - 1 }
    return reduce(state, { type: 'TICK', now: state.deadline! }).state
  }

  it('returns to the lobby with scores cleared and the room code kept', () => {
    const state = finished()
    expect(state.phase).toBe('finalResults')

    const again = reduce(state, { type: 'RESTART', playerId: 'a' }).state
    expect(again.phase).toBe('lobby')
    expect(again.roomCode).toBe(state.roomCode)
    expect(again.roundIndex).toBe(0)
    expect(again.submissions).toEqual([])
    expect(again.players.every((p) => p.score === 0)).toBe(true)
  })

  it('only honors the leader', () => {
    const result = reduce(finished(), { type: 'RESTART', playerId: 'b' })
    expect(result.rejection?.code).toBe('invalid')
    expect(result.state.phase).toBe('finalResults')
  })

  it('refuses to restart a game that is still running', () => {
    const result = reduce(started(['a', 'b']), { type: 'RESTART', playerId: 'a' })
    expect(result.rejection?.code).toBe('invalid')
  })

  it('drops players who left rather than stranding their name in the lobby', () => {
    let state = finished()
    state = reduce(state, { type: 'DISCONNECT', playerId: 'b' }).state
    const again = reduce(state, { type: 'RESTART', playerId: 'a' }).state
    expect(again.players.map((p) => p.id)).toEqual(['a'])
  })
})

describe('when the room briefly empties', () => {
  it('does not race through the build phase with nobody connected', () => {
    let state = started(['a', 'b'])
    state = reduce(state, { type: 'DISCONNECT', playerId: 'a' }).state
    state = reduce(state, { type: 'DISCONNECT', playerId: 'b' }).state

    // "Everyone has submitted" is vacuously true here; only the clock should
    // be able to end the round.
    state = reduce(state, { type: 'TICK', now: T0 + 1000 }).state
    expect(state.phase).toBe('building')
    expect(state.roundIndex).toBe(0)
  })

  it('does not race through voting with nobody connected', () => {
    let state = started(['a', 'b'])
    state = submitAll(state, ['a', 'b'])
    expect(state.phase).toBe('voting')

    state = reduce(state, { type: 'DISCONNECT', playerId: 'a' }).state
    state = reduce(state, { type: 'DISCONNECT', playerId: 'b' }).state
    state = reduce(state, { type: 'TICK', now: T0 + 1000 }).state
    expect(state.phase).toBe('voting')
  })

  it('still ends the phase when the clock runs out', () => {
    let state = started(['a', 'b'])
    state = reduce(state, { type: 'DISCONNECT', playerId: 'a' }).state
    state = reduce(state, { type: 'DISCONNECT', playerId: 'b' }).state
    state = reduce(state, { type: 'TICK', now: T0 + BUILD_MS }).state
    expect(state.phase).toBe('roundResults')
  })

  it('resumes normally once a player reconnects', () => {
    let state = started(['a', 'b'])
    state = reduce(state, { type: 'DISCONNECT', playerId: 'a' }).state
    state = reduce(state, { type: 'DISCONNECT', playerId: 'b' }).state
    state = reduce(state, {
      type: 'JOIN',
      playerId: 'a',
      secret: 's-a',
      name: 'a',
      avatarId: 'fox',
      now: T0,
    }).state

    expect(state.phase).toBe('building')
    state = submitAll(state, ['a'])
    // Only 'a' is here, so their submission completes the phase.
    expect(state.phase).toBe('roundResults')
  })
})

describe('recovering from a host restart', () => {
  /** A room mid-build with one entry already in, as a resume would restore it. */
  function resumed(now: number): RoomState {
    let state = started(['a', 'b'])
    state = submitAll(state, ['a'])
    return {
      ...state,
      players: state.players.map((p) => ({ ...p, connected: false })),
      recoveringUntil: now + RECOVERY_GRACE_MS,
    }
  }

  it('does not let the first phone back end the round for everyone', () => {
    let state = resumed(T0)
    // Alice reconnects; she already submitted before the crash, so without the
    // grace window "everyone here is done" would be true and end the round.
    state = reduce(state, {
      type: 'JOIN',
      playerId: 'a',
      secret: 's-a',
      name: 'a',
      avatarId: 'fox',
      now: T0,
    }).state
    state = reduce(state, { type: 'TICK', now: T0 + 1000 }).state

    expect(state.phase).toBe('building')
    expect(state.roundIndex).toBe(0)
  })

  it('resumes normal early-advance once the grace window passes', () => {
    let state = resumed(T0)
    state = reduce(state, {
      type: 'JOIN',
      playerId: 'a',
      secret: 's-a',
      name: 'a',
      avatarId: 'fox',
      now: T0,
    }).state

    // Bob never came back; after the window, the room proceeds without him.
    state = reduce(state, { type: 'TICK', now: T0 + RECOVERY_GRACE_MS + 1 }).state
    expect(state.phase).not.toBe('building')
  })

  it('still advances everyone normally once they are all back', () => {
    let state = resumed(T0)
    for (const id of ['a', 'b']) {
      state = reduce(state, {
        type: 'JOIN',
        playerId: id,
        secret: `s-${id}`,
        name: id,
        avatarId: 'fox',
        now: T0,
      }).state
    }
    // Bob submits after the window; both are in, so voting opens.
    state = submitAll(state, ['b'], T0 + RECOVERY_GRACE_MS + 1)
    expect(state.phase).toBe('voting')
  })
})

describe('when the host tab is suspended', () => {
  it('pushes the deadline forward so time nobody could play is not play time', () => {
    const state = started(['a', 'b'])
    const gap = 60_000
    const after = reduce(state, { type: 'SUSPENDED', gap }).state

    expect(after.deadline).toBe(state.deadline! + gap)
  })

  it('does not let the round end on the tick that follows a long suspension', () => {
    let state = started(['a', 'b'])
    // Suspended for longer than the whole build phase.
    const gap = BUILD_MS * 2
    state = reduce(state, { type: 'SUSPENDED', gap }).state
    state = reduce(state, { type: 'TICK', now: T0 + gap }).state

    expect(state.phase).toBe('building')
  })

  it('gives players a window to reconnect before the phase can complete early', () => {
    let state = started(['a', 'b'])
    state = submitAll(state, ['a'])
    state = reduce(state, { type: 'SUSPENDED', gap: 30_000 }).state
    // 'b' is gone; without the grace window 'a' alone would end the round.
    state = reduce(state, { type: 'DISCONNECT', playerId: 'b' }).state
    state = reduce(state, { type: 'TICK', now: T0 + 30_000 }).state

    expect(state.phase).toBe('building')
  })

  it('ignores a nonsensical gap and an untimed phase', () => {
    const state = started(['a', 'b'])
    expect(reduce(state, { type: 'SUSPENDED', gap: 0 }).state).toBe(state)

    const untimed: RoomState = { ...state, deadline: null }
    expect(reduce(untimed, { type: 'SUSPENDED', gap: 5000 }).state).toBe(untimed)
  })
})
