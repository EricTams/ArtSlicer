/**
 * A black box for the connection.
 *
 * P2P joins fail on someone else's phone, on someone else's network, and by
 * the time the player hands the phone over the interesting moment has already
 * scrolled past. Every transport writes what it saw in here, so the debug
 * panel can report a failure after the fact instead of asking a guest to
 * reproduce it while everyone waits.
 *
 * A module singleton rather than a context: the transports are plain functions
 * living well below any provider, and threading a logger through each of them
 * would put debug plumbing in signatures the game otherwise keeps clean.
 */

export type EventTone = 'info' | 'good' | 'warn' | 'bad'

export interface DiagEvent {
  /** Wall clock, so a phone's log can be lined up against the host's. */
  at: number
  tone: EventTone
  text: string
}

/** What is true of this device. Every field is null until something knows. */
export interface DiagFacts {
  role: 'host' | 'client' | null
  roomCode: string | null
  /** The peer ID the room lives at: claimed by the host, dialled by the phone. */
  hostId: string | null
  /** This device's own ID, once the broker has handed one out. */
  myId: string | null
  /** The signalling socket to the PeerJS broker. */
  broker: 'connecting' | 'open' | 'disconnected' | 'closed' | null
  /** Which connection attempt we are on; >0 means we have already dropped once. */
  attempt: number
  lastError: string | null
  /** Round trip of the game's own ping, which only a client measures. */
  rttMs: number | null
  clockOffsetMs: number | null
  sent: number
  received: number
}

/**
 * One live connection, from this device's point of view.
 *
 * Both ends keep rows so a session can be debugged from either seat: a phone
 * has exactly one (the host it dialled), while a laptop hosting the room has
 * one per phone. Merging them into a single status was tempting and wrong —
 * "ICE failed" is useless to a host that cannot see which phone failed.
 */
export interface PeerRow {
  id: string
  /** The player's name, once the game has seated them behind this connection. */
  label: string | null
  channel: 'connecting' | 'open' | 'closed'
  ice: string | null
  /**
   * How the traffic actually flows: direct, out through a NAT, or via a relay.
   * The single most telling line when a phone cannot reach a host.
   */
  route: string | null
  /** When this connection first appeared, so a flapping phone is visible. */
  since: number
}

export interface DiagSnapshot {
  facts: DiagFacts
  peers: readonly PeerRow[]
  events: readonly DiagEvent[]
}

/**
 * Enough history to cover a join, a few retries and a drop, but bounded — a
 * phone left in a lobby for an hour must not grow a log it cannot render.
 */
const MAX_EVENTS = 200

/**
 * Every retry dials a fresh connection with a fresh ID, so a phone that has
 * been failing for ten minutes would otherwise leave a row per attempt. Keep
 * the recent ones — enough to see a phone flapping — and evict closed rows
 * first, because a live connection is never the one to forget.
 */
const MAX_PEERS = 8

function emptyFacts(): DiagFacts {
  return {
    role: null,
    roomCode: null,
    hostId: null,
    myId: null,
    broker: null,
    attempt: 0,
    lastError: null,
    rttMs: null,
    clockOffsetMs: null,
    sent: 0,
    received: 0,
  }
}

let snapshot: DiagSnapshot = { facts: emptyFacts(), peers: [], events: [] }
const listeners = new Set<() => void>()

