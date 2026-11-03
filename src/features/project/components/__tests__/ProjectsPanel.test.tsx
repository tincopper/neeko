import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ProjectsPanel from '@/features/project/components/ProjectsPanel';

/**
 * 项目列表的滚动条策略：**整条隐藏，但保留滚动能力**。
 *
 * 判定依据（2026-11-03）：经典滚动条占布局宽度、只占右侧，而本容器的内缩由行自己用
 * `px-3` / `mx-1.5` 表达 —— 留着滚动条就会量出「项目头 0/13、会话行 6/19」这种左右不等；
 * 用 `useScrollbarCompensation` 补又要付「整个列表右移一个占位」的代价。
 * 于是这里二选一，选的是隐藏滚动条。隐藏的跨引擎实现见 `styles/base/tailwind.css`
 * 的 `@utility scrollbar-hidden`（标准属性 + 旧 WebKit 伪元素两条通道）。
 *
 * 依赖面按「空项目列表」裁剪：只 mock 取数据的上下文，子组件在空列表下不渲染。
 *
 * 不断言「没有占位补偿」：jsdom 里滚动条占位恒为 0（没有布局引擎），补偿在那里永远是空转，
 * 写那条断言恒真 —— 属于安慰剂。这条约束由代码层的「不接 hook」（`ProjectsPanel` 注释）
 * 与 `component-guidelines.md` 的「二者互斥」判据保证。
 */
vi.mock('@/shared/contexts/AppContext', () => ({
  useAppContext: () => ({
    config: null,
    agents: [],
    ideCommandOverrides: {},
    showToast: vi.fn(),
  }),
}));

vi.mock('@/features/project/ProjectContext', () => ({
  useProjectActionsContext: () => ({
    onRemoveProject: vi.fn(),
    onSelectProject: vi.fn(),
    onSelectFile: vi.fn(),
    onRefreshGit: vi.fn(),
    onBackToMainTerminal: vi.fn(),
    onOpenIde: vi.fn(),
    onOpenWorktreeTerminal: vi.fn(),
    onSaveProjectSettings: vi.fn(),
    onDragEnd: vi.fn(),
  }),
}));

vi.mock('@/shared/contexts/WslContext', () => ({
  useWslContext: () => ({
    wslEntries: [],
    onRemoveWslProject: vi.fn(),
    onRemoveWslEntry: vi.fn(),
    onAddWslProject: vi.fn(),
    onRefreshWslGit: vi.fn(),
    onOpenWslIde: vi.fn(),
    onOpenWslWorktreeTerminal: vi.fn(),
  }),
}));

vi.mock('@/shared/contexts/RemoteContext', () => ({
  useRemoteContext: () => ({
    remoteEntries: [],
    onRemoveRemoteProject: vi.fn(),
    onRemoveRemoteEntry: vi.fn(),
    onAddRemoteProject: vi.fn(),
    onRefreshRemoteGit: vi.fn(),
    onOpenRemoteIde: vi.fn(),
    onOpenRemoteWorktreeTerminal: vi.fn(),
    invokeRemoteGit: vi.fn(),
  }),
}));

vi.mock('@/shared/store/projectStore', () => ({
  useProjectStore: (selector: (state: { projects: never[]; activeProjectId: null }) => unknown) =>
    selector({ projects: [], activeProjectId: null }),
}));

vi.mock('@/shared/store/workspaceStore', () => ({
  useActiveCheckoutPath: () => null,
}));

vi.mock('@/features/project/hooks/use-active-project', () => ({
  useActiveProject: () => ({ commands: null }),
}));

vi.mock('@/shared/hooks/useAheadBehindSync', () => ({
  useAheadBehindSync: () => undefined,
}));

// 子组件在「空项目列表」下根本不会渲染，但仍然会被 import —— mock 掉它们的模块，
// 让本用例的依赖面只剩「面板自身的布局策略」，不跟着终端 / Git / dnd 子树升级。
vi.mock('@/features/project/components/ProjectItem', () => ({ default: () => null }));
vi.mock('@/features/connection', () => ({ ConnectionProjectCard: () => null }));
vi.mock('@/features/git', () => ({ CommitDialog: () => null }));
vi.mock('@/shared/components/GitDialog', () => ({ default: () => null }));

describe('ProjectsPanel 滚动条策略', () => {
  it('隐藏滚动条（两个引擎通道都声明），但不丢滚动能力', () => {
    render(<ProjectsPanel />);
    const list = screen.getByTestId('projects-scroll');

    // 滚动仍然成立：`overflow-y-auto` 是唯一的滚动开关，删掉它这个面板就滚不动了。
    expect(list).toHaveClass('overflow-y-auto');
    // 隐藏走共享 utility（内部同时写 `scrollbar-width: none` 与 `::-webkit-scrollbar`）。
    expect(list).toHaveClass('scrollbar-hidden');
  });
});
