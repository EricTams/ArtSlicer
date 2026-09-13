import { afterEach, describe, expect, it, vi } from 'vitest'

import { iceServers } from './peerOptions'

afterEach(() => {
  vi.unstubAllEnvs()
})

function withTurn(urls: string, username = 'user', credential = 'secret'): void {
  vi.stubEnv('VITE_TURN_URLS', urls)
  vi.stubEnv('VITE_TURN_USERNAME', username)
  vi.stubEnv('VITE_TURN_CREDENTIAL', credential)
}

describe('iceServers', () => {
  it('names STUN itself, since a config replaces the PeerJS defaults', () => {
    expect(iceServers()[0]?.urls).toEqual([
      'stun:stun.l.google.com:19302',
      'stun:stun.cloudflare.com:3478',
    ])
  })

  it('goes STUN-only when the deploy configured no relay', () => {
    vi.stubEnv('VITE_TURN_URLS', '')
    expect(iceServers()).toHaveLength(1)
  })

  it('adds the relay once the deploy supplies one', () => {
    withTurn('turn:relay.example:3478')
    expect(iceServers()[1]).toEqual({
      urls: ['turn:relay.example:3478'],
      username: 'user',
      credential: 'secret',
    })
  })

  it('carries every transport in the list, tls on 443 included', () => {
    withTurn('turn:relay.example:3478, turn:relay.example:3478?transport=tcp ,turns:relay.example:443')
    expect(iceServers()[1]?.urls).toEqual([
      'turn:relay.example:3478',
      'turn:relay.example:3478?transport=tcp',
      'turns:relay.example:443',
    ])
  })

  it('drops a credentialless relay rather than let RTCPeerConnection throw', () => {
    vi.stubEnv('VITE_TURN_URLS', 'turn:relay.example:3478')
    vi.stubEnv('VITE_TURN_USERNAME', '')
    vi.stubEnv('VITE_TURN_CREDENTIAL', '')
    expect(iceServers()).toHaveLength(1)
  })
})
