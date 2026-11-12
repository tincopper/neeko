import { useEditorStore } from '@/shared/store/editorStore';
import { selectActiveTabId, selectOrderedTabs } from '@/shared/store/editorTabSelectors';
import type { Tab } from '@/shared/types';
import type { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { resolveTerminalEntryOfTab } from './terminalCache';
import { pasteToTerminalSession } from './terminalCommands';

/**
 * terminal / agent 插入路由 —— **全仓唯一的前台仲裁点**（决议 Q2）。
 *
 * 与 `terminalCache.resolveTerminalEntry`（低层精确 resolve）分工：
 * 本模块只回答「该往 session 内哪个 tab 插」，低层只回答「该 tab 的 PTY 在哪」。
 *
 * **顺序口径只实现一次**：本模块不自带任何 `sort` —— 它消费 `editorTabSelectors.selectOrderedTabs`
 * （顺序 = `editorLayout` 的 `tabIds`，左组 → 右组 → pinned）。其余「要某一类 tab」的需求
 * 一律是**在这个有序序列上 filter**（filter 保序），不是第二套顺序实现。
 * 10-12 实测同一问题全仓曾有 7 个答案（order 升序 / order 降序 / 数组顺序 /
 * Map 插入顺序），「插入落哪个 tab」与「刷新落哪个 PTY」口径不一致就是当时的成因。
 *
 * `tabs[session.key]` 是 editor store 的 workspace 空间键（与 `session.key` 同源），
 * 因此跨 session 串写在构造上不可表达。
 *
 * **本模块不再编排 agent 目标**：`insertToSessionAgent`（composer 优先 → Agent CLI 降级）
 * 已迁到 `@/features/agent-chat/api/insertToSessionAgent`，使依赖方向为
 * agent-chat → terminal（高层编排依赖低层仲裁），terminal 不再反向依赖 agent-chat。
 * 本模块对外只提供：有序序列上的前台仲裁（`foregroundTerminalTab` /
 * `foregroundAgentCliTab` / `foregroundAgentChatTabs`）与「把文本写进某个精确目标」
 * （`insertToTerminalTarget` / `insertToSessionTerminal`）。
 */

export interface ForegroundTarget {
  tab: Tab;
  /** true = 该 tab 不是当前激活 tab（调用方据此提示实际落点）。 */
  isFallback: boolean;
}

/** 本 session 的 tab 空间快照：**一次** store 读取同时给出有序序列与激活 tab。 */
interface SessionTabSpace {
  /** 视觉顺序（布局 left → right → pinned），且前台 tab 置顶。 */
  ordered: Tab[];
  activeTabId: string | null;
}

/**
 * 本 session 的 tab 空间视图 —— **唯一**顺序/前台口径，全部由布局派生
 * （`editorTabSelectors`：顺序 = `tabIds`，前台 = 激活组的 `activeTabId`）。
 *
 * 其余「要某一类 tab」的需求一律是在 `ordered` 上 filter（filter 保序）——
 * 那是一层**类型**筛选，不是第二层**顺序**口径（决议 Q2）。
 * 历史病根：同一份顺序曾有 `Tab.order`（创建序）与布局 `tabIds`（视觉序）两个真源，
 * 重排后仲裁读旧序 —— 已删除该字段，顺序只此一处派生。
 */
function sessionTabSpace(session: WorkspaceSession): SessionTabSpace {
  const state = useEditorStore.getState();
  const ordered = selectOrderedTabs(state, session.key);
  const activeTabId = selectActiveTabId(state, session.key);
  const active = ordered.find((t) => t.id === activeTabId);
  return {
    ordered: active ? [active, ...ordered.filter((t) => t.id !== active.id)] : ordered,
    activeTabId,
  };
}

/** 在有序序列上取首个命中者，并算出它是不是前台（`isFallback` 只此一处算法）。 */
function pickFirst(
  space: SessionTabSpace,
  predicate: (tab: Tab) => boolean,
): ForegroundTarget | null {
  const picked = space.ordered.find(predicate);
  if (!picked) return null;
  return { tab: picked, isFallback: picked.id !== space.activeTabId };
}

/**
 * 该 session 内的**终端**插入目标：前台终端；无前台终端 → 同 session 首个终端（视觉序，
 * 布局 `tabIds`）；无终端 → null。**禁止跨 session**（tabs 键即 session.key）。
 */
export function foregroundTerminalTab(session: WorkspaceSession): ForegroundTarget | null {
  return pickFirst(sessionTabSpace(session), (t) => t.data.kind === 'terminal');
}

/**
 * 该 session 内的 **Agent CLI 终端** tab（terminal kind + `agentId`）——
 * 在同一个有序序列上过滤，**不另起 sort**（决议 Q2）。
 *
 * 取代此前两处自带口径的实现：`pickerUtils.findAgentCliTab`（order **降序**，
 * 「最近新增优先」）与 `useEditorAgentActions.findAgentTab`（数组顺序，不排序）。
 */
export function foregroundAgentCliTab(session: WorkspaceSession): ForegroundTarget | null {
  return pickFirst(
    sessionTabSpace(session),
    (t) => t.data.kind === 'terminal' && t.data.agentId !== null,
  );
}

/**
 * 该 session 内的 **agent-chat composer** 候选（Q1 决议的首选目标）——
 * 同样只在同一个有序序列上过滤。
 *
 * 返回**全量候选**而非首个：`PaneContent` 只渲染每组的激活 tab ⇒
 * 「tab 存在于 store」≠「它的 composer 已挂载」，而「未挂载的 composer」在
 * registry 里不存在（投递返回 false）。编排层（`insertToSessionAgent`，已迁至 agent-chat）
 * 沿序逐个试，由 registry 回答「有没有人在」—— 它本来就是这个问题唯一的答案源。
 * **不**在此探测「已挂载集合」：那会把同一事实抄第二份，必然与 registry 漂移。
 */
export function foregroundAgentChatTabs(session: WorkspaceSession): ForegroundTarget[] {
  const space = sessionTabSpace(session);
  return space.ordered
    .filter((t) => t.data.kind === 'agent-chat')
    .map((tab) => ({ tab, isFallback: tab.id !== space.activeTabId }));
}

export interface InsertToSessionTerminalResult {
  ok: boolean;
  /** 命中时的实际落点标题（调用方 toast 用）。 */
  landedTabTitle?: string;
  /** true = 落点不是当前激活 tab。 */
  isFallback?: boolean;
}

/**
 * 把文本写进**指定的**终端目标（精确 tabId → resolve PTY → bracketed-paste）。
 *
 * 「该选哪个 tab」是调用方的事（`foregroundTerminalTab` / `foregroundAgentCliTab`）；
 * 本函数只回答「把这个目标写进去，成不成」。agent 目标编排（已迁至 agent-chat）
 * 的 Agent CLI 降级分支即消费它。
 */
export function insertToTerminalTarget(
  session: WorkspaceSession,
  target: ForegroundTarget,
  text: string,
): InsertToSessionTerminalResult {
  // **pane 无关** resolve：本函数只知道前台 tab，不知道它被拆成几个 pane。
  // 旧实现走 `terminalCache.resolveTerminalEntry` 的两参形态（`paneId` 默认 `'p1'`）——
  // 终端不在第一个 pane（右侧 dock / 分屏）时精确键恒 miss，返回 `{ ok: false }`
  // 且无任何提示：这就是 2026-11 「拖文件到终端什么都没发生」的原始事故。
  const entry = resolveTerminalEntryOfTab(session, target.tab.id);
  if (!entry?.sessionId) return { ok: false };

  pasteToTerminalSession(entry.sessionId, text);
  return {
    ok: true,
    landedTabTitle: target.tab.title,
    isFallback: target.isFallback,
  };
}

/**
 * 唯一编排（终端）：route（前台仲裁）→ resolve（精确 PTY）→ paste。
 *
 * 无终端 / PTY 未就绪 → `{ ok: false }`（显式失败，调用方 toast/降级）。
 */
export function insertToSessionTerminal(
  session: WorkspaceSession,
  text: string,
): InsertToSessionTerminalResult {
  const target = foregroundTerminalTab(session);
  if (!target) return { ok: false };
  return insertToTerminalTarget(session, target, text);
}
