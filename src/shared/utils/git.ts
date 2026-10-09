import type { Worktree } from '@/shared/types';

export function filterWorktreeBranches(branches: string[], worktrees: Worktree[]): string[] {
  const excluded = new Set(worktrees.map((wt) => wt.branch));
  return branches.filter((b) => !excluded.has(b));
}

/**
 * 判断是否处于 linked worktree 单元：null / undefined / 空字符串 = 主仓单元。
 * 与 `workspaceKeyOf` 的空串语义一致（避免 '' 被误判为 worktree）。
 */
export function isActiveWorktree(path: string | null | undefined): boolean {
  return path !== null && path !== undefined && path !== '';
}
