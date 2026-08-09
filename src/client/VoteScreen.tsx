import { SceneView } from '../render/SceneView'
import { Countdown } from '../shared/Countdown'
import type { BallotEntry } from '../shared/protocol'

interface Props {
  prompt: string
  ballot: BallotEntry[]
  yourVote: string | null
  deadline: number | null
  clockOffset: number
  onVote(entryId: string): void
}

/**
 * The phone's voting phase. Entries carry no author — the ballot is keyed by
 * an opaque entry id — so nobody can vote for their friend by name.
 */
export function VoteScreen({ prompt, ballot, yourVote, deadline, clockOffset, onVote }: Props) {
  if (ballot.length === 0) {
    return (
      <div className="screen screen--center">
        <h2>Nothing to vote on</h2>
        <p className="muted">Nobody else got anything finished.</p>
      </div>
    )
  }

  return (
    <div className="vote">
      <header className="build__head">
        <div>
          <p className="build__round">Which one is</p>
          <h2 className="build__prompt">{prompt}</h2>
        </div>
        <Countdown deadline={deadline} clockOffset={clockOffset} />
      </header>

      <p className="muted vote__hint">
        {yourVote ? 'Tap another to change your vote.' : 'Tap your favourite.'}
      </p>

      <div className="vote__grid">
        {ballot.map((entry) => (
          <button
            key={entry.entryId}
            type="button"
            className={`vote__card${entry.entryId === yourVote ? ' vote__card--on' : ''}`}
            onClick={() => onVote(entry.entryId)}
          >
            <SceneView scene={entry.scene} size={150} />
          </button>
        ))}
      </div>
    </div>
  )
}
