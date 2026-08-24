/**
 * dsh-neeko — the bidirectional bridge between DeepSeek Harness and the Neeko
 * desktop shell. This plugin owns the WebSocket + health server, the session
 * lifecycle, approval/question forwarding, and (in CLI mode) launching Neeko.
 *
 * DSH stays product-pure: it never knows Neeko exists. Neeko speaks only the
 * neutral protocol in `./protocol.ts`. This plugin is the protocol layer that
 * translates both directions and holds the session state.
 *
 * @module dsh-neeko
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer, AskUserQuestionAnswerItem, AskUserQuestionItem, AskUserQuestionRequest, UserQuestionProvider } from '@deepseek-ai/dsh-user-questions'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { DshToNeeko, NeekoStatus } from './protocol.ts'
import type { Handshake } from './protocol.ts'
import { buildHistory, translateEvent } from './dsh-adapter.ts'
import { NeekoAdapter } from './neeko-adapter.ts'
import { NeekoWsServer } from './ws-server.ts'
import type { NeekoConnection } from './ws-server.ts'

/** Stable Cordis plugin name. */
export const name = 'neeko'

/** Core services required before the bridge can start. */
export const inject = ['agentDefaultModel', 'agents', 'userQuestions']

/** Default bind host, matching the integration design. */
export const DEFAULT_HOST = '127.0.0.1'

/** Default bridge port — non-3080 so the web profile keeps 3080. */
export const DEFAULT_PORT = 3081

/** Runtime configuration resolved from the startup provider. */
export interface Config {
  /** Pure-wait mode: never spawn Neeko. */
  daemon?: boolean
  /** Bind host. */
  host?: string
  /** Preferred bridge port (falls back to higher ports when busy). */
  port?: number
  /** Resume an existing persisted session instead of creating a new one. */
  sessionId?: string
  /** Whether CLI mode may spawn Neeko. */
  autoSpawn?: boolean
  /** Override the command used to launch Neeko. */
  spawnCommand?: string
}

export const Config: z<Config> = z.object({
  daemon: z.boolean(),
  host: z.string(),
  port: z.number(),
  sessionId: z.string(),
  autoSpawn: z.boolean(),
  spawnCommand: z.string(),
})

/** Process-facing effects replaced by focused tests. */
export const internals: { stderr: { write(chunk: string): unknown } } = {
  stderr: process.stderr,
}

interface ApprovalWaiter {
  readonly request: ApprovalRequest
  readonly resolve: (outcome: ApprovalOutcome) => void
  readonly onAbort: () => void
}

interface QuestionWaiter {
  readonly signal?: AbortSignal
  readonly resolve: (answer: string) => void
  readonly reject: (error: Error) => void
  readonly onAbort: () => void
}

interface BridgeIo {
  readonly stderr: { write(chunk: string): unknown }
  readonly exit: (code: number) => void
}

/**
 * The bridge. Owns the server, the single active connection, the live agent,
 * and the pending approval/question waiters.
 */
