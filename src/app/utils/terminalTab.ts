import { useEditorStore } from '@/shared/store/editorStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { EditorGroupId, Tab } from '@/shared/types';
import { MAX_TERMINAL_TABS, nextTerminalTitle } from '@/shared/utils/terminalTabTitle';
import type { ProjectId } from '@/shared/utils/workspaceRef';

/**
 * terminal tab 的**唯一构造点**（无 React，可在 hook / 命令式入口复用）。
 *
 * 为什么抽出来：插件的 tab 栏「+」、Action Menu 与工具栏的 Terminal 图标都要「开一条终端」，
 * 三处各写一遍构造会漂 —— 占位标题、`agentId`、`scope` 身份、配额门任意一项漏掉都表现为
 * 「点了没反应」或「终端跑到别的项目里」。身份只从 `activeWorkspaceSession(projectId)` 取
 * （身份单点），store 键由 `addTab` 从 scope 推导（构造律）。
 */
export type TerminalTabTarget = EditorGroupId | 'pinned' | undefined;

/** 造一条 terminal tab 并激活（`agentId: null` = 纯 shell）。 */
export function createTerminalTab(args: {
  tabKey: string;
  projectId: ProjectId;
  agentId: string | null;
  title: string;
  targetGroup?: TerminalTabTarget;
}): string {
  const tabId = `tab_${crypto.randomUUID()}`;
  const tab: Tab = {
    id: tabId,
    scope: { kind: 'workspace', session: activeWorkspaceSession(args.projectId) },
    title: args.title,
    data: { kind: 'terminal', agentId: args.agentId },
  };
  useEditorStore.getState().addTab(tab, args.targetGroup);
  useEditorStore.getState().activateTab(args.tabKey, tabId);
  return tabId;
}

/**
 * 新建**纯 shell** 终端：受 `MAX_TERMINAL_TABS` 配额约束，满则返回 `null`
 * （`addTab` 的配额门是静默 return，调用方必须自己解释「点了没反应」）。
 *
 * 配额只约束这个入口；「点某个 agent」是显式意图，不走本函数。
 */
export function createPlainTerminalTab(
  tabKey: string,
  projectId: ProjectId,
  targetGroup?: TerminalTabTarget,
): string | null {
  const existing = useEditorStore.getState().tabs[tabKey];
  const count = (existing?.tabs ?? []).filter((t) => t.data.kind === 'terminal').length;
  if (count >= MAX_TERMINAL_TABS) return null;
  return createTerminalTab({
    tabKey,
    projectId,
    agentId: null,
    title: nextTerminalTitle(existing),
    targetGroup,
  });
}
