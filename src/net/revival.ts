/**
 * What a suspended host has to put back together on its way to the foreground.
 *
 * Kept apart from the transport so it can be reasoned about — and tested —
 * without a broker, a peer, or a browser.
 */

/** What a host must do to be reachable again, given how its peer came back. */
export type Revival =
  /** Still registered and still connected: nothing to do. */
  | 'none'
  /** Registration intact, signalling socket dropped. The room code survives. */
  | 'reconnect'
  /** The peer is gone, and every channel it carried went with it. */
  | 'reclaim'

export function revivalFor(peer: { destroyed: boolean; disconnected: boolean } | null): Revival {
  if (!peer || peer.destroyed) return 'reclaim'
  if (peer.disconnected) return 'reconnect'
  return 'none'
}

/**
 * Whether a connection came through the suspend alive.
 *
 * PeerJS's `open` flag is the thing that goes stale here — a channel dies and
 * it keeps saying yes — so ICE gets the say instead, and only for the two
 * states it never comes back from. `disconnected` recovers often enough that
 * reaping on it would drop players who were about to return, and a connection
 * that degrades past it trips the ICE listener on its own.
 *
 * An undefined state means ICE has not started: a phone still dialling, which
 * is not ours to give up on.
 */
export function survivedSuspend(ice: RTCIceConnectionState | undefined): boolean {
  return ice !== 'failed' && ice !== 'closed'
}
