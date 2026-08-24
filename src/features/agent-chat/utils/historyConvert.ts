import type { ConversationMessage, MessageBlock } from '@/features/conversation/types';

import type { ChatMessage, ContentBlock } from '../components/messageModel';
import { nextBlockId, nextMsgId } from '../components/messageModel';
import type { ToolCard } from '../types';

import { formatChatTime } from './chatFormat';
import { normalizeToolName } from './toolNames';

/** 从工具入参中提取人类可读标题（优先 command / 文件路径类字段）。 */
function toolTitle(input: unknown): string {
  if (typeof input === 'string') return input;
  if (typeof input !== 'object' || input === null) return '';
  const rec = input as Record<string, unknown>;
  const candidate =
    rec.command ??
    rec.cmd ??
    rec.file_path ??
    rec.filePath ??
    rec.path ??
    rec.pattern ??
    rec.query ??
    rec.url;
  if (typeof candidate === 'string') return candidate;
  const firstString = Object.values(rec).find((v) => typeof v === 'string');
  return typeof firstString === 'string' ? firstString : JSON.stringify(rec).slice(0, 120);
}

interface ToolPairingState {
  /** 按出现顺序的 tool block（含未配对的）。 */
  out: Array<{ card: ToolCard; block: ContentBlock }>;
  /** toolUseId → out 下标，用于 toolResult 回填。 */
  indexByCallId: Map<string, number>;
  /** 未配对的 ToolUse callId（按出现顺序），供孤儿 result 按位置合并。 */
  pendingUses: string[];
}

/** @returns 是否新建了卡片（新建 → 需推入时序骨架；去重更新 → 不需要）。 */
function pushToolUse(
  block: Extract<MessageBlock, { type: 'toolUse' }>,
  state: ToolPairingState,
): boolean {
  const name = normalizeToolName(block.name);
  // 同 callId 去重：opencode 快照对同一工具发 running + completed 两次 ToolUse，
  // 保留首次时序位，用后到的快照更新 title/input（后者更完整）。
  const existing = state.indexByCallId.get(block.id);
  if (existing !== undefined) {
    const card = state.out[existing].card;
    card.title = toolTitle(block.input) || name;
    card.name = name;
    return false;
  }
  const card: ToolCard = {
    callId: block.id,
    name,
    title: toolTitle(block.input) || name,
    status: 'done',
  };
  state.indexByCallId.set(block.id, state.out.length);
  state.pendingUses.push(block.id); // 记录未配对的 use，供孤儿 result 按位置合并
  state.out.push({
    card,
    block: { kind: 'tool', id: nextBlockId(), tool: card },
  });
  return true;
}

/** @returns 是否向 out 追加了新块（孤儿结果需要进时序骨架）。 */
function pushToolResult(
  block: Extract<MessageBlock, { type: 'toolResult' }>,
  state: ToolPairingState,
): boolean {
  const at = state.indexByCallId.get(block.toolUseId);
  if (at !== undefined) {
    const { card } = state.out[at];
    card.output = block.content || card.output;
    card.status = block.isError ? 'failed' : 'done';
    state.pendingUses = state.pendingUses.filter((id) => id !== block.toolUseId);
    return false;
  }
  // 孤儿结果：opencode 快照的 running part 与 completed part 使用不同 callID，
  // 精确配对失败 → 按位置合并到最近一个未配对的 ToolUse（同物理工具）。
  const pendingIdx = state.pendingUses.length - 1;
  if (pendingIdx >= 0) {
    const useCallId = state.pendingUses[pendingIdx];
    const useAt = state.indexByCallId.get(useCallId);
    if (useAt !== undefined) {
      const { card } = state.out[useAt];
      card.output = block.content || card.output;
      card.status = block.isError ? 'failed' : 'done';
      state.pendingUses.splice(pendingIdx, 1);
      return false;
    }
  }
  // 兜底：真的无主结果才独立成块。
  const card: ToolCard = {
    callId: block.toolUseId || `orphan_${nextBlockId()}`,
    name: 'result',
    title: '',
    output: block.content,
    status: block.isError ? 'failed' : 'done',
  };
  state.out.push({
    card,
    block: { kind: 'tool', id: nextBlockId(), tool: card },
  });
  return true;
}

function toRole(role: string): ChatMessage['role'] {
  if (role === 'user' || role === 'assistant') return role;
  return 'system';
}

/**
 * 把 conversation 域读出的历史消息转换为 Agent Chat 的只读消息流。
 *
 * - `text` → text block；`thinking` → reasoning block（保持到达时序）；
 * - `toolUse` → 结构化 tool block；`toolResult` 按 toolUseId 回填对应卡片的
 *   输出与状态 —— 历史经同一 WorkRows 管线渲染 CommandCard/DiffCard 等卡片，
 *   仅审批/澄清面板不回放（只读快照）；
 * - blocks 为空时回退到聚合的 `content` 字段；未知 role 归入 system。
 */
export function convertHistory(messages: ConversationMessage[]): ChatMessage[] {
  // 会话级配对状态：tool_use 与 tool_result 在 agent 原生存储里是独立 part，
  // 经常分布在相邻消息 —— 配对必须跨消息（call_id 会话内唯一，无误配风险）。
  const pairing: ToolPairingState = { out: [], indexByCallId: new Map(), pendingUses: [] };

  /** 追加 blocks：连续 reasoning 归并为单块（消除碎片化思考条交替）。 */
  const appendBlocks = (dst: ContentBlock[], src: ContentBlock[]) => {
    for (const b of src) {
      const last = dst[dst.length - 1];
      if (b.kind === 'reasoning' && last && last.kind === 'reasoning') {
        dst[dst.length - 1] = { ...last, text: `${last.text}\n\n${b.text}` };
      } else {
        dst.push(b);
      }
    }
  };

  const result: ChatMessage[] = [];
  for (const m of messages) {
    let blocks: ContentBlock[];
    if (m.blocks.length > 0) {
      // 先收集 text/thinking 与工具块时序骨架。
      const skeleton: Array<
        { kind: 'inline'; block: ContentBlock } | { kind: 'tool'; at: number }
      > = [];
      for (const b of m.blocks) {
        if (b.type === 'text') {
          skeleton.push({
            kind: 'inline',
            block: { kind: 'text', id: nextBlockId(), text: b.text },
          });
        } else if (b.type === 'thinking') {
          skeleton.push({
            kind: 'inline',
            block: { kind: 'reasoning', id: nextBlockId(), text: b.thinking },
          });
        } else if (b.type === 'toolUse') {
          if (pushToolUse(b, pairing)) {
            skeleton.push({ kind: 'tool', at: pairing.out.length - 1 });
          }
        } else if (pushToolResult(b, pairing)) {
          skeleton.push({ kind: 'tool', at: pairing.out.length - 1 });
        }
      }
      // 工具块插回原始时序位置。
      blocks = skeleton.map((s) => (s.kind === 'inline' ? s.block : pairing.out[s.at].block));
    } else {
      blocks = [{ kind: 'text', id: nextBlockId(), text: m.content }];
    }

    const role = toRole(m.role);
    const last = result[result.length - 1];
    // 连续 assistant 消息合并：opencode 等存储把 reasoning/tool 拆成独立 message 行，
    // 逐条转换会产生「思考过程 / 工具组」碎片化交替 —— 合并回同一话轮流。
    if (role === 'assistant' && last && last.role === 'assistant') {
      appendBlocks(last.blocks, blocks);
      continue;
    }
    result.push({
      id: nextMsgId(),
      role,
      blocks,
      ts: formatChatTime(new Date(m.timestamp)),
    });
  }
  return result;
}
