import type { FileChange } from '@/shared/types';

/**
 * G6 契约（redesign-plan §3.2）→ 2026-09-15 简化：Changes 面板只分两类。
 *
 * 纯派生函数（无独立状态，业界公理 3：消费端不做增量推导，只从权威快照派生）：
 * - tracked     = 已纳入版本控制的文件。staged / unstaged / conflicted 统一归此组：
 *                 commit 流程经 commit_files 自动 stage 选中文件（见
 *                 common/git/operations/commit.rs），index 态对 UI 流程无功能意义；
 *                 冲突文件仍以普通行可见，不单独分组。
 * - unversioned = untracked（X='?' && Y='?'；缺 XY 回退 status==='Untracked'）。
 *
 * 缺 XY 的旧 payload 防御回退：Untracked → unversioned，其余 → tracked。
 */

export interface GitStatusGroups {
  tracked: FileChange[];
  unversioned: FileChange[];
}

/** unversioned 判定：XY 优先（X=Y='?'），缺 XY 回退单 status === 'Untracked' */
export function isUnversionedEntry(f: FileChange): boolean {
  if (f.index_status !== undefined && f.worktree_status !== undefined) {
    return f.index_status === '?' && f.worktree_status === '?';
  }
  return f.status === 'Untracked';
}

/** 未合并组合（merge/rebase 冲突）：任一侧 U，或 AA / DD（两侧同为 A / D）。缺 XY 无法判定 → false */
export function isConflictedEntry(f: FileChange): boolean {
  return (
    f.index_status === 'U' ||
    f.worktree_status === 'U' ||
    (f.index_status === 'A' && f.worktree_status === 'A') ||
    (f.index_status === 'D' && f.worktree_status === 'D')
  );
}

export function buildGitStatusGroups(files: FileChange[]): GitStatusGroups {
  const tracked: FileChange[] = [];
  const unversioned: FileChange[] = [];

  for (const f of files) {
    if (isUnversionedEntry(f)) {
      unversioned.push(f);
    } else {
      tracked.push(f);
    }
  }

  return { tracked, unversioned };
}
