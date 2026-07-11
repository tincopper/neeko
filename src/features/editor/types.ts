// ─── Tab Types ──────────────────────────────────────────────────────────────
import type { DiffSource, ViewMode } from "@/features/git/components/diff/types";
import type { FileContent } from "@/features/file/types";
import type { ConversationMeta } from "@/features/conversation/types";

export type TabKind = "terminal" | "file" | "diff" | "gitLog" | "html-preview" | "conversation" | "prDetail";

export interface TerminalTabData {
  kind: "terminal";
  agentId: string | null;
  status: "Idle" | "Running" | "Failed";
  taskCommand?: string;
  taskConfigId?: string;
  rebuildKey?: number;
}

export interface FileTabData {
  kind: "file";
  filePath: string;
  fileName: string;
  content: FileContent;
  isDirty: boolean;
  externallyModified?: boolean;
}

export interface DiffTabData {
  kind: "diff";
  filePath: string;
  fileName: string;
  diffSource: DiffSource;
  initialMode?: ViewMode;
}

export interface GitLogTabData {
  kind: "gitLog";
}

export interface HtmlPreviewTabData {
  kind: "html-preview";
  filePath: string;
  fileName: string;
}

export interface ConversationTabData {
  kind: "conversation";
  conversationId: string;
  agentId?: string;
  conversationMeta?: ConversationMeta;
  onResume?: (meta: ConversationMeta) => void;
}

export interface PRDetailTabData {
  kind: "prDetail";
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
  comments?: import('@/features/git/types/comment').PRComment[];
}

export type TabData = TerminalTabData | FileTabData | DiffTabData | GitLogTabData | HtmlPreviewTabData | ConversationTabData | PRDetailTabData;

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

// ─── Editor Group Types ─────────────────────────────────────────────────────
export type EditorGroupId = "left" | "right";

export interface EditorGroupState {
  tabIds: string[];
  activeTabId: string | null;
}

export interface EditorSplitLayout {
  isSplit: boolean;
  ratio: number;
  activeGroupId: EditorGroupId;
  groups: {
    left: EditorGroupState;
    right: EditorGroupState;
  };
  pinnedTabId: string | null;
  pinnedPanelRatio: number;
}

export function createDefaultEditorLayout(): EditorSplitLayout {
  return {
    isSplit: false,
    ratio: 0.5,
    activeGroupId: "left",
    groups: {
      left: { tabIds: [], activeTabId: null },
      right: { tabIds: [], activeTabId: null },
    },
    pinnedTabId: null,
    pinnedPanelRatio: 0.35,
  };
}

export function findGroupIdForTab(
  layout: EditorSplitLayout,
  tabId: string
): EditorGroupId | null {
  if (layout.groups.left.tabIds.includes(tabId)) return "left";
  if (layout.groups.right.tabIds.includes(tabId)) return "right";
  return null;
}

export function oppositeGroup(groupId: EditorGroupId): EditorGroupId {
  return groupId === "left" ? "right" : "left";
}

// ─── Split Types ────────────────────────────────────────────────────────────
export type PaneId = string;
export type PaneDirection = "horizontal" | "vertical";
export type SplitPathStep = "first" | "second";

export type PaneNode =
  | { type: "leaf"; paneId: PaneId }
  | {
      type: "split";
      direction: PaneDirection;
      ratio: number;
      first: PaneNode;
      second: PaneNode;
    };

export interface SplitState {
  root: PaneNode;
  activePaneId: PaneId;
  paneCount: number;
}
