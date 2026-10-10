import React, { useState, useRef, useEffect, useCallback } from 'react';

import { cn } from '@/lib/utils';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import { BranchIcon, TrashIcon, FolderGitIcon } from '@/shared/components/icons';
import SessionChips from '@/shared/components/SessionChips';
import { useWorktreeChangeStats } from '@/shared/hooks/useWorktreeChangeStats';
import type { GitStatusSnapshot, Worktree } from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';

interface ConnectionWorktreeListProps {
  /** 本列表所属项目 —— 状态槽位按 `WorkspaceSession.of(projectId, wt.path).key` 定址（与本地侧栏同一张表）。 */
  projectId: ProjectId;
  worktrees: Worktree[];
  /** 当前激活的 worktree 路径 */
  activeCheckoutPath: string | null;
  /** 点击 worktree 行：触发外部 onOpenWorktreeTerminal */
  onOpenWorktreeTerminal: (worktreePath: string, branch: string) => void;
  /** 双击 worktree label：开始重命名（提交 newName 由父级处理） */
  onCommitRenameWorktree: (oldPath: string, newName: string) => void;
  /** 删除 worktree（含分支） */
  onRemoveWorktree: (worktreePath: string, branch: string) => void;
  /** 按需拉取某单元的 status（落进 `projectStore.statuses`）；失败返回 `null` = 未知。 */
  onFetchStatus?: (worktreePath: string) => Promise<GitStatusSnapshot | null>;
  /** 检查 worktree 是否 dirty */
  onIsWorktreeDirty?: (worktreePath: string) => Promise<boolean>;
}

