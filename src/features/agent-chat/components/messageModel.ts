import type { TodoItem } from '@/shared/types/agentChat';

import type { PendingDelta } from '../hooks/useDeltaBatcher';
import type { FileChangeSummary, ToolCard, WorkedSummary } from '../types';
import { formatChatTime } from '../utils/chatFormat';

/**
 * 消息内容块 —— 按事件到达顺序排列，保持流式语义。
 * 文本和工具调用不再分桶，而是按 stream 到达的时序混合排列，
 * 这样 "让我读取文件 → 读取工具 → 继续解释" 的流式效果得以保留。
 */
export type ContentBlock =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'tool'; id: string; tool: ToolCard }
  | { kind: 'todos'; id: string; todos: TodoItem[] }
  | { kind: 'diff'; id: string; diff: FileChangeSummary }
  | { kind: 'worked'; id: string; worked: WorkedSummary };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  blocks: ContentBlock[];
  ts?: string;
}

/** 渲染项：单个 block，或相邻 tool blocks 合并出的工具组（交由 WorkRows 分组折叠）。 */
export type RenderItem = ContentBlock | ToolCard[];

export interface PendingUserInput {
  turnId: string;
  prompt: string;
  options?: string[];
}

export interface Attachment {
  id: string;
  type: 'FILE' | 'SKILL';
  name: string;
  label?: string;
}

let msgSeq = 0;
export const nextMsgId = () => `m_${Date.now()}_${msgSeq++}`;

let blockSeq = 0;
export const nextBlockId = () => `b_${Date.now()}_${blockSeq++}`;

/**
 * 相邻 tool blocks 合并为一组：每个 tool_start 独立成 block，
 * 若逐 block 渲染，WorkRows 的 chunkToolGroups 永远只收到 1 个工具，
 * 分组折叠（≥2 连续同类工具 → 摘要行）对跨 block 场景失效。
 */
export function mergeAdjacentToolBlocks(blocks: ContentBlock[]): RenderItem[] {
  const items: RenderItem[] = [];
  let toolBuf: ToolCard[] = [];
  const flush = () => {
    if (toolBuf.length > 0) {
      items.push(toolBuf);
      toolBuf = [];
    }
  };
  for (const b of blocks) {
    if (b.kind === 'tool') {
      toolBuf.push(b.tool);
    } else {
      flush();
      items.push(b);
    }
  }
  flush();
  return items;
}

/**
 * 把流式增量 append 到最后一条 assistant 消息（无则新建）。
 * 若最后一个 block 与当前 kind 同类型则合并（减少 block 数量），否则新建 block。
 * 批处理 flush 时逐条应用。
 */
export function appendDelta(
  prev: ChatMessage[],
  kind: PendingDelta['kind'],
  delta: string,
): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last && last.role === 'assistant') {
    const lastBlock = last.blocks[last.blocks.length - 1];
    // 同类型 block 合并：连续 text/reasoning delta 合并为一个块，避免碎片化
    if (
      lastBlock &&
      lastBlock.kind === kind &&
      (lastBlock.kind === 'text' || lastBlock.kind === 'reasoning')
    ) {
      return prev.map((m, i) =>
        i === prev.length - 1
          ? {
              ...m,
              blocks: m.blocks.map((b, j) =>
                j === m.blocks.length - 1 && (b.kind === 'text' || b.kind === 'reasoning')
                  ? { ...b, text: b.text + delta }
                  : b,
              ),
            }
          : m,
      );
    }
    // 不同类型：新建 block
    const newBlock: ContentBlock =
      kind === 'text'
        ? { kind: 'text', id: nextBlockId(), text: delta }
        : { kind: 'reasoning', id: nextBlockId(), text: delta };
    return prev.map((m, i) =>
      i === prev.length - 1 ? { ...m, blocks: [...m.blocks, newBlock] } : m,
    );
  }
  // 无 assistant 消息：新建消息 + 首个 block
  const newBlock: ContentBlock =
    kind === 'text'
      ? { kind: 'text', id: nextBlockId(), text: delta }
      : { kind: 'reasoning', id: nextBlockId(), text: delta };
  return [
    ...prev,
    {
      id: nextMsgId(),
      role: 'assistant',
      blocks: [newBlock],
      ts: formatChatTime(new Date()),
    },
  ];
}
