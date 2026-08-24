import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { NeekoWsServer } from '../src/ws-server.ts'
import type { NeekoConnection } from '../src/ws-server.ts'
import { PROTOCOL_VERSION, wrapEnvelope } from '../src/protocol.ts'

const servers: NeekoWsServer[] = []
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    try { socket.close() } catch { /* already closed */ }
  }
  await Promise.all(servers.splice(0).map((server) => server.stop()))
})

function createServer(onConnection?: (connection: NeekoConnection) => void): NeekoWsServer {
  const server = new NeekoWsServer({ port: 0, onConnection: onConnection ?? (() => {}) })
  servers.push(server)
  return server
}

function connectClient(port: number, path = '/ws'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    sockets.push(socket)
    socket.on('open', () => resolve(socket))
    socket.on('error', reject)
  })
}

function sendJson(socket: WebSocket, value: unknown): void {
  socket.send(JSON.stringify(value))
}

function nextFrame(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    const onMessage = (data: WebSocket.RawData): void => {
      socket.off('message', onMessage)
      resolve(JSON.parse(String(data)) as unknown)
    }
    socket.on('message', onMessage)
  })
}

function nextClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.on('close', (code) => resolve(code))
  })
}

describe('NeekoWsServer', () => {
  it('serves the health probe', async () => {
    const server = createServer()
    const port = await server.start()
    const response = await fetch(`http://127.0.0.1:${port}/neeko-health`)
    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; version: string; port: number }
    expect(body.status).toBe('ok')
    expect(body.version).toBe(PROTOCOL_VERSION)
    expect(body.port).toBe(port)
  })

  it('answers the root and 404s unknown paths', async () => {
    const server = createServer()
    const port = await server.start()
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200)
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404)
  })

  it('accepts a handshake and exposes a connection', async () => {
    let resolveConnection!: (connection: NeekoConnection) => void
    const connectionPromise = new Promise<NeekoConnection>((resolve) => { resolveConnection = resolve })
    const server = createServer((connection) => resolveConnection(connection))
    const port = await server.start()

    const socket = await connectClient(port)
    sendJson(socket, {
      type: 'handshake',
      payload: { version: PROTOCOL_VERSION, role: 'neeko', mode: 'dsh-agent', active: true, sessionId: 's1' },
    })

    const connection = await connectionPromise
    expect(connection.handshake.payload.mode).toBe('dsh-agent')
    expect(connection.handshake.payload.sessionId).toBe('s1')

    // Server -> client delivery, wrapped in the DSH->Neeko envelope.
    const frame = nextFrame(socket)
    connection.send({ type: 'status.change', payload: { status: 'thinking' } })
    const received = await frame as { direction: string; message: unknown }
    expect(received.direction).toBe('dsh->neeko')
    expect(received.message).toEqual({ type: 'status.change', payload: { status: 'thinking' } })
  })

  it('routes client messages after the handshake', async () => {
    let resolveConnection!: (connection: NeekoConnection) => void
    const connectionPromise = new Promise<NeekoConnection>((resolve) => { resolveConnection = resolve })
    const server = createServer((connection) => resolveConnection(connection))
    const port = await server.start()

    const socket = await connectClient(port)
    sendJson(socket, {
      type: 'handshake',
      payload: { version: PROTOCOL_VERSION, role: 'neeko', mode: 'on-demand', active: true },
    })
    const connection = await connectionPromise
    let received!: unknown
    connection.onMessage((message) => { received = message })
    sendJson(socket, wrapEnvelope(
      { type: 'session.prompt', payload: { sessionId: 's', message: 'hi' } },
      'neeko->dsh',
    ))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(received).toEqual({ type: 'session.prompt', payload: { sessionId: 's', message: 'hi' } })
  })

  it('accepts upgrades on the bare root path too', async () => {
    let resolveConnection!: (connection: NeekoConnection) => void
    const connectionPromise = new Promise<NeekoConnection>((resolve) => { resolveConnection = resolve })
    const server = createServer((connection) => resolveConnection(connection))
    const port = await server.start()
    const socket = await connectClient(port, '/')
    sendJson(socket, {
      type: 'handshake',
      payload: { version: PROTOCOL_VERSION, role: 'neeko', mode: 'dsh-agent', active: true },
    })
    const connection = await connectionPromise
    expect(connection.handshake.payload.mode).toBe('dsh-agent')
  })

  it('rejects a non-handshake first frame and closes with 1008', async () => {
    const server = createServer()
    const port = await server.start()
    const socket = await connectClient(port)
    const closed = nextClose(socket)
    const errorFrame = nextFrame(socket)
    sendJson(socket, { type: 'session.prompt', payload: { sessionId: 's', message: 'hi' } })
    const received = await errorFrame as { message: { payload: { code: string } } }
    expect(received.message.payload.code).toBe('HANDSHAKE_FAILED')
    expect(await closed).toBe(1008)
  })

  it('rejects an unsupported protocol version', async () => {
    const server = createServer()
    const port = await server.start()
    const socket = await connectClient(port)
    const closed = nextClose(socket)
    sendJson(socket, {
      type: 'handshake',
      payload: { version: '9.9.9', role: 'neeko', mode: 'dsh-agent', active: true },
    })
    expect(await closed).toBe(1008)
  })

  it('falls back to a higher port when the preferred one is busy', async () => {
    const first = createServer()
    const port = await first.start()
    const second = new NeekoWsServer({ port, onConnection: () => {} })
    servers.push(second)
    const actual = await second.start()
    expect(actual).toBeGreaterThan(port)
  })
})
