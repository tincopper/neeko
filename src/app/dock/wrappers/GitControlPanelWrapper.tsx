import React, { useCallback, useMemo } from 'react';

import { GitControlPanel, useRefreshGitInfo } from '@/features/git';
import { useActiveProject } from '@/features/project';
import { useAppContext } from '@/shared/contexts';
import { bumpGitRefresh } from '@/shared/hooks/useGitRefresh';
import { useDockStore } from '@/shared/store/dockStore';
import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore, selectBranch, selectEntries } from '@/shared/store/projectStore';
import { workspaceKeyOf, type WorkspaceKey } from '@/shared/utils/workspaceRef';

/**
 * Git Control dock 面板适配层（薄容器）：只做 dock/上下文适配 —— 面板可见性门控、
 * 当前Workspace定址、git 元数据刷新编排（useRefreshGitInfo）。数据 hooks 内聚在 GitControlPanel。
 *
 * **不再监听 worktree 切换去刷 git**：挂载/刷新由 `useActiveWorkspaceSync`（composition 层）
 * 统一负责，本层只读该单元的槽位。旧实现里这个 effect 与事件回调、聚焦刷新并发写同一个
 * per-project 槽，谁后跑完谁就是屏幕上看到的内容。
 */
const GitControlPanelWrapper: React.FC = React.memo(() => {
  const { showToast } = useAppContext();
  // worktreePath 已由 useActiveProject 从单一表示（workspaceStore.byProject）派生
  const {
    project,
    commands,
    capabilities,
    connectionContext,
    worktreePath: checkoutPath,
  } = useActiveProject();

  // 面板在 dock 中可见（任一 zone 激活且展开）才加载数据
  const isPanelActive = useDockStore((s) => {
    for (const zone of Object.values(s.zones)) {
      if (zone.activePanelId === 'gitControl' && zone.expanded) return true;
    }
    return false;
  });

  const refreshGit = useRefreshGitInfo(project, commands);

  const handleRefreshGit = useCallback(async () => {
    if (project) {
      bumpGitRefresh(project.id);
      await refreshGit();
    }
  }, [refreshGit, project]);

  const workspaceKey: WorkspaceKey = useMemo(
    () => workspaceKeyOf(project?.id ?? '', checkoutPath),
    [project?.id, checkoutPath],
  );

  // 当前单元变更数（Changes tab 徽章）与分支名 —— 都按单元取。
  // **未知 ≠ 0**：槽位缺失（未挂载 / 首快照未到）时保持 undefined，由徽章侧决定不渲染；
  // 在这里折算成 0 等于让「还不知道」伪装成「干净」（ChangesList 已显式区分这两态）。
  const changedFileCount = useProjectStore((s) => selectEntries(s, workspaceKey)?.length);
  const checkoutBranch = useProjectStore((s) => selectBranch(s, workspaceKey));

  const aheadBehindMap = useGitStore((s) => s.aheadBehind);
  // 键 = Workspace身份（与写入侧同一把键，与连接形态无关）
  const aheadBehind = useMemo(
    () => (project ? (aheadBehindMap[workspaceKey] ?? null) : null),
    [project, aheadBehindMap, workspaceKey],
  );

  if (!project || !commands || !capabilities) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        No project selected
      </div>
    );
  }

  // 视图分支 = 当前单元的 HEAD（主仓与 worktree 各认自己的，不再互相污染）
  const effectiveProject =
    checkoutBranch && project.gitInfo
      ? { ...project, gitInfo: { ...project.gitInfo, current_branch: checkoutBranch } }
      : project;

  return (
    <GitControlPanel
      workspaceKey={workspaceKey}
      project={effectiveProject}
      commands={commands}
      capabilities={capabilities}
      connectionContext={connectionContext}
      activeCheckoutPath={checkoutPath}
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
