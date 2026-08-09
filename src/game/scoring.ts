import type { PlayerId } from '../shared/gameState'
import type { Submission } from '../shared/gameState'

export const POINTS_PER_VOTE = 100
/** Rewards winning the round outright, on top of the votes themselves. */
export const WINNER_BONUS = 50

export interface RoundResult {
  /** Points earned this round, by player. Zero-vote players are included. */
  points: Record<PlayerId, number>
  votesByEntry: Record<string, number>
  /** Everyone tied for the most votes. Empty when nobody voted. */
  winners: PlayerId[]
}

/**
 * Tallies one round. Ties all win: splitting the bonus, or picking a winner
 * arbitrarily, both feel worse in a party game than simply awarding it twice.
 */
export function tallyRound(
  submissions: readonly Submission[],
  votes: Readonly<Record<PlayerId, string>>,
): RoundResult {
  const votesByEntry: Record<string, number> = {}
  for (const submission of submissions) votesByEntry[submission.entryId] = 0

  for (const entryId of Object.values(votes)) {
    // Ignore votes for entries that no longer exist.
    if (entryId in votesByEntry) votesByEntry[entryId]! += 1
  }

  const points: Record<PlayerId, number> = {}
  for (const submission of submissions) {
    points[submission.playerId] = (votesByEntry[submission.entryId] ?? 0) * POINTS_PER_VOTE
  }

  const most = Math.max(0, ...Object.values(votesByEntry))
  const winners =
    most === 0
      ? []
      : submissions
          .filter((submission) => votesByEntry[submission.entryId] === most)
          .map((submission) => submission.playerId)

  for (const winner of winners) {
    points[winner] = (points[winner] ?? 0) + WINNER_BONUS
  }

  return { points, votesByEntry, winners }
}
