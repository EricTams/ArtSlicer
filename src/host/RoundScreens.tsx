import { SceneView } from '../render/SceneView'
import { getAvatar } from '../shared/avatars'
import { Countdown } from '../shared/Countdown'
import type { PublicPlayer, RoomState } from '../shared/gameState'
import type { RevealedEntry } from '../shared/protocol'
import { POINTS_PER_VOTE, WINNER_BONUS, tallyRound } from '../game/scoring'

/**
 * The host screen during a round. It never shows the artwork while people are
 * still building — that would let the room see (and copy) each other's ideas.
 */
export function BuildingScreen({ state }: { state: RoomState }) {
  const waiting = state.players.filter(
    (player) => player.connected && !state.submissions.some((e) => e.playerId === player.id),
  )

  return (
    <div className="screen screen--center">
      <p className="build__round">
        Round {state.roundIndex + 1} of {state.totalRounds}
      </p>
      <h1 className="hostprompt">{state.prompt}</h1>
      <Countdown deadline={state.deadline} className="countdown--huge" />
      <p className="muted">
        {waiting.length === 0
          ? 'Everyone is done!'
          : `Still building: ${waiting.map((p) => p.name).join(', ')}`}
      </p>
    </div>
  )
}

export function VotingScreen({ state }: { state: RoomState }) {
  const waiting = state.players.filter((player) => player.connected && !(player.id in state.votes))

  return (
    <div className="screen">
      <header className="row">
        <div>
          <p className="build__round">Vote on your phone — which one is</p>
          <h1 className="hostprompt">{state.prompt}</h1>
        </div>
        <div className="spacer" />
        <Countdown deadline={state.deadline} className="countdown--huge" />
      </header>

      <div className="gallery">
        {state.submissions.map((entry) => (
          // Anonymous while voting is open; authors appear on the results screen.
          <div key={entry.entryId} className="gallery__item">
            <SceneView scene={entry.scene} size={260} />
          </div>
        ))}
      </div>

      <p className="muted">
        {waiting.length === 0
          ? 'All votes in!'
          : `Waiting on: ${waiting.map((p) => p.name).join(', ')}`}
      </p>
    </div>
  )
}

export function ResultsScreen({ state }: { state: RoomState }) {
  const { votesByEntry } = tallyRound(state.submissions, state.votes)
  const byId = new Map(state.players.map((player) => [player.id, player]))

  const entries: RevealedEntry[] = state.submissions
    .map((entry) => ({
      entryId: entry.entryId,
      scene: entry.scene,
      playerId: entry.playerId,
      votes: votesByEntry[entry.entryId] ?? 0,
      points: state.lastRoundPoints[entry.playerId] ?? 0,
    }))
    .sort((a, b) => b.votes - a.votes)

  return (
    <div className="screen">
      <header className="row">
        <h1 className="hostprompt">{state.prompt}</h1>
        <div className="spacer" />
        <Countdown deadline={state.deadline} className="countdown--huge" />
      </header>

      <div className="gallery">
        {entries.map((entry) => {
          const player = byId.get(entry.playerId)
          const avatar = getAvatar(player?.avatarId ?? '')
          const won = state.lastRoundWinners.includes(entry.playerId)
          return (
            <div key={entry.entryId} className={`gallery__item${won ? ' gallery__item--win' : ''}`}>
              <SceneView scene={entry.scene} size={260} />
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

      {state.lastRoundWinners.length > 0 && (
        <p className="muted">
          {state.lastRoundWinners.map((id) => byId.get(id)?.name).join(' and ')}{' '}
          {state.lastRoundWinners.length === 1 ? 'wins' : 'win'} the round (+{WINNER_BONUS} bonus,{' '}
          {POINTS_PER_VOTE} per vote).
        </p>
      )}

      <Scoreboard players={sortedByScore(state)} />
    </div>
  )
}

export function FinalScreen({ state }: { state: RoomState }) {
  const ranked = sortedByScore(state)
  const top = ranked[0]
  // Ties at the top all win — same rule as the per-round bonus.
  const champions = top ? ranked.filter((player) => player.score === top.score) : []

  return (
    <div className="screen screen--center">
      <p className="build__round">Final scores</p>
      <h1 className="brand">
        {champions.length === 1 ? `${champions[0]!.name} wins!` : 'It’s a tie!'}
      </h1>
      <div className="podium">
        {champions.map((player) => {
          const avatar = getAvatar(player.avatarId)
          return (
            <div key={player.id} className="podium__winner">
              <span
                className="playerchip__avatar playerchip__avatar--big"
                style={{ background: avatar.color }}
              >
                {avatar.glyph}
              </span>
              <strong>{player.name}</strong>
              <span className="muted">{player.score}</span>
            </div>
          )
        })}
      </div>
      {/* When everyone tied, the podium already lists the whole room and a
          second copy of the same names reads as a bug. */}
      {ranked.length > champions.length && <Scoreboard players={ranked} />}
      <p className="muted">Refresh this page to play again.</p>
    </div>
  )
}

function Scoreboard({ players }: { players: PublicPlayer[] }) {
  return (
    <ol className="scoreboard">
      {players.map((player) => {
        const avatar = getAvatar(player.avatarId)
        return (
          <li key={player.id} className="scoreboard__row">
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

function sortedByScore(state: RoomState): PublicPlayer[] {
  return state.players
    .map((player) => ({
      id: player.id,
      name: player.name,
      avatarId: player.avatarId,
      connected: player.connected,
      score: player.score,
      isLeader: player.id === state.leaderId,
      submitted: state.submissions.some((entry) => entry.playerId === player.id),
      voted: player.id in state.votes,
    }))
    .sort((a, b) => b.score - a.score)
}
