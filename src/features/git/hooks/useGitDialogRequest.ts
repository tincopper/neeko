import type * as React from 'react';
import { useCallback, useState } from 'react';

import type { DialogState } from '@/shared/components/GitDialog';
import type { ProjectView } from '@/shared/types/activeProject';

interface UseGitDialogRequestParams {
  project: ProjectView;
  /**
   * 宿主侧已有的弹窗宿主（如 dock 布局层）——存在时委托其打开，否则用本地
   * GitDialog 承载。两个入口只差一个 type，共用一个派发避免逐字重复分支。
   */
  onOpenDialog?: (type: 'new-branch' | 'new-worktree', e: React.MouseEvent) => void;
}

/** GitDialog（new-branch / new-worktree）的开关状态域。 */
export function useGitDialogRequest({ project, onOpenDialog }: UseGitDialogRequestParams) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const open = useCallback(
    (type: 'new-branch' | 'new-worktree') => {
      if (onOpenDialog) {
        onOpenDialog(type, {} as React.MouseEvent);
        return;
      }
      setDialog({
        type,
        projectId: project.id,
        branches: project.gitInfo?.branches ?? [],
        projectPath: project.path,
      });
    },
    [onOpenDialog, project],
  );

  const close = useCallback(() => {
    setDialog(null);
  }, []);

  return { dialog, open, close };
}
