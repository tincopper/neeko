/**
 * 「Run with agent」的动作面：开一个执行该工作项的 agent 终端，并留下一条执行记录。
 *
 * # 一条链路，五个复用点（本文件不自己造任何一件）
 *
 * | 步 | 复用什么 |
 * | --- | --- |
 * | 选 agent | 项目 `selected_agents[0]`（入参可覆盖） |
 * | 取命令 | `getAgent(id)` → `AgentConfig.command` |
 * | 拼指令 | [`renderWorkItemInstruction`](../utils/workItemInstruction.ts)（只拼意图） |
 * | 拼命令 | [`buildAgentPromptCommand`](../../../shared/utils/agentPromptCommand.ts)（引号转义在这） |
 * | 开终端 | [`createTaskTerminal`](../../terminal/api/taskTerminal.ts)（配额 / ID / 排序 / 创建即激活） |
 *
 * 手里多出来的只有一件事：**把返回的 tab id 记下来**。它是 `WorkItemRun.ref.id` ——
 * 执行记录指向「哪个终端」的唯一定位点（design §3.4）。
 *
 * # 为什么 `ref.id` 是 tab id 而不是 PTY session id
 *
 * PTY session id 在 tab 挂载时才生成，应用重启 / 终端重建后不复存在。用它当锚点，执行记录
 * 会指向一个**不存在的会话**，而用户看到的是「跳转按钮点了没反应」。tab id 由我们 mint、
 * 从建 tab 那一刻就存在，与 tab 同生共死，`activateTab` 能据此定位 —— 是这条链路上唯一可寻址的定位点
 * （关掉 tab 后记录会永久指向「已关闭的会话」，UI 如实置灰，不假装还能跳）。
 *
 * # 记录失败**不回滚**终端
 *
 * 终端已经起来了、agent 已经在跑、用户可能已经在里面输入 —— 这时关掉它等于把一个人的会话
 * 扔掉。所以记录失败只做两件事：toast 说明「执行已开始，但记录没写上」，并让调用方刷新
 * 执行记录列表（否则用户只看得到一句「失败」，不知道库里到底有没有）。
 *
 * # `launching` 为什么还要一个 ref
 *
 * `setLaunched(true)` 是异步的：同一个 tick 里的两次点击都会读到 `launching === false`，
 * 于是开两个终端、记两条记录。ref 是同步的那道闩，state 只是给 UI 画禁用态用的。
 */
import { useCallback, useRef, useState } from 'react';

import { AGENT_IDS } from '@/shared/constants/agentIds';
import { useProjectStore } from '@/shared/store/projectStore';
import { buildAgentPromptCommand } from '@/shared/utils/agentPromptCommand';
import { invokeErrorMessage } from '@/shared/utils/invokeError';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { getAgent } from '../../agent/api/agentApi';
import { createTaskTerminal } from '../../terminal/api/taskTerminal';
import { recordWorkItemRun } from '../api/workItemsApi';
import type { WorkItem } from '../types';
import { renderWorkItemInstruction } from '../utils/workItemInstruction';

/** toast 的形状（与 `shared/hooks/useToast` 的 `showToast` 同签名）。 */
export type ShowToast = (message: string, type?: 'info' | 'error') => void;

export interface UseRunSingleWorkItemResult {
  /**
   * 发起一次 `single` 档执行。
   *
   * @returns **终端是否起来了** —— 不是「记录是否写上」。记录失败时终端仍在跑（见文件头），
   * 调用方拿到 `true` 就该刷新执行记录列表：那是用户核对「到底记上没有」的唯一途径。
   * `false` = 什么都没发生（没有绑定项目 / agent 缺命令 / 终端配额满 / 连点被拦）。
   */
  run: (item: WorkItem, agentId?: string) => Promise<boolean>;
  /** 有一次执行正在起（用来禁用按钮防连点）。 */
  launching: boolean;
}

/**
 * 项目的缺省 agent：`selected_agents[0]`，没有就回落到 opencode。
 *
 * 按**面板绑定的 `projectId`** 查项目，而不是 `activeProject`：dock 面板切换项目的那一帧，
 * `activeProject` 可能已经是另一个项目，而这台终端要落在**这个**项目的 tab 空间里。
 * 两个值绝大多数时候相同，但「绝大多数」在切项目的那一瞬正好不成立。
 */
export function defaultAgentIdForProject(projectId: string | null): string {
  if (projectId === null) return AGENT_IDS.opencode;
  const state = useProjectStore.getState();
  const project = state.projects.find((row) => row.id === projectId) ?? state.activeProject;
  return project?.selected_agents?.[0] ?? AGENT_IDS.opencode;
}

export function useRunSingleWorkItem(
  projectId: string | null,
  showToast: ShowToast,
): UseRunSingleWorkItemResult {
  const [launching, setLaunching] = useState(false);
  /** 同步闩（见文件头「为什么还要一个 ref」）。 */
  const inFlight = useRef(false);

  const run = useCallback(
    async (item: WorkItem, agentId?: string): Promise<boolean> => {
      // 没有激活项目就没有 tab 空间可落（面板正常不会走到这里：列表本来就是空的）。
      if (projectId === null) {
        showToast('No active project; cannot start a run', 'error');
        return false;
      }
      // 连点：第二次直接静默返回，不再弹一次 toast（用户已经看到按钮变灰了）。
      if (inFlight.current) return false;

      inFlight.current = true;
      setLaunching(true);
      try {
        const resolvedId = agentId ?? defaultAgentIdForProject(projectId);
        // agent 配置读不到（未安装 / 已删除）与「没有命令」（如 mockAgent）是同一件事的
        // 两种来源：都开不出会话，都该给出同一句可读的话。
        const agent = await getAgent(resolvedId).catch(() => null);
        if (!agent || agent.command.trim() === '') {
          showToast('That agent is not installed or has no command', 'error');
          return false;
        }

        const taskCommand = buildAgentPromptCommand(agent, renderWorkItemInstruction(item));
        // `as ProjectId` 是收回品牌：面板的 `projectId` 是 `useProjectStore.activeProjectId`
        // 放宽成 `string` 之后的副本，品牌在 store 侧已经是真的（见 `TasksPanel` 的 props 注释）。
        // 端口返回**新 tab 的 id**：它是 `WorkItemRun.ref.id`（跳回这个终端的唯一定位点）。
        const tabId = createTaskTerminal(projectId as ProjectId, {
          agentId: resolvedId,
          agentName: agent.name || undefined,
          taskCommand,
        });
        if (tabId === null) {
          // 配额满：端口没有建 tab，所以这里没有需要撤回的东西。
          showToast('Terminal limit reached; close some terminals first', 'error');
          return false;
        }

        try {
          await recordWorkItemRun({
            workItemId: item.id,
            mode: 'single',
            refKind: 'session',
            refId: tabId,
            runState: 'running',
            label: agent.name || resolvedId,
          });
        } catch (err: unknown) {
          // **不回滚终端**（文件头）：只把「账没记上」说清楚，并让调用方刷新记录。
          showToast(
            `Run started, but recording failed: ${invokeErrorMessage(err, 'Unknown error')}`,
            'error',
          );
        }
        return true;
      } finally {
        inFlight.current = false;
        setLaunching(false);
      }
    },
    [projectId, showToast],
  );

  return { run, launching };
}
