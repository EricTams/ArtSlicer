import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearDiagnostics,
  closePeer,
  getDiagnostics,
  logEvent,
  resetDiagnostics,
  setFacts,
  subscribeDiagnostics,
  upsertPeer,
} from './diagnostics'

beforeEach(() => resetDiagnostics())

describe('connection rows', () => {
  it('updates a connection in place rather than listing it twice', () => {
    upsertPeer('abc', { channel: 'connecting' })
    upsertPeer('abc', { channel: 'open', ice: 'connected' })

    expect(getDiagnostics().peers).toEqual([
      expect.objectContaining({ id: 'abc', channel: 'open', ice: 'connected' }),
    ])
  })

  it('keeps a dropped phone listed, because that is the one being debugged', () => {
    upsertPeer('abc', { label: 'Priya', channel: 'open' })
    closePeer('abc')

    expect(getDiagnostics().peers).toEqual([
      expect.objectContaining({ label: 'Priya', channel: 'closed' }),
    ])
  })

  it('ignores a close for a connection it never saw', () => {
    closePeer('never-seen')

    expect(getDiagnostics().peers).toEqual([])
  })

  it('forgets closed connections first when a retry loop makes too many', () => {
    // Every retry dials a new ID, so a long failure would grow without a cap.
    for (let i = 0; i < 12; i += 1) {
      upsertPeer(`dead-${i}`, { channel: 'open' })
      closePeer(`dead-${i}`)
    }
    upsertPeer('live', { channel: 'open' })

    const { peers } = getDiagnostics()
    expect(peers.length).toBeLessThanOrEqual(8)
    expect(peers.map((peer) => peer.id)).toContain('live')
    // What survives is the most recent history, not the oldest.
    expect(peers.map((peer) => peer.id)).toContain('dead-11')
    expect(peers.map((peer) => peer.id)).not.toContain('dead-0')
  })

  it('drops the oldest live connection only when nothing is closed', () => {
    for (let i = 0; i < 10; i += 1) upsertPeer(`live-${i}`, { channel: 'open' })

    const ids = getDiagnostics().peers.map((peer) => peer.id)
    expect(ids).toHaveLength(8)
    expect(ids).not.toContain('live-0')
    expect(ids).toContain('live-9')
  })
})

describe('the log', () => {
  it('caps itself so a phone left in a lobby cannot grow it forever', () => {
    for (let i = 0; i < 250; i += 1) logEvent(`event ${i}`)

    const { events } = getDiagnostics()
    expect(events).toHaveLength(200)
    // The cap drops the oldest: what just happened is what matters.
    expect(events[events.length - 1]!.text).toBe('event 249')
    expect(events[0]!.text).toBe('event 50')
  })

  it('clears the log without forgetting what the connection is', () => {
    setFacts({ roomCode: 'ACDF' })
    upsertPeer('abc', { channel: 'open' })
    logEvent('something')

    clearDiagnostics()

    const { facts, peers, events } = getDiagnostics()
    expect(events).toEqual([])
    expect(facts.roomCode).toBe('ACDF')
    expect(peers).toHaveLength(1)
  })
})

describe('subscribers', () => {
  it('is told about every kind of change, and stops when unsubscribed', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeDiagnostics(listener)

    setFacts({ roomCode: 'ACDF' })
    upsertPeer('abc', {})
    logEvent('hello')
    expect(listener).toHaveBeenCalledTimes(3)

    unsubscribe()
    logEvent('after')
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('publishes a new snapshot each time, so React sees the change', () => {
    const before = getDiagnostics()
    logEvent('hello')

    expect(getDiagnostics()).not.toBe(before)
  })
})
