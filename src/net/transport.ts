import type { ClientMessage, HostMessage } from '../shared/protocol'

/**
 * The seam between the game and WebRTC. Game code talks to these interfaces
 * only, so swapping PeerJS for a self-hosted broker (or Trystero) touches
 * nothing above this layer.
 *
 * `ConnId` is the transport's own handle for a connection — distinct from
 * PlayerId, which the game assigns only after a valid `hello` arrives.
 */
export type ConnId = string

export interface HostTransport {
  send(conn: ConnId, message: HostMessage): void
  broadcast(message: HostMessage): void
  disconnect(conn: ConnId): void
  destroy(): void
}

export interface ClientTransport {
  send(message: ClientMessage): void
  destroy(): void
}

/** Why a connection could not be established, in terms the UI can explain. */
export type ConnectionFailure =
  | { kind: 'room-not-found' }
  | { kind: 'network' }
  | { kind: 'ice-failed' }
  | { kind: 'unsupported' }
  | { kind: 'unknown'; detail: string }

export function describeFailure(failure: ConnectionFailure): string {
  switch (failure.kind) {
    case 'room-not-found':
      // Phrased as still-trying, because the client retries this case: the
      // host tab may simply not have finished claiming its code yet.
      return 'Looking for that room… check the code on the host screen.'
    case 'ice-failed':
      // The one failure mode this design genuinely cannot fix without a TURN
      // relay, so say the useful thing rather than "connection failed".
      return 'Could not reach the host. Make sure your phone is on the same Wi-Fi as the host screen.'
    case 'network':
      return 'Lost the connection. Retrying…'
    case 'unsupported':
      return 'This browser does not support the connection this game needs. Try Chrome or Safari.'
    case 'unknown':
      return `Something went wrong: ${failure.detail}`
  }
}
