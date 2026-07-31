const WT_SEP = ':wt:';

/**
 * Build composite tab key for worktree tabs.
 * Each worktree gets its own independent tab space.
 */
export function buildWorktreeTabKey(projectId: string, worktreePath: string): string {
  return `${projectId}${WT_SEP}${worktreePath}`;
}

/**
 * Extract the real project ID from a composite tab key.
 * For "proj123:wt:/path" returns "proj123".
 * For plain "proj123" returns "proj123".
 */
export function parseProjectIdFromTabKey(tabKey: string): string {
  const idx = tabKey.indexOf(WT_SEP);
  return idx >= 0 ? tabKey.substring(0, idx) : tabKey;
}

/**
 * Resolve the tab key for a project, honoring an active worktree.
 * When a worktree is active the tab space must be worktree-specific,
 * otherwise tabs (e.g. diff) land in the main project's tab group.
 */
export function resolveTabKey(
  projectId: string,
  activeWorktreePath: string | null | undefined,
): string {
  if (activeWorktreePath) {
    return buildWorktreeTabKey(projectId, activeWorktreePath);
  }
  return projectId;
}
