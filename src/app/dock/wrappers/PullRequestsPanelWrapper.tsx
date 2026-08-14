import React, { useCallback, useMemo } from 'react';

import { PullRequestsPanel } from '@/features/git';
import { useActiveProject } from '@/features/project';
import { useAppContext } from '@/shared/contexts';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { Tab } from '@/shared/types';
import { mergeGitInfoForStore } from '@/shared/utils/git';
import { parseProjectIdFromTabKey, resolveTabKey } from '@/shared/utils/tabKey';

/**
 * Pull Requests dock 面板适配层：仅本地项目渲染（canManagePRs capability）。
 * 面板不可见时不渲染面板本身（省 gh CLI 调用）。
 */
const PullRequestsPanelWrapper: React.FC = React.memo(() => {
  const { showToast } = useAppContext();
  const { project, commands, capabilities, worktreePath } = useActiveProject();

  // Only load PR data when the panel is active — avoids gh CLI call on project switch.
  const isActive = useDockStore((s) => {
    for (const zone of Object.values(s.zones)) {
      if (zone.activePanelId === 'pullRequests' && zone.expanded) return true;
    }
    return false;
  });

  const tabKey = useMemo(() => {
    if (!project) return '';
    // worktree tab key 仅对 local 项目生效（WSL/Remote 使用各自的 worktree 流程）
    if (project.type === 'Local') {
      return resolveTabKey(project.id, worktreePath);
    }
    return project.id;
  }, [project, worktreePath]);

  const onRefreshGit = useCallback(
    async (_projectId: string) => {
      void _projectId;
      if (!project || !commands) return;
      const gitInfo = await commands.refreshGitInfo();
      // worktree 激活时保留 local 主分支名，避免 store 中 current_branch 被 worktree 分支污染
      const worktreeActive = useWorktreeStore.getState().activeWorktreePath != null;
      useProjectStore.setState((state) => {
        const nextProjects = state.projects.map((p) =>
          p.id === project.id
            ? { ...p, git_info: mergeGitInfoForStore(p.git_info, gitInfo, worktreeActive) }
            : p,
        );
        return {
          projects: nextProjects,
          activeProject:
            state.activeProjectId === project.id
              ? (nextProjects.find((p) => p.id === project.id) ?? state.activeProject)
              : state.activeProject,
        };
      });
    },
    [project, commands],
  );

  const handleOpenTerminal = useCallback(
    (command: string, title: string) => {
      if (!project) return;
      const editorState = useEditorStore.getState();
      const existingTabs = editorState.tabs[tabKey];
      const tabId = crypto.randomUUID();
      const tab: Tab = {
        id: tabId,
        // tab 的 projectId 必须是真实 project id，不能用复合 worktree tab key
        //（否则后端 resolve_project 找不到项目）
        projectId: parseProjectIdFromTabKey(tabKey),
        title,
        order: existingTabs?.tabs.length ?? 0,
        data: {
          kind: 'terminal',
          agentId: null,
          status: 'Running',
          taskCommand: command,
        },
      };
      editorState.addTab(tabKey, tab);
      editorState.activateTab(tabKey, tabId);
    },
    [project, tabKey],
  );

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        No project selected
      </div>
    );
  }

  if (!capabilities?.canManagePRs) {
    return null;
  }

  // Don't render PullRequestsPanel until user clicks the tab — saves a gh CLI call.
  if (!isActive) {
    return <div className="h-full w-full" />;
  }

  return (
    <PullRequestsPanel
      projectId={project.id}
      tabKey={tabKey}
      onShowToast={showToast}
      onRefreshGit={onRefreshGit}
      onOpenTerminal={handleOpenTerminal}
    />
  );
});
PullRequestsPanelWrapper.displayName = 'PullRequestsPanelWrapper';

export default PullRequestsPanelWrapper;
export { PullRequestsPanelWrapper };
