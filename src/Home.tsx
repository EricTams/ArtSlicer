import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { APP_VERSION, BUILD_SHA } from './version'

import { isValidRoomCode, normalizeRoomCode } from './shared/roomCode'
import { ScanJoin } from './client/ScanJoin'
import { cameraAvailable } from './client/qrScan'
import { clearRoom, loadRoom } from './game/persistence'
import { useArming } from './shared/useArming'

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
  /*
   * A game the host was in the middle of, read once on the way in. It expires
   * on its own a couple of minutes after the host was last seen, so one left
   * sitting here goes stale rather than wrong: abandoning something already
   * gone does nothing, and starting a game gets a fresh room either way.
   */
  const [interrupted, setInterrupted] = useState(() => loadRoom())
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

        {/* Starting a game picks an interrupted one back up, which is right
            after a refresh mid-round and wrong when the last one is simply
            over. Said here rather than discovered by watching the old game
            reappear, with the way out next to it. */}
        {interrupted && (
          <AbandonGame
            roomCode={interrupted.roomCode}
            onAbandon={() => {
              clearRoom()
              setInterrupted(null)
            }}
          />
        )}

        <button className="btn btn--wide" onClick={() => navigate('/host')}>
          {interrupted ? 'Back to your game' : 'Start a game'}
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

/**
 * The game that is still going, and the way to be rid of it.
 *
 * Two taps, like the host's own way out: the phones in that room are still
 * dialling back in, and this is the press that tells them there is nothing to
 * come back to.
 */
function AbandonGame({ roomCode, onAbandon }: { roomCode: string; onAbandon(): void }) {
  const { armed, press } = useArming(onAbandon)

  return (
    <div className="home__interrupted">
      <p className="home__interrupted-note">
        Room <strong>{roomCode}</strong> is still going. Starting a game picks it back up.
      </p>
      <button
        type="button"
        className={`btn btn--ghost btn--wide home__abandon${armed ? ' home__abandon--armed' : ''}`}
        aria-label={armed ? 'Confirm abandoning the game' : 'Abandon the game'}
        onClick={press}
      >
        {armed ? 'Abandon it?' : 'Abandon it'}
      </button>
    </div>
  )
}
