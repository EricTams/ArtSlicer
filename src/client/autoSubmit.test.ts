import { describe, expect, it } from 'vitest'

import { AUTO_SUBMIT_LEAD_MS, autoSubmitDelay } from './autoSubmit'

const NOW = 1_000_000

describe('autoSubmitDelay', () => {
  it('sends a lead time before the deadline', () => {
    expect(autoSubmitDelay(NOW + 30_000, 0, NOW)).toBe(30_000 - AUTO_SUBMIT_LEAD_MS)
  })

  it('corrects for a host clock running ahead of this phone', () => {
    // The host says 30s left, but its clock is 5s ahead, so really it is 25s.
    expect(autoSubmitDelay(NOW + 30_000, 5_000, NOW)).toBe(25_000 - AUTO_SUBMIT_LEAD_MS)
  })

  it('corrects for a host clock running behind', () => {
    expect(autoSubmitDelay(NOW + 30_000, -5_000, NOW)).toBe(35_000 - AUTO_SUBMIT_LEAD_MS)
  })

  it('sends immediately once the lead time is already inside the deadline', () => {
    expect(autoSubmitDelay(NOW + AUTO_SUBMIT_LEAD_MS - 1, 0, NOW)).toBe(0)
  })

  it('sends immediately for a deadline that has gone, rather than never', () => {
    expect(autoSubmitDelay(NOW - 10_000, 0, NOW)).toBe(0)
  })

  it('matches what the countdown on screen is showing, less the lead', () => {
    // Countdown computes deadline - (now + offset); the send rides on that.
    const deadline = NOW + 12_345
    const offset = 678
    const onScreen = deadline - (NOW + offset)
    expect(autoSubmitDelay(deadline, offset, NOW)).toBe(onScreen - AUTO_SUBMIT_LEAD_MS)
  })
})
