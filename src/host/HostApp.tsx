import { useCallback, useEffect, useState } from 'react'

import { PlayerFlow } from '../client/PlayerFlow'
import { loadIdentity } from '../client/identity'
import { usePiecesLoaded } from '../editor/usePiecesLoaded'
import { DebugPanel } from '../net/DebugPanel'
import type { ClientHandlers, ConnectionFailure } from '../net/transport'
import { describeFailure } from '../net/transport'
import type { HostRoom } from '../game/hostRoom'
import { clearRoom } from '../game/persistence'
import { JoinPanel, Lobby } from './Lobby'
import { BuildingScreen, FinalScreen, ResultsScreen, VotingScreen } from './RoundScreens'
import { useBigScreen } from './useBigScreen'
import { useHostRoom } from './useHostRoom'
import { useWakeLock } from './useWakeLock'

/**
 * The host, with the debug panel over it. Wrapping here rather than inside
 * each branch keeps the panel reachable on the two screens that need it most:
 * "opening a room…" that never finishes, and "could not open a room".
 */
export function HostApp() {
  return (
    <>
      <HostScreens />
      <NewGame />
      <DebugPanel />
    </>
  )
}

/**
 * A way out, on every screen.
 *
 * The host picks an interrupted game back up by itself, which is right when
 * the tab was refreshed mid-round and wrong when somebody has sat down to play
 * a new one. Without this the only way past a resumed game is to go and clear
 * the browser's storage by hand.
 *
 * Two taps. This ends a game a room full of people may be in the middle of,
 * and it sits in a corner where a thumb goes to steady the phone. The arming
 * lapses on its own so a stray touch does not leave it primed.
 */
function NewGame() {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])

  return (
    <button
      type="button"
      className={`newgame${armed ? ' newgame--armed' : ''}`}
      aria-label={armed ? 'Confirm starting a new game' : 'Start a new game'}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          return
        }
        // Forget the interrupted game first, or the reload resumes it again.
        clearRoom()
        window.location.reload()
      }}
    >
      {armed ? 'Start over?' : 'New game'}
    </button>
  )
}

/**
 * The host: whichever device opened the room. It is the authoritative server
 * whether that's a laptop being used as a shared screen or one player's phone.
 *
 * On a big screen it shows the room-wide view — the gallery, the reveal, the
 * scoreboard. On a phone it hands the display over to that player's own game,
 * because there is no audience to show anything to.
 */
function HostScreens() {
  const { status, state, failure, room } = useHostRoom()
  const bigScreen = useBigScreen()
  // Default: play on this device when hosting from a phone, act as a shared
  // screen on a laptop or TV. Either can be overridden.
  const [playHere, setPlayHere] = useState<boolean | null>(null)
  const playing = playHere ?? !bigScreen

  // The host holds every connection, so its screen must not sleep mid-round.
  useWakeLock(status === 'ready')

  // The host re-renders the scenes phones submit, so it needs the same sprites.
  const piecesLoaded = usePiecesLoaded()

  // A room that is open and in trouble keeps its screen; see TroubleBanner.
  const screen = (): React.ReactNode => {
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

  if (status === 'claiming' || !state.roomCode || !room) {
    return (
      <div className="screen screen--center">
        <h1 className="brand">
          Art<em>Slicer</em>
        </h1>
        <p className="tagline">Opening a room…</p>
      </div>
    )
  }

  if (playing) {
    return (
      <HostAsPlayer
        room={room}
        roomCode={state.roomCode}
        inLobby={state.phase === 'lobby'}
        bigScreen={bigScreen}
        onStopPlaying={() => setPlayHere(false)}
      />
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
      return <Lobby state={state} onPlayHere={() => setPlayHere(true)} playing={false} />
  }
  }

  return (
    <>
      {status === 'ready' && failure && <TroubleBanner failure={failure} />}
      {screen()}
    </>
  )
}

/**
 * Trouble on a room that is already open.
 *
 * It rides over the game instead of replacing it. The transport is retrying
 * by the time this renders, and a broker that blinks would otherwise pull the
 * one screen the whole room is playing to out from under them mid-round.
 */
function TroubleBanner({ failure }: { failure: ConnectionFailure }) {
  return (
    <div className="hosttrouble" role="status">
      {describeFailure(failure)}
    </div>
  )
}

/**
 * The host device playing along. The local player connects through an
 * in-process loopback that runs the identical message path a remote phone
 * uses, so this is not a second implementation of anything.
 */
function HostAsPlayer({
  room,
  roomCode,
  inLobby,
  bigScreen,
  onStopPlaying,
}: {
  room: HostRoom
  roomCode: string
  inLobby: boolean
  bigScreen: boolean
  onStopPlaying(): void
}) {
  const [identity] = useState(() => loadIdentity())
  // Stable across renders, or the player would reconnect constantly.
  const connect = useCallback(
    (handlers: ClientHandlers) => room.attachLocalClient(handlers),
    [room],
  )

  return (
    <div className="hostplay">
      {/* This device is the only place the QR exists, so the lobby must show
          it even though this player is busy joining their own game. */}
      {inLobby && (
        <div className="hostplay__join">
          <JoinPanel roomCode={roomCode} compact />
        </div>
      )}
      {bigScreen && (
        <p className="hostplay__note">
          You’re hosting and playing on this device.{' '}
          <button type="button" className="linkbtn" onClick={onStopPlaying}>
            Use it as a shared screen instead
          </button>
        </p>
      )}
      <PlayerFlow connect={connect} identity={identity} roomCode={roomCode} />
    </div>
  )
}
