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
  /**
   * PTY 会话 id（后端铸造）。
   *
   * 侧栏 ↔ tab 的**唯一映射键**：侧栏会话行来自 live-sessions 注册表（不依赖打开的 tab），
   * 点一行要能命中它的 tab。
   *
   * 注：曾经还有个 `status: 'Idle' | 'Running' | 'Failed'` —— 它只在自动启动 agent 命令时
   * 写一次、全仓无读者，是「视图持有状态副本」的活标本。状态现在只来自注册表。
   */
  ptySessionId?: string;
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

/**
 * Composer 富文本草稿的 JSON 节点（Tiptap `editor.getJSON()` 产物的最小结构声明）。
 *
 * chip 节点的属性语义（哪个 attr 是命令名 / 文件路径）由 agent-chat 的
 * `editorSchema.ts` 定义；这里只需要「能落盘、能恢复、能被 docToPromptText 遍历」。
 */
export interface ComposerDocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ComposerDocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/** Composer 富文本草稿的文档根（Tiptap doc 的 JSON 形状）。 */
export interface ComposerDocJson {
  type: 'doc';
  content?: ComposerDocNode[];
}

export interface AgentChatTabData {
  kind: 'agent-chat';
  /** 当前选中的 agent ID（如 deepseek-harness、opencode）。 */
  agentId?: string;
  /** 会话 ID（用于恢复）。 */
  sessionId?: string;
  /**
   * 用户选中的模型 id（`ModelInfo.id`）。
   *
   * # 为什么必须持久化到 tab data
   *
   * `useAgentChat` 的 `selectedModel` 是组件局部 state，而 `PaneContent` 只渲染
   * `activeTab` —— 切到别的 tab 就卸载，切回来重新挂载时它是 `null`。此时
   * `useSelectedModelSync` 会落到 `models[0]`（agent 下发的首选），**不是**用户
   * 上次选的那个。
   *
   * 会话内 `configOptions.current_value` 看似能救，但它只在 `ready` 时可信，且
   * 静默会话重建期间拿不到 —— 用户看到的是「切个 tab 我的模型就变了」。
   *
   * 只存 id：`name` / `group` 等展示字段由列表按 id 反查，避免存一份会过期的快照。
   */
  modelId?: string;
  /** Histor 恢复目标：conversation 域的会话 id（拉取历史渲染）。 */
  resumeConversationId?: string;
  /** Histor 恢复目标：agent 原生会话 id（agent_chat_resume 接续写入）。 */
  resumeNativeSessionId?: string;
  /**
   * Composer 富文本草稿（Tiptap 文档 JSON，含 chip token）。mount / 切 tab 时
   * `setContent` 恢复一次；`onUpdate` 只出不进（受控回环单向闸门，composer 任务
   * design §4）。显式写 `undefined` = 清空草稿。
   */
  composerDoc?: ComposerDocJson;
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
  data: TabData;
}

/**
 * 某个 tab 空间的 `Tab` 注册表（id → Tab 查询的容器）。
 *
 * **不持有「前台 / 顺序」**：两者都是 `editorLayout[tabKey]` 的职责（组的 `tabIds` 即顺序，
 * `groups[activeGroupId].activeTabId` 即前台）—— 唯一派生点在
 * `src/shared/store/editorTabSelectors.ts`。曾有的 `activeTabId` 字段是分屏前的第二份表示，
 * 分屏 / 拖拽重排后与布局分叉（拖文件落错 pane、Cmd+W 关错 tab），已删除。
 */
export interface ProjectTabs {
  tabs: Tab[];
}

/** Minimal shape any tab-like item must satisfy for the generic TabItem. */
export interface TabLike {
  id: string;
  title: string;
}
