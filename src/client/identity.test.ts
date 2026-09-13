import { describe, expect, it } from 'vitest'

import { type Identity, shouldRejoinSilently } from './identity'

const stored = (over: Partial<Identity> = {}): Identity => ({
  playerId: 'p1',
  secret: 's1',
  name: 'Ada',
  avatarId: 'fox',
  lastRoom: 'QVCW',
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
