import { useEditorStore } from '@/shared/store/editorStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { Tab } from '@/shared/types';
import { generateTabId } from '@/shared/utils/tabIdentity';
import { MAX_TERMINAL_TABS, nextTerminalTitle } from '@/shared/utils/terminalTabTitle';
import type { ProjectId, WorkspaceSession } from '@/shared/utils/workspaceRef';

/**
 * 终端 tab 的创建端口（terminal 域唯一入口）。
 *
 * 收敛的知识（此前散在 `useFileEditorState.sendAfterBoot`、`useTerminalTabs.addTab`、
 * `ConversationsPanelWrapper.handleResumeConversation`、`useActivateSession` 四处手造 Tab）：
 * 配额上限、ID 铸造、占位标题策略、`scope` 构造与「创建即激活」。
 *
 * 调用方只决定**这一条 tab 的身份**（哪个单元、接谁、跑什么），不碰 store 细节 ——
 * 「切了 tab 但视图不动」这类事故全部源自「某处少走了一步」。
 */

export interface TaskTerminalOptions {
  /** 绑定的 agent；`null` = 纯 shell 终端（无品牌图标、无自动拉起）。 */
  agentId: string | null | undefined;
  /** 占位标题的首选来源（agent 名）；缺省回落 agentId → `Terminal N`。 */
  agentName?: string;
  /** 交给 PTY 直接执行的命令行（`createTaskTerminal` 必填）。 */
  taskCommand?: string;
  /**
   * 「接回这条**还活着**的会话」：只拆过界面（关 tab 时选了「后台运行」），进程还在。
   * `TerminalViewBase` 见到它就跳过 createSession，改用 attach。
   */
  attachSessionId?: string;
  /**
   * 「从这条**已结束**的会话恢复」：新 PTY 建好后继承它的标题与「已使用」，
   * 旧条目退场（`adopt_live_session`）。
   */
  resumeFromSessionId?: string;
  /** 占位标题覆盖（缺省按上面那条链取）。 */
  title?: string;
}

/**
 * 在**指定单元**里创建终端 tab。返回**新 tab 的 id**；`null` = 该单元终端数已达上限。
 *
 * 返回 id 而不是布尔：`refId` 类调用方（工作项执行记录要指回这个终端）需要它，
 * 而「是否建出来了」用 `!== null` 判，语义不丢。
 *
 * 显式收 `WorkspaceSession` 而不是 `projectId`：活跃单元可能是 linked worktree，
 * 由「项目身份」反推 tab 空间键会激活到另一个空间（用户看到的是「点了没反应」）。
 */
export function createTerminalTabIn(
  workspace: WorkspaceSession,
  opts: TaskTerminalOptions,
): string | null {
  const state = useEditorStore.getState();
  const existing = state.tabs[workspace.key];
  const terminalCount = (existing?.tabs ?? []).filter((t) => t.data.kind === 'terminal').length;
  if (terminalCount >= MAX_TERMINAL_TABS) return null;

  const tabId = generateTabId();
  const tab: Tab = {
    id: tabId,
    scope: { kind: 'workspace', session: workspace },
    // 占位标题：agent 名（初版行为）→ agentId → `Terminal N`。
    // 会话真标题到手后由 `resolveTabTitle` 在渲染期覆盖，不写回 store。
    title: opts.title ?? opts.agentName ?? opts.agentId ?? nextTerminalTitle(existing),
    data: {
      kind: 'terminal',
      agentId: opts.agentId ?? null,
      taskCommand: opts.taskCommand,
      attachSessionId: opts.attachSessionId,
      resumeFromSessionId: opts.resumeFromSessionId,
    },
  };
  state.addTab(tab);
  state.activateTab(workspace.key, tabId);
  return tabId;
}

export interface TaskTerminalCommandOptions extends TaskTerminalOptions {
  taskCommand: string;
}

/**
 * 在当前活跃单元里创建 `taskCommand` 终端 tab（PTY 直接执行命令，无需等 session 就绪）。
 *
 * @returns 新 tab 的 id；配额满（`MAX_TERMINAL_TABS`）`null`。
 */
export function createTaskTerminal(
  projectId: ProjectId,
  opts: TaskTerminalCommandOptions,
): string | null {
  return createTerminalTabIn(activeWorkspaceSession(projectId), opts);
}
