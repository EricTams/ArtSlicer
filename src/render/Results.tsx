import { getAvatar } from '../shared/avatars'
import type { PlayerId, PublicPlayer } from '../shared/gameState'
import type { RevealedEntry } from '../shared/protocol'
import { SceneView } from './SceneView'

/**
 * The reveal, shared by the big screen and every phone. One implementation so
 * the moment reads the same wherever you happen to be looking — only the
 * rendered size differs.
 */
export function ResultsGallery({
  entries,
  players,
  winners,
  size,
}: {
  entries: RevealedEntry[]
  players: PublicPlayer[]
  winners: PlayerId[]
  size: number
}) {
  const byId = new Map(players.map((player) => [player.id, player]))

  return (
    <div className="gallery">
      {entries.map((entry) => {
        const player = byId.get(entry.playerId)
        const avatar = getAvatar(player?.avatarId ?? '')
        const won = winners.includes(entry.playerId)

        return (
          <div key={entry.entryId} className={`gallery__item${won ? ' gallery__item--win' : ''}`}>
            <SceneView scene={entry.scene} size={size} />
            <div className="gallery__caption">
              <span className="playerchip__avatar" style={{ background: avatar.color }}>
                {avatar.glyph}
              </span>
              <div>
                <strong>{player?.name ?? 'Someone'}</strong>
                <div className="muted">
                  {entry.votes} vote{entry.votes === 1 ? '' : 's'}
                  {entry.points > 0 && ` · +${entry.points}`}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function Scoreboard({ players, you }: { players: PublicPlayer[]; you?: PlayerId | null }) {
  return (
    <ol className="scoreboard">
      {[...players]
        .sort((a, b) => b.score - a.score)
        .map((player) => {
          const avatar = getAvatar(player.avatarId)
          return (
            <li
              key={player.id}
              className={`scoreboard__row${player.id === you ? ' scoreboard__row--you' : ''}`}
            >
              <span className="playerchip__avatar" style={{ background: avatar.color }}>
                {avatar.glyph}
              </span>
              <span className="scoreboard__name">{player.name}</span>
              <span className="scoreboard__score">{player.score}</span>
            </li>
          )
        })}
    </ol>
  )
}

/** Everyone tied at the top; ties all win, matching the per-round bonus rule. */
export function championsOf(players: PublicPlayer[]): PublicPlayer[] {
  const top = [...players].sort((a, b) => b.score - a.score)[0]
  return top ? players.filter((player) => player.score === top.score) : []
}
