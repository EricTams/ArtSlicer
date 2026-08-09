import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { isValidRoomCode, normalizeRoomCode } from './shared/roomCode'

/**
 * The front door. Players who scanned a QR code never see this — their link
 * goes straight to #/join/CODE — so this is for whoever is starting a game, or
 * for someone typing a code because scanning failed.
 */
export function Home() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const normalized = normalizeRoomCode(code)

  return (
    <div className="screen screen--center">
      <div className="stack home">
        <h1 className="brand">
          Art<em>Slicer</em>
        </h1>
        <p className="tagline">
          Grab a pile of junk. Make it look like the prompt. Let everyone judge you.
        </p>

        <button className="btn btn--wide" onClick={() => navigate('/host')}>
          Start a game
        </button>

        <p className="muted home__or">or join one</p>

        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault()
            if (isValidRoomCode(normalized)) navigate(`/join/${normalized}`)
          }}
        >
          <input
            className="input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Room code"
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="go"
            aria-label="Room code"
          />
          <button className="btn" type="submit" disabled={!isValidRoomCode(normalized)}>
            Join
          </button>
        </form>

        <p className="muted home__hint">
          Starting a game works best on whatever screen the room can see — a laptop or TV if you
          have one, otherwise your phone.
        </p>
      </div>
    </div>
  )
}
