import { getAvatar } from '../shared/avatars'
import {
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  type PublicPlayer,
  type RoomState,
  publicPlayers,
} from '../shared/gameState'
import { joinUrl } from '../shared/roomCode'
import { QrCode } from './QrCode'

/** The shared-screen lobby, shown when the host device is not also playing. */
export function Lobby({
  state,
  onPlayHere,
  playing,
}: {
  state: RoomState
  onPlayHere(): void
  playing: boolean
}) {
  const players = publicPlayers(state)
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
        <JoinPanel roomCode={state.roomCode} />

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
          {!playing && (
            <button type="button" className="btn btn--ghost" onClick={onPlayHere}>
              Play on this device too
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The QR code and room code. Shown on the host device whether that's a laptop
 * across the room or the phone of the player who started the game — in the
 * phone case they simply hold it out for others to scan.
 */
export function JoinPanel({ roomCode, compact }: { roomCode: string; compact?: boolean }) {
  const url = joinUrl(roomCode)

  return (
    <div className="card stack lobby__join">
      <h2>{compact ? 'Others scan this' : 'Join on your phone'}</h2>
      <QrCode value={url} size={compact ? 200 : 320} />
      <div className="stack" style={{ gap: 4 }}>
        <p className="muted" style={{ margin: 0 }}>
          or go to <strong>{shortUrl(url)}</strong> and enter
        </p>
        <p className="roomcode">{roomCode}</p>
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
