import { useEffect, useState } from 'react'

import { createHostRoom } from '../game/hostRoom'
import type { ConnectionFailure } from '../net/transport'
import { type RoomState, createRoom } from '../shared/gameState'

export type HostStatus = 'claiming' | 'ready' | 'failed'

export interface HostRoom {
  status: HostStatus
  state: RoomState
  failure: ConnectionFailure | null
}

/**
 * Boots the authoritative room once and mirrors its state into React.
 * Deliberately not keyed to anything: a remount would claim a second room code
 * and orphan every phone already connected to the first.
 */
export function useHostRoom(): HostRoom {
  const [state, setState] = useState<RoomState>(() => createRoom(''))
  const [status, setStatus] = useState<HostStatus>('claiming')
  const [failure, setFailure] = useState<ConnectionFailure | null>(null)

  useEffect(() => {
    const room = createHostRoom({
      onStateChange: setState,
      onReady: () => {
        setStatus('ready')
        setFailure(null)
      },
      onFailure: (next) => {
        setFailure(next)
        setStatus('failed')
      },
    })
    return () => room.destroy()
  }, [])

  return { status, state, failure }
}
