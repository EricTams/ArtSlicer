import { describe, expect, it } from 'vitest'

import { type ErrorCode, refusalKind } from './protocol'

describe('refusalKind', () => {
  it.each<ErrorCode>(['room-full', 'game-in-progress'])(
    'keeps asking after %s, which describes the room and not the player',
    (code) => {
      expect(refusalKind(code)).toBe('retry-later')
    },
  )

  it('gives up on a stale bundle, which a retry cannot refresh', () => {
    expect(refusalKind('protocol-mismatch')).toBe('terminal')
  })

  it('gives up on a taken seat, since the same secret gets the same answer', () => {
    expect(refusalKind('bad-secret')).toBe('terminal')
  })

  it('treats a rejected action as leaving the seat alone', () => {
    expect(refusalKind('invalid')).toBe('action')
  })
})
