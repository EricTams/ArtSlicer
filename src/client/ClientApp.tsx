import { useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'

import { createPeerClient } from '../net/peerClient'
import type { ClientHandlers } from '../net/transport'
import { isValidRoomCode, normalizeRoomCode } from '../shared/roomCode'
import { PlayerFlow } from './PlayerFlow'
import { loadIdentity } from './identity'

/** Phone entry point, reached by scanning the host's QR code. */
export function ClientApp() {
  const { code } = useParams<{ code: string }>()
  const roomCode = code ? normalizeRoomCode(code) : ''

  // Loaded once: a remount must not mint a new identity, or the player loses
  // their seat on every reconnect.
  const identity = useMemo(() => loadIdentity(), [])

  // Stable, so the player UI does not tear down its connection on every render.
  const connect = useCallback(
    (handlers: ClientHandlers) => createPeerClient(roomCode, handlers),
    [roomCode],
  )

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

  return <PlayerFlow connect={connect} identity={identity} roomCode={roomCode} />
}
