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

export interface ClientHandlers {
  onOpen(): void
  onMessage(message: HostMessage): void
  /** Connection dropped but a retry is scheduled; the UI should say "reconnecting". */
  onReconnecting(attempt: number): void
  /** Terminal for this attempt — the UI should explain and offer a retry. */
  onFailure(failure: ConnectionFailure): void
}

/**
 * How a player's UI obtains a connection. Remote players get a WebRTC
 * transport; the player hosting on their own device gets an in-process
 * loopback. Both satisfy this signature, so the player UI is identical either
 * way and there is no second code path to keep in sync.
 */
export type ConnectFn = (handlers: ClientHandlers) => ClientTransport

/** Why a connection could not be established, in terms the UI can explain. */
export type ConnectionFailure =
  | { kind: 'room-not-found' }
  | { kind: 'network' }
  | { kind: 'ice-failed' }
  | { kind: 'unsupported' }
  | { kind: 'unknown'; detail: string }

/**
 * PeerJS's error types, in terms the UI can explain.
 *
 * `webrtc` and `disconnected` are mapped deliberately rather than left to fall
 * through: both are the connection breaking rather than anything the player
 * chose, and both come back on a retry. As `unknown` they were terminal.
 */
export function toFailure(err: { type?: string; message?: string }): ConnectionFailure {
  switch (err.type) {
    case 'peer-unavailable':
      return { kind: 'room-not-found' }
    case 'browser-incompatible':
      return { kind: 'unsupported' }
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'webrtc':
    case 'disconnected':
      return { kind: 'network' }
    default:
      return { kind: 'unknown', detail: err.message ?? err.type ?? 'unknown error' }
  }
}

/**
 * Whether the transport should keep trying on its own.
 *
 * The question is only whether anything could change without the player doing
 * something about it. A room that is missing may still be claiming its code, a
 * network drops and comes back, and ICE can fail over one path and succeed
 * over the next. A browser without WebRTC will not grow it on the second ask.
 */
export function isRecoverable(failure: ConnectionFailure): boolean {
  switch (failure.kind) {
    case 'room-not-found':
    case 'network':
    case 'ice-failed':
      return true
    case 'unsupported':
    case 'unknown':
      return false
  }
}

export function describeFailure(failure: ConnectionFailure): string {
  switch (failure.kind) {
    case 'room-not-found':
      // Phrased as still-trying, because the client retries this case: the
      // host tab may simply not have finished claiming its code yet.
      return 'Looking for that room… check the code on the host screen.'
    case 'ice-failed':
      // Retried now rather than left sitting, so the copy says so. The Wi-Fi
      // hint stays: with no relay configured it is still the thing that works.
      return 'Could not reach the host — trying again. If this keeps up, check you are both on the same Wi-Fi.'
    case 'network':
      return 'Lost the connection. Retrying…'
    case 'unsupported':
      return 'This browser does not support the connection this game needs. Try Chrome or Safari.'
    case 'unknown':
      return `Something went wrong: ${failure.detail}`
  }
}