export class NeekoBridge {
  private readonly server: NeekoWsServer
  private readonly neekoAdapter: NeekoAdapter
  private readonly disposers: (() => void)[] = []
  private readonly connectionDisposers: (() => void)[] = []
  private readonly approvalWaiters = new Map<string, ApprovalWaiter>()
  private readonly questionWaiters = new Map<string, QuestionWaiter>()
  private connection: NeekoConnection | undefined
  private agentHandle: AgentHandle | undefined
  private agent: Agent | undefined
  private adoptedDisposer: (() => void) | undefined
  private agentRunning = false
  private toolActive = 0
  private status: NeekoStatus = 'idle'
  private activationChain: Promise<void> = Promise.resolve()
  private boundPort: number | undefined
  private started = false

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    private readonly io: BridgeIo,
  ) {
    const resolved = resolveConfig(config)
    this.server = new NeekoWsServer({
      host: resolved.host,
      port: resolved.port,
      onConnection: (connection) => this.handleConnection(connection),
    })
    this.neekoAdapter = new NeekoAdapter({
      getAgent: () => this.agent,
      resolveApproval: (requestId, decision) => this.finishApproval(requestId, decision === 'allowed' ? 'allowed-once' : 'rejected'),
      resolveQuestion: (requestId, answer) => this.resolveQuestion(requestId, answer),
      notifyError: (code, message) => this.sendToConnection({ type: 'error', payload: { code, message } }),
    })
  }

  /** The port the bridge actually bound (available after {@link start}). */
  get port(): number | undefined {
    return this.boundPort
  }

  /**
   * Start the bridge: register DSH listeners, bind the server, and (in CLI
   * mode) spawn Neeko.
   * @returns the bound port.
   */
  async start(): Promise<number> {
    if (this.started) {
      if (this.boundPort === undefined) throw new Error('dsh-neeko: start is still pending')
      return this.boundPort
    }
    this.started = true
    await this.ctx.get('loader')?.await()
    this.disposers.push(this.ctx.on('session/event', (session, event) => this.handleSessionEvent(session, event)))
    this.disposers.push(this.ctx.on('agent/status', ({ agent, status }) => {
      if (agent !== this.agent) return
      this.agentRunning = status === 'running'
      this.refreshStatus()
    }))
    const questionDisposer = this.ctx.get('userQuestions')?.registerProvider(this.questionProvider())
    if (questionDisposer !== undefined) this.disposers.push(questionDisposer)

    this.boundPort = await this.server.start()
    this.io.stderr.write(`dsh-neeko: bridge listening on ${this.server.websocketUrl()}\n`)
    this.maybeSpawnNeeko()
    return this.boundPort
  }

  /** Tear down the bridge: settle waiters, dispose the agent, stop the server. */
  async stop(): Promise<void> {
    this.cancelAllApprovals()
    this.cancelAllQuestions()
    this.adoptedDisposer?.()
    this.adoptedDisposer = undefined
    while (this.connectionDisposers.length > 0) this.connectionDisposers.pop()?.()
    while (this.disposers.length > 0) this.disposers.pop()?.()
    const handle = this.agentHandle
    this.agentHandle = undefined
    this.agent = undefined
    if (handle !== undefined) await handle.dispose()
    await this.server.stop()
  }

  // ── connection + mode detection ────────────────────────────────────────────

  private handleConnection(connection: NeekoConnection): void {
    if (this.connection !== undefined && this.connection !== connection) {
      this.connection.close(4000, 'superseded by a new Neeko connection')
    }
    this.connection = connection
    this.connectionDisposers.push(connection.onMessage((message) => this.neekoAdapter.handle(message)))
    this.connectionDisposers.push(connection.onClose((code, reason) => this.detachConnection(connection)))

    const handshake = connection.handshake
    if (handshake.payload.mode === 'dsh-agent') {
      // DSH started Neeko -> enter the chat immediately.
      void this.activate(handshake)
    } else if (handshake.payload.mode === 'on-demand' && handshake.payload.active === true) {
      // Neeko user clicked "DeepSeek" -> enter the chat now.
      void this.activate(handshake)
    }
    // mode=on-demand && !active -> stay idle; no session is created or subscribed.
  }

  private async detachConnection(connection: NeekoConnection): Promise<void> {
    if (this.connection !== connection) return
    this.connection = undefined
    while (this.connectionDisposers.length > 0) this.connectionDisposers.pop()?.()
    this.cancelAllApprovals()
    this.cancelAllQuestions()
    const handle = this.agentHandle
    this.agentHandle = undefined
    this.agent = undefined
    this.adoptedDisposer?.()
    this.adoptedDisposer = undefined
    this.agentRunning = false
    this.toolActive = 0
    this.status = 'idle'
    if (handle !== undefined) await handle.dispose()
  }

  // ── session lifecycle ──────────────────────────────────────────────────────

  private activate(handshake: Handshake): void {
    this.activationChain = this.activationChain.then(() => this.doActivate(handshake))
  }

  private async doActivate(handshake: Handshake): Promise<void> {
    const agents = this.ctx.get('agents')
    const defaultModel = this.ctx.get('agentDefaultModel')
    if (agents === undefined || defaultModel === undefined) return
    const connection = this.connection
    if (connection === undefined) return

    const selection = defaultModel.currentSelection()
    const agentOptions = { provider: selection.provider, model: selection.model }
    const requestedId = handshake.payload.sessionId === undefined ? undefined : SessionId(handshake.payload.sessionId)

    let handle: AgentHandle | undefined
    let agent: Agent | undefined
    let adopted = false

    // 1) Adopt a live agent that already carries the requested session.
    if (requestedId !== undefined) {
      const live = agents.get(requestedId)
      if (live !== undefined) {
        agent = live
        adopted = true
      }
    }

    // 2) Resume a persisted session, falling back to a fresh create.
    if (agent === undefined && requestedId !== undefined) {
      try {
        handle = await agents.resume({
          resumeSessionId: requestedId,
          agentOptions,
          setup: (agentCtx) => { this.setupAgent(agentCtx, selection) },
        })
        agent = handle.agent
      } catch {
        // no persisted session under this id -> create one below.
      }
    }

    // 3) Create a fresh session.
    if (agent === undefined) {
      handle = await agents.create({
        sessionId: requestedId ?? SessionId(`session-${randomUUID()}`),
        meta: { cwd: process.cwd() },
        agentOptions,
        setup: (agentCtx) => { this.setupAgent(agentCtx, selection) },
      })
      agent = handle.agent
    }

    // Release the previous bridge-owned agent and any adopted-agent listeners.
    const previousHandle = this.agentHandle
    // Re-adopting an agent we already own keeps the handle and its auto-disposed
    // scoped listeners; everything else needs an explicit switch.
    const reAdoptingOwned = adopted && previousHandle !== undefined && previousHandle.agent === agent
    if (previousHandle !== undefined && !reAdoptingOwned) {
      await previousHandle.dispose()
    }
    if (!reAdoptingOwned) {
      this.adoptedDisposer?.()
      this.adoptedDisposer = adopted ? this.setupAgent(agent.ctx, selection) : undefined
    }
    this.agentHandle = reAdoptingOwned ? previousHandle : (adopted ? undefined : handle)
    this.agent = agent
    await agent.whenIdle()

    // Push the reconstructed history and open the chat.
    connection.send({
      type: 'session.init',
      payload: {
        sessionId: String(agent.session.id),
        history: buildHistory(agent.session.events),
      },
    })
    this.refreshStatus()
  }

  /** Compose one agent's scoped world for the Neeko surface. */
  private setupAgent(agentCtx: Context, selection: ModelSelection): () => void {
    const modelDisposer = installModelSelection(agentCtx, { current: selection, assembled: undefined })
    const approvalDisposer = agentCtx.on('approval/request', (request: ApprovalRequest) => this.requestApproval(request))
    return () => {
      modelDisposer()
      approvalDisposer()
    }
  }

  // ── DSH event translation ──────────────────────────────────────────────────

  private handleSessionEvent(session: Session, event: SessionEvent): void {
    if (session !== this.agent?.session) return
    for (const message of translateEvent(event)) {
      if (message.type === 'tool.start') {
        this.toolActive += 1
        this.refreshStatus()
      } else if (message.type === 'tool.end') {
        this.toolActive = Math.max(0, this.toolActive - 1)
        this.refreshStatus()
      }
      this.sendToConnection(message)
    }
  }

  // ── approval / question plumbing ───────────────────────────────────────────

  /** Ask Neeko to decide one approval request, resolving the DSH waterfall. */
  private requestApproval(request: ApprovalRequest): Promise<ApprovalOutcome> {
    if (request.signal?.aborted) return Promise.resolve('cancelled')
    return new Promise((resolve) => {
      const requestId = randomUUID()
      const waiter: ApprovalWaiter = {
        request,
        resolve,
        onAbort: () => this.finishApproval(requestId, 'cancelled'),
      }
      request.signal?.addEventListener('abort', waiter.onAbort, { once: true })
      this.approvalWaiters.set(requestId, waiter)
      this.refreshStatus()
      this.sendToConnection({
        type: 'approval.request',
        payload: {
          requestId,
          toolName: request.toolName,
          ...(request.reason === undefined ? {} : { reason: request.reason }),
        },
      })
    })
  }

  /** Forward one (or more) user questions to Neeko and collect the answers. */
  private questionProvider(): UserQuestionProvider {
    return {
      ask: (request) => this.askQuestion(request),
    }
  }

  private async askQuestion(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    const answers: AskUserQuestionAnswerItem[] = []
    for (const question of request.questions) {
      answers.push(await this.askOneQuestion(question, request.signal))
    }
    return { answers }
  }

  private askOneQuestion(question: AskUserQuestionItem, signal?: AbortSignal): Promise<AskUserQuestionAnswerItem> {
    if (signal?.aborted) {
      return Promise.reject(new UserQuestionError('dsh-neeko: question aborted before the user answered', 'ASK_ABORTED'))
    }
    return new Promise((resolve, reject) => {
      const requestId = randomUUID()
      const waiter: QuestionWaiter = {
        ...(signal === undefined ? {} : { signal }),
        resolve: (answerText) => {
          const option = question.options?.find((candidate) => candidate.label === answerText)
          const item: AskUserQuestionAnswerItem = {
            id: question.id,
            selected: option === undefined ? [] : [option.label],
            ...(option === undefined && answerText !== '' ? { custom: answerText } : {}),
          }
          resolve(item)
        },
        reject,
        onAbort: () => {
          this.finishQuestion(requestId, new UserQuestionError('dsh-neeko: question aborted before the user answered', 'ASK_ABORTED'))
        },
      }
      signal?.addEventListener('abort', waiter.onAbort, { once: true })
      this.questionWaiters.set(requestId, waiter)
      this.refreshStatus()
      this.sendToConnection({
        type: 'question.request',
        payload: {
          requestId,
          question: question.question,
          ...(question.options === undefined || question.options.length === 0 ? {} : {
            options: question.options.map((option, index) => ({ id: String(index), label: option.label })),
          }),
        },
      })
    })
  }

  private finishApproval(requestId: string, outcome: ApprovalOutcome): void {
    const waiter = this.approvalWaiters.get(requestId)
    if (waiter === undefined) return
    this.approvalWaiters.delete(requestId)
    waiter.request.signal?.removeEventListener('abort', waiter.onAbort)
    waiter.resolve(outcome)
    this.refreshStatus()
  }

  private resolveQuestion(requestId: string, answer: string): void {
    const waiter = this.questionWaiters.get(requestId)
    if (waiter === undefined) return
    this.questionWaiters.delete(requestId)
    waiter.signal?.removeEventListener('abort', waiter.onAbort)
    waiter.resolve(answer)
    this.refreshStatus()
  }

  private finishQuestion(requestId: string, error: Error): void {
    const waiter = this.questionWaiters.get(requestId)
    if (waiter === undefined) return
    this.questionWaiters.delete(requestId)
    waiter.signal?.removeEventListener('abort', waiter.onAbort)
    waiter.reject(error)
    this.refreshStatus()
  }

  private cancelAllApprovals(): void {
    for (const [requestId, waiter] of this.approvalWaiters) {
      waiter.request.signal?.removeEventListener('abort', waiter.onAbort)
      waiter.resolve('cancelled')
    }
    this.approvalWaiters.clear()
  }

  private cancelAllQuestions(): void {
    for (const [requestId, waiter] of this.questionWaiters) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort)
      waiter.reject(new UserQuestionError('dsh-neeko: connection closed before the user answered', 'ASK_ABORTED'))
    }
    this.questionWaiters.clear()
  }

  // ── status + transport helpers ─────────────────────────────────────────────

  private refreshStatus(): void {
    const status = this.computeStatus()
    if (status === this.status) return
    this.status = status
    this.sendToConnection({ type: 'status.change', payload: { status } })
  }

  private computeStatus(): NeekoStatus {
    if (this.approvalWaiters.size > 0 || this.questionWaiters.size > 0) return 'awaiting_human'
    if (this.agentRunning) return this.toolActive > 0 ? 'executing' : 'thinking'
    return 'idle'
  }

  private sendToConnection(message: DshToNeeko): void {
    this.connection?.send(message)
  }

  // ── Neeko launch (CLI mode only) ───────────────────────────────────────────

  private maybeSpawnNeeko(): void {
    if (this.config.daemon === true || this.config.autoSpawn === false) return
    if (process.env.DSH_NEEKO_AUTOSPAWN === '0') return
    spawnNeeko(this.server.websocketUrl(), 'dsh-agent', this.config.spawnCommand, this.io.stderr)
  }
}

