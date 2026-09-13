import { describe, expect, it } from 'vitest'

import { revivalFor, survivedSuspend } from './revival'

const live = { destroyed: false, disconnected: false }

describe('revivalFor', () => {
  it('leaves a peer that came back intact alone', () => {
    expect(revivalFor(live)).toBe('none')
  })

  it('reconnects the socket when only signalling dropped, keeping the code', () => {
    expect(revivalFor({ ...live, disconnected: true })).toBe('reconnect')
  })

  it('reclaims the room when the peer itself is gone', () => {
    expect(revivalFor({ ...live, destroyed: true })).toBe('reclaim')
  })

  it('treats a destroyed peer as gone even while it reports a live socket', () => {
    expect(revivalFor({ destroyed: true, disconnected: false })).toBe('reclaim')
  })

  it('reclaims when there is no peer at all', () => {
    expect(revivalFor(null)).toBe('reclaim')
  })
})

describe('survivedSuspend', () => {
  it.each(['failed', 'closed'] as const)('reaps a channel left %s', (ice) => {
    expect(survivedSuspend(ice)).toBe(false)
  })

  it('keeps a disconnected channel, which still comes back', () => {
    expect(survivedSuspend('disconnected')).toBe(true)
  })

  it.each(['connected', 'completed', 'checking', 'new'] as const)('keeps one %s', (ice) => {
    expect(survivedSuspend(ice)).toBe(true)
  })

  it('keeps a phone that had not started dialling', () => {
    expect(survivedSuspend(undefined)).toBe(true)
  })
})
