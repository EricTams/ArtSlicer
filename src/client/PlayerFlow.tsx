import { useEffect, useState } from 'react'

import { usePiecesLoaded } from '../editor/usePiecesLoaded'
import type { ConnectFn } from '../net/transport'
import { AVATARS, getAvatar } from '../shared/avatars'
import { MAX_NAME_LENGTH, MIN_PLAYERS_TO_START, sanitizeName } from '../shared/gameState'
import { BuildScreen } from './BuildScreen'
import { ResultsScreen } from './ResultsScreen'
import { VoteScreen } from './VoteScreen'
import type { Identity } from './identity'
import { type ClientRoom, useClientRoom } from './useClientRoom'

export function PlayerFlow({
  connect,
  identity,
  roomCode,
}: {
  connect: ConnectFn
  identity: Identity
  /** Shown on the join form so a player can confirm they scanned the right code. */
  roomCode: string
}) {
  const room = useClientRoom(connect, identity)
  const [name, setName] = useState(identity.name)
  const [avatarId, setAvatarId] = useState(identity.avatarId || AVATARS[0]!.id)
  const [submitted, setSubmitted] = useState(false)

  const me = room.players.find((p) => p.id === room.you)
  const inLobby = Boolean(me)

  // A refused join (room full, name taken) must return the button to a usable
  // state rather than leaving it stuck on "Joining…".
  useEffect(() => {
    if (room.problem) setSubmitted(false)
  }, [room.problem])

  if (room.status === 'error') {
    return (
      <div className="screen screen--center">
        <div className="card stack">
          <h2>Can’t join</h2>
          <p className="error">{room.problem ?? 'Something went wrong.'}</p>
          <button className="btn" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!inLobby) {
    const trimmed = sanitizeName(name)
    return (
      <div className="screen">
        <div className="stack" style={{ textAlign: 'center' }}>
          <h1 className="brand" style={{ fontSize: '2.5rem' }}>
            Art<em>Slicer</em>
          </h1>
          <p className="muted">
            Room <strong>{roomCode}</strong>
          </p>
        </div>

        <label className="stack" style={{ gap: 6 }}>
          <span className="muted">Your name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            placeholder="Name"
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="done"
          />
        </label>

        <div className="stack" style={{ gap: 6 }}>
          <span className="muted">Pick an avatar</span>
          <div className="avatargrid">
            {AVATARS.map((avatar) => (
              <button
                key={avatar.id}
                type="button"
                className={`avatarbtn${avatar.id === avatarId ? ' avatarbtn--on' : ''}`}
                style={{ background: avatar.color }}
                onClick={() => setAvatarId(avatar.id)}
                aria-label={avatar.id}
                aria-pressed={avatar.id === avatarId}
              >
                {avatar.glyph}
              </button>
            ))}
          </div>
        </div>

        <div className="spacer" />

        {room.problem && <p className="error">{room.problem}</p>}

        <button
          className="btn btn--wide"
          disabled={!trimmed || room.status === 'connecting' || submitted}
          onClick={() => {
            setSubmitted(true)
            room.join(trimmed, avatarId)
          }}
        >
          {room.status === 'connecting' ? 'Connecting…' : submitted ? 'Joining…' : 'Join game'}
        </button>
      </div>
    )
  }

  const connected = room.players.filter((p) => p.connected).length
  const needed = MIN_PLAYERS_TO_START - connected
  const avatar = getAvatar(me!.avatarId)

  if (room.phase !== 'lobby') {
    return <InGame room={room} />
  }

  return (
    <div className="screen screen--center">
      <div className="stack" style={{ alignItems: 'center', width: '100%', maxWidth: 380 }}>
        <span
          className="playerchip__avatar playerchip__avatar--big"
          style={{ background: avatar.color }}
        >
          {avatar.glyph}
        </span>
        <h2>{me!.name}</h2>
        <p className="muted">
          You’re in. {connected} player{connected === 1 ? '' : 's'} here.
        </p>

        {room.status === 'reconnecting' && <p className="error">Reconnecting…</p>}

        <div className="spacer" />

        {room.canStart ? (
          <button className="btn btn--wide" onClick={room.start}>
            Start the game
          </button>
        ) : me!.isLeader ? (
          <p className="muted">
            Need {needed} more player{needed === 1 ? '' : 's'} before you can start.
          </p>
        ) : (
          <p className="muted">Waiting for the first player to start…</p>
        )}
      </div>
    </div>
  )
}

/**
 * Phone screens for a round in progress. Sprites must be decoded before the
 * editor or the ballot can draw anything, so this gate covers both.
 */
function InGame({ room }: { room: ClientRoom }) {
  const loaded = usePiecesLoaded()

  if (!loaded) {
    return (
      <div className="screen screen--center">
        <p className="tagline">Loading the junk…</p>
      </div>
    )
  }

  switch (room.phase) {
    case 'building':
      return (
        <BuildScreen
          prompt={room.prompt}
          roundIndex={room.roundIndex}
          totalRounds={room.totalRounds}
          deadline={room.deadline}
          clockOffset={room.clockOffset}
          submitted={room.youSubmitted}
          onSubmit={room.submit}
        />
      )

    case 'voting':
      return (
        <VoteScreen
          prompt={room.prompt}
          ballot={room.ballot}
          yourVote={room.yourVote}
          deadline={room.deadline}
          clockOffset={room.clockOffset}
          onVote={room.vote}
        />
      )

    case 'roundResults':
    case 'finalResults':
    default:
      // Every player sees the full reveal on their own phone, so a game with
      // no big screen loses nothing.
      return <ResultsScreen room={room} />
  }
}
