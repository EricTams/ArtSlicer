import { describe, expect, it } from 'vitest'

import { type ConnectionFailure, isRecoverable, toFailure } from './transport'

describe('toFailure', () => {
  it.each([
    ['peer-unavailable', 'room-not-found'],
    ['browser-incompatible', 'unsupported'],
    ['network', 'network'],
    ['server-error', 'network'],
    ['socket-error', 'network'],
    ['socket-closed', 'network'],
  ])('reads %s as %s', (type, kind) => {
    expect(toFailure({ type }).kind).toBe(kind)
  })

  it.each(['webrtc', 'disconnected'])('keeps %s retryable rather than unknown', (type) => {
    const failure = toFailure({ type })
    expect(failure.kind).toBe('network')
    expect(isRecoverable(failure)).toBe(true)
  })

  it.each(['invalid-id', 'invalid-key', 'ssl-unavailable'])('leaves %s terminal', (type) => {
    expect(isRecoverable(toFailure({ type }))).toBe(false)
  })

  it('carries a detail through so the player sees something specific', () => {
    expect(toFailure({ type: 'weird', message: 'the fridge unplugged' })).toEqual({
      kind: 'unknown',
      detail: 'the fridge unplugged',
    })
  })

  it('still names an error that arrived with no message', () => {
    expect(toFailure({ type: 'weird' })).toEqual({ kind: 'unknown', detail: 'weird' })
  })
})

describe('isRecoverable', () => {
  it('retries a failed ICE negotiation, which may take another path', () => {
    expect(isRecoverable({ kind: 'ice-failed' })).toBe(true)
  })

  it.each<ConnectionFailure>([{ kind: 'room-not-found' }, { kind: 'network' }])(
    'retries $kind',
    (failure) => {
      expect(isRecoverable(failure)).toBe(true)
    },
  )

  it('gives up on a browser that cannot do WebRTC at all', () => {
    expect(isRecoverable({ kind: 'unsupported' })).toBe(false)
  })
})
