import { describe, expect, it } from 'vitest';

import type { ConversationMessage } from '@/features/conversation/types';

import { convertHistory } from '../historyConvert';

const msg = (overrides: Partial<ConversationMessage>): ConversationMessage => ({
  role: 'assistant',
  content: '',
  blocks: [],
  timestamp: 1724200000000,
  seq: 0,
  ...overrides,
});

describe('convertHistory — ConversationMessage[] → 只读 ChatMessage[]', () => {
  it('text/thinking block 映射为 text/reasoning block，保持时序', () => {
    const result = convertHistory([
      msg({
        role: 'user',
        content: '帮我看看这个文件',
        blocks: [{ type: 'text', text: '帮我看看这个文件' }],
      }),
      msg({
        role: 'assistant',
        blocks: [
          { type: 'thinking', thinking: '先读文件' },
          { type: 'text', text: '文件内容如下…' },
        ],
      }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[0].blocks).toEqual([
      { kind: 'text', id: expect.any(String), text: '帮我看看这个文件' },
    ]);
    expect(result[1].blocks[0]).toMatchObject({ kind: 'reasoning', text: '先读文件' });
    expect(result[1].blocks[1]).toMatchObject({ kind: 'text', text: '文件内容如下…' });
  });

  it('toolUse/toolResult 配对为结构化 tool block（走卡片渲染管线）', () => {
    const result = convertHistory([
      msg({
        role: 'assistant',
        blocks: [
          { type: 'text', text: '执行命令' },
          { type: 'toolUse', id: 't1', name: 'bash', input: { command: 'cargo test' } },
          { type: 'text', text: '中间说明' },
          { type: 'toolResult', toolUseId: 't1', content: 'ok', isError: false },
        ],
      }),
    ]);

    const kinds = result[0].blocks.map((b) => b.kind);
    // text → tool(配对完成) → text：工具块插回原始时序位置
    expect(kinds).toEqual(['text', 'tool', 'text']);
    const tool = result[0].blocks[1];
    if (tool.kind !== 'tool') throw new Error('expected tool block');
    expect(tool.tool).toMatchObject({
      callId: 't1',
      name: 'bash',
      title: 'cargo test',
      status: 'done',
      output: 'ok',
    });
  });

  it('孤儿 result 按位置合并到前一个未配对 use（消除 opencode 快照碎片化）', () => {
    const result = convertHistory([
      msg({
        role: 'assistant',
        blocks: [
          { type: 'toolUse', id: 'a', name: 'Read', input: { file_path: '/tmp/x.ts' } },
          { type: 'toolResult', toolUseId: 'missing', content: 'stale', isError: true },
        ],
      }),
    ]);

    // 孤儿 result 合并到前一个未配对 use → 单卡带 output
    const tools = result[0].blocks.filter((b) => b.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0].tool).toMatchObject({
      callId: 'a',
      name: 'read_file',
      title: '/tmp/x.ts',
      status: 'failed',
      output: 'stale',
    });
  });

  it('PascalCase 工具名归一为小写以命中卡片分派（Read→read_file 语义由渲染层处理）', () => {
    const result = convertHistory([
      msg({
        role: 'assistant',
        blocks: [{ type: 'toolUse', id: 'b', name: 'Bash', input: { command: 'ls' } }],
      }),
    ]);
    if (result[0].blocks[0].kind !== 'tool') throw new Error('expected tool block');
    expect(result[0].blocks[0].tool.name).toBe('bash');
  });

  it('跨消息配对：tool_use 与 tool_result 分布在相邻消息时仍合为一个卡片（结果回填原位置）', () => {
    const result = convertHistory([
      msg({
        role: 'assistant',
        blocks: [
          { type: 'text', text: '查看技能文件' },
          { type: 'toolUse', id: 'x1', name: 'exec', input: { command: 'cat SKILL.md' } },
        ],
      }),
      msg({
        role: 'assistant',
        blocks: [{ type: 'toolResult', toolUseId: 'x1', content: 'file body', isError: false }],
      }),
    ]);

    // 连续 assistant 消息合并为一轮；命令卡持有回填输出
    expect(result).toHaveLength(1);
    const tools = result[0].blocks.filter((b) => b.kind === 'tool');
    expect(tools).toHaveLength(1);
    if (tools[0].kind !== 'tool') throw new Error('unreachable');
    expect(tools[0].tool).toMatchObject({
      name: 'run_command',
      title: 'cat SKILL.md',
      output: 'file body',
      status: 'done',
    });
    // 不存在孤儿结果块（结果已回填）
    expect(result[0].blocks.filter((b) => b.kind === 'tool')).toHaveLength(1);
  });

  it('命令类别名归一：exec/shell/command → run_command 命中 CommandCard 分派', () => {
    for (const raw of ['exec', 'Shell', 'command', 'exec_command']) {
      const result = convertHistory([
        msg({
          role: 'assistant',
          blocks: [{ type: 'toolUse', id: raw, name: raw, input: { command: 'ls' } }],
        }),
      ]);
      if (result[0].blocks[0].kind !== 'tool') throw new Error('unreachable');
      expect(result[0].blocks[0].tool.name).toBe('run_command');
    }
  });

  it('codex 真实结构：function_call 与 output 为独立消息，call_id 配对后命令卡完整', () => {
    // 实测 ~/.codex/sessions rollout：工具名 exec_command，call/output 各自成消息
    const result = convertHistory([
      msg({
        role: 'assistant',
        content: '[tool:exec_command]',
        blocks: [
          { type: 'toolUse', id: 'call_abc', name: 'exec_command', input: { command: 'cat a.md' } },
        ],
      }),
      msg({
        role: 'assistant',
        content: '',
        blocks: [
          {
            type: 'toolResult',
            toolUseId: 'call_abc',
            content: 'Chunk ID: 0540c4\nWall time: 0.1s\nOutput:\nfile body',
            isError: false,
          },
        ],
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].blocks.filter((b) => b.kind === 'tool')).toHaveLength(1);
    const tool = result[0].blocks.find((b) => b.kind === 'tool');
    if (tool?.kind !== 'tool') throw new Error('unreachable');
    expect(tool.tool).toMatchObject({
      name: 'run_command',
      title: 'cat a.md',
      output: expect.stringContaining('file body'),
      status: 'done',
    });
  });

  it('blocks 为空时回退到 content 字段；未知 role 归入 system', () => {
    const result = convertHistory([
      msg({ role: 'assistant', content: '裸文本消息', blocks: [] }),
      msg({ role: 'weird-role', content: 'x', blocks: [{ type: 'text', text: 'x' }] }),
    ]);

    expect(result[0].blocks[0]).toMatchObject({ kind: 'text', text: '裸文本消息' });
    expect(result[1].role).toBe('system');
  });

  it('时间戳转换为展示时间字符串（ts）', () => {
    const [first] = convertHistory([msg({ role: 'user', content: 'hi', blocks: [] })]);
    expect(typeof first.ts).toBe('string');
    expect(first.ts!.length).toBeGreaterThan(0);
  });

  it('连续 assistant 消息合并为一条（消除思考过程/工具组的碎片化交替）', () => {
    const result = convertHistory([
      msg({ role: 'assistant', blocks: [{ type: 'thinking', thinking: '先想' }] }),
      msg({ role: 'assistant', blocks: [{ type: 'text', text: '回答' }] }),
      msg({ role: 'assistant', blocks: [{ type: 'toolUse', id: 't', name: 'bash', input: {} }] }),
      msg({ role: 'assistant', blocks: [{ type: 'thinking', thinking: '再想' }] }),
      msg({ role: 'user', blocks: [{ type: 'text', text: '下一条' }] }),
    ]);

    // 4 条连续 assistant → 1 条；user 是边界保持独立
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('assistant');
    expect(result[0].blocks).toHaveLength(4);
    // thinking 归并仅发生在相邻时；被 text/tool 分隔的保持各自时序位
    expect(result[0].blocks).toHaveLength(4);
    const reasonings = result[0].blocks.filter((b) => b.kind === 'reasoning');
    expect(reasonings).toHaveLength(2);
    expect(reasonings[0]).toMatchObject({ text: '先想' });
    expect(reasonings[1]).toMatchObject({ text: '再想' });
    expect(result[1].role).toBe('user');
  });

  it('空 title 的工具行显示名称占位而非空白', () => {
    const result = convertHistory([
      msg({
        role: 'assistant',
        blocks: [{ type: 'toolUse', id: 'o1', name: 'exec_command', input: {} }],
      }),
    ]);
    const tool = result[0].blocks[0];
    if (tool.kind !== 'tool') throw new Error('unreachable');
    expect(tool.tool.title.length).toBeGreaterThan(0);
  });

  it('同 callId 重复 ToolUse（opencode 快照）去重为单卡并保留终态 output', () => {
    // opencode db：running 快照先发 ToolUse(title=命令)，completed 快照再发 ToolUse+ToolResult
    const result = convertHistory([
      msg({
        role: 'assistant',
        blocks: [
          { type: 'toolUse', id: 'dup1', name: 'bash', input: { command: 'cat README.md' } },
        ],
      }),
      msg({
        role: 'assistant',
        blocks: [
          { type: 'toolUse', id: 'dup1', name: 'bash', input: { command: 'cat README.md' } },
          { type: 'toolResult', toolUseId: 'dup1', content: 'file content here', isError: false },
        ],
      }),
    ]);
    // 合并为一条 assistant 消息，且仅一个 tool 块（含 output）
    expect(result).toHaveLength(1);
    const tools = result[0].blocks.filter((b) => b.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0].tool.output).toBe('file content here');
    expect(tools[0].tool.status).toBe('done');
  });
});
