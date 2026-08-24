/**
 * dsh-neeko WebSocket server: binds `127.0.0.1:3081` (or the configured port),
 * serves the `/neeko-health` probe endpoint, and accepts Neeko connections.
 * The first frame on every socket must be a valid {@link Handshake}; the
 * server validates it and only then exposes a {@link NeekoConnection} to the
 * bridge.
 *
 * Port allocation is dynamic: if the configured port is taken, the server
 * retries `port + 1`, `port + 2`, … up to {@link PORT_RETRY_BUDGET} extra
 * attempts so a second Harness surface (e.g. the web profile on 3080) never
 * wedges Neeko integration. The actual bound port is reported through
 * {@link NeekoWsServer.start}.
 *
 * @module dsh-neeko/ws-server
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer, type RawData } from 'ws'
import { PROTOCOL_VERSION, wrapEnvelope, unwrapEnvelope, isHandshake, isNeekoToDsh } from './protocol.ts'
import type { DshToNeeko, Handshake, NeekoToDsh } from './protocol.ts'

/** WebSocket upgrade path Neeko connects to. */
export const WS_PATH = '/ws'

/** Health probe path Neeko uses to decide whether DSH is already running. */
export const HEALTH_PATH = '/neeko-health'

/** How many additional ports to try after the configured one is busy. */
export const PORT_RETRY_BUDGET = 9

/** The bridge-facing handle for one authenticated Neeko client. */
export interface NeekoConnection {
  /** The validated handshake that opened this connection. */
  readonly handshake: Handshake
  /**
   * Send one protocol message to the client, wrapped in the DSH->Neeko
   * envelope. No-op once the socket has closed.
   */
  send(message: DshToNeeko): void
  /** Register a receiver for client messages after the handshake. */
  onMessage(listener: (message: NeekoToDsh) => void): () => void
  /** Register a receiver for connection teardown (clean close or error). */
  onClose(listener: (code: number, reason: string) => void): () => void
  /** Close the socket with an optional close code and reason. */
  close(code?: number, reason?: string): void
}

/** Options accepted by {@link NeekoWsServer}. */
export interface NeekoWsServerOptions {
  /** Bind host; defaults to loopback. */
  host?: string
  /** Preferred port; the server falls back to higher ports when busy. */
  port?: number
  /** Called once a valid handshake has been received. */
  onConnection(connection: NeekoConnection): void
}

interface PendingConnection {
  readonly socket: WebSocket
  readonly rawMessage: (message: NeekoToDsh) => void
  readonly rawClose: (code: number, reason: string) => void
}

/**
 * The HTTP + WebSocket endpoint owned by the bridge. One instance owns one
 * listen socket; `start()` binds it and returns the actual port.
 */
export class NeekoWsServer {
  private readonly host: string
  private readonly preferredPort: number
  private readonly onConnection: (connection: NeekoConnection) => void
  private readonly http: Server
  private readonly wss: WebSocketServer
  private readonly pending = new Map<WebSocket, PendingConnection>()
  private started = false
  private stopped = false
  private boundPort: number | undefined

  constructor(options: NeekoWsServerOptions) {
    this.host = options.host ?? '127.0.0.1'
    this.preferredPort = options.port ?? 3081
    this.onConnection = options.onConnection
    this.wss = new WebSocketServer({ noServer: true })
    this.wss.on('connection', (socket) => this.attach(socket))
    this.http = createServer((request, response) => this.handleHttp(request, response))
    this.http.on('upgrade', (request, socket, head) => this.handleUpgrade(request, socket, head))
  }

  /** The port the server actually bound (available after {@link start}). */
  get port(): number | undefined {
    return this.boundPort
  }

  /**
   * Bind the listener, retrying upward on busy ports.
   * @returns the actual bound port.
   * @throws when every candidate port is busy or the bind otherwise fails.
   */
  async start(): Promise<number> {
    if (this.started) {
      if (this.boundPort === undefined) throw new Error('dsh-neeko: server start is still pending')
      return this.boundPort
    }
    this.started = true
    let lastError: unknown
    for (let attempt = 0; attempt <= PORT_RETRY_BUDGET; attempt += 1) {
      const candidate = this.preferredPort + attempt
      try {
        this.boundPort = await this.listen(candidate)
        return this.boundPort
      } catch (error: unknown) {
        if (!isEaddrinuse(error)) throw error
        lastError = error
      }
    }
    throw new Error(`dsh-neeko: no free port in [${this.preferredPort}, ${this.preferredPort + PORT_RETRY_BUDGET}]: ${describeError(lastError)}`)
  }

  /** The URL Neeko should connect to, after {@link start}. */
  websocketUrl(): string {
    const port = this.boundPort ?? this.preferredPort
    return `ws://${this.host}:${port}${WS_PATH}`
  }

  /** Close the HTTP server and every live socket. */
  stop(): Promise<void> {
    this.stopped = true
    for (const pending of this.pending.values()) pending.socket.terminate()
    this.pending.clear()
    return new Promise((resolve) => {
      this.wss.close(() => {
        this.http.close(() => resolve())
      })
    })
  }

