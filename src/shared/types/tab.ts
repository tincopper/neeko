// ─── Tab Types ──────────────────────────────────────────────────────────────
import type { ProjectId, WorkspaceSession } from '@/shared/utils/workspaceRef';

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
  /** 只读 tab（如 LSP 跳转打开的项目外定义文件）：不可编辑、不进入保存流程。 */
  readOnly?: boolean;
  /**
   * LSP 虚拟文档 uri（如 jdtls 的 `jdt://` 类文件）：tab 的 filePath 是展示路径
   * （`jdt:/<module>/…/<Name>.java`，供面包屑/高亮），而 LSP 请求（definition/hover/
   * completion）必须携带此原始 uri，jdtls 才能定位其模型中的 IClassFile。
   */
  virtualUri?: string;
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
  projectId: ProjectId;
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

/**
 * Tab 的领域归属（P4 层级归位）：`App → Project → Workspace` 层级中，tab 要么属于某个
 * Workspace（业务 tab），要么属于 App 节点（设置 / 全局面板）—— 后者不依附任何
 * Workspace，是联合类型的合法分支而非字符串哨兵。
 */
export type TabScope = { kind: 'workspace'; session: WorkspaceSession } | { kind: 'app' };

export interface Tab {
  id: string;
  /** 唯一身份字段：tab 携带完整领域地址；store 键由它推导（构造律，见 editorStore.addTab）。 */
  scope: TabScope;
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
