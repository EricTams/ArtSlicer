import { describe, expect, it } from 'vitest'

import { type Identity, rejoinableRoom, shouldRejoinSilently } from './identity'

const NOW = 1_700_000_000_000
const MINUTE = 60 * 1000

const stored = (over: Partial<Identity> = {}): Identity => ({
  playerId: 'p1',
  secret: 's1',
  name: 'Ada',
  avatarId: 'fox',
  lastRoom: 'QVCW',
  lastRoomAt: NOW,
  ...over,
})

describe('shouldRejoinSilently', () => {
  it('takes the seat back in the room it left, which is a lock screen or a refresh', () => {
    expect(shouldRejoinSilently(stored(), 'QVCW')).toBe(true)
  })

  it('stops to ask at a different room, which is a different game', () => {
    expect(shouldRejoinSilently(stored(), 'ZZZZ')).toBe(false)
  })

  it('stops to ask when the stored identity never named a room', () => {
    // Written before rooms were remembered: no claim to any seat.
    expect(shouldRejoinSilently(stored({ lastRoom: undefined }), 'QVCW')).toBe(false)
  })

  it('has nothing to rejoin as without a name, however the rooms line up', () => {
    expect(shouldRejoinSilently(stored({ name: '' }), 'QVCW')).toBe(false)
  })

  it('is case- and room-exact, so a different code is never mistaken for the same one', () => {
    expect(shouldRejoinSilently(stored({ lastRoom: 'qvcw' }), 'QVCW')).toBe(false)
  })
})

describe('rejoinableRoom', () => {
  it('offers the room back to a phone that has just closed the app', () => {
    expect(rejoinableRoom(stored(), NOW + MINUTE)).toBe('QVCW')
  })

  it('still offers it across a break in the middle of a game', () => {
    expect(rejoinableRoom(stored(), NOW + 25 * MINUTE)).toBe('QVCW')
  })

  it('stops offering a game long over, whose code is gone anyway', () => {
    expect(rejoinableRoom(stored(), NOW + 2 * 60 * MINUTE)).toBeNull()
  })

  it('offers nothing when the time was never stored', () => {
    // An identity written before this was kept: no way to tell an interrupted
    // game from one played last week.
    expect(rejoinableRoom(stored({ lastRoomAt: undefined }), NOW)).toBeNull()
  })

  it('offers nothing without a room or a name to return as', () => {
    expect(rejoinableRoom(stored({ lastRoom: undefined }), NOW)).toBeNull()
    expect(rejoinableRoom(stored({ name: '' }), NOW)).toBeNull()
  })
})
