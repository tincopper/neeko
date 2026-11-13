import { Columns3, GitBranch, Minus, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import React, { useCallback, useEffect } from 'react';

import { cn } from '@/lib/utils';
import type { TeamSnapshot } from '@/shared/types/team';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { useTeamPanel } from '../hooks/useTeamPanel';
import { useTeamTaskTab } from '../hooks/useTeamTaskTab';
import { useTeamStore } from '../store/teamStore';
import { clampZoom } from '../utils/flowViewport';

import TeamFlowGraph from './TeamFlowGraph';
import TeamTaskBoard from './TeamTaskBoard';

/**
 * 团队看板 / 分配图的**中央 tab** 视图（300px 的 dock 列装不下整张板）。
 *
 * # 数据面是 teamStore（唯一快照持有者）
 *
 * 面板与中央 tab 是同一支队伍的两个观察位：挂载时若 store 不在本 tab 的队伍上，
 * `openTeam` 把它拉回来（面板同步切过去）；store 的快照 / 脉冲刷新两者共享，
 * **没有第二份快照**。队伍被关闭（store 回 `null`）时给一张可操作的说明卡，
 * 不渲染空板 —— 「看不出来为什么是空的」比空更糟。
 */
interface TeamBoardCenterViewProps {
  teamId: string;
  /** tab data 里的默认视图；切换是 tab 内部 state（切 tab 回来保留由 data 不变兜底）。 */
  view: 'board' | 'flow';
  /**
   * 本 tab 所属项目身份（由 `PaneContent` 从 tab 的 workspace scope 投影）。
   *
   * 打开任务详情 tab 时要按同一项目落键 —— 域内导航（看板 → 任务详情）由本组件
   * 自己发起，不绕出去让 editor 域代劳（同域闭环，跨域连线只在 wrapper 层）。
   */
  projectId: ProjectId;
}

/**
 * 按钮步长 0.25 与 wheel 步长 0.1（[`flowViewport`]）**各自独立**：
 * 一个是点一下走一大格、一个是滚一格微调，手感不是同一件事，别硬合成一个常量。
 * 边界与钳制仍只有一份实现（ZOOM_MIN / ZOOM_MAX / clampZoom），避免两个真相源。
 */
const ZOOM_BUTTON_STEP = 0.25;
/** 图区高度：扣掉 header / 缩放条等固定高度后的可视高。 */
const FLOW_HEIGHT = 'calc(100vh - 220px)';

const TeamBoardCenterView: React.FC<TeamBoardCenterViewProps> = React.memo(
  ({ teamId, view: initialView, projectId }) => {
    const { teamId: storeTeamId, snapshot, loading, error } = useTeamPanel();
    const openTeam = useTeamStore((s) => s.openTeam);
    const refresh = useTeamStore((s) => s.refresh);
    const [view, setView] = React.useState<'board' | 'flow'>(initialView);
    const [zoom, setZoom] = React.useState(1);
    const { openTaskTab } = useTeamTaskTab();

    // tab data 的 view 变了（用户从面板再点一次「在中间打开」，`mergeTabData` 合并了
    // view）→ 本组件要跟着切。只在 prop 真的变化时同步，不覆盖用户在本 tab 内的切换。
    const lastPropView = React.useRef(initialView);
    React.useEffect(() => {
      if (lastPropView.current === initialView) return;
      lastPropView.current = initialView;
      setView(initialView);
    }, [initialView]);

    // store 不在这支队上（面板切走了 / 首次挂载）→ 拉回来。
    useEffect(() => {
      if (storeTeamId !== teamId) openTeam(teamId);
    }, [storeTeamId, teamId, openTeam]);

    /**
     * 看板列 / 分配图节点 → 任务详情 tab（**域内导航**：agent-team 自己开自己域里的 tab）。
     *
     * 中央看板是任务详情的宿主，必须接线 —— 否则图上节点带 `role="button"` 与
     * 「打开详情」的 aria-label 却什么都不发生（承诺一个不存在的动作）。
     */
    const handleOpenTask = useCallback(
      (taskTeamId: string, taskId: string, title: string) => {
        openTaskTab({ teamId: taskTeamId, taskId, title, projectId });
      },
      [openTaskTab, projectId],
    );

    const active = storeTeamId === teamId;
    const snap: TeamSnapshot | null = active ? snapshot : null;

    return (
      <div className="flex h-full min-h-0 flex-col bg-bg-secondary">
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-ui font-semibold text-text-primary">
            {snap?.team.name ?? teamId}
          </span>
          {snap ? (
            <span className="text-micro text-text-muted">
              {snap.members.length} 成员 · {snap.tasks.length} 任务
            </span>
          ) : null}
          <span className="ml-auto" />
          <div className="flex items-center gap-1" role="group" aria-label="任务视图">
            <button
              type="button"
              aria-pressed={view === 'board'}
              onClick={() => setView('board')}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-micro font-semibold',
                'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                view === 'board'
                  ? 'bg-bg-selected text-accent-blue'
                  : 'text-text-muted hover:bg-bg-hover',
              )}
            >
              <Columns3 size={12} aria-hidden="true" />
              看板
            </button>
            <button
              type="button"
              aria-pressed={view === 'flow'}
              onClick={() => setView('flow')}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-micro font-semibold',
                'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                view === 'flow'
                  ? 'bg-bg-selected text-accent-blue'
                  : 'text-text-muted hover:bg-bg-hover',
              )}
            >
              <GitBranch size={12} aria-hidden="true" />
              分配图
            </button>
          </div>
          {active ? (
            <button
              type="button"
              onClick={() => refresh()}
              aria-label="刷新团队快照"
              className="grid size-7 place-items-center rounded-md text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
            >
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          ) : null}
        </header>

        {!active ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="text-meta text-text-muted">
              该团队当前没有在面板中打开 —— 挂载时会自动切过去；若已关闭，请先在面板里重开。
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {loading && !snap ? (
              <p className="text-meta text-text-muted">正在读取团队快照…</p>
            ) : error ? (
              <p role="alert" className="text-meta text-accent-red">
                {error}
              </p>
            ) : view === 'board' ? (
              <TeamTaskBoard
                tasks={snap?.tasks ?? []}
                members={snap?.members ?? []}
                tasksTruncated={snap?.tasksTruncated ?? false}
                onOpenTask={handleOpenTask}
              />
            ) : (
              <div className="flow-zoom-wrap">
                <div className="mb-1 flex items-center gap-1" role="group" aria-label="分配图缩放">
                  <button
                    type="button"
                    aria-label="缩小"
                    className="grid size-6 place-items-center rounded-md text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
                    onClick={() => setZoom((z) => clampZoom(z - ZOOM_BUTTON_STEP))}
                  >
                    <Minus size={12} aria-hidden="true" />
                  </button>
                  <span className="w-10 text-center font-mono text-micro text-text-muted">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    aria-label="放大"
                    className="grid size-6 place-items-center rounded-md text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
                    onClick={() => setZoom((z) => clampZoom(z + ZOOM_BUTTON_STEP))}
                  >
                    <Plus size={12} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="重置缩放"
                    className="grid size-6 place-items-center rounded-md text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
                    onClick={() => setZoom(1)}
                  >
                    <RotateCcw size={12} aria-hidden="true" />
                  </button>
                </div>
                <div
                  className="overflow-auto rounded-md border border-border bg-bg-primary p-2"
                  style={{ height: FLOW_HEIGHT }}
                >
                  {/* zoom 传给 SVG 本体（精确像素），整张图等比缩放 —— 节点/文字/边一起变。
                      百分比容器宽的旧写法只改外框宽度，与 viewBox 的联动不可靠。 */}
                  <div className="w-fit min-w-full p-1">
                    <TeamFlowGraph
                      tasks={snap?.tasks ?? []}
                      members={snap?.members ?? []}
                      onOpenTask={handleOpenTask}
                      zoom={zoom}
                      onZoomChange={setZoom}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);
TeamBoardCenterView.displayName = 'TeamBoardCenterView';

export default TeamBoardCenterView;
