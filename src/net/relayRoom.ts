import {
  CLOSE,
  type ClientToRelay,
  type HostToRelay,
  type RelayToClient,
  type RelayToHost,
  parseEnvelope,
} from './relayProtocol'

/**
 * The relay's routing, without the Worker around it.
 *
 * A Durable Object that hibernates keeps no memory between events — only the
 * sockets themselves and what is attached to each — so every function here is
 * handed the room's live sockets and works out what to do from them alone.
 * That is also what lets it be tested without a Workers runtime.
 */

/** Every socket has its own id, so a host can be told apart from its own replacement. */
export type Attachment =
  | { role: 'host'; id: string; key: string; since: number }
  | { role: 'client'; id: string; since: number }

export interface RoomSocket {
  readonly att: Attachment
  send(data: string): void
  close(code: number, reason: string): void
}

/** A party game, not a stadium. */
export const MAX_CLIENTS = 24

/** A drawing is a few hundred bytes; this is room for a very busy one. */
export const MAX_FRAME = 64 * 1024

export type Admission = { reject: { code: number; reason: string } } | { accept: Attachment }

/**
 * Admit a host. The key is what tells a host coming back from a suspend apart
 * from a stranger who rolled the same code: the same key takes the room over,
 * a different one is told the code is taken.
 */
export function admitHost(
  sockets: readonly RoomSocket[],
  id: string,
  key: string,
  now: number,
): Admission {
  if (!key) return { reject: { code: CLOSE.badRequest, reason: 'host key missing' } }

  const current = sockets.find((s) => s.att.role === 'host')
  if (current && current.att.role === 'host' && current.att.key !== key) {
    return { reject: { code: CLOSE.taken, reason: 'room code taken' } }
  }

  // The old socket is this same host, half-dead from a suspend. Every phone on
  // it was talking to a game that has since been torn down and rebuilt, so
  // they go too: each reconnects and says hello to the host that is here now.
  current?.close(CLOSE.replaced, 'host reconnected')
  closeClients(sockets, CLOSE.hostGone, 'host reconnected')

  return { accept: { role: 'host', id, key, since: now } }
}

/** Runs once the host's socket is registered, so `ready` reaches it. */
export function hostAdmitted(host: RoomSocket): void {
  sendTo(host, { t: 'ready' } satisfies RelayToHost)
}

export function admitClient(sockets: readonly RoomSocket[], id: string, now: number): Admission {
  const host = findHost(sockets)
  if (!host) return { reject: { code: CLOSE.noHost, reason: 'no host for this room' } }
  if (sockets.filter((s) => s.att.role === 'client').length >= MAX_CLIENTS) {
    return { reject: { code: CLOSE.full, reason: 'room full' } }
  }
  return { accept: { role: 'client', id, since: now } }
}

/** Runs once the phone's socket is registered: tell both ends it is open. */
export function clientAdmitted(sockets: readonly RoomSocket[], client: RoomSocket): void {
  if (client.att.role !== 'client') return
  sendTo(client, { t: 'ready', c: client.att.id } satisfies RelayToClient)
  const host = findHost(sockets)
  if (host) sendTo(host, { t: 'open', c: client.att.id } satisfies RelayToHost)
}

export function onMessage(sockets: readonly RoomSocket[], from: RoomSocket, raw: unknown): void {
  // Anything binary or oversized is not ours; dropping it beats relaying it.
  if (typeof raw !== 'string' || raw.length > MAX_FRAME) return
  const envelope = parseEnvelope(raw)
  if (!envelope) return

  if (from.att.role === 'client') {
    const message = envelope as Partial<ClientToRelay>
    if (message.t !== 'msg' || typeof message.d !== 'string') return
    const host = findHost(sockets)
    if (host) sendTo(host, { t: 'msg', c: from.att.id, d: message.d } satisfies RelayToHost)
    return
  }

  const message = envelope as Partial<HostToRelay> & { c?: unknown; d?: unknown }
  switch (message.t) {
    case 'send': {
      if (typeof message.c !== 'string' || typeof message.d !== 'string') return
      const client = findClient(sockets, message.c)
      if (client) sendTo(client, { t: 'msg', d: message.d } satisfies RelayToClient)
      return
    }
    case 'all': {
      if (typeof message.d !== 'string') return
      const frame = JSON.stringify({ t: 'msg', d: message.d } satisfies RelayToClient)
      for (const s of sockets) if (s.att.role === 'client') safeSend(s, frame)
      return
    }
    case 'kick': {
      if (typeof message.c !== 'string') return
      findClient(sockets, message.c)?.close(CLOSE.kicked, 'removed by host')
      return
    }
  }
}

/**
 * A socket has gone. `sockets` may or may not still include it — the runtime
 * does not promise either way — so it is excluded by its id.
 */
export function onClose(sockets: readonly RoomSocket[], gone: RoomSocket): void {
  const others = sockets.filter((s) => s.att.id !== gone.att.id)
  if (gone.att.role === 'host') {
    // A host replaced by its own reconnect has already been succeeded; the
    // phones belong to the new one now.
    if (findHost(others)) return
    closeClients(others, CLOSE.hostGone, 'host left')
    return
  }
  const host = findHost(others)
  if (host) sendTo(host, { t: 'close', c: gone.att.id } satisfies RelayToHost)
}

/**
 * Sockets that have stopped pinging. A phone that loses signal does not say
 * goodbye, and neither does a host whose tab was frozen; without this, the
 * room would keep talking to them indefinitely.
 */
export function silentSockets(
  sockets: readonly RoomSocket[],
  lastHeard: (s: RoomSocket) => number,
  now: number,
  timeout: number,
): RoomSocket[] {
  return sockets.filter((s) => now - Math.max(lastHeard(s), s.att.since) > timeout)
}

function findHost(sockets: readonly RoomSocket[]): RoomSocket | undefined {
  return sockets.find((s) => s.att.role === 'host')
}

function findClient(sockets: readonly RoomSocket[], id: string): RoomSocket | undefined {
  return sockets.find((s) => s.att.role === 'client' && s.att.id === id)
}

function closeClients(sockets: readonly RoomSocket[], code: number, reason: string): void {
  for (const s of sockets) if (s.att.role === 'client') s.close(code, reason)
}

function sendTo(socket: RoomSocket, message: RelayToHost | RelayToClient): void {
  safeSend(socket, JSON.stringify(message))
}

/** A socket mid-close throws on send; that is never worth losing the room over. */
function safeSend(socket: RoomSocket, frame: string): void {
  try {
    socket.send(frame)
  } catch {
    // Its close event will tidy up.
  }
}
