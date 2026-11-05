import { useCallback } from 'react';

import { useAppViewStore } from '@/shared/store/appViewStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';

/**
 * 「打开某个项目的 Tasks」（design §4.2c，左侧 Projects 的项目级入口）。
 *
 * # 为什么是「先切项目，再进视图」，而不是「进视图再切」
 *
 * 工作项按项目存（`workItemsStore` 的槽位是 projectId）。反过来的顺序会让面板在切换的
 * 那一帧先渲染**上一个项目**的工作项，而用户点的是另一个项目的入口 —— 那一帧显示的是别人的
 * 数据，而且没有任何东西会告诉他看错了。
 *
 * # 为什么不复用 `togglePanel('tasks')`
 *
 * `togglePanel` 是**开关**：已经开着时再点会关掉。项目入口的语义是「我要看这个项目的
 * 工作项」，用户从项目 A 的 Tasks 切到项目 B 的入口时，他要的是**换项目**，不是关面板。
 * 所以这里直接 `setAppView('tasks')`（幂等），开关仍归 dock 栏的 Tasks 按钮。
 *
 * # 为什么抽成独立 hook
 *
 * 它是一条**跨域协调**规则（project 域的选择 × app 视图路由）。留在 `useAppShellData` 里
 * 就只能靠整个 shell 的集成测试间接覆盖 —— 而那两者的顺序（先切项目、再切视图）正是
 * 唯一值得钉住的东西。
 */
export function useOpenProjectTasks(
  selectProject: (projectId: ProjectId) => void,
): (projectId: ProjectId) => void {
  return useCallback(
    (projectId: ProjectId) => {
      // 顺序不可交换：先切项目（工作项槽位跟着换），再进视图。
      selectProject(projectId);
      useAppViewStore.getState().setAppView('tasks');
    },
    [selectProject],
  );
}
