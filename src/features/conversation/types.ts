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
