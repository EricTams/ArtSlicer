import { useEffect, useState } from 'react'

import { type HostRoom, createHostRoom } from '../game/hostRoom'
import type { ConnectionFailure } from '../net/transport'
import { type RoomState, createRoom } from '../shared/gameState'

export type HostStatus = 'claiming' | 'ready' | 'failed'

export interface HostRoomHandle {
  status: HostStatus
  state: RoomState
  failure: ConnectionFailure | null
  /**
   * Null until the room exists. The local player's UI is only mounted once it
   * is set, which also guarantees the room is there before that UI's effects
   * try to attach to it.
   */
  room: HostRoom | null
}

/**
 * Boots the authoritative room once and mirrors its state into React.
 * Deliberately not keyed to anything: a remount would claim a second room code
 * and orphan every phone already connected to the first.
 */
export function useHostRoom(): HostRoomHandle {
  const [state, setState] = useState<RoomState>(() => createRoom(''))
  const [status, setStatus] = useState<HostStatus>('claiming')
  const [failure, setFailure] = useState<ConnectionFailure | null>(null)
  const [room, setRoom] = useState<HostRoom | null>(null)

  useEffect(() => {
    const created = createHostRoom({
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
    setRoom(created)

    return () => {
      created.destroy()
      setRoom(null)
    }
  }, [])

  return { status, state, failure, room }
}
