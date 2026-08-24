// ─── Tab Types ──────────────────────────────────────────────────────────────
import type { FileContent } from './file';
import type { DiffSource, ViewMode, CommitFileChange } from './git';
import type { ConversationMeta } from './session';

export type TabKind =
  | 'terminal'
  | 'file'
  | 'diff'
  | 'html-preview'
  | 'conversation'
  | 'prDetail'
  | 'web-agent'
  | 'agent-chat'
  | 'browser';

export interface TerminalTabData {
  kind: 'terminal';
  agentId: string | null;
  status: 'Idle' | 'Running' | 'Failed';
  taskCommand?: string;
  taskConfigId?: string;
  rebuildKey?: number;
}

export interface FileTabData {
  kind: 'file';
  filePath: string;
  fileName: string;
  content: FileContent;
  isDirty: boolean;
  externallyModified?: boolean;
  initialPreviewMode?: 'preview' | 'source';
  isUntitled?: boolean;
  untitledName?: string;
}

export interface DiffTabData {
  kind: 'diff';
  filePath: string;
  fileName: string;
  diffSource: DiffSource;
  initialMode?: ViewMode;
  combined?: boolean;
  combinedFiles?: CommitFileChange[];
  scrollToPath?: string;
}

export interface HtmlPreviewTabData {
  kind: 'html-preview';
  filePath: string;
  fileName: string;
}

export interface ConversationTabData {
  kind: 'conversation';
  conversationId: string;
  agentId?: string;
  conversationMeta?: ConversationMeta;
  onResume?: (meta: ConversationMeta) => void;
}

export interface PRDetailTabData {
  kind: 'prDetail';
  projectId: string;
  prNumber: number;
  prTitle: string;
  prState: string;
  prBody: string | null;
  prAuthor: string;
  prCreatedAt: string;
  prUrl: string;
  prHeadRef: string;
  prBaseRef: string;
  comments?: import('./git').PRComment[];
}

export interface BrowserTabData {
  kind: 'browser';
  /** 初始导航 URL（空 = 等待用户在地址栏输入）。 */
  url: string;
  /** 当前页面 favicon URL（用于 tab 图标展示；可能为空）。 */
  favicon?: string;
}

export interface AgentChatTabData {
  kind: 'agent-chat';
  /** 当前选中的 agent ID（如 deepseek-harness、opencode）。 */
  agentId?: string;
  /** 会话 ID（用于恢复）。 */
  sessionId?: string;
  /** Histor 恢复目标：conversation 域的会话 id（拉取历史渲染）。 */
  resumeConversationId?: string;
  /** Histor 恢复目标：agent 原生会话 id（agent_chat_resume 接续写入）。 */
  resumeNativeSessionId?: string;
}

export type TabData =
  | TerminalTabData
  | FileTabData
  | DiffTabData
  | HtmlPreviewTabData
  | ConversationTabData
  | PRDetailTabData
  | BrowserTabData
  | AgentChatTabData;

export interface Tab {
  id: string;
  projectId: string;
  title: string;
  order: number;
  data: TabData;
}

export interface ProjectTabs {
  tabs: Tab[];
  activeTabId: string | null;
}

/** Minimal shape any tab-like item must satisfy for the generic TabItem. */
export interface TabLike {
  id: string;
  title: string;
}
