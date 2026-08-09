import { useCallback, useEffect, useRef, useState } from 'react'

import { createPeerClient } from '../net/peerClient'
import { type ClientTransport, describeFailure } from '../net/transport'
import { PROTOCOL_VERSION } from '../shared/protocol'
import type { Phase, PlayerId, PublicPlayer } from '../shared/gameState'
import { type Identity, saveIdentity } from './identity'

/**
 * Two independent things are in flight here, and collapsing them into one
 * value deadlocks the join button: the transport can be open long before the
 * player has picked a name. `ready` means "connected, waiting on the player".
 */
export type ClientStatus = 'connecting' | 'ready' | 'reconnecting' | 'joined' | 'error'

export interface ClientRoom {
  status: ClientStatus
  phase: Phase
  roundIndex: number
  players: PublicPlayer[]
  you: PlayerId | null
  canStart: boolean
  /** A human-readable problem, whether from the transport or the host. */
  problem: string | null
  /** Host clock minus local clock, so countdowns agree across devices. */
  clockOffset: number
  join(name: string, avatarId: string): void
  start(): void
}

const PING_INTERVAL_MS = 3000

export function useClientRoom(roomCode: string, identity: Identity): ClientRoom {
  const [status, setStatus] = useState<ClientStatus>('connecting')
  const [phase, setPhase] = useState<Phase>('lobby')
  const [roundIndex, setRoundIndex] = useState(0)
  const [players, setPlayers] = useState<PublicPlayer[]>([])
  const [you, setYou] = useState<PlayerId | null>(null)
  const [canStart, setCanStart] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [clockOffset, setClockOffset] = useState(0)

  const transportRef = useRef<ClientTransport | null>(null)
  /**
   * Held in a ref so a reconnect can re-send `hello` without user action.
   * Seeded from storage so a player whose phone locked (or who refreshed)
   * slides straight back into their seat instead of re-typing their name.
   */
  const credentialsRef = useRef<{ name: string; avatarId: string } | null>(
    identity.name ? { name: identity.name, avatarId: identity.avatarId } : null,
  )

  const sendHello = useCallback(() => {
    const creds = credentialsRef.current
    if (!creds) return
    transportRef.current?.send({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      playerId: identity.playerId,
      secret: identity.secret,
      name: creds.name,
      avatarId: creds.avatarId,
      clientTime: Date.now(),
    })
  }, [identity.playerId, identity.secret])

  useEffect(() => {
    if (!roomCode) return

    const transport = createPeerClient(roomCode, {
      onOpen() {
        setProblem(null)
        // If the player already chose a name, rejoin silently; otherwise sit
        // in `ready` so the join form becomes usable.
        if (credentialsRef.current) {
          sendHello()
        } else {
          setStatus('ready')
        }
      },
      onMessage(message) {
        switch (message.t) {
          case 'welcome':
            setYou(message.you)
            setStatus('joined')
            setProblem(null)
            break
          case 'state':
            setPhase(message.phase)
            setRoundIndex(message.roundIndex)
            setPlayers(message.players)
            setYou(message.you)
            setCanStart(message.canStart)
            break
          case 'pong': {
            const now = Date.now()
            const roundTrip = now - message.clientTime
            // Assume a symmetric path: the host's clock at "now" is its
            // timestamp plus half the round trip.
            setClockOffset(message.hostTime + roundTrip / 2 - now)
            break
          }
          case 'error':
            setProblem(message.message)
            if (message.code !== 'invalid') setStatus('error')
            break
        }
      },
      onReconnecting() {
        setStatus((prev) => (prev === 'error' ? prev : 'reconnecting'))
      },
      onFailure(failure) {
        // Reported for visibility, but the transport keeps retrying for the
        // recoverable kinds, so don't tear the UI down here.
        setProblem(describeFailure(failure))
      },
    })

    transportRef.current = transport

    const pingTimer = setInterval(() => {
      transport.send({ t: 'ping', clientTime: Date.now() })
    }, PING_INTERVAL_MS)

    return () => {
      clearInterval(pingTimer)
      transport.destroy()
      transportRef.current = null
    }
  }, [roomCode, sendHello])

  const join = useCallback(
    (name: string, avatarId: string) => {
      credentialsRef.current = { name, avatarId }
      saveIdentity({ ...identity, name, avatarId })
      sendHello()
    },
    [identity, sendHello],
  )

  const start = useCallback(() => {
    transportRef.current?.send({ t: 'start' })
  }, [])

  return { status, phase, roundIndex, players, you, canStart, problem, clockOffset, join, start }
}
