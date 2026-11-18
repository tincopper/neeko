import React, { createContext, useContext } from 'react';

import type { ProjectId } from '@/shared/utils/workspaceRef';

/**
 * 项目与 worktree 的**副作用动作总线**（provider 挂在 app 根，覆盖整个 shell ——
 * `src/app/AppProviders.tsx`）。只放动作，不放状态（状态在 `projectStore` / `workspaceStore`）。
 *
 * # 为什么住在 `shared/contexts/` 而不是 `features/project/`
 *
 * 能力本身是项目的，但**消费方**跨了一层 feature：`features/live-sessions` 的侧栏行点击
 * 需要「切项目」这唯一的序列（`useActivateUnit` → `onSelectProject`）。而
 * `features/project` 又渲染侧栏字节（`ProjectGitSection` / `WorktreeList` 都用
 * `UnitSessionList`），于是从 `@/features/project` 门面取本 hook 会形成目录级循环导入
 * （实测 `import/no-cycle: Dependency cycle via ./components/ProjectGitSection`）。
 *
 * 本模块只依赖 react + `WorkspaceRef`（零 feature 依赖），落横切层即可解开那个环。
 * `features/project/ProjectContext.tsx` 保留为 re-export 门面 —— 既有导入路径与
 * `vi.mock('@/features/project/ProjectContext')` 一概不变，且模块身份仍只有这一个。
 */
/**
 * 切项目的**唯一序列**（`useCrossTypeSelection.handleSelectProject`）的类型。
 *
 * `activateUnit` / `useActivateSession` 收的就是这个类型 —— 单一定义点，避免消费侧各自
 * 重新声明一遍「等价签名」。
 */
export type SelectProject = (projectId: ProjectId) => void | Promise<void>;

export interface ProjectActionsContextValue {
  onRemoveProject: (projectId: ProjectId) => void;
  /**
   * 切项目 = **唯一序列**（`useCrossTypeSelection.handleSelectProject`）：关设置视图 →
   * 清掉所有项目的激活单元 → 写 `activeProjectId/activeProject` → 按项目类型刷新 git →
   * local 走 `useProjectSelection.selectProject`。
   *
   * 返回 `void | Promise<void>` 是**运行期事实的类型化**：实现是 `async`。调用侧若要求
   * 「等这条序列结算之后再落单元」（`activateUnit`），必须能 await —— 否则某天有人在
   * 序列中间插一个真正的 `await`，单元就会被清回主仓，而症状只是「点了没落到那个工作树」。
   */
  onSelectProject: SelectProject;
  onAddProject: () => void;
  onSelectFile: (projectId: ProjectId, filePath: string) => void;
  onRefreshGit: (projectId: ProjectId) => void;
  onBackToMainTerminal: (projectId: ProjectId) => void;
  onOpenIde?: (projectId: ProjectId) => void;
  onOpenWorktreeTerminal?: (projectId: ProjectId, worktreePath: string, branch: string) => void;
  /** 打开某个项目的 Tasks（先切项目，再进中心视图）—— design §4.2c。 */
  onOpenTasks?: (projectId: ProjectId) => void;
  onDragEnd?: (draggedId: string, targetId: string) => void;
  onSaveProjectSettings?: (
    projectId: ProjectId,
    agentId: string | null,
    ideCommand: string | null,
  ) => void;
}

const ProjectActionsContext = createContext<ProjectActionsContextValue | null>(null);

export function ProjectActionsProvider({
  value,
  children,
}: {
  value: ProjectActionsContextValue;
  children?: React.ReactNode;
}) {
  return <ProjectActionsContext.Provider value={value}>{children}</ProjectActionsContext.Provider>;
}

/**
 * 无 provider 时**抛错**，不降级成「什么都不做」：静默不切项目正是「点了没反应」这个
 * 缺陷的形态。消费侧（侧栏行点击）宁可渲染失败，也不要安静地少做一件事。
 */
export function useProjectActionsContext() {
  const ctx = useContext(ProjectActionsContext);
  if (!ctx) {
    throw new Error('useProjectActionsContext must be used within ProjectActionsProvider');
  }
  return ctx;
}
