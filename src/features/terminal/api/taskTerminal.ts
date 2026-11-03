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
 * @returns 新 tab 的 **id**（= 「这个终端开在哪」）；配额满（`MAX_TERMINAL_TABS`）时 `null`。
 *
 * # 为什么返回 id 而不是 boolean（2026-11-02）
 *
 * 调用方有两类，它们真正需要的是**同一个事实**：
 *
 * - 编辑器 AI 动作：只关心「开没开出来」（`!== null`）；
 * - `run-single`：要把 tab id 写进 `WorkItemRun.ref.id` —— 那是「跳回这个终端」的唯一定位点
 *   （PTY session id 在 tab 挂载时才生成、重启后不复存在，不能当锚点）。
 *
 * 曾经想把它做成 `opts.tabId?: string`（调用方自 mint、返回值保持 boolean），但护栏
 * `check_terminal_foreground_arbitration` 的 A3 明令禁止 terminal 域出现可选的 `tabId`：
 * 那正是「缺省取 Map 首个」这条第二口径的回潮入口，而它在 TS 上完全合法、编译期无声。
 * 所以**唯一出口仍然只有一个**：谁建谁给出 id，boolean 只是 `!== null`。
 *
 * 也不允许「建完之后去 store 里反查刚建的那个」：`addTab` 把 tab 追加到末尾，反查只能靠
 * 「最新的那个」这种时间推测，而同一帧里可能还有别的建 tab 调用。
 */
export function createTaskTerminal(projectId: ProjectId, opts: TaskTerminalOptions): string | null {
  const state = useEditorStore.getState();
  // 配额检查按 store 键（= tab.scope 推导键）寻址，与 addTab 落键同形
  const existing = state.tabs[activeWorkspaceSession(projectId).key];
  const terminalCount = (existing?.tabs ?? []).filter((t) => t.data.kind === 'terminal').length;
  if (terminalCount >= MAX_TERMINAL_TABS) return null;

  const tabId = generateTerminalTabId();
  const tab: Tab = {
    id: tabId,
    scope: { kind: 'workspace', session: activeWorkspaceSession(projectId) },
    title: opts.agentName ?? opts.agentId,
    data: {
      kind: 'terminal',
      agentId: opts.agentId,
      status: 'Idle',
      taskCommand: opts.taskCommand,
    },
  };
  state.addTab(tab);
  state.activateTab(projectId, tabId);
  return tabId;
}
