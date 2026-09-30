import React, { useEffect, useMemo, useRef } from 'react';

import { cn } from '@/lib/utils';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import { BranchIcon, TrashIcon, FolderGitIcon } from '@/shared/components/icons';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveWorktree } from '@/shared/store/worktreeStore';
import { Worktree } from '@/shared/types';
import { repoKeyOf } from '@/shared/utils/repoRef';

import { getRepoStatus } from '../../git/api/gitApi';
import { useWorktreeListActions } from '../hooks/useWorktreeListActions';

import SessionChips from './SessionChips';

interface WorktreeListProps {
  worktrees: Worktree[];
  projectId: string;
  projectPath?: string;
  onOpenWorktreeTerminal?: (projectId: string, path: string, branch: string) => void;
  onRefreshGit: (projectId: string) => void;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
}

interface ChangeStat {
  add: number;
  del: number;
}

const WorktreeList: React.FC<WorktreeListProps> = ({
  worktrees,
  projectId,
  onOpenWorktreeTerminal,
  onRefreshGit,
  onShowToast,
}) => {
  const {
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
  } = useWorktreeListActions(projectId, onRefreshGit, onShowToast);

  // 响应式订阅：这里读的是「哪一行高亮」，用 getState() 快照会在激活态变化后停在旧值
  // （列表看起来点了没反应）。命令式取法只允许出现在事件回调里。
  const activeWorktreePath = useActiveWorktree(projectId).activePath;

  const filteredWorktrees = useMemo(() => worktrees, [worktrees]);

  // 每个工作树的 chip 读**自己单元**的 status。后端只挂当前视图那个单元（决策 D-B），
  // 其余单元在此按需 pull 并落进同一张快照表（projectStore.statuses）；
  // 拉不到就保持「未知」（chip 不显示），绝不写 0/0 假装干净。
  const unitStatuses = useProjectStore((s) => s.statuses);
  // 新鲜度守卫按**组件挂载**记账，不按全局槽位：槽位跨挂载持久，若拿 `key in statuses`
  // 当跳过守卫，未挂载单元（没有任何生产者）的 chip 一旦拉过就永久陈旧且抑制重拉
  // （= 旧数据伪装成事实）。挂载级 ref 恢复「重新打开面板即重拉」的新鲜度；同一挂载内
  // 它同时防住 applyStatus → statuses 变化 → effect 重跑 → 再拉取的自激环
  // （未挂载单元的 pull 每次都盖新号，version 闸门拦不住自触发）。
  const chipFetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    for (const wt of filteredWorktrees) {
      const key = repoKeyOf(projectId, wt.path);
      if (chipFetchedRef.current.has(key)) continue;
      chipFetchedRef.current.add(key);
      getRepoStatus(projectId, wt.path)
        .then((snapshot) => {
          if (cancelled || snapshot.repo_key !== key) return;
          useProjectStore.getState().applyStatus(snapshot);
        })
        .catch(() => {
          // 拉取失败 = 未知：退出已拉清单，让下一次触发（清单变化 / 重挂载）可以重试
          chipFetchedRef.current.delete(key);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [filteredWorktrees, projectId]);

  const changeStats = useMemo(() => {
    const next: Record<string, ChangeStat> = {};
    for (const wt of filteredWorktrees) {
      const entries = unitStatuses[repoKeyOf(projectId, wt.path)]?.entries;
      if (!entries) continue;
      next[wt.path] = {
        add: entries.reduce((s, f) => s + f.additions, 0),
        del: entries.reduce((s, f) => s + f.deletions, 0),
      };
    }
    return next;
  }, [filteredWorktrees, projectId, unitStatuses]);

  if (filteredWorktrees.length === 0) return null;

  return (
    <>
      {filteredWorktrees.map((wt) => {
        const stats = changeStats[wt.path];
        const isRenaming = renaming === wt.path;
        const isDeleting = deleting === wt.path;
        const isActive = activeWorktreePath === wt.path;
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
              onOpenWorktreeTerminal?.(projectId, wt.path, wt.branch);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (!isRenaming && !isDeleting) {
                  onOpenWorktreeTerminal?.(projectId, wt.path, wt.branch);
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
                backgroundColor: isActive ? 'var(--bg-selected)' : 'transparent',
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
                  className="bg-transparent border-none text-text-muted cursor-pointer px-1.5 py-0.5 rounded flex items-center transition-all duration-150 hover:bg-bg-hover hover:!text-accent-red opacity-0 group-hover:opacity-100"
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
            if (!open) dismissConfirmDelete();
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

export default React.memo(WorktreeList);
