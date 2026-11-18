import type { ReactNode } from 'react';

import {
  ProjectActionsProvider,
  type ProjectActionsContextValue,
} from '@/shared/contexts/ProjectActionsContext';

/**
 * 测试用 `ProjectActionsProvider` wrapper。
 *
 * 为什么需要它：侧栏子树（`UnitSessionList` 及其下的一切会话行 / 团队行）**确实需要**
 * 「切项目」这个能力（`useActivateUnit` → `useProjectActionsContext()`），缺 provider 会抛错
 * ——那是刻意的（静默不切项目正是要修的缺陷形态）。所以直接渲染该子树的用例必须包一层。
 *
 * 用法：
 * ```tsx
 * render(<UnitSessionList workspaceKey={KEY} />, { wrapper: createProjectActionsWrapper() });
 * renderHook(() => useTeamEntryActions(), { wrapper: createProjectActionsWrapper({ onSelectProject }) });
 * ```
 *
 * 默认值全为 no-op；要断言调用的用例经 `overrides` 传入 `vi.fn()`（helper 自身不依赖 vitest）。
 * value 在工厂闭包里创建一次 ⇒ 跨渲染引用稳定（每次 render 新建 value 会让消费方无谓重渲染）。
 */
export function createProjectActionsValue(
  overrides: Partial<ProjectActionsContextValue> = {},
): ProjectActionsContextValue {
  const noop = () => {};
  return {
    onRemoveProject: noop,
    onSelectProject: noop,
    onAddProject: noop,
    onSelectFile: noop,
    onRefreshGit: noop,
    onBackToMainTerminal: noop,
    ...overrides,
  };
}

export function createProjectActionsWrapper(overrides: Partial<ProjectActionsContextValue> = {}) {
  const value = createProjectActionsValue(overrides);
  return function ProjectActionsWrapper({ children }: { children: ReactNode }) {
    return <ProjectActionsProvider value={value}>{children}</ProjectActionsProvider>;
  };
}
