import { DurableObject } from 'cloudflare:workers'

import { CLOSE, HEARTBEAT_MS, HEARTBEAT_TIMEOUT_MS, PING, PONG } from '../../src/net/relayProtocol'
import {
  type Attachment,
  type RoomSocket,
  admitClient,
  admitHost,
  clientAdmitted,
  hostAdmitted,
  onClose,
  onMessage,
  silentSockets,
} from '../../src/net/relayRoom'

/**
 * The ArtSlicer relay: one Durable Object per room code, carrying the game's
 * messages between the host and its phones over plain WebSockets.
 *
 * It replaces WebRTC for the cases WebRTC cannot reach — a phone on cellular,
 * a guest network that isolates clients — because a wss:// connection on 443
 * looks like any other HTTPS and gets through wherever the page itself loaded.
 * The host is still the server: this only moves strings, and never reads one.
 */

interface Env {
  ROOMS: DurableObjectNamespace<Room>
  ALLOWED_ORIGINS: string
}

/** The same alphabet and length the app rolls codes from. */
const ROOM_CODE = /^[ACDEFGHJKMNPQRTUVWXY2346789]{4}$/

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const match = /^\/room\/([^/]+)$/.exec(url.pathname)

    if (!match) {
      return new Response('ArtSlicer relay. Rooms live at /room/<CODE>.', { status: 404 })
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 })
    }
    if (!originAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) {
      return new Response('Origin not allowed.', { status: 403 })
    }

    const code = decodeURIComponent(match[1]!)
    if (!ROOM_CODE.test(code)) return new Response('Not a room code.', { status: 400 })

    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request)
  },
} satisfies ExportedHandler<Env>

/**
 * Stops other sites borrowing the relay from their visitors' browsers. Local
 * and private-network origins always pass, so a dev server on the LAN can be
 * tested from a phone; anything not run from a browser could forge the header
 * anyway, so this is a fence, not a lock.
 */
function originAllowed(origin: string | null, allowed: string): boolean {
  if (!origin) return false
  const list = allowed.split(',').map((o) => o.trim())
  if (list.includes('*') || list.includes(origin)) return true
  try {
    const { hostname, protocol } = new URL(origin)
    if (protocol !== 'http:' && protocol !== 'https:') return false
    return (
      hostname === 'localhost' ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname.endsWith('.local')
    )
  } catch {
    return false
  }
}

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Answered by the runtime itself, so a room full of idle phones heart-
    // beating every few seconds never wakes this object up.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const role = url.searchParams.get('role')
    const id = crypto.randomUUID()
    const now = Date.now()

    const sockets = this.sockets()
    const admission =
      role === 'host'
        ? admitHost(sockets, id, url.searchParams.get('key') ?? '', now)
        : role === 'client'
          ? admitClient(sockets, id, now)
          : { reject: { code: CLOSE.badRequest, reason: 'role must be host or client' } }

    const { 0: browser, 1: server } = new WebSocketPair()

    if ('reject' in admission) {
      // Accepted and closed straight away, outside hibernation, so the close
      // code reaches the browser — a refused upgrade would show it only 1006.
      server.accept()
      server.close(admission.reject.code, admission.reject.reason)
      return new Response(null, { status: 101, webSocket: browser })
    }

    this.ctx.acceptWebSocket(server, [admission.accept.role])
    server.serializeAttachment(admission.accept)

    const joined = wrap(server)
    if (joined.att.role === 'host') hostAdmitted(joined)
    else clientAdmitted(this.sockets(), joined)

    await this.keepWatch()
    return new Response(null, { status: 101, webSocket: browser })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    onMessage(this.sockets(), wrap(ws), message)
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    onClose(this.sockets(), wrap(ws))
    try {
      ws.close(code, reason)
    } catch {
      // Already closed: the runtime may have replied to the close for us.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    onClose(this.sockets(), wrap(ws))
  }

  /**
   * Reaps sockets that stopped pinging. A phone that loses signal sends no
   * close, and a host frozen in a background tab sends nothing at all.
   */
  async alarm(): Promise<void> {
    const now = Date.now()
    const silent = silentSockets(
      this.sockets(),
      (s) => this.lastHeard(s),
      now,
      HEARTBEAT_TIMEOUT_MS,
    )
    for (const s of silent) {
      s.close(CLOSE.silent, 'no heartbeat')
      // A silent socket's peer is usually gone, so the close handshake that
      // would raise webSocketClose may never finish. Tell the room now; if the
      // event does arrive later, the host ignores a phone it already let go.
      onClose(this.sockets(), s)
    }
    await this.keepWatch()
  }

  /** Only open sockets: one this side has already closed is on its way out. */
  private sockets(): RoomSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.OPEN)
      .map(wrap)
  }

  private lastHeard(s: RoomSocket): number {
    const ws = this.ctx.getWebSockets().find((w) => attachmentOf(w)?.id === s.att.id)
    return ws ? (this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0) : 0
  }

  /** An alarm while anyone is connected, and none once the room is empty. */
  private async keepWatch(): Promise<void> {
    if (this.sockets().length === 0) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS * 2)
    }
  }
}

function attachmentOf(ws: WebSocket): Attachment | null {
  return (ws.deserializeAttachment() as Attachment | null) ?? null
}

function wrap(ws: WebSocket): RoomSocket {
  const att = attachmentOf(ws)
  if (!att) throw new Error('socket without an attachment')
  return {
    att,
    send: (data) => ws.send(data),
    close: (code, reason) => {
      try {
        ws.close(code, reason)
      } catch {
        // Already closing.
      }
    },
  }
}
