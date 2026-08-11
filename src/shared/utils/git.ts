import type { GitInfo, Worktree } from '@/shared/types';

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

/**
 * 合并 worktree 场景下写回 projectStore 的 git_info：
 * worktree 激活时保留主分支（local 入口）的 current_branch，
 * 避免 store 中项目的 current_branch 被 worktree 分支名污染。
 * 其余字段（changed_files 等）仍使用 worktree 的最新数据。
 */
export function mergeGitInfoForStore(
  existing: GitInfo | null | undefined,
  incoming: GitInfo,
  worktreeActive: boolean,
): GitInfo {
  // incoming（get_git_info）不返回 ignored_files；从 existing 继承，
  // 避免 Git 面板刷新后文件树的忽略灰色状态丢失。
  const merged = { ...existing, ...incoming };
  if (!worktreeActive) return merged;
  // worktree 激活时保留主分支（local 入口）的 current_branch，
  // 避免 store 中项目的 current_branch 被 worktree 分支名污染。
  return { ...merged, current_branch: existing?.current_branch ?? incoming.current_branch };
}
