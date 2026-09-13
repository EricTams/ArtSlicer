import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientHandlers } from '../net/transport'
import type { HostMessage } from '../shared/protocol'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { BUILD_SHA } from '../version'

/** Captures what the host hands the transport, so a phone can be faked. */
const peer = vi.hoisted(() => ({ handlers: null as any, sent: [] as unknown[] }))

vi.mock('../net/peerHost', () => ({
  createPeerHost: (handlers: unknown) => {
    peer.handlers = handlers
    queueMicrotask(() => peer.handlers.onReady('ACDF'))
    return {
      send: (_c: string, m: unknown) => peer.sent.push(m),
      broadcast: (m: unknown) => peer.sent.push(m),
      disconnect: () => {},
      destroy: () => {},
    }
  },
  watchIce: () => {},
}))

import { createHostRoom } from './hostRoom'

function installStorage() {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  })
}

/** A phone: says hello over the faked transport, then plays. */
function phone(conn: string, id: string, build = BUILD_SHA) {
  return {
    helloWithBuild: () =>
      peer.handlers.onMessage(conn, {
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        build,
        playerId: id,
        secret: `s-${id}`,
        name: id,
        avatarId: 'fox',
        clientTime: Date.now(),
      }),
    hello: () =>
      peer.handlers.onMessage(conn, {
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        build: BUILD_SHA,
        playerId: id,
        secret: `s-${id}`,
        name: id,
        avatarId: 'fox',
        clientTime: Date.now(),
      }),
    submit: () => peer.handlers.onMessage(conn, { t: 'submit', scene: { pieces: [] } }),
  }
}

let lastLocalTransport: { destroy(): void } | null = null

/** Tears down the host's loopback the way unmounting its player UI would. */
function hostTransportDestroy(): void {
  lastLocalTransport?.destroy()
}

/** The host playing on its own device, through the in-process loopback. */
function localPlayer(room: ReturnType<typeof createHostRoom>, id: string) {
  const seen: HostMessage[] = []
  const handlers: ClientHandlers = {
    onOpen: () => {},
    onMessage: (m) => seen.push(m),
    onReconnecting: () => {},
    onFailure: () => {},
  }
  const transport = room.attachLocalClient(handlers)
  lastLocalTransport = transport
  return {
    seen,
    hello: () =>
      transport.send({
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        build: BUILD_SHA,
        playerId: id,
        secret: `s-${id}`,
        name: id,
        avatarId: 'cat',
        clientTime: Date.now(),
      }),
    submit: () => transport.send({ t: 'submit', scene: { pieces: [] } }),
    start: () => transport.send({ t: 'start' }),
  }
}

beforeEach(() => {
  peer.handlers = null
  peer.sent = []
  installStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('host playing on its own device, with one phone', () => {
  it('does not end the build phase until the host has submitted too', async () => {
    const room = createHostRoom({
      onStateChange: () => {},
      onReady: () => {},
      onFailure: () => {},
    })
    await Promise.resolve()

    const host = localPlayer(room, 'host')
    const guest = phone('c1', 'guest')
    host.hello()
    guest.hello()
    expect(room.getState().players).toHaveLength(2)

    host.start()
    expect(room.getState().phase).toBe('building')

    // The phone finishes first. The host is still building.
    guest.submit()
    expect(room.getState().phase).toBe('building')

    host.submit()
    expect(room.getState().submissions).toHaveLength(2)
    expect(room.getState().phase).toBe('voting')

    room.destroy()
  })

  it('ends the round on one entry if the host player has dropped', () => {
    // The shape of the bug being chased: a host that is seated, then loses its
    // local client, stops counting as someone the round is waiting for. The
    // phone submitting is then "everyone", and one entry is too few to vote on.
    const room = createHostRoom({
      onStateChange: () => {},
      onReady: () => {},
      onFailure: () => {},
    })

    const host = localPlayer(room, 'host')
    const guest = phone('c1', 'guest')
    host.hello()
    guest.hello()
    host.start()
    expect(room.getState().phase).toBe('building')

    // Whatever unmounts the host's player UI tears down its loopback.
    room.attachLocalClient !== undefined
    hostTransportDestroy()

    guest.submit()

    const state = room.getState()
    expect(state.submissions).toHaveLength(1)
    expect(state.phase).toBe('roundResults')
    expect(state.players.every((player) => player.score === 0)).toBe(true)

    room.destroy()
  })

  it('keeps the seat when a replacement local client has already taken it', () => {
    // React tears an old effect down around setting the new one up. A stale
    // teardown must not disconnect the player now sitting in that seat.
    const room = createHostRoom({
      onStateChange: () => {},
      onReady: () => {},
      onFailure: () => {},
    })

    const host = localPlayer(room, 'host')
    const guest = phone('c1', 'guest')
    host.hello()
    guest.hello()
    host.start()

    const stale = lastLocalTransport!
    const replacement = localPlayer(room, 'host')
    replacement.hello()

    stale.destroy()

    expect(room.getState().players.find((p) => p.id === 'host')?.connected).toBe(true)

    guest.submit()
    expect(room.getState().phase).toBe('building')

    room.destroy()
  })
})

describe('a phone on the wrong build', () => {
  it('is turned away rather than seated', () => {
    const room = createHostRoom({
      onStateChange: () => {},
      onReady: () => {},
      onFailure: () => {},
    })

    phone('c1', 'stale', 'deadbee').helloWithBuild()

    expect(room.getState().players).toHaveLength(0)
    expect(peer.sent).toContainEqual(
      expect.objectContaining({ t: 'error', code: 'protocol-mismatch' }),
    )

    room.destroy()
  })

  it('is turned away even when its protocol number happens to match', () => {
    // The case the protocol number alone cannot catch: a cached bundle that
    // nobody thought to bump, behaving differently while claiming to agree.
    const room = createHostRoom({
      onStateChange: () => {},
      onReady: () => {},
      onFailure: () => {},
    })

    phone('c1', 'stale', `${BUILD_SHA}-old`).helloWithBuild()
    expect(room.getState().players).toHaveLength(0)

    room.destroy()
  })

  it('seats a phone on the matching build', () => {
    const room = createHostRoom({
      onStateChange: () => {},
      onReady: () => {},
      onFailure: () => {},
    })

    phone('c1', 'current').hello()
    expect(room.getState().players).toHaveLength(1)

    room.destroy()
  })
})
