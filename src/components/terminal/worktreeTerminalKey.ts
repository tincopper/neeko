// cache key 格式：projectId + ":wt:" + worktreePath
export function worktreeKey(projectId: string, worktreePath: string) {
   return `${projectId}:wt:${worktreePath}`;
}
