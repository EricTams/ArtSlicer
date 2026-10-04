import { describe, expect, it } from 'vitest'

import { CLOSE } from './relayProtocol'
import {
  type Admission,
  type Attachment,
  MAX_CLIENTS,
  type RoomSocket,
  admitClient,
  admitHost,
  clientAdmitted,
  hostAdmitted,
  onClose,
  onMessage,
  silentSockets,
} from './relayRoom'

interface FakeSocket extends RoomSocket {
  sent: unknown[]
  closed: { code: number; reason: string } | null
}

function socket(att: Attachment): FakeSocket {
  const fake: FakeSocket = {
    att,
    sent: [],
    closed: null,
    send(data) {
      fake.sent.push(JSON.parse(data))
    },
    close(code, reason) {
      fake.closed = { code, reason }
    },
  }
  return fake
}

function accepted(admission: Admission): Attachment {
  if ('reject' in admission) throw new Error(`rejected: ${admission.reject.reason}`)
  return admission.accept
}

/** A room with a host and two phones, every one of them admitted the way the Worker does it. */
function room() {
  const sockets: FakeSocket[] = []
  const host = socket(accepted(admitHost(sockets, 'h1', 'secret', 0)))
  sockets.push(host)
  hostAdmitted(host)
  const phones = ['p1', 'p2'].map((id) => {
    const phone = socket(accepted(admitClient(sockets, id, 0)))
    sockets.push(phone)
    clientAdmitted(sockets, phone)
    return phone
  })
  host.sent.length = 0
  for (const phone of phones) phone.sent.length = 0
  return { sockets, host, phones: phones as [FakeSocket, FakeSocket] }
}

describe('admitting a host', () => {
  it('tells the host the room is ready', () => {
    const host = socket(accepted(admitHost([], 'h1', 'secret', 0)))
    hostAdmitted(host)
    expect(host.sent).toEqual([{ t: 'ready' }])
  })

  it('turns away a stranger who rolled the same code', () => {
    const { sockets } = room()
    expect(admitHost(sockets, 'h2', 'other', 0)).toEqual({
      reject: { code: CLOSE.taken, reason: 'room code taken' },
    })
  })

  it('lets the same host back in, and sends its phones round again', () => {
    const { sockets, host, phones } = room()
    accepted(admitHost(sockets, 'h2', 'secret', 0))
    expect(host.closed?.code).toBe(CLOSE.replaced)
    for (const phone of phones) expect(phone.closed?.code).toBe(CLOSE.hostGone)
  })

  it('refuses a host with no key, which could never reclaim its room', () => {
    expect('reject' in admitHost([], 'h1', '', 0)).toBe(true)
  })
})

describe('admitting a phone', () => {
  it('waits for a host rather than opening onto nothing', () => {
    expect(admitClient([], 'p1', 0)).toEqual({
      reject: { code: CLOSE.noHost, reason: 'no host for this room' },
    })
  })

  it('tells both ends, giving the phone its id', () => {
    const sockets: FakeSocket[] = [socket({ role: 'host', id: 'h1', key: 'k', since: 0 })]
    const phone = socket(accepted(admitClient(sockets, 'p1', 0)))
    sockets.push(phone)
    clientAdmitted(sockets, phone)
    expect(phone.sent).toEqual([{ t: 'ready', c: 'p1' }])
    expect(sockets[0]!.sent).toEqual([{ t: 'open', c: 'p1' }])
  })

  it('stops at a full room', () => {
    const sockets: FakeSocket[] = [socket({ role: 'host', id: 'h1', key: 'k', since: 0 })]
    for (let i = 0; i < MAX_CLIENTS; i++) sockets.push(socket({ role: 'client', id: `p${i}`, since: 0 }))
    expect(admitClient(sockets, 'late', 0)).toMatchObject({ reject: { code: CLOSE.full } })
  })
})

describe('carrying messages', () => {
  it('hands a phone frame to the host, labelled with who sent it', () => {
    const { sockets, host, phones } = room()
    onMessage(sockets, phones[0], JSON.stringify({ t: 'msg', d: '{"t":"start"}' }))
    expect(host.sent).toEqual([{ t: 'msg', c: 'p1', d: '{"t":"start"}' }])
  })

  it('sends a host frame to the one phone it names', () => {
    const { sockets, phones } = room()
    onMessage(sockets, sockets[0]!, JSON.stringify({ t: 'send', c: 'p2', d: 'x' }))
    expect(phones[0].sent).toEqual([])
    expect(phones[1].sent).toEqual([{ t: 'msg', d: 'x' }])
  })

  it('broadcasts to every phone', () => {
    const { sockets, phones } = room()
    onMessage(sockets, sockets[0]!, JSON.stringify({ t: 'all', d: 'x' }))
    for (const phone of phones) expect(phone.sent).toEqual([{ t: 'msg', d: 'x' }])
  })

  it('does not let a phone pose as the host', () => {
    const { sockets, phones } = room()
    onMessage(sockets, phones[0], JSON.stringify({ t: 'all', d: 'x' }))
    expect(phones[1].sent).toEqual([])
  })

  it('kicks the phone the host names', () => {
    const { sockets, phones } = room()
    onMessage(sockets, sockets[0]!, JSON.stringify({ t: 'kick', c: 'p1' }))
    expect(phones[0].closed?.code).toBe(CLOSE.kicked)
    expect(phones[1].closed).toBeNull()
  })

  it.each([
    ['binary', new ArrayBuffer(4)],
    ['not JSON', 'nope'],
    ['oversized', JSON.stringify({ t: 'msg', d: 'x'.repeat(70_000) })],
  ])('drops a %s frame', (_label, raw) => {
    const { sockets, host, phones } = room()
    onMessage(sockets, phones[0], raw)
    expect(host.sent).toEqual([])
  })
})

describe('closing', () => {
  it('tells the host a phone has gone', () => {
    const { sockets, host, phones } = room()
    onClose(sockets, phones[0])
    expect(host.sent).toEqual([{ t: 'close', c: 'p1' }])
  })

  it('sends every phone away when the host leaves, so they retry', () => {
    const { sockets, host, phones } = room()
    onClose(sockets, host)
    for (const phone of phones) expect(phone.closed?.code).toBe(CLOSE.hostGone)
  })

  it('leaves the phones alone when the host that left has already been replaced', () => {
    const { sockets, host } = room()
    const successor = socket({ role: 'host', id: 'h2', key: 'secret', since: 1 })
    const phone = socket({ role: 'client', id: 'p9', since: 1 })
    onClose([host, successor, phone], host)
    expect(phone.closed).toBeNull()
    expect(sockets).toHaveLength(3)
  })
})

describe('silentSockets', () => {
  it('finds the sockets that stopped pinging, counting from when they joined', () => {
    const quiet = socket({ role: 'client', id: 'q', since: 0 })
    const chatty = socket({ role: 'client', id: 'c', since: 0 })
    const fresh = socket({ role: 'client', id: 'f', since: 90 })
    const heard = new Map<RoomSocket, number>([[chatty, 80]])
    const silent = silentSockets([quiet, chatty, fresh], (s) => heard.get(s) ?? 0, 100, 45)
    expect(silent).toEqual([quiet])
  })
})
