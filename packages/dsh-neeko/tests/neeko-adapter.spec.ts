import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { NeekoToDsh } from '../src/protocol.ts'
import { NeekoAdapter, type NeekoAdapterDeps } from '../src/neeko-adapter.ts'

function makeDeps(overrides: Partial<NeekoAdapterDeps> = {}) {
  const deps: NeekoAdapterDeps = {
    getAgent: () => undefined,
    resolveApproval: vi.fn(),
    resolveQuestion: vi.fn(),
    notifyError: vi.fn(),
    ...overrides,
  }
  return deps
}

function fakeAgent(overrides: Partial<Agent> = {}): Agent {
  const followup = vi.fn()
  const steer = vi.fn()
  const cancel = vi.fn()
  const agent = {
    id: SessionId('s1'),
    session: { id: SessionId('s1') },
    followup,
    steer,
    cancel,
    ...overrides,
  } as unknown as Agent
  ;(agent as unknown as { followup: ReturnType<typeof vi.fn> }).followup = followup
  ;(agent as unknown as { steer: ReturnType<typeof vi.fn> }).steer = steer
  ;(agent as unknown as { cancel: ReturnType<typeof vi.fn> }).cancel = cancel
  return agent
}

function send(adapter: NeekoAdapter, message: NeekoToDsh): void {
  adapter.handle(message)
}

describe('NeekoAdapter', () => {
  it('routes session.prompt to agent.followup with a user message', () => {
    const agent = fakeAgent()
    const adapter = new NeekoAdapter(makeDeps({ getAgent: () => agent }))
    send(adapter, { type: 'session.prompt', payload: { sessionId: 's1', message: 'hello' } })
    const { followup } = agent as unknown as { followup: ReturnType<typeof vi.fn> }
    expect(followup).toHaveBeenCalledTimes(1)
    const message = followup.mock.calls[0]?.[0]
    expect(message?.content[0]?.text).toBe('hello')
    expect(message?.source.kind).toBe('user')
  })

  it('routes session.steer to agent.steer', () => {
    const agent = fakeAgent()
    const adapter = new NeekoAdapter(makeDeps({ getAgent: () => agent }))
    send(adapter, { type: 'session.steer', payload: { sessionId: 's1', message: 'keep going' } })
    const { steer } = agent as unknown as { steer: ReturnType<typeof vi.fn> }
    expect(steer).toHaveBeenCalledTimes(1)
  })

  it('routes session.cancel to agent.cancel with a user cause', () => {
    const agent = fakeAgent()
    const adapter = new NeekoAdapter(makeDeps({ getAgent: () => agent }))
    send(adapter, { type: 'session.cancel', payload: { sessionId: 's1' } })
    const { cancel } = agent as unknown as { cancel: ReturnType<typeof vi.fn> }
    expect(cancel).toHaveBeenCalledWith({ kind: 'user' })
  })

  it('forwards approval and question responses', () => {
    const deps = makeDeps({ getAgent: () => fakeAgent() })
    const adapter = new NeekoAdapter(deps)
    send(adapter, { type: 'approval.respond', payload: { requestId: 'r1', decision: 'allowed' } })
    send(adapter, { type: 'question.respond', payload: { requestId: 'r2', answer: 'yes' } })
    expect(deps.resolveApproval).toHaveBeenCalledWith('r1', 'allowed')
    expect(deps.resolveQuestion).toHaveBeenCalledWith('r2', 'yes')
  })

  it('rejects a prompt targeting a different session', () => {
    const deps = makeDeps({ getAgent: () => fakeAgent() })
    const adapter = new NeekoAdapter(deps)
    send(adapter, { type: 'session.prompt', payload: { sessionId: 'other', message: 'hi' } })
    expect(deps.notifyError).toHaveBeenCalledWith('SESSION_MISMATCH', expect.stringContaining('other'))
  })

  it('rejects a prompt with no active session', () => {
    const deps = makeDeps({ getAgent: () => undefined })
    const adapter = new NeekoAdapter(deps)
    send(adapter, { type: 'session.prompt', payload: { sessionId: 's1', message: 'hi' } })
    expect(deps.notifyError).toHaveBeenCalledWith('NO_ACTIVE_SESSION', expect.any(String))
  })

  it('rejects an empty prompt', () => {
    const deps = makeDeps({ getAgent: () => fakeAgent() })
    const adapter = new NeekoAdapter(deps)
    send(adapter, { type: 'session.prompt', payload: { sessionId: 's1', message: '   ' } })
    expect(deps.notifyError).toHaveBeenCalledWith('EMPTY_PROMPT', expect.any(String))
  })
})
