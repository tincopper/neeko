import type { Worktree } from '@/shared/types';

export function filterWorktreeBranches(branches: string[], worktrees: Worktree[]): string[] {
  const excluded = new Set(worktrees.map((wt) => wt.branch));
  return branches.filter((b) => !excluded.has(b));
}
