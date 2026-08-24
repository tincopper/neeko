import type { MessageBlock } from '../types';

export interface ToolBlockGroup {
  type: 'tool';
  toolUse: Extract<MessageBlock, { type: 'toolUse' }>;
  toolResult: Extract<MessageBlock, { type: 'toolResult' }> | null;
}

export type PairedBlock = MessageBlock | ToolBlockGroup;

interface PendingToolUse {
  use: Extract<MessageBlock, { type: 'toolUse' }>;
  outputIndex: number;
}

/**
 * 将同一消息内的 toolUse 与其匹配的 toolResult 配对。
 *
 * 规则：
 * - toolUse 压栈，记录输出槽位；toolResult 从栈中自后向前找匹配 id 的 toolUse，
 *   命中则把该槽位替换为 ToolBlockGroup（含 result），未命中则 result 单独输出。
 * - 未配对的 toolUse 保持独立。
 * - 其他 block（text/thinking）按原顺序透传。
 */
export function pairToolBlocks(blocks: MessageBlock[]): PairedBlock[] {
  const out: PairedBlock[] = [];
  const pending: PendingToolUse[] = [];

  for (const block of blocks) {
    if (block.type === 'toolUse') {
      out.push(block);
      pending.push({ use: block, outputIndex: out.length - 1 });
      continue;
    }

    if (block.type === 'toolResult') {
      const idx = pending.findIndex((p) => p.use.id === block.toolUseId);
      if (idx !== -1) {
        const hit = pending.splice(idx, 1)[0];
        out[hit.outputIndex] = {
          type: 'tool',
          toolUse: hit.use,
          toolResult: block,
        };
        continue;
      }
      out.push(block);
      continue;
    }

    out.push(block);
  }

  return out;
}
