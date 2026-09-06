import type { FileChange } from '@/shared/types';

/**
 * G6 契约（redesign-plan §3.2）：porcelain XY → ChangesList 四组真实语义。
 *
 * 纯派生函数（无独立状态，业界公理 3：消费端不做增量推导，只从权威快照派生）：
 * - staged      = X 存在且 ∉ {' ', '?'}
 * - unstaged    = Y 存在且 ∉ {' ', '?'}（非 unversioned）
 * - unversioned = X='?' && Y='?'（缺 XY 回退 status==='Untracked'）
 * - conflicted  = 未合并组合（U 出现 / AA / DD），独占不进其他组
 *
 * 同一文件允许同时进入 staged 与 unstaged（XY 双非空，VSCode 同款）。
 * 缺 XY 的旧 payload 防御回退：Untracked → unversioned，其余 → unstaged（现行为）。
 */

export interface GitStatusGroups {
  staged: FileChange[];
  unstaged: FileChange[];
  unversioned: FileChange[];
  conflicted: FileChange[];
}

/** 未合并组合：任一侧 U，或 AA / DD（两侧同为 A / D） */
function isUnmerged(x: string | undefined, y: string | undefined): boolean {
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
}

/** unversioned 判定：XY 优先（X=Y='?'），缺 XY 回退单 status === 'Untracked' */
export function isUnversionedEntry(f: FileChange): boolean {
  if (f.index_status !== undefined && f.worktree_status !== undefined) {
    return f.index_status === '?' && f.worktree_status === '?';
  }
  return f.status === 'Untracked';
}

/** 是否携带 XY 契约字段（任一侧存在即视为完整 XY 语义——porcelain 永远双侧输出） */
function hasXy(f: FileChange): boolean {
  return f.index_status !== undefined || f.worktree_status !== undefined;
}

export function buildGitStatusGroups(files: FileChange[]): GitStatusGroups {
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const unversioned: FileChange[] = [];
  const conflicted: FileChange[] = [];

  for (const f of files) {
    const x = f.index_status;
    const y = f.worktree_status;

    if (isUnmerged(x, y)) {
      conflicted.push(f);
      continue;
    }
    if (isUnversionedEntry(f)) {
      unversioned.push(f);
      continue;
    }
    // 缺 XY：旧 payload 回退现行为（全部进 Changes 组）
    if (!hasXy(f)) {
      unstaged.push(f);
      continue;
    }

    let grouped = false;
    if (x !== undefined && x !== ' ' && x !== '?') {
      staged.push(f);
      grouped = true;
    }
    if (y !== undefined && y !== ' ' && y !== '?') {
      unstaged.push(f);
      grouped = true;
    }
    // 防御：双侧均为空格的条目（真实 porcelain 不会产生）归入 unstaged 兜底
    if (!grouped) unstaged.push(f);
  }

  return { staged, unstaged, unversioned, conflicted };
}
