import { createPeerClient } from './peerClient'
import { createPeerHost } from './peerHost'
import { createRelayClient } from './relayClient'
import { createRelayHost } from './relayHost'
import type { ClientHandlers, ClientTransport, HostHandlers, HostTransport } from './transport'

/**
 * Which road the game's messages take.
 *
 * The WebSocket relay when the build names one, because it works on every
 * network a phone can load the page from. Without one the build falls back to
 * WebRTC through the public PeerJS broker — fine on a shared Wi-Fi, and what
 * every build before the relay shipped.
 *
 * Host and phones must agree, and they do: both read the same build-time
 * setting, and a phone on a different build is turned away at `hello` anyway.
 */
export function relayUrl(): string | null {
  const raw = import.meta.env.VITE_RELAY_URL?.trim()
  return raw ? raw : null
}

export function createHostTransport(handlers: HostHandlers, preferredCode?: string): HostTransport {
  const relay = relayUrl()
  return relay
    ? createRelayHost(relay, handlers, preferredCode)
    : createPeerHost(handlers, preferredCode)
}

export function createClientTransport(roomCode: string, handlers: ClientHandlers): ClientTransport {
  const relay = relayUrl()
  return relay ? createRelayClient(relay, roomCode, handlers) : createPeerClient(roomCode, handlers)
}
