/**
 * dsh-neeko wire protocol: the neutral, product-agnostic vocabulary shared by
 * DeepSeek Harness (DSH) and the Neeko desktop shell. Both sides speak only
 * this protocol through the dsh-neeko bridge — the bridge is a pure protocol
 * layer and never leaks DSH internals to Neeko (or vice versa).
 *
 * @module dsh-neeko/protocol
 */

/** Protocol version carried by every handshake; bumped on breaking wire changes. */
export const PROTOCOL_VERSION = '1.0.0'

/** The role the connecting client claims. Currently only Neeko exists. */
export type NeekoRole = 'neeko'

/**
 * How a Neeko connection wants to behave:
 * - `dsh-agent` — DSH started Neeko; enter the Agent Chat immediately.
 * - `on-demand` — Neeko started on its own; activate only when the user clicks
 *   "DeepSeek" (`active: true`), otherwise stay idle.
 */
export type ConnectionMode = 'dsh-agent' | 'on-demand'

/** The bridge's view of the agent lifecycle, surfaced to Neeko. */
export type NeekoStatus = 'idle' | 'thinking' | 'executing' | 'awaiting_human'

/** Connection-opening message sent by the Neeko client as its first frame. */
export interface Handshake {
  type: 'handshake'
  payload: {
    /** Protocol version the client speaks. */
    version: string
    /** The connecting role. */
    role: NeekoRole
    /** Connection mode. */
    mode: ConnectionMode
    /** Whether the user asked to enter the chat right now. */
    active: boolean
    /** Optional session id to resume instead of creating a new one. */
    sessionId?: string
  }
}

/** One reconstructed conversation row pushed to Neeko on `session.init`. */
export type HistoryItem =
  | {
      kind: 'user'
      /** Stable message identity, echoed on the wire. */
      messageId: string
      content: string
      createdAt: number
    }
  | {
      kind: 'assistant'
      messageId: string
      text: string
      thinking: string
      createdAt: number
    }
  | {
      kind: 'tool'
      /** Pairs with the `taskId` of live `tool.start` / `tool.end`. */
      taskId: string
      name: string
      args: unknown
      result: unknown
      status: 'success' | 'failed'
      createdAt: number
    }

/** An interactive approval gate: Neeko must decide before the tool may run. */
export interface ApprovalRequestMessage {
  type: 'approval.request'
  payload: {
    /** Bridge-issued correlation id echoed back by `approval.respond`. */
    requestId: string
    toolName: string
    reason?: string
  }
}

/** A user question the agent asked; Neeko must answer before it proceeds. */
export interface QuestionRequestMessage {
  type: 'question.request'
  payload: {
    requestId: string
    question: string
    options?: { id: string; label: string }[]
  }
}

/** A terminal, structured bridge error sent to Neeko. */
export interface ErrorMessage {
  type: 'error'
  payload: {
    code: string
    message: string
  }
}

/**
 * Messages the bridge (DSH side) sends to Neeko. The `payload.direction` is
 * recorded on the envelope; each message keeps only its own domain payload.
 */
export type DshToNeeko =
  | {
      type: 'session.init'
      payload: {
        sessionId: string
        history: HistoryItem[]
      }
    }
  | {
      type: 'status.change'
      payload: {
        status: NeekoStatus
      }
    }
  | {
      type: 'text.delta'
      payload: {
        chunk: string
        messageId: string
      }
    }
  | {
      type: 'thinking.delta'
      payload: {
        chunk: string
      }
    }
  | {
      type: 'tool.start'
      payload: {
        taskId: string
        toolName: string
        args: unknown
      }
    }
  | {
      type: 'tool.stream'
      payload: {
        taskId: string
        streamType: 'stdout' | 'stderr'
        chunk: string
      }
    }
  | {
      type: 'tool.end'
      payload: {
        taskId: string
        status: 'success' | 'failed'
        result: unknown
        diff?: {
          filePath: string
          patch: string
        }
      }
    }
  | ApprovalRequestMessage
  | QuestionRequestMessage
  | ErrorMessage

/** Messages Neeko sends to the bridge (DSH side). */
export type NeekoToDsh =
  | {
      type: 'session.prompt'
      payload: {
        sessionId: string
        message: string
      }
    }
  | {
      type: 'session.steer'
      payload: {
        sessionId: string
        message: string
      }
    }
  | {
      type: 'session.cancel'
      payload: {
        sessionId: string
      }
    }
  | {
      type: 'approval.respond'
      payload: {
        requestId: string
        decision: 'allowed' | 'rejected'
      }
    }
  | {
      type: 'question.respond'
      payload: {
        requestId: string
        answer: string
      }
    }

/** Any protocol message, before direction is known. */
export type ProtocolMessage = DshToNeeko | NeekoToDsh | Handshake

/** The wire direction of an {@link Envelope}. */
export type EnvelopeDirection = 'dsh->neeko' | 'neeko->dsh'

/**
 * The uniform frame every protocol message travels inside. `rpcId` lets a
 * client correlate request/response pairs and deduplicate retries.
 */
export interface Envelope {
  rpcId: string
  direction: EnvelopeDirection
  timestamp: number
  message: ProtocolMessage
}

/** Narrow a parsed value to a {@link Handshake}. */
export function isHandshake(message: unknown): message is Handshake {
  if (typeof message !== 'object' || message === null) return false
  const candidate = message as { type?: unknown; payload?: unknown }
  if (candidate.type !== 'handshake') return false
  const payload = candidate.payload as { version?: unknown; role?: unknown; mode?: unknown; active?: unknown }
  return typeof payload === 'object' && payload !== null
    && typeof payload.version === 'string'
    && payload.role === 'neeko'
    && (payload.mode === 'dsh-agent' || payload.mode === 'on-demand')
    && typeof payload.active === 'boolean'
}

/** Narrow a parsed value to a {@link NeekoToDsh} message. */
export function isNeekoToDsh(message: unknown): message is NeekoToDsh {
  if (typeof message !== 'object' || message === null) return false
  const candidate = message as { type?: unknown }
  switch (candidate.type) {
    case 'session.prompt':
    case 'session.steer':
    case 'session.cancel':
    case 'approval.respond':
    case 'question.respond':
      return true
    default:
      return false
  }
}

/**
 * Wrap one message in the uniform envelope.
 * @param message - the protocol message to carry.
 * @param direction - which side produced it.
 * @param rpcId - correlation id; a fresh one is minted when omitted.
 */
export function wrapEnvelope(message: ProtocolMessage, direction: EnvelopeDirection, rpcId = randomRpcId()): Envelope {
  return {
    rpcId,
    direction,
    timestamp: Date.now(),
    message,
  }
}

/**
 * Parse a received JSON frame into the message it carries. Accepts both the
 * uniform envelope and a bare message (so the first handshake frame may be
 * sent unwrapped for symmetry with older clients). Malformed frames return
 * `undefined`.
 * @param raw - the parsed JSON value received on the wire.
 */
export function unwrapEnvelope(raw: unknown): { rpcId?: string; message: unknown } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const candidate = raw as { rpcId?: unknown; message?: unknown; type?: unknown }
  if (candidate.message !== undefined) {
    return {
      ...(typeof candidate.rpcId === 'string' ? { rpcId: candidate.rpcId } : {}),
      message: candidate.message,
    }
  }
  if (candidate.type !== undefined) return { message: candidate }
  return undefined
}

function randomRpcId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
