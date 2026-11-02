import type { Workspace } from '@/shared/types/team';

/**
 * 工作区 → 展示文案（**唯一**映射点，成员 chip 与任务卡片共用）。
 *
 * 只显示 worktree 路径的**末段**：完整绝对路径在窄面板里会挤掉名字，而分支/worktree
 * 目录名对「两个成员是不是并行改同一个树」这个问题才是有信息的。
 */
export function workspaceLabel(workspace: Workspace): string {
  if (workspace === 'shared') return '共享工作区';
  if (workspace === 'read_only') return '只读';
  const path = workspace.worktree.path;
  const base = path.split(/[\\/]/).filter(Boolean).pop();
  return base ? `worktree ${base}` : 'worktree';
}
