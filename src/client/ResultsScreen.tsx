import { ResultsGallery, Scoreboard, championsOf } from '../render/Results'
import { getAvatar } from '../shared/avatars'
import { Countdown } from '../shared/Countdown'
import type { ClientRoom } from './useClientRoom'

/**
 * The reveal on a player's own phone. When a big screen is in the room this
 * duplicates it, which is fine — but it means a phone-only game still gets the
 * full result rather than being told to look at a screen that isn't there.
 */
export function ResultsScreen({ room }: { room: ClientRoom }) {
  const final = room.phase === 'finalResults'
  const me = room.players.find((player) => player.id === room.you)
  const myPoints = room.reveal.find((entry) => entry.playerId === room.you)?.points ?? 0
  const iWon = room.winners.includes(room.you ?? '')

  if (final) {
    const champions = championsOf(room.players)
    const youWon = champions.some((player) => player.id === room.you)

    return (
      <div className="results">
        <p className="build__round">Final scores</p>
        <h2 className="results__headline">
          {youWon
            ? champions.length === 1
              ? 'You win!'
              : 'You tied for the win!'
            : champions.length === 1
              ? `${champions[0]!.name} wins`
              : 'It’s a tie'}
        </h2>

        <Scoreboard players={room.players} you={room.you} />

        {room.canRestart ? (
          <button className="btn btn--wide" onClick={room.restart}>
            Play again
          </button>
        ) : (
          <p className="muted">Waiting for the first player to start another game…</p>
        )}
      </div>
    )
  }

  const avatar = getAvatar(me?.avatarId ?? '')

  return (
    <div className="results">
      <header className="build__head">
        <div>
          <p className="build__round">
            Round {room.roundIndex + 1} of {room.totalRounds}
          </p>
          <h2 className="build__prompt">{room.prompt}</h2>
        </div>
        <Countdown deadline={room.deadline} clockOffset={room.clockOffset} />
      </header>

      <div className="results__you">
        <span className="playerchip__avatar" style={{ background: avatar.color }}>
          {avatar.glyph}
        </span>
        {myPoints > 0 ? (
          <span className="bigscore">+{myPoints}</span>
        ) : (
          <span className="muted">No votes this round</span>
        )}
        {iWon && <span className="playerchip__tag">ROUND WIN</span>}
      </div>

      <ResultsGallery
        entries={room.reveal}
        players={room.players}
        winners={room.winners}
        size={140}
      />

      <Scoreboard players={room.players} you={room.you} />
    </div>
  )
}
