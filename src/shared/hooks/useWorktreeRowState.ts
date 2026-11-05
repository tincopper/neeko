import { useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';

import { getFileName } from '@/shared/utils/fileTree';

/** 删除确认弹窗的内容（worktree 行删除前展示「脏 / 不脏」两种文案）。 */
export interface ConfirmDeleteState {
  path: string;
  branch: string;
  isDirty: boolean;
}

/**
 * linked worktree 行的**交互状态机**（重命名 / 删除 / 确认弹窗）。
 *
 * **为什么单独成 hook**：本地侧栏（`WorktreeList`）与 WSL/SSH 侧栏
 * （`ConnectionWorktreeList`）曾各写一份逐字相同的状态机（状态 + 五个 handler）。那是
 * `.trellis/spec/guides/code-reuse-thinking-guide.md` 的「模式 4：跨域几乎
 * 相同的实现并行」—— 新增一个字段要改两遍，且两份会静默漂移。
 *
 * **边界**：本 hook 只持有**视图交互态**，不发 IPC、不读 store。域侧的真实动作由调用方注入
 * （本地 = `useWorktreeListActions` 的 PTY 回收 + 删分支 + 槽位作废；远端 = 父级回调）。
 * 这样「两个域各自的事务语义」留在各自 adapter 里 —— 那是**刻意的**差异，不该被抽象吞掉。
 */
export function useWorktreeRowState(
  /** 域侧改名（本地: `renameWorktree` + canonical 收口；远端: 父级回调）。 */
  onRename: (oldPath: string, newName: string) => void,
  /**
   * 域侧删除（异步）。状态机 await 它、再按 `removeResetDelayMs` 收尾 ——
   * 是否真返回 Promise 由域侧决定（本地是 async，远端是 fire-and-forget 包装）。
   */
  onRemove: (path: string, branch: string) => void | Promise<void>,
  /** 删除前的脏检查；不传 = 不检查（直接按「不脏」弹确认）。 */
  onCheckDirty?: (path: string) => Promise<boolean>,
  /**
   * 删除后延迟清 spinner（毫秒，默认 0 = 立即清）。
   *
   * 远端（WSL/SSH）父级是**异步刷新**列表：删除命令的 Promise 完成时工作树尚未从清单
   * 消失，立即清 spinner 会让该行「闪回」（spinner 没了、行还在）。传 800 掩盖刷新窗口。
   */
  removeResetDelayMs = 0,
) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteState | null>(null);

  // 这里**没有** focus effect：进入改名态即聚焦并全选是「行内重命名输入框」的职责，
  // 现在由 `InlineRenameInput` 在挂载时自己做（三个调用点共用一份）。
  // 本 hook 再持一份 ref 就会造出第二个「谁聚焦」的实现，而第一份已经漂移过。

  const handleRemove = useCallback(
    async (worktreePath: string, branch: string, e: ReactMouseEvent) => {
      e.stopPropagation();
      if (!onCheckDirty) {
        setConfirmDelete({ path: worktreePath, branch, isDirty: false });
        return;
      }
      try {
        setConfirmDelete({ path: worktreePath, branch, isDirty: await onCheckDirty(worktreePath) });
      } catch {
        // 脏检查失败不阻断删除流程：按「不脏」弹确认（用户仍可自行取消）。
        setConfirmDelete({ path: worktreePath, branch, isDirty: false });
      }
    },
    [onCheckDirty],
  );

  const confirmRemove = useCallback(
    async (worktreePath: string, branch: string) => {
      setConfirmDelete(null);
      setDeleting(worktreePath);
      try {
        await onRemove(worktreePath, branch);
      } catch {
        // **必须吞掉**：`ConfirmDialog` 的 onConfirm 是同步调用（`onClick`），抛出会变成
        // unhandled promise rejection。域侧本就在内部处理失败（本地弹 toast、远端
        // console.error），状态机只负责收尾。
      } finally {
        if (removeResetDelayMs > 0) {
          setTimeout(() => setDeleting(null), removeResetDelayMs);
        } else {
          setDeleting(null);
        }
      }
    },
    [onRemove, removeResetDelayMs],
  );

  const startRename = useCallback((worktreePath: string, e: ReactMouseEvent) => {
    e.stopPropagation();
    setRenaming(worktreePath);
    setRenameValue(getFileName(worktreePath));
  }, []);

  const commitRename = useCallback(() => {
    const oldPath = renaming;
    if (!oldPath) return;
    const newName = renameValue.trim();
    setRenaming(null);
    if (!newName) return;
    const oldDirName = getFileName(oldPath);
    // 名字未变 = 空操作：不打 IPC，也不触发后端改名（曾漏这层判断，会白改一次）。
    if (newName === oldDirName) return;
    onRename(oldPath, newName);
  }, [renaming, renameValue, onRename]);

  const cancelRename = useCallback(() => {
    setRenaming(null);
    setRenameValue('');
  }, []);

  const dismissConfirmDelete = useCallback(() => setConfirmDelete(null), []);

  // 返回对象必须引用稳定：行组件（`WorktreeRowList`、两个域适配器）都上了 `React.memo`，
  // 每次渲染换新对象会让那层 memo 永不命中（与 `useBranchDisplay` /
  // `useConnectionWorktreeActions` 的返回面同一口径）。
  return useMemo(
    () => ({
      renaming,
      renameValue,
      setRenameValue,
      deleting,
      confirmDelete,
      dismissConfirmDelete,
      handleRemove,
      confirmRemove,
      startRename,
      commitRename,
      cancelRename,
    }),
    [
      renaming,
      renameValue,
      setRenameValue,
      deleting,
      confirmDelete,
      dismissConfirmDelete,
      handleRemove,
      confirmRemove,
      startRename,
      commitRename,
      cancelRename,
    ],
  );
}

/**
 * `useWorktreeRowState` 的返回面 —— **唯一产出点**。
 *
 * 行组件把它整块接过去（`rowState` 一个 prop），因此这个类型**必须由 hook 派生**，
 * 不能在组件里再手写一份结构副本（两份会在新增字段时静默漂移，且违反
 * `src/AGENTS.md`「类型管理：组件内不重复定义」）。
 */
export type WorktreeRowState = ReturnType<typeof useWorktreeRowState>;
