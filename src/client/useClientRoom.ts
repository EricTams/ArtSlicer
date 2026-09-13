import { useCallback, useEffect, useRef, useState } from 'react'

import { logEvent, setFacts } from '../net/diagnostics'
import { type ClientTransport, type ConnectFn, describeFailure } from '../net/transport'
import {
  type BallotEntry,
  PROTOCOL_VERSION,
  type RevealedEntry,
  refusalKind,
} from '../shared/protocol'
import type { Phase, PlayerId, PublicPlayer } from '../shared/gameState'
import type { Scene } from '../shared/scene'
import { BUILD_SHA } from '../version'
import { type Identity, saveIdentity, shouldRejoinSilently } from './identity'

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
  totalRounds: number
  prompt: string
  players: PublicPlayer[]
  you: PlayerId | null
  canStart: boolean
  /** Host clock time at which the current phase ends, or null when untimed. */
  deadline: number | null
  ballot: BallotEntry[]
  yourVote: string | null
  youSubmitted: boolean
  canRestart: boolean
  reveal: RevealedEntry[]
  winners: PlayerId[]
  /** A human-readable problem, whether from the transport or the host. */
  problem: string | null
  /** Host clock minus local clock, so countdowns agree across devices. */
  clockOffset: number
  join(name: string, avatarId: string): void
  start(): void
  restart(): void
  submit(scene: Scene): void
  vote(entryId: string): void
}

const PING_INTERVAL_MS = 3000

/**
 * How often to ask again after the host turned us away for a reason that will
 * not last. Slow enough to be free, fast enough that a seat freeing up or a
 * round ending lets the player in while they are still looking at the screen.
 */
const REJOIN_INTERVAL_MS = 5000

/**
 * Drives one player's view of the room. Takes a `connect` function rather than
 * a room code so the same hook serves both a remote phone (WebRTC) and the
 * player hosting on this device (in-process loopback). `connect` must be
 * stable — a new identity would tear down and rebuild the connection.
 */
