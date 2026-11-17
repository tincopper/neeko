import type { Workspace } from '@/shared/types/team';

/**
 * 工作区 → 展示文案（**唯一**映射点，成员 chip / 成员行 / 任务卡片共用）。
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

/**
 * 「缺省工作区不渲染」这**一条**规则的落点（R7 / R8 共用）。
 *
 * `shared` 是建队时的缺省值（`Team.defaultWorkspace`），所以它出现在几乎每一行上 ——
 * 而一行里写着「共享工作区」等于什么都没说。花名册与卡片都只渲染**非缺省**的工作区。
 *
 * 反过来 `read_only` 与 worktree 是**真的事实**：前者说「这个人不能改文件」，后者说
 * 「这个人在另一个树里干活」，两件都会改变用户的判断，所以照常渲染。
 *
 * @returns `null` = 缺省值，调用方整枚不渲染（不是渲染一个空串）
 */
export function nonDefaultWorkspaceLabel(workspace: Workspace): string | null {
  // 不复制文案：唯一来源仍是 `workspaceLabel`，这里只回答「该不该渲染」。
  return workspace === 'shared' ? null : workspaceLabel(workspace);
}
