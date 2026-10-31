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

/** 单个 tool 输出字符上限：超过后保留尾部窗口，防无界拼接（内存治理 P2）。 */
const MAX_TOOL_OUTPUT_CHARS = 128 * 1024;

/** tool 输出截断标记。 */
const TOOL_OUTPUT_TRUNCATED_MARK = '\n[output truncated - showing tail]\n';

/** 追加 tool 输出并限制上限：超限后滑动保留尾部窗口，标记仅注入一次。 */
export function clipToolOutput(existing: string | undefined, delta: string): string {
  const next = (existing ?? '') + delta;
  if (next.length <= MAX_TOOL_OUTPUT_CHARS) return next;
  const tail = next.slice(-MAX_TOOL_OUTPUT_CHARS);
  const alreadyMarked = (existing ?? '').includes(TOOL_OUTPUT_TRUNCATED_MARK);
  return (alreadyMarked ? '' : TOOL_OUTPUT_TRUNCATED_MARK) + tail;
}

/** 会话上下文（`context_init` 事件）—— 组合根与视图共用。 */
export interface CtxInfo {
  projectName: string;
  env: string;
  /** 执行根：后端解析出的**执行地址根**（worktree 单元 = 工作树根）。 */
  cwd: string;
  /**
   * 后端回显的执行地址 key（`WorkspaceSession#key` 形态）。
   *
   * 显示与执行同源：视图用它派生「哪个单元」的展示名，而不是拿 tab 自己的地址去补
   * （那会让显示与执行变成两个来源，正好掩盖错配）。
   */
  workspaceKey: string;
}

/**
 * 上下文用量的展示模型（`meta` 事件派生）。
 *
 * - `used`：`context_tokens ?? input_tokens` —— 优先当前占用估计，
 *   compaction 后暂缺时回退会话累计 input。
 * - `limit`：窗口上限，未知为 `null`（UI 只显已用量，不渲染百分比/进度条）。
 * - `cacheHitRate`：三计数齐备且分母 > 0 才派生，缺失即 `undefined`
 *   （隐藏命中率行）。
 */
export interface ContextWindow {
  used: number;
  limit: number | null;
  model: string;
  /** `read / (input + read + write)`，会话累计口径。 */
  cacheHitRate?: number;
}

/**
 * `meta` 事件 → 用量条数据；没有可渲染的数据时返回 `null`（不渲染用量条）。
 *
 * 每一块 UI 只渲染有真实数据支撑的内容：无 usage、或连「已用」值都拿不到
 *（context 与 input 均缺）时返回 `null`，禁止拿 `input + output` 冒充上限
 *（旧实现正是这个误用 —— 已删除）。
 */
export function contextWindowOf(ev: {
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    context_tokens?: number | null;
    context_limit?: number | null;
    cache_read_tokens?: number | null;
    cache_write_tokens?: number | null;
  } | null;
  model?: string | null;
}): ContextWindow | null {
  const usage = ev.usage;
  if (!usage) return null;
  const used = usage.context_tokens ?? usage.input_tokens;
  if (used == null) return null;

  const read = usage.cache_read_tokens;
  const write = usage.cache_write_tokens;
  const input = usage.input_tokens;
  // 三值齐备且分母 > 0 才有命中率；缺任一项时隐藏（不猜）。
  const denom = read != null && write != null && input != null ? input + read + write : 0;
  const cacheHitRate =
    denom > 0 && read != null && write != null && input != null ? read / denom : undefined;

  return {
    used,
    limit: usage.context_limit ?? null,
    model: ev.model ?? 'unknown',
    cacheHitRate,
  };
}
