import type { Worktree } from '@/shared/types';

export function filterWorktreeBranches(branches: string[], worktrees: Worktree[]): string[] {
  const excluded = new Set(worktrees.map((wt) => wt.branch));
  return branches.filter((b) => !excluded.has(b));
}

/**
 * 判断 worktree 是否激活：null / undefined / 空字符串均视为未激活，
 * 与 resolveTabKey 的空串语义保持一致（避免 '' 被误判为激活）。
 */
export function isActiveWorktree(path: string | null | undefined): boolean {
  return path !== null && path !== undefined && path !== '';
}
