// ─── Tab Types ──────────────────────────────────────────────────────────────
import type { FileContent } from './file';
import type { DiffSource, ViewMode, CommitFileChange } from './git';
import type { ConversationMeta } from './session';

export type TabKind = 'terminal' | 'file' | 'diff' | 'html-preview' | 'conversation' | 'prDetail';

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

export type TabData =
  | TerminalTabData
  | FileTabData
  | DiffTabData
  | HtmlPreviewTabData
  | ConversationTabData
  | PRDetailTabData;

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
