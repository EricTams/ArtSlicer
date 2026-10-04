import { HEARTBEAT_MS, HEARTBEAT_TIMEOUT_MS, PING, PONG, parseEnvelope } from './relayProtocol'

/**
 * One WebSocket to the relay, with the heartbeat both ends need.
 *
 * A socket on a phone dies quietly: lose signal, or have the tab frozen in the
 * background, and nothing fires until TCP gives up minutes later. So each end
 * pings, the relay answers without waking, and a socket that hears nothing for
 * a whole timeout is treated as gone and reported exactly once.
 */
export interface RelaySocket {
  send(frame: object): boolean
  readonly open: boolean
  /**
   * Asks the relay whether this socket still works, dropping it if no answer
   * comes. For coming back from the background, when the socket may have died
   * while nothing was running to notice.
   */
  probe(): void
  close(): void
}

export interface RelaySocketHandlers {
  onOpen(): void
  onFrame(frame: Record<string, unknown>): void
  /** Fired once, whether the relay closed us, the network did, or the heartbeat lapsed. */
  onDrop(code: number, reason: string): void
}

/** A live relay answers a ping in well under a second, even over cellular. */
const PROBE_MS = 4000

const CONNECT_TIMEOUT_MS = 10_000

/** Not a relay code: the socket went silent on our side of the line. */
export const SILENT_LOCALLY = 4999

export function openRelaySocket(url: string, handlers: RelaySocketHandlers): RelaySocket {
  const ws = new WebSocket(url)
  let lastHeard = Date.now()
  let finished = false
  let probeTimer: ReturnType<typeof setTimeout> | null = null

  let lastTick = Date.now()

  // A connect that hangs — a captive portal, a dead route — would otherwise
  // sit for the whole heartbeat timeout while a player stares at a spinner.
  const connectTimer = setTimeout(() => {
    if (ws.readyState === WebSocket.CONNECTING) finish(SILENT_LOCALLY, 'relay did not answer')
  }, CONNECT_TIMEOUT_MS)

  const heartbeat = setInterval(() => {
    const now = Date.now()
    const frozen = now - lastTick > HEARTBEAT_MS * 2
    lastTick = now
    // A tab coming back from being frozen has heard nothing because nothing
    // was running, not because the relay went quiet. Ask before judging.
    if (frozen) {
      socket.probe()
      return
    }
    if (now - lastHeard > HEARTBEAT_TIMEOUT_MS) {
      finish(SILENT_LOCALLY, 'no reply from the relay')
      return
    }
    if (ws.readyState === WebSocket.OPEN) ws.send(PING)
  }, HEARTBEAT_MS)

  function finish(code: number, reason: string): void {
    if (finished) return
    finished = true
    clearInterval(heartbeat)
    clearTimeout(connectTimer)
    if (probeTimer) clearTimeout(probeTimer)
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
    try {
      ws.close()
    } catch {
      // Already closing.
    }
    handlers.onDrop(code, reason)
  }

  ws.onopen = () => {
    lastHeard = Date.now()
    handlers.onOpen()
  }

  ws.onmessage = (event) => {
    lastHeard = Date.now()
    if (event.data === PONG) return
    const frame = parseEnvelope(event.data)
    if (frame) handlers.onFrame(frame)
  }

  // An error is always followed by a close, which carries the code; wait for it.
  ws.onclose = (event) => finish(event.code, event.reason)

  const socket: RelaySocket = {
    send(frame) {
      if (finished || ws.readyState !== WebSocket.OPEN) return false
      ws.send(JSON.stringify(frame))
      return true
    },
    get open() {
      return !finished && ws.readyState === WebSocket.OPEN
    },
    probe() {
      if (finished || probeTimer) return
      if (ws.readyState !== WebSocket.OPEN) {
        // Still connecting is fine; closing or closed will report itself.
        return
      }
      const asked = Date.now()
      ws.send(PING)
      probeTimer = setTimeout(() => {
        probeTimer = null
        if (lastHeard < asked) finish(SILENT_LOCALLY, 'no reply after returning to the foreground')
      }, PROBE_MS)
    },
    close() {
      finish(1000, 'closed')
    },
  }
  return socket
}

/** The relay base URL with the room path and query on it. */
export function relayRoomUrl(base: string, path: string, query: Record<string, string>): string {
  const url = new URL(base.replace(/\/$/, '') + path)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return url.toString()
}
