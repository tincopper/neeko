import { useEditorStore } from '@/shared/store/editorStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { Tab } from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';

/**
 * taskCommand 终端的创建端口（terminal 域唯一入口）。
 *
 * 收敛的知识（此前散在 `useFileEditorState.sendAfterBoot` 手造 Tab 与
 * `useTerminalTabs.addTab` 两处）：终端 tab 配额上限、ID 生成规则、排序（order 取
 * 当前 tab 数追加）与"创建即激活"。editor 域只调本端口，不手造
 * `Tab{kind:'terminal', taskCommand}`，不在别处留第二份魔数。
 */

export const MAX_TERMINAL_TABS = 10;

export function generateTerminalTabId(): string {
  return `tab_${crypto.randomUUID()}`;
}

export interface TaskTerminalOptions {
  agentId: string;
  agentName?: string;
  taskCommand: string;
}

/**
 * 创建并激活一个 taskCommand 终端 tab（PTY 直接执行命令，无需等 session 就绪）。
 *
 * @returns 建成功 true；配额满（`MAX_TERMINAL_TABS`）false。
 */
export function createTaskTerminal(projectId: ProjectId, opts: TaskTerminalOptions): boolean {
  const state = useEditorStore.getState();
  // 配额检查按 store 键（= tab.scope 推导键）寻址，与 addTab 落键同形
  const existing = state.tabs[activeWorkspaceSession(projectId).key];
  const terminalCount = (existing?.tabs ?? []).filter((t) => t.data.kind === 'terminal').length;
  if (terminalCount >= MAX_TERMINAL_TABS) return false;

  const tabId = generateTerminalTabId();
  const tab: Tab = {
    id: tabId,
    scope: { kind: 'workspace', session: activeWorkspaceSession(projectId) },
    title: opts.agentName ?? opts.agentId,
    order: existing?.tabs.length ?? 0,
    data: {
      kind: 'terminal',
      agentId: opts.agentId,
      status: 'Idle',
      taskCommand: opts.taskCommand,
    },
  };
  state.addTab(tab);
  state.activateTab(projectId, tabId);
  return true;
}