  /**
   * Bind the listener to `port` (an OS-assigned ephemeral port when `0`).
   * @returns the actual bound port.
   */
  private listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        this.http.off('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        this.http.off('error', onError)
        const address = this.http.address()
        resolve(typeof address === 'object' && address !== null ? address.port : port)
      }
      this.http.once('error', onError)
      this.http.once('listening', onListening)
      this.http.listen(port, this.host)
    })
  }

  private handleHttp(request: IncomingMessage, response: ServerResponse): void {
    const pathname = (request.url ?? '/').split('?', 1)[0] ?? '/'
    if (request.method === 'GET' && pathname === HEALTH_PATH) {
      response.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      })
      response.end(JSON.stringify({
        status: 'ok',
        name: 'dsh-neeko',
        version: PROTOCOL_VERSION,
        port: this.boundPort ?? this.preferredPort,
      }))
      return
    }
    if (request.method === 'GET' && pathname === '/') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        name: 'dsh-neeko',
        version: PROTOCOL_VERSION,
        health: HEALTH_PATH,
        websocket: WS_PATH,
      }))
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (this.stopped) {
      socket.destroy()
      return
    }
    const pathname = (request.url ?? '/').split('?', 1)[0] ?? '/'
    // Accept both the canonical path and the bare root so clients that connect
    // to `ws://host:port` (no path, as in the integration design) work too.
    if (pathname !== WS_PATH && pathname !== '/') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request)
    })
  }

  private attach(socket: WebSocket): void {
    let handshake: Handshake | undefined
    let handedOver = false
    const messageListeners = new Set<(message: NeekoToDsh) => void>()
    const closeListeners = new Set<(code: number, reason: string) => void>()
    const pending: PendingConnection = {
      socket,
      rawMessage: (message) => {
        for (const listener of messageListeners) listener(message)
      },
      rawClose: (code, reason) => {
        for (const listener of closeListeners) listener(code, reason)
      },
    }
    this.pending.set(socket, pending)

    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        this.failHandshake(socket, 'binary frames are not supported')
        return
      }
      let raw: unknown
      try {
        raw = JSON.parse(String(data))
      } catch {
        this.failHandshake(socket, 'malformed JSON frame')
        return
      }
      const unwrapped = unwrapEnvelope(raw)
      if (unwrapped === undefined) {
        this.failHandshake(socket, 'frame is not a protocol message')
        return
      }
      if (handshake === undefined) {
        if (!isHandshake(unwrapped.message)) {
          this.failHandshake(socket, 'first frame must be a handshake')
          return
        }
        if (unwrapped.message.payload.version !== PROTOCOL_VERSION) {
          this.failHandshake(socket, `unsupported protocol version ${unwrapped.message.payload.version} (bridge speaks ${PROTOCOL_VERSION})`)
          return
        }
        handshake = unwrapped.message
        if (handedOver) return
        handedOver = true
        this.pending.delete(socket)
        const connection: NeekoConnection = {
          handshake,
          send: (message) => {
            if (socket.readyState !== WebSocket.OPEN) return
            socket.send(JSON.stringify(wrapEnvelope(message, 'dsh->neeko')))
          },
          onMessage: (listener) => {
            messageListeners.add(listener)
            return () => messageListeners.delete(listener)
          },
          onClose: (listener) => {
            closeListeners.add(listener)
            return () => closeListeners.delete(listener)
          },
          close: (code = 1000, reason = '') => {
            if (socket.readyState === WebSocket.OPEN) socket.close(code, reason)
          },
        }
        this.onConnection(connection)
        return
      }
      if (!isNeekoToDsh(unwrapped.message)) {
        this.sendError(socket, 'UNKNOWN_MESSAGE', `unknown message type: ${describeMessage(unwrapped.message)}`)
        return
      }
      pending.rawMessage(unwrapped.message)
    })

    socket.on('close', (code: number, reason: Buffer) => {
      this.pending.delete(socket)
      if (handshake !== undefined) pending.rawClose(code, reason.toString())
    })
    socket.on('error', (error: Error) => {
      this.pending.delete(socket)
      if (handshake !== undefined) pending.rawClose(1011, describeError(error))
    })
  }

  private failHandshake(socket: WebSocket, reason: string): void {
    this.sendError(socket, 'HANDSHAKE_FAILED', reason)
    this.pending.delete(socket)
    socket.close(1008, reason)
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    if (socket.readyState !== WebSocket.OPEN) return
    const error: DshToNeeko = { type: 'error', payload: { code, message } }
    socket.send(JSON.stringify(wrapEnvelope(error, 'dsh->neeko')))
  }
}

function isEaddrinuse(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EADDRINUSE'
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function describeMessage(message: unknown): string {
  if (typeof message === 'object' && message !== null) {
    const type = (message as { type?: unknown }).type
    if (typeof type === 'string') return type
  }
  return JSON.stringify(message)
}
