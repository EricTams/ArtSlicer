import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { AVATARS, getAvatar } from '../shared/avatars'
import { MAX_NAME_LENGTH, MIN_PLAYERS_TO_START, sanitizeName } from '../shared/gameState'
import { isValidRoomCode, normalizeRoomCode } from '../shared/roomCode'
import { loadIdentity } from './identity'
import { useClientRoom } from './useClientRoom'

/** Phone entry point, reached by scanning the host's QR code. */
export function ClientApp() {
  const { code } = useParams<{ code: string }>()
  const roomCode = code ? normalizeRoomCode(code) : ''

  // Loaded once: a remount must not mint a new identity, or the player loses
  // their seat on every reconnect.
  const identity = useMemo(() => loadIdentity(), [])

  if (!isValidRoomCode(roomCode)) {
    return (
      <div className="screen screen--center">
        <h1 className="brand">
          Art<em>Slicer</em>
        </h1>
        <p className="error">
          {roomCode ? `"${roomCode}" is not a valid room code.` : 'No room code in that link.'}
        </p>
        <p className="muted">Scan the QR code on the host screen.</p>
      </div>
    )
  }

  return <Room roomCode={roomCode} identity={identity} />
}

function Room({ roomCode, identity }: { roomCode: string; identity: ReturnType<typeof loadIdentity> }) {
  const room = useClientRoom(roomCode, identity)
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
          {room.status === 'connecting'
            ? 'Connecting…'
            : submitted
              ? 'Joining…'
              : 'Join game'}
        </button>
      </div>
    )
  }

  const connected = room.players.filter((p) => p.connected).length
  const needed = MIN_PLAYERS_TO_START - connected
  const avatar = getAvatar(me!.avatarId)

  if (room.phase !== 'lobby') {
    return (
      <div className="screen screen--center">
        <div className="stack" style={{ alignItems: 'center' }}>
          <span className="playerchip__avatar playerchip__avatar--big" style={{ background: avatar.color }}>
            {avatar.glyph}
          </span>
          <h2>Round {room.roundIndex + 1}</h2>
          <p className="muted">The build phase lands in M4.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="screen screen--center">
      <div className="stack" style={{ alignItems: 'center', width: '100%', maxWidth: 380 }}>
        <span className="playerchip__avatar playerchip__avatar--big" style={{ background: avatar.color }}>
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
