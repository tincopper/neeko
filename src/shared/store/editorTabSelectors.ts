import type { EditorSplitLayout, ProjectTabs, Tab } from '@/shared/types';
import type { SessionRef } from '@/shared/types/liveSessions';

/**
 * tab 空间的「视图投影」唯一读取面。
 *
 * **第一性原理**：`editorLayout[tabKey]` 是 tab 空间的唯一权威 —— 顺序（各组
 * `tabIds` 左 → 右 → `pinnedTabIds`）与前台（`activeGroupId` 指向组的 `activeTabId`）
 * 都在它里面。`tabs[tabKey]` 只是 `Tab` 的注册表（id → Tab 查询）。
 *
 * 因此「顺序」与「前台」不存储第二份，一律在此派生：
 * - `selectOrderedTabIds` / `selectOrderedTabs`：视觉顺序即仲裁顺序（左 → 右 → pinned）；
 * - `selectActiveTabId`：前台 = 激活编辑器组的激活 tab（**不含** pinned 面板激活态，
 *   见下方说明）。
 *
 * 历史缺陷（2026-10-15）：`ProjectTabs.activeTabId` 与 `Tab.order` 曾各存第二份表示，
 * 分屏 / 拖拽重排后与 layout 分叉 —— 拖文件落到上一个 pane 的输入框、Cmd+W 关错 tab、
 * 仲裁按旧顺序取首个。根治 = 删除字段，让分叉在构造上不可表示。
 */
export interface EditorTabSpaceState {
  tabs: Record<string, ProjectTabs>;
  editorLayout: Record<string, EditorSplitLayout>;
}

/**
 * 顺序：left 组 → right 组 → pinned（视觉顺序即仲裁顺序）。
 *
 * 不变量 I1（有 tab 的空间必有 layout，且三组 tabIds 恰好枚举该空间的 tab）成立时
 * 这就是全量；layout 缺失时返回 `[]`（优雅降级，生产中不可达 —— `addTab` 是唯一创建
 * 入口且总会 `ensureLayout`，tab 不持久化、无 session-restore 写入路径）。
 */
export function selectOrderedTabIds(state: EditorTabSpaceState, tabKey: string): string[] {
  const layout = state.editorLayout[tabKey];
  if (!layout) return [];
  return [...layout.groups.left.tabIds, ...layout.groups.right.tabIds, ...layout.pinnedTabIds];
}

/**
 * 顺序投影成 `Tab`（跳过已失效 id —— 与 `useEditorGroupLayout` 的 heal 语义一致：
 * layout 可能残留已关闭 tab 的 id，消费端只渲染/仲裁仍存在的 tab）。
 */
export function selectOrderedTabs(state: EditorTabSpaceState, tabKey: string): Tab[] {
  const projectTabs = state.tabs[tabKey];
  if (!projectTabs) return [];
  const byId = new Map(projectTabs.tabs.map((tab) => [tab.id, tab]));
  const ordered: Tab[] = [];
  for (const id of selectOrderedTabIds(state, tabKey)) {
    const tab = byId.get(id);
    if (tab) ordered.push(tab);
  }
  return ordered;
}

/**
 * 前台 tab：`layout.groups[layout.activeGroupId].activeTabId`。
 *
 * **pinned 激活态（`pinnedActiveTabId`）与之正交、不在此派生**：pinned tab 不可关闭、
 * Cmd+W 从不命中它，它是「钉住的参照面板」而非当前工作 tab（今日行为，保持不变）。
 * layout 缺失 → `null`（优雅降级，见 `selectOrderedTabIds` 的 I1 说明）。
 */
export function selectActiveTabId(state: EditorTabSpaceState, tabKey: string): string | null {
  const layout = state.editorLayout[tabKey];
  if (!layout) return null;
  return layout.groups[layout.activeGroupId].activeTabId;
}

/** `selectActiveTabId` 的 `Tab` 形态（前台 tab 对象；无前台 / 已失效 → `null`）。 */
export function selectActiveTab(state: EditorTabSpaceState, tabKey: string): Tab | null {
  const activeId = selectActiveTabId(state, tabKey);
  if (!activeId) return null;
  return state.tabs[tabKey]?.tabs.find((tab) => tab.id === activeId) ?? null;
}

/**
 * 前台会话的完整身份（含所在单元），供 live-session 派生层过滤。
 *
 * 返回排序后的数组，调用方应在 `useMemo` 中按稳定的 `tabs` / `editorLayout`
 * 引用计算，而不是把它直接作为 zustand selector 的返回值（后者每次 getSnapshot
 * 都会生成新数组）。空集也无需共享常量：只有状态切片变化时才会重算。
 */
export function selectActiveSessionRefs(state: EditorTabSpaceState): readonly SessionRef[] {
  const refs: SessionRef[] = [];
  for (const tabKey of Object.keys(state.tabs)) {
    const tab = selectActiveTab(state, tabKey);
    if (!tab) continue;
    const data = tab.data;
    if (data.kind === 'agent-chat' && data.sessionId) {
      refs.push({ workspaceKey: tabKey, kind: 'chat', sessionId: data.sessionId });
    } else if (data.kind === 'terminal' && data.ptySessionId) {
      refs.push({ workspaceKey: tabKey, kind: 'terminal', sessionId: data.ptySessionId });
    }
  }
  return refs.sort((a, b) => a.workspaceKey.localeCompare(b.workspaceKey));
}
