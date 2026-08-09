import { useCallback, useState } from 'react'

import { PlayerFlow } from '../client/PlayerFlow'
import { loadIdentity } from '../client/identity'
import { usePiecesLoaded } from '../editor/usePiecesLoaded'
import type { ClientHandlers } from '../net/transport'
import { describeFailure } from '../net/transport'
import type { HostRoom } from '../game/hostRoom'
import { JoinPanel, Lobby } from './Lobby'
import { BuildingScreen, FinalScreen, ResultsScreen, VotingScreen } from './RoundScreens'
import { useBigScreen } from './useBigScreen'
import { useHostRoom } from './useHostRoom'
import { useWakeLock } from './useWakeLock'

/**
 * The host: whichever device opened the room. It is the authoritative server
 * whether that's a laptop being used as a shared screen or one player's phone.
 *
 * On a big screen it shows the room-wide view — the gallery, the reveal, the
 * scoreboard. On a phone it hands the display over to that player's own game,
 * because there is no audience to show anything to.
 */
export function HostApp() {
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
