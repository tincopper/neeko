import { describe, expect, it } from 'vitest';

import type { ConversationMessage } from '@/features/conversation/types';

import { buildConversationStats } from '../conversationStats';

function msg(seq: number, blocks: ConversationMessage['blocks']): ConversationMessage {
  return { seq, role: seq % 2 === 0 ? 'user' : 'assistant', content: '', blocks, timestamp: seq };
}

describe('buildConversationStats', () => {
  it('统计消息数 / 工具调用 / thinking，并保留侧边栏回跳定位', () => {
    const messages = [
      msg(0, [{ type: 'text', text: 'hi' }]),
      msg(1, [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'toolUse', id: 't1', name: 'read_file', input: { path: 'a.ts' } },
        { type: 'toolUse', id: 't2', name: 'grep', input: { pattern: 'x' } },
      ]),
      msg(2, [{ type: 'toolResult', toolUseId: 't1', content: 'ok', isError: false }]),
    ];

    const stats = buildConversationStats(messages);
    expect(stats.totalMessages).toBe(3);
    expect(stats.toolCalls).toBe(2);
    expect(stats.thinkingCount).toBe(1);
    expect(stats.uniqueTools).toEqual(['read_file', 'grep']);
    // 回跳定位：消息下标 + 块下标（侧边栏点击 scrollToMessage 依赖它）
    expect(stats.toolCallList).toEqual([
      { msgIdx: 1, blockIdx: 1, name: 'read_file', input: { path: 'a.ts' } },
      { msgIdx: 1, blockIdx: 2, name: 'grep', input: { pattern: 'x' } },
    ]);
  });

  it('无 blocks 的消息被跳过，不产生工具调用也不抛错', () => {
    const messages = [
      { seq: 0, role: 'user', content: 'no blocks', blocks: undefined, timestamp: 0 },
    ] as unknown as ConversationMessage[];

    const stats = buildConversationStats(messages);
    expect(stats).toEqual({
      totalMessages: 1,
      toolCalls: 0,
      thinkingCount: 0,
      uniqueTools: [],
      toolCallList: [],
    });
  });

  it('同名工具只进 uniqueTools 一次（计数仍按调用次数）', () => {
    const messages = [
      msg(1, [
        { type: 'toolUse', id: 'a', name: 'grep', input: {} },
        { type: 'toolUse', id: 'b', name: 'grep', input: {} },
      ]),
    ];

    const stats = buildConversationStats(messages);
    expect(stats.toolCalls).toBe(2);
    expect(stats.uniqueTools).toEqual(['grep']);
  });

  it('空列表返回零值（顶部信息条不渲染计数）', () => {
    expect(buildConversationStats([])).toEqual({
      totalMessages: 0,
      toolCalls: 0,
      thinkingCount: 0,
      uniqueTools: [],
      toolCallList: [],
    });
  });
});
