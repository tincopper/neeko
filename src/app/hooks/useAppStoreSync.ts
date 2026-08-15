import { useEffect } from 'react';

import { useProjectStore } from '@/shared/store/projectStore';
import { isActiveWorktree } from '@/shared/utils/git';

interface UseAppStoreSyncParams {
  isTerminalView: boolean;
  activeWorktreePath: string | null;
  selectProject: (id: string) => void;
  handleOpenIdeCallback: (project: { id: string; selected_ide: string | null }) => void;
  handleSetProjectIde: (projectId: string, ideCommand: string | null) => void;
}

/**
 * 把「视图状态 + 动作引用」写回 projectStore（供 shell 外部直接调用）。
 * 从 useAppShell 抽出：单独处理 store 引用同步，避免与数据编排混在一起。
 */
export function useAppStoreSync({
  isTerminalView,
  activeWorktreePath,
  selectProject,
  handleOpenIdeCallback,
  handleSetProjectIde,
}: UseAppStoreSyncParams): void {
  useEffect(() => {
    useProjectStore.setState({
      isTerminalView: isTerminalView || isActiveWorktree(activeWorktreePath),
      selectProject,
      openIde: handleOpenIdeCallback,
      setProjectIde: handleSetProjectIde,
    });
  }, [
    isTerminalView,
    activeWorktreePath,
    selectProject,
    handleOpenIdeCallback,
    handleSetProjectIde,
  ]);
}