export function useClientRoom(
  connect: ConnectFn,
  identity: Identity,
  /** Which room this is, to tell coming back from starting again. */
  roomCode: string,
): ClientRoom {
  const [status, setStatus] = useState<ClientStatus>('connecting')
  const [phase, setPhase] = useState<Phase>('lobby')
  const [roundIndex, setRoundIndex] = useState(0)
  const [totalRounds, setTotalRounds] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [players, setPlayers] = useState<PublicPlayer[]>([])
  const [you, setYou] = useState<PlayerId | null>(null)
  const [canStart, setCanStart] = useState(false)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [ballot, setBallot] = useState<BallotEntry[]>([])
  const [yourVote, setYourVote] = useState<string | null>(null)
  const [youSubmitted, setYouSubmitted] = useState(false)
  const [canRestart, setCanRestart] = useState(false)
  const [reveal, setReveal] = useState<RevealedEntry[]>([])
  const [winners, setWinners] = useState<PlayerId[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [clockOffset, setClockOffset] = useState(0)

  const transportRef = useRef<ClientTransport | null>(null)
  /** Refused for a reason that may pass, so keep asking for a seat. */
  const waitingForSeatRef = useRef(false)
  /** Whether the host has actually seated us, which changes what a refusal means. */
  const seatedRef = useRef(false)
  /**
   * Held in a ref so a reconnect can re-send `hello` without user action.
   *
   * Seeded from storage only for the room the stored name was last used in: a
   * phone that locked mid-game slides straight back into its seat, while
   * arriving at a different room leaves this empty so the player is asked
   * first. Whoever is holding the phone at a new party may not be who held it
   * at the last one.
   */
  const credentialsRef = useRef<{ name: string; avatarId: string } | null>(
    shouldRejoinSilently(identity, roomCode)
      ? { name: identity.name, avatarId: identity.avatarId }
      : null,
  )

  const sendHello = useCallback(() => {
    const creds = credentialsRef.current
    if (!creds) return
    transportRef.current?.send({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      build: BUILD_SHA,
      playerId: identity.playerId,
      secret: identity.secret,
      name: creds.name,
      avatarId: creds.avatarId,
      clientTime: Date.now(),
    })
  }, [identity.playerId, identity.secret])

  useEffect(() => {
    const transport = connect({
      onOpen() {
        setProblem(null)
        // A new channel holds no seat until the host says otherwise.
        seatedRef.current = false
        if (credentialsRef.current) {
          sendHello()
        } else {
          setStatus('ready')
        }
      },
      onMessage(message) {
        switch (message.t) {
          case 'welcome':
            logEvent(`Seated as ${message.you}`, 'good')
            seatedRef.current = true
            waitingForSeatRef.current = false
            setYou(message.you)
            setStatus('joined')
            setProblem(null)
            break
          case 'state':
            setPhase(message.phase)
            setRoundIndex(message.roundIndex)
            setTotalRounds(message.totalRounds)
            setPrompt(message.prompt)
            setPlayers(message.players)
            setYou(message.you)
            setCanStart(message.canStart)
            setDeadline(message.deadline)
            setBallot(message.ballot ?? [])
            setYourVote(message.yourVote ?? null)
            setYouSubmitted(message.youSubmitted)
            setCanRestart(message.canRestart)
            setReveal(message.reveal ?? [])
            setWinners(message.winners ?? [])
            break
          case 'pong': {
            const now = Date.now()
            const roundTrip = now - message.clientTime
            // Assume a symmetric path: the host's clock at "now" is its
            // timestamp plus half the round trip.
            const offset = message.hostTime + roundTrip / 2 - now
            setClockOffset(offset)
            // The ping is the one continuous proof the link still carries
            // traffic, so the panel shows it rather than the log.
            setFacts({ rttMs: Math.round(roundTrip), clockOffsetMs: Math.round(offset) })
            break
          }
          case 'error': {
            logEvent(`Host refused: ${message.code} — ${message.message}`, 'bad')
            setProblem(message.message)
            const kind = refusalKind(message.code)
            // The one refusal that overrules what we think: the host is saying
            // this connection holds no seat, so whatever we believed about
            // being seated is out of date and asking again is the way back.
            if (message.code === 'not-seated') seatedRef.current = false
            // Holding a seat means this answered the action we just took, not
            // our right to be here — `game-in-progress` replies both to a late
            // join and to a seated player pressing Start too late.
            if (seatedRef.current || kind === 'action') break
            if (kind === 'terminal') {
              setStatus('error')
              break
            }
            // The room is full or already playing: both pass. Hold the
            // connection, say why, and let the timer below keep asking.
            waitingForSeatRef.current = true
            setStatus('ready')
            // The timer will keep asking, but a round is on a clock and the
            // first ask should not wait five seconds for it.
            if (message.code === 'not-seated') sendHello()
            break
          }
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

    const rejoinTimer = setInterval(() => {
      if (!waitingForSeatRef.current) return
      logEvent('Asking for a seat again')
      sendHello()
    }, REJOIN_INTERVAL_MS)

    return () => {
      clearInterval(pingTimer)
      clearInterval(rejoinTimer)
      transport.destroy()
      transportRef.current = null
    }
  }, [connect, sendHello])

  const join = useCallback(
    (name: string, avatarId: string) => {
      credentialsRef.current = { name, avatarId }
      // Storing the room alongside the name is what lets the next connection
      // tell a reconnect from a fresh game.
      saveIdentity({ ...identity, name, avatarId, lastRoom: roomCode })
      sendHello()
    },
    [identity, roomCode, sendHello],
  )

  const start = useCallback(() => transportRef.current?.send({ t: 'start' }), [])
  const restart = useCallback(() => transportRef.current?.send({ t: 'restart' }), [])
  const submit = useCallback(
    (scene: Scene) => transportRef.current?.send({ t: 'submit', scene }),
    [],
  )
  const vote = useCallback(
    (entryId: string) => transportRef.current?.send({ t: 'vote', entryId }),
    [],
  )

  return {
    status,
    phase,
    roundIndex,
    totalRounds,
    prompt,
    players,
    you,
    canStart,
    deadline,
    ballot,
    yourVote,
    youSubmitted,
    canRestart,
    reveal,
    winners,
    problem,
    clockOffset,
    join,
    start,
    restart,
    submit,
    vote,
  }
}
