import React, { useCallback, useEffect, useMemo } from 'react';

import { GitControlPanel, useRefreshGitInfo } from '@/features/git';
import { useActiveProject } from '@/features/project';
import { useAppContext } from '@/shared/contexts';
import { bumpGitRefresh } from '@/shared/hooks/useGitRefresh';
import { useDockStore } from '@/shared/store/dockStore';
import { useGitStore } from '@/shared/store/gitStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import { aheadBehindKey } from '@/shared/utils/aheadBehindKey';

/**
 * Git Control dock 面板适配层（薄容器）：
 * 只做 dock/上下文适配 —— 激活门控（isActive）、project 视图转换（worktree 分支覆盖）、
 * git info 刷新编排（useRefreshGitInfo）。数据 hooks 全部内聚在 GitControlPanel。
 */
const GitControlPanelWrapper: React.FC = React.memo(() => {
  const { showToast } = useAppContext();
  const { project, commands, capabilities, connectionContext } = useActiveProject();
  const activeWorktreeBranch = useWorktreeStore((s) => s.activeWorktreeBranch);
  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);

  // 面板在 dock 中可见（任一 zone 激活且展开）才加载数据
  const isPanelActive = useDockStore((s) => {
    for (const zone of Object.values(s.zones)) {
      if (zone.activePanelId === 'gitControl' && zone.expanded) return true;
    }
    return false;
  });

  const refreshGit = useRefreshGitInfo(project, commands, connectionContext);

  // 切换 worktree 时刷新 git info，保持 changes 列表同步
  useEffect(() => {
    refreshGit().catch(console.error);
  }, [activeWorktreePath, refreshGit]);

  const handleRefreshGit = useCallback(async () => {
    if (project) bumpGitRefresh(project.id);
    await refreshGit();
  }, [refreshGit, project]);

  // 从全局 useGitStore 读取 ahead/behind（单数据源），传入 commit panel
  const aheadBehindMap = useGitStore((s) => s.aheadBehind);
  const aheadBehind = useMemo(() => {
    if (!project || !connectionContext) return null;
    const cc = connectionContext;
    let key;
    if (cc.type === 'wsl') {
      key = aheadBehindKey('wsl', cc.distro, project.id);
    } else if (cc.type === 'remote') {
      key = aheadBehindKey('remote', cc.host, project.id);
    } else {
      key = aheadBehindKey('local', project.id, project.id);
    }
    return aheadBehindMap[key] ?? null;
  }, [project, connectionContext, aheadBehindMap]);

  if (!project || !commands || !capabilities) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        No project selected
      </div>
    );
  }

  // Override gitInfo.current_branch when a worktree is active
  const effectiveProject =
    activeWorktreeBranch && project.gitInfo
      ? {
          ...project,
          gitInfo: {
            ...project.gitInfo,
            current_branch: activeWorktreeBranch,
          },
        }
      : project;

  const changedFileCount = project.gitInfo?.changed_files?.length ?? 0;

  return (
    <GitControlPanel
      project={effectiveProject}
      commands={commands}
      capabilities={capabilities}
      connectionContext={connectionContext}
      activeWorktreePath={activeWorktreePath}
      active={isPanelActive}
      onRefreshGit={handleRefreshGit}
      onShowToast={showToast}
      aheadBehind={aheadBehind}
      changedFileCount={changedFileCount}
    />
  );
});
GitControlPanelWrapper.displayName = 'GitControlPanelWrapper';

export default GitControlPanelWrapper;
export { GitControlPanelWrapper };