/**
 * Launch the Neeko desktop app in DSH-agent mode so it opens straight into the
 * Agent Chat, as documented in path A of the integration design.
 * @param url - the bridge WebSocket URL to hand Neeko.
 * @param mode - the connection mode flag to pass.
 * @param command - optional override (e.g. `"open -a Neeko"`); defaults to the
 *   platform convention.
 * @param stderr - diagnostic sink for spawn failures.
 */
export function spawnNeeko(
  url: string,
  mode: string,
  command: string | undefined,
  stderr: { write(chunk: string): unknown } = internals.stderr,
): void {
  const isDarwin = process.platform === 'darwin'
  const tokens = (command ?? (isDarwin ? 'open -a Neeko' : 'neeko')).split(/\s+/u).filter((token) => token !== '')
  const executable = tokens[0]
  if (executable === undefined) {
    stderr.write('dsh-neeko: no Neeko spawn command configured\n')
    return
  }
  const rest = tokens.slice(1)
  const flags = [`--dsh-ws=${url}`, `--mode=${mode}`]
  const args = isDarwin && executable === 'open' ? [...rest, '--args', ...flags] : [...rest, ...flags]
  let child
  try {
    child = spawn(executable, args, { detached: true, stdio: 'ignore' })
  } catch (error: unknown) {
    stderr.write(`dsh-neeko: failed to spawn Neeko (${executable}): ${error instanceof Error ? error.message : String(error)}\n`)
    return
  }
  child.unref()
  child.on('error', (error: Error) => {
    stderr.write(`dsh-neeko: failed to spawn Neeko (${executable}): ${error.message}\n`)
  })
}

function resolveConfig(config: Config): { host: string; port: number } {
  const envPort = Number(process.env.DSH_NEEKO_PORT)
  return {
    host: config.host ?? DEFAULT_HOST,
    port: config.port ?? (Number.isInteger(envPort) && envPort > 0 ? envPort : DEFAULT_PORT),
  }
}

/**
 * Mount the dsh-neeko bridge.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated bridge configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('neeko: the launcher must provide ctx.appExit before the tree mounts')
  ctx.effect(() => {
    const bridge = new NeekoBridge(ctx, config, { stderr: internals.stderr, exit })
    const task = bridge.start().catch(async (error: unknown) => {
      internals.stderr.write(`dsh-neeko: ${error instanceof Error ? error.message : String(error)}\n`)
      await bridge.stop()
      exit(1)
    })
    return async () => {
      await bridge.stop()
      await task
    }
  }, 'neeko.run')
}
