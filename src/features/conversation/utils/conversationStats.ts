import type { ConversationMessage } from '@/features/conversation/types';

/**
 * 会话统计（顶部信息条 + 工具调用侧边栏的数据源）。
 *
 * 从 `ConversationViewer` 抽出的**纯派生**：给定消息列表算出计数与工具调用清单，
 * 组件只负责 `useMemo` 包裹与渲染。抽出的理由有两条 ——
 * ① 纯函数可直测（工具调用定位 `msgIdx/blockIdx` 是侧边栏跳转的契约）；
 * ② 组件文件已顶到 300 行红线（`check_component_size` ratchet）。
 */

/** 工具调用侧边栏项（含回跳定位）。 */
export interface ToolCallItem {
  msgIdx: number;
  blockIdx: number;
  name: string;
  input: unknown;
}

export interface ConversationStats {
  totalMessages: number;
  toolCalls: number;
  thinkingCount: number;
  uniqueTools: string[];
  toolCallList: ToolCallItem[];
}

/** 汇总消息列表的工具调用 / thinking 计数（无 blocks 的消息跳过）。 */
export function buildConversationStats(messages: ConversationMessage[]): ConversationStats {
  const toolCallList: ToolCallItem[] = [];
  let thinkingCount = 0;

  messages.forEach((msg, msgIdx) => {
    if (!msg.blocks) return;
    msg.blocks.forEach((block, blockIdx) => {
      if (block.type === 'toolUse') {
        toolCallList.push({ msgIdx, blockIdx, name: block.name, input: block.input });
      }
      if (block.type === 'thinking') thinkingCount++;
    });
  });

  return {
    totalMessages: messages.length,
    toolCalls: toolCallList.length,
    thinkingCount,
    uniqueTools: [...new Set(toolCallList.map((call) => call.name))],
    toolCallList,
  };
}
