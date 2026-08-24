import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../components/messageModel';
import { appendBlock, appendCommandBlock, attachFileDiff, findToolBlock } from '../streamReducers';

function assistantMsg(id: string, blocks: ChatMessage['blocks']): ChatMessage {
  return { id, role: 'assistant', blocks };
}

function textBlock(id: string, text: string): ChatMessage['blocks'][number] {
  return { kind: 'text', id, text };
}

function toolBlock(
  id: string,
  callId: string,
  status: 'running' | 'done' | 'failed' = 'running',
): ChatMessage['blocks'][number] {
  return { kind: 'tool', id, tool: { callId, name: 'edit_file', title: 'edit', status } };
}

describe('attachFileDiff', () => {
  it('新建消息 + diff block（无 assistant 消息时）', () => {
    const prev: ChatMessage[] = [];
    const next = attachFileDiff(prev, 'src/a.ts', '+1\n-1');
    expect(next).toHaveLength(1);
    expect(next[0].role).toBe('assistant');
    expect(next[0].blocks[0]).toMatchObject({
      kind: 'diff',
      diff: { files: [{ path: 'src/a.ts', add: 1, del: 1 }] },
    });
  });

  it('末尾 assistant 消息追加 diff block', () => {
    const prev = [assistantMsg('m1', [textBlock('b1', 'hello')])];
    const next = attachFileDiff(prev, 'src/a.ts', '+1');
    expect(next[0].blocks).toHaveLength(2);
    expect(next[0].blocks[1]).toMatchObject({
      kind: 'diff',
      diff: { files: [{ path: 'src/a.ts', add: 1, del: 0 }] },
    });
  });

  it('末尾已是 diff block 时合并（同 path 更新，异 path 追加）', () => {
    const prev = [
      assistantMsg('m1', [
        {
          kind: 'diff',
          id: 'b1',
          diff: {
            files: [{ path: 'src/a.ts', add: 1, del: 0 }],
            diffs: [{ path: 'src/a.ts', diff: '+1' }],
          },
        },
      ]),
    ];
    // 同 path → 更新（diffStats 按行计数：'+a\n+b' = 2 行新增）
    const merged = attachFileDiff(prev, 'src/a.ts', '+a\n+b');
    expect(merged[0].blocks[0]).toMatchObject({
      diff: {
        files: [{ path: 'src/a.ts', add: 2 }],
        diffs: [{ path: 'src/a.ts', diff: '+a\n+b' }],
      },
    });
    // 异 path → 追加
    const appended = attachFileDiff(prev, 'src/b.ts', '+c');
    const block = appended[0].blocks[0];
    expect(block.kind).toBe('diff');
    if (block.kind === 'diff') {
      expect(block.diff.files).toHaveLength(2);
      expect(block.diff.files[1]).toEqual({ path: 'src/b.ts', add: 1, del: 0 });
    }
  });

  it('最后一条不是 assistant 时新建消息', () => {
    const prev = [{ id: 'u1', role: 'user' as const, blocks: [textBlock('b1', 'q')] }];
    const next = attachFileDiff(prev, 'src/a.ts', '+1');
    expect(next).toHaveLength(2);
    expect(next[1].role).toBe('assistant');
  });
});

describe('findToolBlock', () => {
  it('跨消息找到匹配 callId 的 tool block', () => {
    const prev = [
      assistantMsg('m1', [toolBlock('b1', 'call_1')]),
      assistantMsg('m2', [toolBlock('b2', 'call_2')]),
    ];
    expect(findToolBlock(prev, 'call_2')).toEqual({ msgIndex: 1, blockIndex: 0 });
  });

  it('找不到时返回 null', () => {
    const prev = [assistantMsg('m1', [toolBlock('b1', 'call_1')])];
    expect(findToolBlock(prev, 'call_x')).toBeNull();
  });
});

describe('appendBlock', () => {
  it('末尾 assistant 消息时追加到其 blocks', () => {
    const prev = [assistantMsg('m1', [textBlock('b1', 'hello')])];
    const next = appendBlock(prev, toolBlock('b2', 'call_1'));
    expect(next[0].blocks).toHaveLength(2);
    expect(next[0].blocks[1]).toMatchObject({ kind: 'tool' });
  });

  it('末尾不是 assistant 时新建消息', () => {
    const prev = [{ id: 'u1', role: 'user' as const, blocks: [textBlock('b1', 'q')] }];
    const next = appendBlock(prev, toolBlock('b2', 'call_1'));
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ role: 'assistant', blocks: [{ kind: 'tool' }] });
  });
});

describe('appendCommandBlock', () => {
  it('末尾 text block 前补段落分隔', () => {
    const prev = [assistantMsg('m1', [textBlock('b1', 'run')])];
    const next = appendCommandBlock(prev, toolBlock('b2', 'call_1'));
    expect(next[0].blocks).toHaveLength(2);
    const first = next[0].blocks[0];
    expect(first.kind).toBe('text');
    if (first.kind === 'text') {
      expect(first.text).toContain('\n\n');
    }
    expect(next[0].blocks[1]).toMatchObject({ kind: 'tool' });
  });

  it('末尾不是 text block 时直接追加', () => {
    const prev = [assistantMsg('m1', [toolBlock('b1', 'call_0')])];
    const next = appendCommandBlock(prev, toolBlock('b2', 'call_1'));
    expect(next[0].blocks).toHaveLength(2);
    expect(next[0].blocks[1]).toMatchObject({ kind: 'tool' });
  });

  it('末尾不是 assistant 时新建消息', () => {
    const prev: ChatMessage[] = [];
    const next = appendCommandBlock(prev, toolBlock('b2', 'call_1'));
    expect(next).toHaveLength(1);
    expect(next[0].role).toBe('assistant');
  });
});
