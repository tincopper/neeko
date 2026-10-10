import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import { cleanupTerminalsForTabKey } from '@/features/terminal';
import { useProjectStore } from '@/shared/store/projectStore';
import { selectActiveCheckoutPath, useWorkspaceStore } from '@/shared/store/workspaceStore';
import { ProjectId, WorkspaceSession } from '@/shared/utils/workspaceRef';

import {
  removeWorktree,
  deleteBranch,
  renameWorktree,
  canonicalWorktreePath,
  isWorktreeDirty,
} from '../../git/api/gitApi';

export interface ConfirmDeleteState {
  path: string;
  branch: string;
  isDirty: boolean;
}

/**
 * WorktreeList 的**动作层**：删除 / 改名 / 确认弹窗的状态与处理器（组件 300 行上限的
 * 拆分产物 —— UI 组件只留渲染与视图数据）。
 *
 * 生命周期收口契约（与本 hook 的实现一一对应）：
 * - 删除成功后：该单元槽位作废（I1-b「未知 ≠ 旧数据」）+ 它是当前视图时激活态回落主仓
 *   （回落由 `useActiveWorkspaceSync` 反应成「挂载主仓」，这里不手动刷数据）；
 * - 改名成功后：旧路径槽位作废 + 它是当前视图时激活态改指**后端 canonical** 的新路径
 *   （前端派生串不得直接写激活态 —— 归一只能问后端，红线 8/12）。
 */
export function useWorktreeListActions(
  projectId: ProjectId,
  onRefreshGit: (projectId: ProjectId) => void,
  onShowToast?: (message: string, type?: 'info' | 'error') => void,
) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteState | null>(null);

  useEffect(() => {
    if (renaming !== null && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  const handleRemove = useCallback(
    async (worktreePath: string, branch: string, e: ReactMouseEvent) => {
      e.stopPropagation();
      try {
        const isDirty = await isWorktreeDirty(projectId, worktreePath);
        setConfirmDelete({ path: worktreePath, branch, isDirty });
      } catch {
        setConfirmDelete({ path: worktreePath, branch, isDirty: false });
      }
    },
    [projectId],
  );

  const performRemove = useCallback(
    async (worktreePath: string, branch: string) => {
      setConfirmDelete(null);
      setDeleting(worktreePath);
      try {
        // 删除前回收该工作树 tab 空间下的**全部**终端 PTY（分屏 / 多个 tab 都在内）。
        // 传 editor 组键（canonical WorkspaceKey）：终端域在自己的单点把它换算成
        // `:wt:` cache-key 命名空间的前缀（见 terminalTabCleanup 的 terminalSpacePrefix），
        // 调用方不手拼 cache key —— 换算缺失时前缀永不命中，PTY 会一直挂在即将消失的目录上。
        cleanupTerminalsForTabKey(WorkspaceSession.of(projectId, worktreePath ?? null).key);
        await removeWorktree(projectId, worktreePath);
        // 该单元从此没有任何生产者，槽位必须作废（I1-b「未知 ≠ 旧数据」）——命令成功后才做，
        // 失败时工作树还在、挂载与数据仍然有效。作废**只发生一次**：
        // - 删的正是当前视图所在单元 ⇒ 由 `clearActiveWorkspace` 单点完成（同时把激活态回落
        //   主仓，`useActiveWorkspaceSync` 据此重挂主仓，这里不手动刷任何数据）；
        // - 否则该槽位不会被任何其他路径碰到，在此显式作废。
        // 两条路互斥，避免「同一槽作废两次」让 `clearActiveWorkspace` 的单点契约变假。
        if (selectActiveCheckoutPath(useWorkspaceStore.getState(), projectId) === worktreePath) {
          useWorkspaceStore.getState().clearActiveWorkspace(projectId);
        } else {
          useProjectStore
            .getState()
            .invalidateStatus(WorkspaceSession.of(projectId, worktreePath ?? null).key);
        }
        let branchError: string | null = null;
        try {
          await deleteBranch(projectId, branch, false);
        } catch (e: unknown) {
          branchError = String(e);
        }
        await new Promise((r) => setTimeout(r, 450));
        onRefreshGit(projectId);
        if (branchError) {
          onShowToast?.(`Branch "${branch}" could not be deleted: ${branchError}`, 'error');
        }
      } catch (e: unknown) {
        onShowToast?.(`Failed to remove worktree: ${String(e)}`, 'error');
      } finally {
        setDeleting(null);
      }
    },
    [projectId, onRefreshGit, onShowToast],
  );

  const startRename = useCallback((worktreePath: string, e: ReactMouseEvent) => {
    e.stopPropagation();
    setRenaming(worktreePath);
    setRenameValue(worktreePath.split(/[\\/]/).pop() ?? worktreePath);
  }, []);

  const commitRename = useCallback(async () => {
    const oldPath = renaming;
    if (!oldPath) return;
    const newName = renameValue.trim();
    setRenaming(null);
    if (!newName) return;
    const oldDirName = oldPath.split(/[\\/]/).pop() ?? '';
    if (newName === oldDirName) return;
    try {
      const newFullPath = oldPath.replace(/[^/\\]+$/, newName);
      await renameWorktree(projectId, oldPath, newFullPath);
      // 旧路径的单元身份从此不存在：后端已释放其挂载，前端槽位同步作废；
      // 若它正是当前视图，激活态改指新路径（下一轮由挂载唯一入口取回新单元数据）。
      useProjectStore
        .getState()
        .invalidateStatus(WorkspaceSession.of(projectId, oldPath ?? null).key);
      const wtStore = useWorkspaceStore.getState();
      if (selectActiveCheckoutPath(wtStore, projectId) === oldPath) {
        // activePath 必须是后端 canonical 形态（workspaceStore 的不变量，红线 8/12）：
        // newFullPath 只是前端正则派生的字符串，符号链接根上与 `git worktree list`
        // 回传形态不同形，存活校验（裸等值比较 canonical 清单）会把它误判成
        // 「单元消失」回落主仓。归一只能问后端；归一失败宁可回落主仓，也不留
        // 第二种身份表示。
        const canonical = await canonicalWorktreePath(projectId, newFullPath).catch(() => null);
        useWorkspaceStore.getState().setActiveWorkspace(projectId, canonical, undefined);
      }
      onRefreshGit(projectId);
    } catch (e: unknown) {
      onShowToast?.(String(e), 'error');
    }
  }, [renaming, renameValue, projectId, onRefreshGit, onShowToast]);

  const cancelRename = useCallback(() => {
    setRenaming(null);
    setRenameValue('');
  }, []);

  const dismissConfirmDelete = useCallback(() => setConfirmDelete(null), []);

  return {
    renaming,
    renameValue,
    setRenameValue,
    renameInputRef,
    deleting,
    confirmDelete,
    dismissConfirmDelete,
    handleRemove,
    performRemove,
    startRename,
    commitRename,
    cancelRename,
  };
}
