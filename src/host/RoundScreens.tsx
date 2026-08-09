import { POINTS_PER_VOTE, WINNER_BONUS, tallyRound } from '../game/scoring'
import { ResultsGallery, Scoreboard, championsOf } from '../render/Results'
import { SceneView } from '../render/SceneView'
import { getAvatar } from '../shared/avatars'
import { Countdown } from '../shared/Countdown'
import { type RoomState, publicPlayers } from '../shared/gameState'
import type { RevealedEntry } from '../shared/protocol'

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
  return (
    <div className="screen">
      <header className="row">
        <h1 className="hostprompt">{state.prompt}</h1>
        <div className="spacer" />
        <Countdown deadline={state.deadline} className="countdown--huge" />
      </header>

      <ResultsGallery
        entries={revealOf(state)}
        players={publicPlayers(state)}
        winners={state.lastRoundWinners}
        size={260}
      />

      {state.lastRoundWinners.length > 0 && (
        <p className="muted">
          {state.lastRoundWinners.map((id) => nameOf(state, id)).join(' and ')}{' '}
          {state.lastRoundWinners.length === 1 ? 'wins' : 'win'} the round (+{WINNER_BONUS} bonus,{' '}
          {POINTS_PER_VOTE} per vote).
        </p>
      )}

      <Scoreboard players={publicPlayers(state)} />
    </div>
  )
}

export function FinalScreen({ state }: { state: RoomState }) {
  const players = publicPlayers(state)
  const champions = championsOf(players)
  const leader = state.players.find((p) => p.id === state.leaderId && p.connected)

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
      {players.length > champions.length && <Scoreboard players={players} />}

      <p className="muted">
        {leader ? `${leader.name} can start another game.` : 'Refresh this page to play again.'}
      </p>
    </div>
  )
}

/** The same reveal the clients receive, rebuilt from authoritative state. */
function revealOf(state: RoomState): RevealedEntry[] {
  const { votesByEntry } = tallyRound(state.submissions, state.votes)
  return state.submissions
    .map((entry) => ({
      entryId: entry.entryId,
      scene: entry.scene,
      playerId: entry.playerId,
      votes: votesByEntry[entry.entryId] ?? 0,
      points: state.lastRoundPoints[entry.playerId] ?? 0,
    }))
    .sort((a, b) => b.votes - a.votes)
}

function nameOf(state: RoomState, id: string): string {
  return state.players.find((player) => player.id === id)?.name ?? 'Someone'
}
