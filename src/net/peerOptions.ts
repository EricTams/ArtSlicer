import type { PeerOptions } from 'peerjs'

/**
 * P2P failures are hard to diagnose after the fact — they happen on someone
 * else's phone, on someone else's network. `?debug=1` (up to 3) turns on
 * PeerJS's own logging so a problem can be reproduced in the field.
 */
export function peerOptions(): PeerOptions {
  const raw = new URLSearchParams(window.location.search).get('debug')
  const level = raw ? Math.min(3, Math.max(0, Number(raw) || 0)) : 0
  return { debug: level, config: { iceServers: iceServers() } }
}

/**
 * Two of them, from separate operators. A STUN lookup is one UDP round trip
 * with no fallback of its own, so a single unreachable host costs every player
 * the reflexive candidate that gets them out through a NAT.
 */
const STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']

/**
 * The ICE list the peer connection is built with.
 *
 * Handing PeerJS a `config` replaces its built-in list outright rather than
 * adding to it, so the STUN servers it would have supplied are named here too.
 *
 * TURN is left to build-time configuration because a relay cannot be free and
 * anonymous at once: every provider wants credentials, and credentials in a
 * static bundle served from Pages are readable by anyone who views source.
 * Rather than commit someone's relay quota to the repo, the deploy injects it
 * and an unconfigured build simply goes without — which is what every build
 * before this one did.
 */
export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: STUN_URLS }]

  const urls = splitUrls(import.meta.env.VITE_TURN_URLS)
  const username = import.meta.env.VITE_TURN_USERNAME
  const credential = import.meta.env.VITE_TURN_CREDENTIAL

  // All three or nothing. A turn: URL with no credentials is not merely
  // useless — RTCPeerConnection throws on it, which would cost us every
  // connection including the direct ones that never needed a relay.
  if (urls.length > 0 && username && credential) {
    servers.push({ urls, username, credential })
  }

  return servers
}

/** One env var holds the whole relay list: udp, tcp, and tls on 443. */
function splitUrls(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
}
