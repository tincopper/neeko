import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { buildHistory, translateEvent } from '../src/dsh-adapter.ts'

/** Build a session event object the way the runtime logs them. */
function event<T extends SessionEventType>(type: T, seq: number, data: SessionEventMap[T], surface = false): Extract<SessionEvent, { type: T }> {
  return { type, seq, time: seq * 1000, data, ...(surface ? { surfaceOp: 'append' } : {}) } as Extract<SessionEvent, { type: T }>
}

const textChunk = (text: string, index = 0) => ({ type: 'text-delta' as const, index, text })
const reasoningChunk = (text: string, index = 0) => ({ type: 'reasoning-delta' as const, index, text })

describe('translateEvent', () => {
  it('maps text chunks to text.delta with a stable message id', () => {
    const messages = translateEvent(event('assistant/chunk', 0, { turn: 2, step: 3, chunk: textChunk('hello') }))
    expect(messages).toEqual([{
      type: 'text.delta',
      payload: { chunk: 'hello', messageId: 'assistant:2:3' },
    }])
  })

  it('maps reasoning chunks to thinking.delta', () => {
    const messages = translateEvent(event('assistant/chunk', 0, { turn: 1, step: 1, chunk: reasoningChunk('hmm') }))
    expect(messages).toEqual([{ type: 'thinking.delta', payload: { chunk: 'hmm' } }])
  })

  it('ignores non-stream chunks', () => {
    expect(translateEvent(event('assistant/chunk', 0, { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'stop' } } }))).toEqual([])
  })

  it('maps a tool call to tool.start with parsed arguments', () => {
    const messages = translateEvent(event('tool/call', 0, {
      turn: 1,
      step: 1,
      callId: CallId('c1'),
      name: 'bash',
      arguments: '{"command":"ls"}',
    }))
    expect(messages).toEqual([{
      type: 'tool.start',
      payload: { taskId: 'c1', toolName: 'bash', args: { command: 'ls' } },
    }])
  })

  it('keeps unparsable tool arguments as raw text', () => {
    const messages = translateEvent(event('tool/call', 0, {
      turn: 1,
      step: 1,
      callId: CallId('c2'),
      name: 'bash',
      arguments: 'not-json',
    }))
    expect(messages[0]?.type).toBe('tool.start')
    if (messages[0]?.type === 'tool.start') expect(messages[0].payload.args).toBe('not-json')
  })

  it('maps a successful tool result to tool.end', () => {
    const result = createToolResultMessage({
      callId: CallId('c1'),
      content: [{ type: 'text', text: 'done' }],
      isError: false,
    })
    const messages = translateEvent(event('tool/result', 1, { turn: 1, step: 1, message: result }))
    expect(messages).toEqual([{
      type: 'tool.end',
      payload: { taskId: 'c1', status: 'success', result: 'done' },
    }])
  })

  it('maps a failed tool result to tool.end with failed status', () => {
    const result = createToolResultMessage({
      callId: CallId('c1'),
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
    })
    const messages = translateEvent(event('tool/result', 1, {
      turn: 1,
      step: 1,
      message: result,
      error: { name: 'Error', code: 'E_BOOM' },
    }))
    expect(messages).toEqual([{
      type: 'tool.end',
      payload: { taskId: 'c1', status: 'failed', result: 'boom' },
    }])
  })

  it('extracts the fs diff from tool meta', () => {
    const result = createToolResultMessage({
      callId: CallId('c1'),
      content: [{ type: 'text', text: 'changed' }],
      isError: false,
    })
    const messages = translateEvent(event('tool/result', 1, {
      turn: 1,
      step: 1,
      message: result,
      meta: { diffs: [{ path: 'a.txt', oldText: 'a', newText: 'b' }] },
    }))
    expect(messages[0]?.type).toBe('tool.end')
    if (messages[0]?.type === 'tool.end') {
      expect(messages[0].payload.diff).toEqual({ filePath: 'a.txt', patch: 'b' })
    }
  })

  it('ignores unrelated events', () => {
    expect(translateEvent(event('turn/start', 0, { turn: 1 }))).toEqual([])
    expect(translateEvent(event('todo/write', 0, { todos: [] }))).toEqual([])
  })
})

describe('buildHistory', () => {
  it('assembles user, assistant, and tool rows in order', () => {
    const user = createUserMessage({
      content: [{ type: 'text', text: 'List files' }],
      source: { kind: 'user' },
    })
    const assistant = createAssistantMessage({
      content: [{ type: 'text', text: 'Here they are.' }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
    const toolResult = createToolResultMessage({
      callId: CallId('c1'),
      content: [{ type: 'text', text: 'a.txt' }],
      isError: false,
    })
    const events: SessionEvent[] = [
      event('user/message', 0, user, true),
      event('assistant/chunk', 1, { turn: 1, step: 1, chunk: reasoningChunk('Let me check') }),
      event('assistant/chunk', 2, { turn: 1, step: 1, chunk: textChunk('Here ') }),
      event('assistant/chunk', 3, { turn: 1, step: 1, chunk: textChunk('they are.') }),
      event('assistant/message', 4, { turn: 1, step: 1, message: assistant }, true),
      event('tool/call', 5, { turn: 1, step: 2, callId: CallId('c1'), name: 'bash', arguments: '{"command":"ls"}' }),
      event('tool/result', 6, { turn: 1, step: 2, message: toolResult }, true),
    ]

    const history = buildHistory(events)
    expect(history).toEqual([
      { kind: 'user', messageId: String(user.id), content: 'List files', createdAt: 0 },
      {
        kind: 'assistant',
        messageId: 'assistant:1:1',
        text: 'Here they are.',
        thinking: 'Let me check',
        createdAt: 1000,
      },
      {
        kind: 'tool',
        taskId: 'c1',
        name: 'bash',
        args: { command: 'ls' },
        result: 'a.txt',
        status: 'success',
        createdAt: 5000,
      },
    ])
  })

  it('pairs a tool call with its later result and drops a dangling call', () => {
    const result = createToolResultMessage({
      callId: CallId('c1'),
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    })
    const events: SessionEvent[] = [
      event('assistant/chunk', 0, { turn: 1, step: 1, chunk: textChunk('partial') }),
      event('tool/call', 1, { turn: 1, step: 2, callId: CallId('c1'), name: 'bash', arguments: '{}' }),
      event('tool/result', 2, { turn: 1, step: 2, message: result }, true),
    ]
    expect(buildHistory(events).map((item) => item.kind)).toEqual(['assistant', 'tool'])
    expect(buildHistory([event('tool/call', 0, { turn: 1, step: 1, callId: CallId('c9'), name: 'bash', arguments: '{}' })]).map((item) => item.kind)).toEqual([])
  })

  it('skips a tool result whose call is out of history', () => {
    const result = createToolResultMessage({
      callId: CallId('missing'),
      content: [{ type: 'text', text: 'orphan' }],
      isError: false,
    })
    const history = buildHistory([event('tool/result', 0, { turn: 1, step: 1, message: result }, true)])
    expect(history).toEqual([])
  })
})
