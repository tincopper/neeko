export interface ConversationMeta {
  id: string;
  nativeSessionId: string;
  agentId: string;
  title: string;
  model?: string;
  startedAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
  filePath: string;
  projectPath: string | null;
  userTitle: string | null;
  tags: string[];
  /**
   * Whether native resume is available.
   * Backend always sends a boolean; UI shows Resume only when `true`.
   * Optional for older/mock payloads — treat missing as not supported.
   */
  supportsResume?: boolean;
}

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

export interface ConversationListPage {
  items: ConversationMeta[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

