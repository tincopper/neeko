import {
  nextBlockId,
  nextMsgId,
  type ChatMessage,
  type ContentBlock,
} from '../components/messageModel';
import type { FileStat } from '../types';
import { formatChatTime } from '../utils/chatFormat';
import { diffStats } from '../utils/diffHighlight';
import { withParagraphBreak } from '../utils/messageContent';

/**
 * 将 file_diff 聚合进最后一条 assistant 消息的 diff block（按 path 去重）。
 * 若消息末尾已是 diff block 则合并，否则新建 diff block。
 */
export function attachFileDiff(prev: ChatMessage[], path: string, diff: string): ChatMessage[] {
  const stats = diffStats(diff);
  const file: FileStat = { path, add: stats.add, del: stats.del };
  const last = prev[prev.length - 1];

  if (last && last.role === 'assistant') {
    const lastBlock = last.blocks[last.blocks.length - 1];
    // 末尾已是 diff block → 合并（同 path 更新，异 path 追加）
    if (lastBlock && lastBlock.kind === 'diff') {
      const current = lastBlock.diff;
      const exists = current.files.some((f) => f.path === path);
      const files = exists
        ? current.files.map((f) => (f.path === path ? file : f))
        : [...current.files, file];
      const diffs = exists
        ? current.diffs.map((d) => (d.path === path ? { path, diff } : d))
        : [...current.diffs, { path, diff }];
      return prev.map((m, i) =>
        i === prev.length - 1
          ? {
              ...m,
              blocks: m.blocks.map((b, j) =>
                j === m.blocks.length - 1 ? { ...b, diff: { files, diffs } } : b,
              ),
            }
          : m,
      );
    }
    // 末尾不是 diff block → 新建 diff block
    return appendBlock(prev, {
      kind: 'diff',
      id: nextBlockId(),
      diff: { files: [file], diffs: [{ path, diff }] },
    });
  }
  // 无 assistant 消息 → 新建消息 + diff block
  return [
    ...prev,
    {
      id: nextMsgId(),
      role: 'assistant',
      blocks: [
        { kind: 'diff', id: nextBlockId(), diff: { files: [file], diffs: [{ path, diff }] } },
      ],
      ts: formatChatTime(new Date()),
    },
  ];
}

/**
 * 在消息列表中查找 tool block（跨所有消息），用于 tool_output / tool_end 更新。
 * 返回 { msgIndex, blockIndex } 或 null。
 */
export function findToolBlock(
  msgs: ChatMessage[],
  callId: string,
): { msgIndex: number; blockIndex: number } | null {
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    for (let j = 0; j < msg.blocks.length; j++) {
      const b = msg.blocks[j];
      if (b.kind === 'tool' && b.tool.callId === callId) {
        return { msgIndex: i, blockIndex: j };
      }
    }
  }
  return null;
}

/**
 * 按时序追加内容块：末尾消息是 assistant 则追加到其 blocks，否则新建 assistant 消息。
 * 流式事件（tool_start / todos / worked / diff）共用的块追加语义。
 */
export function appendBlock(prev: ChatMessage[], block: ContentBlock): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last && last.role === 'assistant') {
    return prev.map((m, i) => (i === prev.length - 1 ? { ...m, blocks: [...m.blocks, block] } : m));
  }
  return [
    ...prev,
    {
      id: nextMsgId(),
      role: 'assistant',
      blocks: [block],
      ts: formatChatTime(new Date()),
    },
  ];
}

/**
 * 命令块追加：若末尾 assistant 消息的最后一个 block 是文本，先补段落分隔
 * （避免文本与命令糅合），再追加 command block。
 */
export function appendCommandBlock(prev: ChatMessage[], block: ContentBlock): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last && last.role === 'assistant') {
    // 若末尾是 text block，追加段落分隔（避免文本与命令糅合）
    const lastBlock = last.blocks[last.blocks.length - 1];
    if (lastBlock && lastBlock.kind === 'text') {
      return prev.map((m, i) =>
        i === prev.length - 1
          ? {
              ...m,
              blocks: [
                ...m.blocks.slice(0, -1),
                { ...lastBlock, text: withParagraphBreak(lastBlock.text) },
                block,
              ],
            }
          : m,
      );
    }
    return prev.map((m, i) => (i === prev.length - 1 ? { ...m, blocks: [...m.blocks, block] } : m));
  }
  return [
    ...prev,
    {
      id: nextMsgId(),
      role: 'assistant',
      blocks: [block],
      ts: formatChatTime(new Date()),
    },
  ];
}
