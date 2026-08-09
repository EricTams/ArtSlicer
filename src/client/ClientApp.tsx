import { useParams } from 'react-router-dom'

import { isValidRoomCode, normalizeRoomCode } from '../shared/roomCode'

/**
 * Phone entry point. Reached by scanning the host's QR code, which encodes
 * #/join/<code>. M1 scaffold: validates the code from the URL and reports it.
 * Name/avatar entry and the peer connection arrive in M2.
 */
export function ClientApp() {
  const { code } = useParams<{ code: string }>()
  const roomCode = code ? normalizeRoomCode(code) : ''
  const valid = isValidRoomCode(roomCode)

  return (
    <div className="screen screen--center">
      <div className="stack" style={{ alignItems: 'center', maxWidth: 420, width: '100%' }}>
        <h1 className="brand">
          Art<em>Slicer</em>
        </h1>
        {valid ? (
          <>
            <p className="tagline">Joining room</p>
            <p className="brand" style={{ fontSize: '3rem', letterSpacing: '0.15em' }}>
              {roomCode}
            </p>
          </>
        ) : (
          <p className="error">
            {roomCode ? `"${roomCode}" is not a valid room code.` : 'No room code in the link.'}
          </p>
        )}
        <p className="muted">Client screen — join flow lands in M2.</p>
      </div>
    </div>
  )
}