const ConnectionWorktreeList: React.FC<ConnectionWorktreeListProps> = ({
  projectId,
  worktrees,
  activeCheckoutPath,
  onOpenWorktreeTerminal,
  onCommitRenameWorktree,
  onRemoveWorktree,
  onFetchStatus,
  onIsWorktreeDirty,
}) => {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    path: string;
    branch: string;
    isDirty: boolean;
  } | null>(null);

  useEffect(() => {
    if (renaming !== null && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  // 每个 worktree 的 chip 读**自己单元**的 status（与本地侧栏同一张表、同一把键、同一份
  // 挂载级新鲜度守卫）—— 收在 `useWorktreeChangeStats`，避免本地 / 远端两套形态漂移。
  const changeStats = useWorktreeChangeStats(projectId, worktrees, onFetchStatus);

  const handleRemove = useCallback(
    async (worktreePath: string, branch: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (onIsWorktreeDirty) {
        try {
          const isDirty = await onIsWorktreeDirty(worktreePath);
          setConfirmDelete({ path: worktreePath, branch, isDirty });
        } catch {
          setConfirmDelete({ path: worktreePath, branch, isDirty: false });
        }
      } else {
        setConfirmDelete({ path: worktreePath, branch, isDirty: false });
      }
    },
    [onIsWorktreeDirty],
  );

  const performRemove = useCallback(
    (worktreePath: string, branch: string) => {
      setConfirmDelete(null);
      setDeleting(worktreePath);
      onRemoveWorktree(worktreePath, branch);
      // Connection backends are async; let parent refresh trigger re-render. Reset spinner safety.
      setTimeout(() => setDeleting(null), 800);
    },
    [onRemoveWorktree],
  );

  const startRename = useCallback((worktreePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenaming(worktreePath);
    setRenameValue(worktreePath.split(/[\\/]/).pop() ?? worktreePath);
  }, []);

  const commitRename = useCallback(() => {
    const oldPath = renaming;
    if (!oldPath) return;
    const newName = renameValue.trim();
    setRenaming(null);
    if (!newName) return;
    const oldDirName = oldPath.split(/[\\/]/).pop() ?? '';
    if (newName === oldDirName) return;
    onCommitRenameWorktree(oldPath, newName);
  }, [renaming, renameValue, onCommitRenameWorktree]);

  const cancelRename = useCallback(() => {
    setRenaming(null);
    setRenameValue('');
  }, []);

  if (worktrees.length === 0) return null;

  return (
    <>
      {worktrees.map((wt) => {
        const stats = changeStats[wt.path];
        const isRenaming = renaming === wt.path;
        const isDeleting = deleting === wt.path;
        const isActive = activeCheckoutPath === wt.path;
        const label = wt.path.split(/[\\/]/).pop() ?? wt.path;

        return (
          <div
            key={wt.path}
            role="button"
            tabIndex={0}
            className={cn(
              'group flex items-center gap-2.5 pl-4 pr-3 py-2 mx-1.5 rounded-md cursor-pointer transition-colors',
              isDeleting && 'wt-deleting',
              isActive ? 'bg-bg-selected' : 'hover:bg-bg-hover',
            )}
            onClick={(e) => {
              e.stopPropagation();
              if (isRenaming || isDeleting) return;
              onOpenWorktreeTerminal(wt.path, wt.branch);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (!isRenaming && !isDeleting) {
                  onOpenWorktreeTerminal(wt.path, wt.branch);
                }
              }
            }}
            title={`${wt.path}\nClick to open terminal`}
          >
            <span
              className={cn(
                'w-7 h-7 rounded-md flex items-center justify-center shrink-0',
                isActive ? 'text-text-primary' : 'text-text-muted',
              )}
              style={{
                backgroundColor: isActive ? 'rgba(255,255,255,0.04)' : 'transparent',
              }}
            >
              <FolderGitIcon size={16} />
            </span>
            <div className="flex-1 min-w-0">
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  className="w-full bg-bg-tertiary border border-accent-blue rounded text-text-primary text-[var(--font-size)] font-semibold px-1 py-0.5 outline-none box-border"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <div
                    className="text-[var(--font-size)] font-semibold text-text-primary truncate"
                    onDoubleClick={(e) => startRename(wt.path, e)}
                    title="Double-click to rename"
                  >
                    {label}
                  </div>
                  <div className="text-[0.85em] font-mono text-text-muted truncate">
                    {wt.branch}
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {stats && (stats.add > 0 || stats.del > 0) && (
                <SessionChips.Changes add={stats.add} del={stats.del} />
              )}
              {isDeleting ? (
                <span className="wt-spinner" title="Removing..." />
              ) : (
                <button
                  data-no-drag
                  className="bg-transparent border-none text-text-muted cursor-pointer px-1.5 py-0.5 rounded flex items-center transition-all duration-150 hover:bg-bg-tertiary hover:!text-accent-red opacity-0 group-hover:opacity-100"
                  onClick={(e) => handleRemove(wt.path, wt.branch, e)}
                  title="Remove worktree and branch"
                >
                  <TrashIcon size={12} />
                </button>
              )}
            </div>
          </div>
        );
      })}
      {confirmDelete && (
        <ConfirmDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setConfirmDelete(null);
          }}
          title="Remove Worktree"
          description={
            <>
              {confirmDelete.isDirty ? (
                <p className="text-[13px] text-text-primary mb-3 leading-relaxed text-accent-yellow bg-accent-yellow/[0.08] p-2 px-3 rounded-md border-l-[3px] border-accent-yellow">
                  This worktree has uncommitted changes. Removing it will discard all local changes.
                  Are you sure?
                </p>
              ) : (
                <p className="text-[13px] text-text-primary mb-3 leading-relaxed">
                  Remove worktree{' '}
                  <strong className="text-accent-blue">
                    {confirmDelete.path.split(/[\\/]/).pop()}
                  </strong>{' '}
                  and delete branch{' '}
                  <strong className="text-accent-blue">{confirmDelete.branch}</strong>?
                </p>
              )}
              <div className="flex flex-col gap-1 p-2 px-3 bg-bg-tertiary rounded-md mb-4 font-mono text-xs">
                <span className="text-text-muted break-all">{confirmDelete.path}</span>
                <span className="flex items-center gap-1 text-accent-green">
                  <BranchIcon size={11} /> {confirmDelete.branch}
                </span>
              </div>
            </>
          }
          confirmLabel={confirmDelete.isDirty ? 'Force Remove' : 'Remove'}
          onConfirm={() => performRemove(confirmDelete.path, confirmDelete.branch)}
          danger
        />
      )}
    </>
  );
};

export default React.memo(ConnectionWorktreeList);