function publish(next: DiagSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

export function subscribeDiagnostics(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getDiagnostics(): DiagSnapshot {
  return snapshot
}

export function setFacts(partial: Partial<DiagFacts>): void {
  publish({ ...snapshot, facts: { ...snapshot.facts, ...partial } })
}

/** Creates the row on first sight, so callers never have to open one first. */
export function upsertPeer(id: string, partial: Partial<Omit<PeerRow, 'id'>>): void {
  const existing = snapshot.peers.find((peer) => peer.id === id)
  if (existing) {
    publish({
      ...snapshot,
      peers: snapshot.peers.map((peer) => (peer.id === id ? { ...peer, ...partial } : peer)),
    })
    return
  }

  const row: PeerRow = {
    id,
    label: null,
    channel: 'connecting',
    ice: null,
    route: null,
    since: Date.now(),
    ...partial,
  }
  publish({ ...snapshot, peers: evict([...snapshot.peers, row]) })
}

function evict(peers: PeerRow[]): PeerRow[] {
  let excess = peers.length - MAX_PEERS
  if (excess <= 0) return peers

  const kept = peers.filter((peer) => {
    if (excess > 0 && peer.channel === 'closed') {
      excess -= 1
      return false
    }
    return true
  })
  // Still over only if every row is live, and then the oldest has to go.
  return kept.length > MAX_PEERS ? kept.slice(kept.length - MAX_PEERS) : kept
}

/**
 * Marks a row closed rather than removing it: a phone that connected and
 * dropped is the most interesting row on the panel, and deleting it would
 * erase the very thing being debugged. Rows go when the room does.
 */
export function closePeer(id: string): void {
  if (snapshot.peers.some((peer) => peer.id === id)) upsertPeer(id, { channel: 'closed' })
}

export function logEvent(text: string, tone: EventTone = 'info'): void {
  const events = [...snapshot.events, { at: Date.now(), tone, text }]
  publish({
    ...snapshot,
    events: events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events,
  })
}

/** Counts every frame rather than logging them: traffic would drown the log. */
export function countSent(): void {
  setFacts({ sent: snapshot.facts.sent + 1 })
}

export function countReceived(): void {
  setFacts({ received: snapshot.facts.received + 1 })
}

export function clearDiagnostics(): void {
  publish({ ...snapshot, events: [] })
}

/**
 * Wipes the board for a new session. Called when a transport is created, so
 * that joining a second room does not present the first room's failures as if
 * they were this one's.
 */
export function resetDiagnostics(): void {
  publish({ facts: emptyFacts(), peers: [], events: [] })
}

/**
 * Live samplers the panel can pull on when it opens.
 *
 * ICE state is pushed as it changes, but the chosen candidate pair is only
 * available by asking, and asking costs a round of `getStats`. Rather than
 * poll forever, connections register here and the panel samples on demand —
 * so the route shown is the route at the moment somebody looked.
 */
const samplers = new Set<() => void>()

export function registerSampler(sample: () => void): () => void {
  samplers.add(sample)
  return () => samplers.delete(sample)
}

export function refreshDiagnostics(): void {
  for (const sample of samplers) sample()
}

/**
 * Reads back which candidate pair won, in the terms that explain a failure:
 * `host` is the same network, `srflx`/`prflx` is out through a NAT, `relay`
 * is a TURN server. A phone on cellular and a host on Wi-Fi need a relay, and
 * the public broker offers none — which is exactly what this line reveals.
 */
export async function sampleRoute(pc: RTCPeerConnection, peerId: string): Promise<void> {
  try {
    const stats = await pc.getStats()
    const candidates = new Map<string, string>()
    const succeeded: RTCIceCandidatePairStats[] = []

    stats.forEach((report) => {
      if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
        candidates.set(report.id, (report as { candidateType?: string }).candidateType ?? '?')
      }
      if (report.type === 'candidate-pair') {
        const pair = report as RTCIceCandidatePairStats
        if (pair.state === 'succeeded') succeeded.push(pair)
      }
    })

    // Several pairs can succeed; traffic uses the nominated one.
    const chosen = succeeded.find((pair) => pair.nominated) ?? succeeded[0]
    if (!chosen) {
      upsertPeer(peerId, { route: 'no candidate pair yet' })
      return
    }

    const local = candidates.get(chosen.localCandidateId ?? '') ?? '?'
    const remote = candidates.get(chosen.remoteCandidateId ?? '') ?? '?'
    const trip = chosen.currentRoundTripTime
    const latency = typeof trip === 'number' ? ` · ${Math.round(trip * 1000)}ms` : ''
    upsertPeer(peerId, { route: `${local} → ${remote}${latency}` })
  } catch {
    // Diagnostics must never be the thing that breaks a game.
    upsertPeer(peerId, { route: 'unavailable' })
  }
}

/** What the panel copies to the clipboard, so a tester can paste it to you. */
export function formatReport(): string {
  const { facts, peers, events } = snapshot
  const lines = [
    `ArtSlicer connection report · ${new Date().toISOString()}`,
    '',
    ...describeFacts(facts).map(([label, value]) => `${label}: ${value}`),
    '',
    `Connections (${peers.length}):`,
    ...(peers.length === 0
      ? ['  none']
      : peers.map(
          (peer) =>
            `  ${describePeer(peer)} · ${peer.channel} · ICE ${peer.ice ?? '—'} · ${peer.route ?? 'route —'}`,
        )),
    '',
    ...describeDevice().map(([label, value]) => `${label}: ${value}`),
    '',
    'Log:',
    ...events.map((event) => `  ${clockOf(event.at)}  ${event.text}`),
  ]
  return lines.join('\n')
}

/** A row reads as a person where the game knows one, and as an ID otherwise. */
export function describePeer(peer: PeerRow): string {
  return peer.label ?? peer.id.slice(-6)
}

/** The facts in reading order: the panel and the report show the same list. */
export function describeFacts(facts: DiagFacts): Array<[string, string]> {
  return [
    ['Role', facts.role ?? '—'],
    ['Room', facts.roomCode ?? '—'],
    ['Host peer', facts.hostId ?? '—'],
    ['My peer', facts.myId ?? '—'],
    ['Broker', facts.broker ?? '—'],
    ['Attempt', String(facts.attempt)],
    ['Ping', facts.rttMs === null ? '—' : `${facts.rttMs}ms`],
    ['Clock offset', facts.clockOffsetMs === null ? '—' : `${facts.clockOffsetMs}ms`],
    ['Frames', `${facts.sent} sent · ${facts.received} received`],
    ['Last error', facts.lastError ?? 'none'],
  ]
}

/**
 * The device half of the picture. Read fresh each time rather than stored: a
 * phone can go offline or change network between opening the panel twice.
 */
export function describeDevice(): Array<[string, string]> {
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; type?: string }
  }
  const link = nav.connection
  return [
    ['URL', window.location.href],
    ['Online', navigator.onLine ? 'yes' : 'no'],
    ['Network', link?.type ?? link?.effectiveType ?? 'unknown'],
    ['WebRTC', typeof RTCPeerConnection === 'function' ? 'yes' : 'no'],
    ['Secure context', window.isSecureContext ? 'yes' : 'no'],
    ['Screen', `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`],
    ['Browser', navigator.userAgent],
  ]
}

export function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false })
}
