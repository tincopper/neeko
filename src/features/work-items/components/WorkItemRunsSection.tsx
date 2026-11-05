import { RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import { useActiveWorkspaceSession } from '@/shared/store/workspaceStore';
import type { AgentConfig } from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { Button } from '@/ui/Button';

import { listAgents } from '../../agent/api/agentApi';
import {
  defaultAgentIdForProject,
  useRunSingleWorkItem,
  type ShowToast,
} from '../hooks/useRunSingleWorkItem';
import { useWorkItemRuns } from '../hooks/useWorkItemRuns';
import type { WorkItem } from '../types';

import WorkItemRunRow from './WorkItemRunRow';

/**
 * 详情底部的「执行」区（design §4.6）：动作入口 + agent 选择 + 执行记录。
 *
 * # 三个入口始终可见，不可用的那两个置灰 + 各自一行原因
 *
 * design §4.6 与 PRD US-RUN-3：不可用时**不隐藏**（隐藏会让用户以为能力不存在，于是去翻
 * 菜单）、**不做假按钮**（点了没反应也不说为什么）。`single` 已落地，`team` 要等团队域收尾，
 * `flow` 连引擎都没有 —— 两者的原因不同，所以不共用一句话。
 *
 * # 三块职责各有归属，不揉在本组件里
 *
 * | 关注点 | 住在哪里 | 为什么 |
 * | --- | --- | --- |
 * | 拉执行记录 | `hooks/useWorkItemRuns.ts` | 生命周期跟「这次打开的详情」绑死；**不进 store**（它是只读旁路，design §4.6） |
 * | 发起一次 `single` 执行 | `hooks/useRunSingleWorkItem.ts` | 选 agent / 拼指令 / 开终端 / 写记录的编排；toast 由面板注入（这里 `useToast()` 会写进一个没人渲染的 state） |
 * | 一行记录长什么样 | `WorkItemRunRow.tsx` | 纯呈现 + 三张语义表；不取数、不读 store |
 *
 * 本组件只剩「谁在这里、能不能点、点了以后要不要重读」。
 *
 * # 写入成功后必须重读一次（失败也要）
 *
 * 记录是**跨端的另一份事实**（`work_item_run_list`）：本地凭据没有任何乐观插入，不重读就不会
 * 出现在列表里。记录失败时更需要读 —— 用户刚被告知「账没记上」，他需要看到库里到底有没有。
 * 反过来，终端都没起来（缺命令 / 配额满）则不重读：什么都没发生，刷新只会让列表闪一下。
 */
const TEAM_DISABLED_REASON =
  'Assign to team: the team-side entry point is not wired yet (depends on task 10-30)';
const FLOW_DISABLED_REASON =
  'Run flow…: the fixed-flow engine is not implemented; this entry is a placeholder';

/** agent 下拉的尺寸与配色（与 `WorkItemForm` 的 select 同一套 token，不另立一套）。 */
const SELECT_CLASS =
  'h-7 max-w-[10rem] rounded-md border border-border bg-bg-primary px-1.5 text-micro text-text-primary focus:border-accent-blue focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none';

/**
 * agent 下拉的候选：**只收声明了 `command` 的**。
 *
 * 没有命令的 agent（如 `mockAgent`）开不出会话，列进下拉等于给用户一个「点了才知道不行」的
 * 选项。**拉不到列表不禁用按钮**：空列表只说明「我们不知道还有谁」，缺省 agent 仍然可以试
 * 一次 —— 把「列表失败」升级成「功能不可用」是另一类谎报。
 */
function usePromptCapableAgents(): AgentConfig[] {
  const [agents, setAgents] = useState<AgentConfig[]>([]);

  useEffect(() => {
    let cancelled = false;
    listAgents().then(
      (rows) => {
        if (cancelled) return;
        setAgents(rows.filter((row) => row.command.trim() !== ''));
      },
      () => {
        if (cancelled) return;
        setAgents([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return agents;
}

interface WorkItemRunsSectionProps {
  /** 详情打开的那条工作项（`run` 需要它的字段来拼指令）。 */
  item: WorkItem;
  /** 宿主注入的激活项目：终端落在它的 tab 空间里（`null` = 没绑定，不能发起执行）。 */
  projectId: string | null;
  /**
   * toast 由**面板**持有并渲染（`shared/hooks/useToast` 的 `showToast`）。
   *
   * 不在本组件里 `useToast()`：那会把消息写进一个只有自己知道、永远没人渲染的 state，
   * 于是失败静默（`ShowToast` 的签名就是那个 hook 的回调类型）。
   */
  showToast: ShowToast;
}

const WorkItemRunsSection: React.FC<WorkItemRunsSectionProps> = React.memo(
  ({ item, projectId, showToast }) => {
    const { id: workItemId } = item;
    const { runs, loading, error, reload } = useWorkItemRuns(workItemId);
    const agents = usePromptCapableAgents();
    const { run, launching } = useRunSingleWorkItem(projectId, showToast);

    /** 下拉的当前值：`null` = 用户还没选（用项目缺省）。 */
    const [pickedAgentId, setPickedAgentId] = useState<string | null>(null);
    const defaultAgentId = defaultAgentIdForProject(projectId);
    const agentId = pickedAgentId ?? defaultAgentId;

    /**
     * 下拉选项：候选列表 + **保证当前值在其中**。
     *
     * 缺省 agent 可能来自项目配置（`selected_agents[0]`），也可以是一个还没被
     * `listAgents()` 收录的自定义 agent。把它补进选项里，`<select>` 才有一个合法的
     * value —— 否则浏览器会把它渲染成空选项，而用户看到的「选了 A」和实际要跑的 B 不一致。
     */
    const agentOptions = useMemo(() => {
      const known = agents.map((agent) => ({ id: agent.id, label: agent.name || agent.id }));
      return known.some((option) => option.id === agentId)
        ? known
        : [{ id: agentId, label: agentId }, ...known];
    }, [agents, agentId]);

    /**
     * 陈旧度的「现在」：只在**挂载**与**每次刷新**这两个瞬间读一次。
     *
     * 不起定时器：`isStale` 是渲染提示（design §4.6），而 design 的刷新策略本身就是
     * 「打开详情刷新一次 + 手动刷新」—— 快照只在两个瞬间被看，为一个徽标挂一个常驻心跳不值当
     * （相对的取舍：快速打开又放置十几分钟时，徽标不会自己亮起来，需要自己点↻）。
     */
    const [now, setNow] = useState(() => Date.now());

    const handleReload = useCallback(() => {
      setNow(Date.now());
      reload();
    }, [reload]);

    /** 跳转要的 tab 空间键：**唯一铸造点**是 `activeWorkspaceSession(projectId).key`，不自己拼。
     *
     * `as ProjectId` 是收回品牌而不是重新铸造：面板的 `projectId` 是 `useProjectStore.activeProjectId`
     * 放宽成 `string` 之后的副本（见 `TasksPanel` 的 props 注释），品牌在 store 侧已经是真的。
     */
    const session = useActiveWorkspaceSession(projectId as ProjectId | null);
    /**
     * 这个 tab 空间里现存的 tab（订阅数组引用，不复制成新对象）。
     *
     * 用它判断「执行记录指向的终端还在不在」：记录是历史，tab 可能早已被关掉。判断放在渲染期
     * 是为了让按钮**如实**变成 disabled —— 点一个必定无声失败的按钮比没有按钮更让人困惑。
     */
    const tabs = useEditorStore((state) =>
      session === null ? null : (state.tabs[session.key]?.tabs ?? null),
    );
    const openTabIds = useMemo(() => new Set((tabs ?? []).map((tab) => tab.id)), [tabs]);

    const handleOpenRun = useCallback(
      (tabId: string) => {
        if (session === null) return;
        // 已被关掉的 tab 会让 activateTab 静默无操作（它找不到目标就返回原状态）——
        // 这条路径在 UI 上已经不可达（按钮 disabled），所以不需要第二道判断。
        useEditorStore.getState().activateTab(session.key, tabId);
      },
      [session],
    );

    const handleRun = useCallback(() => {
      void run(item, pickedAgentId ?? undefined).then((launched) => {
        // 终端起来了就重读一次：**记录成败都要读**（失败时用户更需要看到库里到底有没有）。
        // 失败但没起来（缺命令 / 配额满）不读：什么都没发生，刷新只会让列表闪一下。
        if (launched) handleReload();
      });
    }, [handleReload, item, pickedAgentId, run]);

    return (
      <section aria-label="Runs" className="mt-3 border-t border-border pt-2">
        <header className="flex items-center justify-between gap-1">
          <h4 className="text-micro font-semibold text-text-secondary">Runs</h4>
          <button
            type="button"
            onClick={handleReload}
            aria-label="Refresh runs"
            // 图标用 lucide（不是字符 `↻`）：字符图标不跟字号、部分字体下渲染成方块，
            // 且全仓其余刷新按钮都是 `RefreshCw`。尺寸与 `TasksPanelHeader` 同档。
            className="inline-flex size-6 items-center justify-center rounded text-meta text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            <RefreshCw aria-hidden="true" className="size-3" />
          </button>
        </header>

        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Button
            variant="primary"
            size="sm"
            disabled={launching || projectId === null}
            aria-busy={launching}
            title={projectId === null ? 'No active project' : undefined}
            onClick={handleRun}
          >
            Run with agent
          </Button>
          <label className="flex items-center gap-1 text-micro text-text-secondary">
            <span className="sr-only">Select agent</span>
            <select
              aria-label="Select agent"
              value={agentId}
              disabled={launching}
              onChange={(event) => setPickedAgentId(event.target.value)}
              className={SELECT_CLASS}
            >
              {agentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" size="sm" disabled title={TEAM_DISABLED_REASON}>
            Dispatch to team
          </Button>
          <Button variant="secondary" size="sm" disabled title={FLOW_DISABLED_REASON}>
            Run flow…
          </Button>
        </div>
        {/* 一行原因，按档分开：两档不可用的理由不同，共用一句话就有一句是假的。 */}
        <p className="mt-1 text-micro text-text-muted">{TEAM_DISABLED_REASON}</p>
        <p className="text-micro text-text-muted">{FLOW_DISABLED_REASON}</p>

        {error === null ? null : (
          <p role="alert" className="mt-1 text-micro break-words text-accent-red">
            {error}
          </p>
        )}

        {loading ? (
          <p role="status" className="mt-1 text-micro text-text-muted">
            Loading runs…
          </p>
        ) : runs.length === 0 ? (
          <p className="mt-1 text-micro text-text-muted">No runs yet</p>
        ) : (
          <ul aria-label="Runs" className="mt-1 flex flex-col gap-1">
            {runs.map((record) => (
              <WorkItemRunRow
                key={record.id}
                run={record}
                tabOpen={record.ref.kind === 'session' && openTabIds.has(record.ref.id)}
                now={now}
                onOpen={handleOpenRun}
              />
            ))}
          </ul>
        )}
      </section>
    );
  },
);
WorkItemRunsSection.displayName = 'WorkItemRunsSection';

export default WorkItemRunsSection;
