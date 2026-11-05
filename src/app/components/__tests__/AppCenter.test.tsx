import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { useAppViewStore } from '@/shared/store/appViewStore';

// Mock the three center views so the routing test focuses on which one mounts.
vi.mock('@/app/components/ProjectView', () => ({
  default: () => <div data-testid="view-workspace">Workspace</div>,
}));
vi.mock('@/features/settings/components/SettingsView', () => ({
  default: () => <div data-testid="view-settings">Settings</div>,
}));
vi.mock('@/app/dock/wrappers/LibraryPanelWrapper', () => ({
  default: () => <div data-testid="view-library">Library</div>,
}));
vi.mock('@/app/dock/wrappers/TasksPanelWrapper', () => ({
  default: () => <div data-testid="view-tasks">Tasks</div>,
}));

import AppCenter from '../AppCenter';

describe('AppCenter — single-source center routing (appViewStore)', () => {
  beforeEach(() => {
    useAppViewStore.setState({ appView: 'normal' });
    vi.restoreAllMocks();
  });

  it('renders ProjectView for the normal view', () => {
    useAppViewStore.setState({ appView: 'normal' });
    render(<AppCenter />);
    expect(screen.getByTestId('view-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('view-settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('view-library')).not.toBeInTheDocument();
  });

  it('renders SettingsView only when appView is settings', () => {
    useAppViewStore.setState({ appView: 'settings' });
    render(<AppCenter />);
    expect(screen.getByTestId('view-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('view-workspace')).not.toBeInTheDocument();
  });

  it('renders LibraryPanel when appView is library', async () => {
    vi.spyOn(useLibraryStore.getState(), 'refreshPrompts').mockResolvedValue(undefined);
    useAppViewStore.setState({ appView: 'library' });
    render(<AppCenter />);
    expect(await screen.findByTestId('view-library')).toBeInTheDocument();
    // 工作区常驻但隐藏（hidden 类在无语义包装层上，无 Testing Library 等价查询）
    // eslint-disable-next-line testing-library/no-node-access
    expect(screen.getByTestId('view-workspace').parentElement?.className).toContain('hidden');
  });

  it('keeps Library mounted (hidden) after switching away — no remount flash', async () => {
    vi.spyOn(useLibraryStore.getState(), 'refreshPrompts').mockResolvedValue(undefined);
    useAppViewStore.setState({ appView: 'library' });
    const { rerender } = render(<AppCenter />);
    expect(await screen.findByTestId('view-library')).toBeInTheDocument();

    useAppViewStore.setState({ appView: 'normal' });
    rerender(<AppCenter />);
    expect(screen.getByTestId('view-workspace')).toBeInTheDocument();
    // 常驻：切走后仍在 DOM（hidden），再进无需重挂载
    expect(screen.getByTestId('view-library')).toBeInTheDocument();
  });

  it('refreshes library data in the background on activation', async () => {
    const refreshSpy = vi
      .spyOn(useLibraryStore.getState(), 'refreshPrompts')
      .mockResolvedValue(undefined);
    useAppViewStore.setState({ appView: 'normal' });
    render(<AppCenter />);
    expect(refreshSpy).not.toHaveBeenCalled();

    useAppViewStore.setState({ appView: 'library' });
    expect(await screen.findByTestId('view-library')).toBeInTheDocument();
    expect(refreshSpy).toHaveBeenCalled();
  });
});

/**
 * Tasks 是 tab 面板（中心全宽看板），与 Library **同构**：首进后常驻、`hidden` 切换。
 *
 * 钉三件事：它真的渲染（`AppCenter` 有分支）、它占满中心区（不是被 `hidden` 罩着的那个）、
 * 切走后不卸载（回归重挂载 = 重拉列表 + 丢滚动位置）。
 */
describe('AppCenter — tasks 中心视图', () => {
  beforeEach(() => {
    useAppViewStore.setState({ appView: 'normal' });
    vi.restoreAllMocks();
  });

  it('appView 为 tasks 时渲染 TasksPanel，ProjectView 常驻但隐藏', async () => {
    useAppViewStore.setState({ appView: 'tasks' });
    render(<AppCenter />);

    const tasks = await screen.findByTestId('view-tasks');
    expect(tasks).toBeInTheDocument();
    // 看板必须占据中心区：它的岛不能带 hidden（否则用户看到的是 ProjectView）
    // eslint-disable-next-line testing-library/no-node-access
    expect(tasks.parentElement?.className.split(' ') ?? []).not.toContain('hidden');
    expect(screen.getByTestId('view-workspace').parentElement?.className).toContain('hidden');
  });

  it('切走后常驻（hidden），再次进入不重挂载', async () => {
    useAppViewStore.setState({ appView: 'tasks' });
    const { rerender } = render(<AppCenter />);
    const first = await screen.findByTestId('view-tasks');

    useAppViewStore.setState({ appView: 'normal' });
    rerender(<AppCenter />);
    expect(screen.getByTestId('view-workspace')).toBeInTheDocument();
    // 同一个 DOM 节点（没有重新挂载），且被 hidden 掉
    expect(screen.getByTestId('view-tasks')).toBe(first);
    // eslint-disable-next-line testing-library/no-node-access
    expect(first.parentElement?.className.split(' ')).toContain('hidden');
  });

  it('打开 Settings 时 Tasks 卸载，回来再挂载（settings 是条件渲染）', async () => {
    useAppViewStore.setState({ appView: 'tasks' });
    const { rerender } = render(<AppCenter />);
    expect(await screen.findByTestId('view-tasks')).toBeInTheDocument();

    useAppViewStore.setState({ appView: 'settings' });
    rerender(<AppCenter />);
    expect(screen.getByTestId('view-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('view-tasks')).not.toBeInTheDocument();
  });
});

describe('AppCenter — 中心视图几何对齐（统一框架）', () => {
  /**
   * 判据：**四个中心视图的框架几何必须完全一致**。
   *
   * 这段测试存在的理由是一次真实的返工：Tasks 曾自己写 `rounded-lg bg-bg-primary p-1.5`，
   * 于是它比 ProjectView / Library / Settings 四周各多缩 6px，还多一层圆角 ——
   * 用户的原话是「高度和宽度没有和其他中间内容区域对齐」。
   *
   * 所以这里不逐个断言「长什么样」，而是断言**它们一样**：框架类串完全相同。
   * 新增中心视图时必须回答同一个问题，而不是自由发挥。
   */
  it('normal / settings / library / tasks 用同一个框架（类串逐字相同）', () => {
    vi.spyOn(useLibraryStore.getState(), 'refreshPrompts').mockResolvedValue(undefined);
    useAppViewStore.setState({ appView: 'normal' });
    const { rerender } = render(<AppCenter />);
    const baseline = screen.getByTestId('center-view-frame').className;

    for (const view of ['normal', 'settings', 'library', 'tasks'] as const) {
      useAppViewStore.setState({ appView: view });
      rerender(<AppCenter />);
      // 逐字相同：几何只有一个所有者，视图之间不许有任何差异
      expect(screen.getByTestId('center-view-frame')).toHaveClass(baseline, { exact: true });
    }
  });

  it('框架**不**自写内缩：外圈内缩归 DockLayout 的 center-area（唯一所有者）', () => {
    useAppViewStore.setState({ appView: 'tasks' });
    render(<AppCenter />);

    const frame = screen.getByTestId('center-view-frame');
    // 多缩一层就会让这个视图比别的窄 —— 那正是「对不齐」的直接来源
    expect(frame).not.toHaveClass('p-1.5');
    expect(frame).not.toHaveClass('p-2');
    expect(frame).toHaveClass('bg-bg-primary');
  });
});
