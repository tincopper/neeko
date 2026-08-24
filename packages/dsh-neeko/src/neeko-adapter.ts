/**
 * Neeko adapter: translates Neeko→DSH protocol messages into live DSH API
 * calls. The bridge supplies the active agent and the approval/question
 * resolvers; this class owns the *mapping* and never touches the wire.
 *
 * @module dsh-neeko/neeko-adapter
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { NeekoToDsh } from './protocol.ts'

/** The live DSH surface the adapter drives, supplied by the bridge. */
export interface NeekoAdapterDeps {
  /** Resolve the agent currently bound to the Neeko connection. */
  getAgent(): Agent | undefined
  /** Resolve a pending approval waiter by the protocol `requestId`. */
  resolveApproval(requestId: string, decision: 'allowed' | 'rejected'): void
  /** Resolve a pending question waiter by the protocol `requestId`. */
  resolveQuestion(requestId: string, answer: string): void
  /** Report a protocol-level failure back to Neeko. */
  notifyError(code: string, message: string): void
}

/** Maps Neeko protocol messages onto the DSH agent/session API. */
export class NeekoAdapter {
  constructor(private readonly deps: NeekoAdapterDeps) {}

  /** Route one decoded client message to the matching DSH call. */
  handle(message: NeekoToDsh): void {
    switch (message.type) {
      case 'session.prompt':
        this.prompt(message.payload.sessionId, message.payload.message)
        break
      case 'session.steer':
        this.steer(message.payload.sessionId, message.payload.message)
        break
      case 'session.cancel':
        this.cancel(message.payload.sessionId)
        break
      case 'approval.respond':
        this.deps.resolveApproval(message.payload.requestId, message.payload.decision)
        break
      case 'question.respond':
        this.deps.resolveQuestion(message.payload.requestId, message.payload.answer)
        break
    }
  }

  private prompt(sessionId: string, message: string): void {
    const agent = this.requireSession(sessionId)
    if (agent === undefined) return
    if (message.trim() === '') {
      this.deps.notifyError('EMPTY_PROMPT', 'session.prompt requires a non-empty message')
      return
    }
    agent.followup(this.userMessage(message))
  }

  private steer(sessionId: string, message: string): void {
    const agent = this.requireSession(sessionId)
    if (agent === undefined) return
    if (message.trim() === '') {
      this.deps.notifyError('EMPTY_PROMPT', 'session.steer requires a non-empty message')
      return
    }
    agent.steer(this.userMessage(message))
  }

  private cancel(sessionId: string): void {
    const agent = this.requireSession(sessionId)
    if (agent === undefined) return
    agent.cancel({ kind: 'user' })
  }

  /** Resolve the active agent and reject a stale/missing session id. */
  private requireSession(sessionId: string): Agent | undefined {
    const agent = this.deps.getAgent()
    if (agent === undefined) {
      this.deps.notifyError('NO_ACTIVE_SESSION', 'no active session on this connection')
      return undefined
    }
    if (agent.session.id !== SessionId(sessionId)) {
      this.deps.notifyError('SESSION_MISMATCH', `request targets ${sessionId}, active session is ${agent.session.id}`)
      return undefined
    }
    return agent
  }

  private userMessage(text: string) {
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    })
  }
}
