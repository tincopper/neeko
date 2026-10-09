import { useCallback } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import {
  activeWorkspaceKeyOf,
  selectActiveCheckoutPath,
  useActiveWorkspace,
  useWorkspaceStore,
  type CheckoutEntry,
} from '@/shared/store/workspaceStore';
import { resolveTabKey } from '@/shared/utils/tabKey';
import { workspaceKeyOf } from '@/shared/utils/workspaceRef';

/**
 * 「当前项目的 Workspace」视图 hook。
 *
 * 单一表示：状态只有 `workspaceStore.byProject[projectId]` 一份（旧版本并行维护过
 * `activeWorktreePath` 等全局镜像，事件回调读镜像 → 读到别的项目/别的工作树的值）。
 * 单一方向：本 hook **只写激活态并作废旧单元槽位**，不发 git 命令 —— 后端挂载由
 * `useActiveWorkspaceSync`（composition 层）对激活态的订阅统一完成。两个发起点必然产生
 * 时序差，那正是旧实现里「列表要不要手动刷新」取决于谁先跑完的根因。
 *
 * **mutator 的目标项目一律显式传入**（第一参数 `projectId`）：渲染期闭包捕获的
 * `activeProjectId` 在跨项目动作里是「切换前」的旧值 —— 同一事件内先
 * `setState({activeProjectId})` 再调 mutator 时回调不会重新绑定，激活态会被写进**旧项目**
 * 的 byProject（跨项目串写；回归契约见 `useWorktreeActions.test.ts`「跨项目打开
 * worktree」与 `useWorkspaceState.test.ts`「mutator 按传入 projectId 写状态」）。
 * 读取全部经 `getState()` 现取，回调引用因此永久稳定。
 */
export function useWorkspaceState(activeProjectId: string | null) {
  const { activePath, activeBranch, opened } = useActiveWorkspace(activeProjectId);

  const activateWorkspace = useCallback((projectId: string, path: string | null, branch = '') => {
    const prevKey = activeWorkspaceKeyOf(projectId);
    const nextKey = workspaceKeyOf(projectId, path);
    useWorkspaceStore.getState().setActiveWorkspace(projectId, path, branch);
    // 旧单元此后没有任何生产者，残留数据不得被渲染（未挂载 = 未知）
    if (prevKey && prevKey !== nextKey) useProjectStore.getState().invalidateStatus(prevKey);
    // 切到新的 tab 空间（tabKey 已按单元分域）
    const tabs = useEditorStore.getState().tabs[resolveTabKey(projectId, path)];
    useEditorStore.setState({ activeTabId: tabs?.activeTabId ?? null });
  }, []);

  const markWorkspaceOpened = useCallback((projectId: string, path: string, branch: string) => {
    useWorkspaceStore.getState().markWorkspaceOpened(projectId, path, branch);
  }, []);

  /** 只改展示用分支名（不切换单元、不触发挂载）。路径现取该项目的当前激活值。 */
  const setActiveWorkspaceBranch = useCallback((projectId: string, branch: string) => {
    const path = selectActiveCheckoutPath(useWorkspaceStore.getState(), projectId);
    useWorkspaceStore.getState().setActiveWorkspace(projectId, path, branch);
  }, []);

  const clearActiveWorkspace = useCallback((projectId: string) => {
    // 槽位作废随 store 级 mutator 单点发生（workspaceStore.clearActiveWorkspace），此处不重复
    useWorkspaceStore.getState().clearActiveWorkspace(projectId);
  }, []);

  return {
    activeCheckoutPath: activePath,
    activeCheckoutBranch: activeBranch,
    openedCheckouts: opened,
    activateWorkspace,
    markWorkspaceOpened,
    setActiveWorkspaceBranch,
    clearActiveWorkspace,
  };
}

export type { CheckoutEntry };
