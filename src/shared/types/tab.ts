// ─── Tab Types ──────────────────────────────────────────────────────────────
import type { ProjectId, WorkspaceSession } from '@/shared/utils/workspaceRef';

import type { FileContent } from './file';
import type { DiffSource, ViewMode, CommitFileChange } from './git';
import type { ConversationMeta } from './session';

export type TabKind =
  | 'terminal'
  | 'team-board'
  | 'team-task'
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
  /**
   * 接管一个**已经由后端创建好**的 PTY 会话（团队队长/成员等）。
   *
   * - **谁写入**：团队入口（`useTerminalTabs.openExistingTerminalTab`，写入方唯一）。
   * - **谁消费**：local 策略的 `createSession` —— 有值时**不发** `create_terminal_session`，
   *   直接把该 id 当作本 tab 的会话 id（`CacheEntry.sessionId` 的来源）。
   *
   * # 为什么放在 tab data 里
   *
   * tab 是「这个终端用哪个后端会话」的唯一载体：旁挂表（`sessionId → tabId`）在关闭 tab /
   * 切工作区后会留下孤儿条目，且同一事实出现两个真相源。写一次（建 tab 时）后由
   * `updateTab` 的 `mergeTabData` 原样透传，**没有第二写入口**。
   *
   * # 不是寻址键
   *
   * 缓存键仍由 `terminalAddress(session, tabId, paneId)` 唯一铸造（红线 12 的 terminal 同族
   * 判据）；`sessionId` 只回答「连哪个 PTY」，不参与「这是哪个终端」的判定。
   */
  existingSessionId?: string;
}

/**
 * 团队看板 / 分配图的**中央 tab**（300px 的 dock 列装不下整张板）。
 *
 * # 数据面是 teamStore，不是本 tab
 *
 * tab 只携带「打开哪支队、默认哪个视图」；快照仍由 `teamStore` 持有（唯一数据面，
 * 面板与中央 tab 是同一支队伍的两个视图）。中央 tab 挂载时若 store 不在这支队上，
 * 会 `openTeam` 把 store 拉回来（面板同步切过去 —— 同一事实，两个观察位）。
 */
export interface TeamBoardTabData {
  kind: 'team-board';
  /** 团队 id（`tm_*`）。 */
  teamId: string;
  /** 展示名（建 tab 时快照；面板刷新后可能改名，不追）。 */
  teamName: string;
  /** 默认视图：看板 / 分配图。 */
  view: 'board' | 'flow';
}

/**
 * 团队**任务详情**的中央 tab（markdown 渲染 + 步骤轨迹；替代旧的底部抽屉）。
 *
 * 地址只带（teamId, taskId）：详情是**点开才拉**的载荷（红线 4），tab 挂载时
 * 自己发 `team_task_detail`，不进任何 store —— 关 tab 即弃，无缓存失效问题。
 */
export interface TeamTaskTabData {
  kind: 'team-task';
  /** 团队 id（任务 id 只在队内唯一 —— 两列一起寻址，C23）。 */
  teamId: string;
  /** 任务 id（`t{n}`）。 */
  taskId: string;
  /** tab 标题（`t1 · <任务标题>`，建 tab 时快照）。 */
  label: string;
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
  | TeamBoardTabData
  | TeamTaskTabData
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
