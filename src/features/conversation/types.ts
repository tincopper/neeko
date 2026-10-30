import type { ConversationMeta } from '@/shared/types/session';

export type { ConversationMeta } from '@/shared/types/session';

/// 消息内容块 - 表示 Agent 执行过程中的不同类型内容
export type MessageBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'toolUse'; id: string; name: string; input: unknown }
  | { type: 'toolResult'; toolUseId: string; content: string; isError: boolean };

export interface ConversationMessage {
  role: string;
  content: string;
  blocks: MessageBlock[];
  model?: string;
  timestamp: number;
  seq: number;
}

/** 工具调用定位（侧边栏回跳：`seq` 定位消息，`blockIdx` 定位消息内块）。 */
export interface ToolCallRef {
  seq: number;
  blockIdx: number;
  name: string;
  /** 短摘要（路径 / 命令 / pattern），由 Rust 侧生成，避免回传入参载荷。 */
  summary: string;
}

/** 会话正文统计（顶部信息条 + 工具调用侧边栏）：由 Rust 计算，前端不持有全量正文。 */
export interface ConversationStats {
  totalMessages: number;
  toolCalls: number;
  thinkingCount: number;
  uniqueTools: string[];
  /** 工具调用清单（超过上限时截断） */
  toolCallList: ToolCallRef[];
  /** 清单是否被截断（`toolCalls` 仍是真实总数） */
  toolCallListTruncated: boolean;
}

/** 会话内搜索命中（只含定位 + 片段，不含正文）。 */
export interface ConversationSearchHit {
  seq: number;
  role: string;
  snippet: string;
}

export interface ScanReport {
  agent_id: string;
  sessions_found: number;
  errors: string[];
}

/**
 * 会话正文分页（红线 4：单次 IPC 载荷 ≤2MB）。
 *
 * 分页只是**传输**边界：解析在 Rust 侧仍然完整，前端用 `hasMore` 逐页组装。
 */
export interface ConversationMessagePage {
  items: ConversationMessage[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface ConversationListPage {
  items: ConversationMeta[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
