import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { APP_VERSION, BUILD_SHA } from './version'

import { isValidRoomCode, normalizeRoomCode } from './shared/roomCode'
import { ScanJoin } from './client/ScanJoin'
import { cameraAvailable } from './client/qrScan'

/**
 * The front door. Players who scanned a QR code with the phone's camera app
 * never see this — their link goes straight to #/join/CODE — so this is for
 * whoever is starting a game, for someone typing a code, and for anyone
 * already in the app who wants to join a room without leaving it.
 */
export function Home() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [scanning, setScanning] = useState(false)
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

        {/* The phone's own camera app would read the same code and then hand
            the player to the browser, which for anyone running this from their
            home screen means leaving the app. This one stays in it. */}
        {cameraAvailable() && (
          <button className="btn btn--ghost btn--wide" onClick={() => setScanning(true)}>
            Scan the code
          </button>
        )}

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

        <button className="btn btn--ghost btn--wide" onClick={() => navigate('/solo')}>
          Play on your own
        </button>

        <p className="muted home__hint">
          Starting a game works best on whatever screen the room can see — a laptop or TV if you
          have one, otherwise your phone.
        </p>

        <p className="home__version">
          v{APP_VERSION} <span className="home__build">{BUILD_SHA}</span>
        </p>
      </div>

      {scanning && (
        <ScanJoin
          onClose={() => setScanning(false)}
          onCode={(scanned) => navigate(`/join/${scanned}`)}
        />
      )}
    </div>
  )
}
