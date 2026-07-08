export interface ConversationMeta {
  id: string;
  nativeSessionId: string;
  agentId: string;
  title: string;
  startedAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
  filePath: string;
  projectPath: string | null;
  userTitle: string | null;
  tags: string[];
}

export interface ConversationMessage {
  role: string;
  content: string;
  timestamp: number;
  seq: number;
}

export interface ScanReport {
  agent_id: string;
  sessions_found: number;
  errors: string[];
}
