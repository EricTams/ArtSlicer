/**
 * How far ahead of the deadline to send the picture.
 *
 * The host changes phase on its own tick and refuses anything that arrives
 * after, so the message needs time to get there. The scene has been current in
 * its ref since the last drag, so going early costs nothing but the final
 * second of a round nobody spends editing anyway.
 */
export const AUTO_SUBMIT_LEAD_MS = 1500

/**
 * How long to wait before submitting on the player's behalf.
 *
 * The deadline is an absolute time on the host's clock and means nothing on
 * this device until the offset the ping measures is taken off it — the same
 * correction the countdown makes, in the same direction, so the send lands
 * when the clock on screen says it should.
 *
 * Never negative: a deadline already gone means send now and let the host
 * decide whether it was in time.
 */
export function autoSubmitDelay(deadline: number, clockOffset: number, now: number): number {
  return Math.max(0, deadline - now - clockOffset - AUTO_SUBMIT_LEAD_MS)
}
