import React, { useCallback } from 'react';

import type { TeamSession, TeamState } from '@/shared/types/team';

import { useTeamPanel } from '../hooks/useTeamPanel';
import { useTeamStore } from '../store/teamStore';

import TaskDetailDrawer from './TaskDetailDrawer';
import TeamLaunchPanel from './TeamLaunchPanel';
import TeamRoster from './TeamRoster';
import TeamTaskBoard from './TeamTaskBoard';

/**
 * 团队面板（`prototype-agent-team.html` 视图 ①，dock 右栏形态）。
 *
 * # 单一真相
 *
 * 面板渲染的一切都来自 `TeamSnapshot`（后端 `view.rs` 推导一次的产物）。这里**不缓存**
 * 成员状态、不派生「租约还剩多久」的时间流逝（那是后端每一拍算的 `leaseRemainingSecs`）——
 * 前端自己维护一份就会与快照漂移，而漂移是静默的。
 *
 * # 空态即入口
 *
 * 没有 `teamId` 时不显示空板，而是显示队长入口（[`TeamLaunchPanel`]）：
 * 「面板是空的」和「你还没有团队」是两件事，前者会让人以为加载失败。
 *
 * # 不做的事（后续阶段）
 *
 * 审批队列、成员 transcript 拉取、团队关闭都不在这里 —— 本面板只回答「团队现在长什么样」。
 */

interface TeamPanelProps {
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  /** 把队长 PTY 接进 dock 终端（跨域动作，由 app 层 wrapper 注入）。 */
  onOpenLeaderTerminal?: (session: TeamSession, title: string) => void;
}

/** 团队状态的展示文案（`TeamState` 是裸枚举，直接渲染会漏出 snake_case）。 */
const TEAM_STATE_LABEL: Record<TeamState, string> = {
  active: '运行中',
  closing: '正在关闭',
  closed: '已关闭',
};

const TeamPanel: React.FC<TeamPanelProps> = React.memo(({ onShowToast, onOpenLeaderTerminal }) => {
  const { teamId, snapshot, detail, loading, error } = useTeamPanel();
  const refresh = useTeamStore((s) => s.refresh);
  const openTaskDetail = useTeamStore((s) => s.openTaskDetail);
  const closeTaskDetail = useTeamStore((s) => s.closeTaskDetail);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleOpenTask = useCallback(
    (taskId: string) => {
      // **只有这里**会触发 `team_task_detail`（红线 4：点开才拉）。
      void openTaskDetail(taskId);
    },
    [openTaskDetail],
  );

  if (!teamId) {
    return (
      <TeamLaunchPanel onShowToast={onShowToast} onOpenLeaderTerminal={onOpenLeaderTerminal} />
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-bg-primary">
      <header className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui font-semibold text-text-primary">
            {snapshot?.team.name ?? teamId}
          </span>
          <span className="truncate text-micro text-text-muted">
            {snapshot
              ? `${TEAM_STATE_LABEL[snapshot.team.state]} · ${snapshot.team.projectPath}`
              : teamId}
          </span>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          aria-label="重新拉取团队快照"
          className="shrink-0 rounded px-1.5 py-0.5 text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
        >
          刷新
        </button>
      </header>

      {error ? (
        <p role="alert" className="border-b border-border px-2 py-1 text-meta text-accent-red">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {snapshot === null && loading ? (
          <p className="p-3 text-meta text-text-muted">正在加载团队快照…</p>
        ) : null}
        <TeamRoster members={snapshot?.members ?? []} />
        <div className="border-t border-border" />
        <TeamTaskBoard
          tasks={snapshot?.tasks ?? []}
          tasksTruncated={snapshot?.tasksTruncated ?? false}
          onOpenTask={handleOpenTask}
        />
      </div>

      {detail ? <TaskDetailDrawer detail={detail} onClose={closeTaskDetail} /> : null}
    </div>
  );
});
TeamPanel.displayName = 'TeamPanel';

export default TeamPanel;
