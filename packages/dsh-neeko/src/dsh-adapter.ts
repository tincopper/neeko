/**
 * DSH adapter: translates DSH session-log events into dsh-neeko protocol
 * messages, and reconstructs a stable conversation history for `session.init`.
 *
 * Translation is intentionally stateless per event: each `assistant/chunk`
 * row becomes its own `text.delta` / `thinking.delta` (the client accumulates
 * deltas), each `tool/call` a `tool.start`, each `tool/result` a `tool.end`.
 * Only {@link buildHistory} needs to accumulate across rows.
 *
 * @module dsh-neeko/dsh-adapter
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { DshToNeeko, HistoryItem } from './protocol.ts'

/** Stable assistant message id for one (turn, step) — matches live deltas. */
function assistantMessageId(turn: number, step: number): string {
  return `assistant:${turn}:${step}`
}

/**
 * Translate one appended session event into the protocol messages Neeko
 * should see. Unknown or presentation-only rows produce nothing.
 * @param event - the appended session event.
 * @returns the protocol messages to send, in order.
 */
export function translateEvent(event: SessionEvent): DshToNeeko[] {
  switch (event.type) {
    case 'assistant/chunk': {
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') {
        return [{
          type: 'text.delta',
          payload: {
            chunk: chunk.text,
            messageId: assistantMessageId(event.data.turn, event.data.step),
          },
        }]
      }
      if (chunk.type === 'reasoning-delta') {
        return [{ type: 'thinking.delta', payload: { chunk: chunk.text } }]
      }
      return []
    }
    case 'tool/call': {
      return [{
        type: 'tool.start',
        payload: {
          taskId: String(event.data.callId),
          toolName: event.data.name,
          args: parseToolArguments(event.data.arguments),
        },
      }]
    }
    case 'tool/result': {
      const failed = event.data.error !== undefined
      const diff = extractDiff(event.data.meta)
      return [{
        type: 'tool.end',
        payload: {
          taskId: String(event.data.message.source.callId),
          status: failed ? 'failed' : 'success',
          result: toolResultText(event.data.message.content),
          ...(diff === undefined ? {} : { diff }),
        },
      }]
    }
    default:
      return []
  }
}

/**
 * Reconstruct the ordered conversation history for one session's log, for the
 * `session.init` push. Assistant text is assembled from stream chunks so the
 * history matches what the live stream delivered; tool rows pair their call
 * with the later result.
 * @param events - the session's event log, in seq order.
 * @returns protocol history rows, in chronological order.
 */
export function buildHistory(events: readonly SessionEvent[]): HistoryItem[] {
  const items: HistoryItem[] = []
  let buffer: { turn: number; step: number; text: string; thinking: string; createdAt: number } | undefined
  const toolStarts = new Map<string, { name: string; args: unknown; createdAt: number }>()

  const flush = (): void => {
    if (buffer === undefined) return
    if (buffer.text !== '' || buffer.thinking !== '') {
      items.push({
        kind: 'assistant',
        messageId: assistantMessageId(buffer.turn, buffer.step),
        text: buffer.text,
        thinking: buffer.thinking,
        createdAt: buffer.createdAt,
      })
    }
    buffer = undefined
  }

  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        flush()
        const text = textFromBlocks(event.data.content)
        if (text !== '') {
          items.push({
            kind: 'user',
            messageId: String(event.data.id),
            content: text,
            createdAt: event.time,
          })
        }
        break
      }
      case 'assistant/chunk': {
        const chunk = event.data.chunk
        if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') break
        if (buffer === undefined || buffer.turn !== event.data.turn || buffer.step !== event.data.step) {
          flush()
          buffer = { turn: event.data.turn, step: event.data.step, text: '', thinking: '', createdAt: event.time }
        }
        if (chunk.type === 'text-delta') buffer.text += chunk.text
        else buffer.thinking += chunk.text
        break
      }
      case 'assistant/message': {
        // The chunks already accumulated this step's item; only fall back to
        // the assembled message when no chunk buffer covers the same step.
        const covered = buffer !== undefined && buffer.turn === event.data.turn && buffer.step === event.data.step
        flush()
        if (!covered) {
          const text = textFromBlocks(event.data.message.content)
          const thinking = thinkingFromBlocks(event.data.message.content)
          if (text !== '' || thinking !== '') {
            items.push({
              kind: 'assistant',
              messageId: assistantMessageId(event.data.turn, event.data.step),
              text,
              thinking,
              createdAt: event.time,
            })
          }
        }
        break
      }
      case 'tool/call': {
        flush()
        toolStarts.set(String(event.data.callId), {
          name: event.data.name,
          args: parseToolArguments(event.data.arguments),
          createdAt: event.time,
        })
        break
      }
      case 'tool/result': {
        flush()
        const taskId = String(event.data.message.source.callId)
        const start = toolStarts.get(taskId)
        if (start === undefined) break
        toolStarts.delete(taskId)
        items.push({
          kind: 'tool',
          taskId,
          name: start.name,
          args: start.args,
          result: toolResultText(event.data.message.content),
          status: event.data.error !== undefined ? 'failed' : 'success',
          createdAt: start.createdAt,
        })
        break
      }
      default:
        break
    }
  }
  flush()
  return items
}

/** Parse a tool call's raw argument JSON; falls back to the raw string. */
function parseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

/** Join the text blocks of a message's content, skipping tool-result nesting. */
function textFromBlocks(content: readonly ContentBlock[]): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

/** Join the reasoning blocks of a message's content. */
function thinkingFromBlocks(content: readonly ContentBlock[]): string {
  return content
    .filter((block) => block.type === 'reasoning')
    .map((block) => block.text)
    .join('')
}

/** Extract the user-facing text of a tool result message. */
function toolResultText(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') {
      parts.push(block.text)
    } else if (block.type === 'tool-result') {
      parts.push(textFromBlocks(block.content))
    }
  }
  return parts.join('\n')
}

/**
 * Narrow the tool-private `meta` to the protocol's diff shape. The fs tools
 * attach `{ diffs: FileDiff[] }` here; unknown shapes are ignored defensively.
 */
function extractDiff(meta: unknown): { filePath: string; patch: string } | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const diffs = (meta as { diffs?: unknown }).diffs
  if (!Array.isArray(diffs)) return undefined
  const first = diffs[0]
  if (typeof first !== 'object' || first === null) return undefined
  const candidate = first as { path?: unknown; newText?: unknown; oldText?: unknown }
  if (typeof candidate.path !== 'string') return undefined
  return {
    filePath: candidate.path,
    patch: typeof candidate.newText === 'string' ? candidate.newText : typeof candidate.oldText === 'string' ? candidate.oldText : '',
  }
}
