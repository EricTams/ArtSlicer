import { usePiecesLoaded } from '../editor/usePiecesLoaded'
import { describeFailure } from '../net/transport'
import { getAvatar } from '../shared/avatars'
import {
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  type PublicPlayer,
  publicPlayers,
} from '../shared/gameState'
import { joinUrl } from '../shared/roomCode'
import { QrCode } from './QrCode'
import { BuildingScreen, FinalScreen, ResultsScreen, VotingScreen } from './RoundScreens'
import { useHostRoom } from './useHostRoom'

/** Host entry point — runs on the laptop and is the authoritative game server. */
export function HostApp() {
  const { status, state, failure } = useHostRoom()
  // The host re-renders the scenes phones submit, so it needs the same sprites
  // they do. Loading starts immediately and overlaps with the lobby wait.
  const piecesLoaded = usePiecesLoaded()

  if (status === 'failed' && failure) {
    return (
      <div className="screen screen--center">
        <div className="card stack" style={{ maxWidth: 520 }}>
          <h2>Could not open a room</h2>
          <p className="error">{describeFailure(failure)}</p>
          <button className="btn" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (status === 'claiming' || !state.roomCode) {
    return (
      <div className="screen screen--center">
        <h1 className="brand">
          Art<em>Slicer</em>
        </h1>
        <p className="tagline">Opening a room…</p>
      </div>
    )
  }

  if (state.phase !== 'lobby' && !piecesLoaded) {
    return (
      <div className="screen screen--center">
        <p className="tagline">Loading the junk…</p>
      </div>
    )
  }

  switch (state.phase) {
    case 'building':
      return <BuildingScreen state={state} />
    case 'voting':
      return <VotingScreen state={state} />
    case 'roundResults':
      return <ResultsScreen state={state} />
    case 'finalResults':
      return <FinalScreen state={state} />
    case 'lobby':
      return <Lobby roomCode={state.roomCode} players={publicPlayers(state)} />
  }
}

function Lobby({ roomCode, players }: { roomCode: string; players: PublicPlayer[] }) {
  const url = joinUrl(roomCode)
  const connected = players.filter((p) => p.connected).length
  const needed = MIN_PLAYERS_TO_START - connected

  return (
    <div className="screen">
      <div className="row">
        <h1 className="brand" style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}>
          Art<em>Slicer</em>
        </h1>
        <div className="spacer" />
        <p className="tagline">
          {connected}/{MAX_PLAYERS} players
        </p>
      </div>

      <div className="lobby">
        <div className="card stack lobby__join">
          <h2>Join on your phone</h2>
          <QrCode value={url} />
          <div className="stack" style={{ gap: 4 }}>
            <p className="muted" style={{ margin: 0 }}>
              or go to <strong>{shortUrl(url)}</strong> and enter
            </p>
            <p className="roomcode">{roomCode}</p>
          </div>
        </div>

        <div className="stack lobby__players">
          <h2>Players</h2>
          {players.length === 0 ? (
            <p className="muted">Waiting for the first player…</p>
          ) : (
            <ul className="playerlist">
              {players.map((player) => (
                <PlayerChip key={player.id} player={player} />
              ))}
            </ul>
          )}
          <div className="spacer" />
          <p className="muted">
            {needed > 0
              ? `Need ${needed} more player${needed === 1 ? '' : 's'} to start.`
              : `${leaderName(players)} can start the game.`}
          </p>
        </div>
      </div>
    </div>
  )
}

function PlayerChip({ player }: { player: PublicPlayer }) {
  const avatar = getAvatar(player.avatarId)
  return (
    <li className="playerchip" style={{ opacity: player.connected ? 1 : 0.45 }}>
      <span className="playerchip__avatar" style={{ background: avatar.color }}>
        {avatar.glyph}
      </span>
      <span className="playerchip__name">{player.name}</span>
      {player.isLeader && <span className="playerchip__tag">HOST</span>}
      {!player.connected && <span className="playerchip__tag playerchip__tag--dim">AWAY</span>}
    </li>
  )
}

function leaderName(players: PublicPlayer[]): string {
  return players.find((p) => p.isLeader)?.name ?? 'The first player'
}

/** The QR carries the full URL; the printed version just has to be typeable. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/#.*$/, '')
}
