import type { PeerOptions } from 'peerjs'

/**
 * P2P failures are hard to diagnose after the fact — they happen on someone
 * else's phone, on someone else's network. `?debug=1` (up to 3) turns on
 * PeerJS's own logging so a problem can be reproduced in the field.
 */
export function peerOptions(): PeerOptions {
  const raw = new URLSearchParams(window.location.search).get('debug')
  const level = raw ? Math.min(3, Math.max(0, Number(raw) || 0)) : 0
  return { debug: level }
}
