import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { useAppViewStore } from '@/shared/store/appViewStore';

/**
 * **跨视图几何对齐**（本轮诉求的正面判据）。
 *
 * 前几轮我在单个视图内部反复调表面 token，但用户真正指出的是一条**跨视图**不变量：
 * 「高度和宽度没有和其他中间内容区域对齐」。
 *
 * 单视图测试抓不到它 —— 每个视图都能自己一致，彼此却差 6px。所以这里断言：
 *
 * 1. 四个中心视图**各自恰好一层**框架（0 层 = 视图裸奔；2 层 = 有视图自己又套了一层，
 *    而那正是对不齐的来源）；
 * 2. 那层框架的类串**逐字相同**（几何只有一套定义）。
 *
 * # 为什么这里 mock 视图，「视图不自写几何」由各自的测试覆盖
 *
 * 渲染真实视图需要 `AppProvider` / 项目 / IPC 等一整套上下文，而那与本判据无关。
 * 「视图有没有偷偷再套一层外壳」分两处把守：
 *
 * - 这里：框架实例数量（视图若自己套 `CenterViewFrame` 就会 > 1）；
 * - 各视图自己的测试：断言组件根**不写** `p-*` / `rounded-*` / `bg-bg-primary`
 *   （如 `TasksPanel.test.tsx` 的「本面板不自写几何」）。
 */
vi.mock('@/app/components/ProjectView', () => ({
  default: () => <div data-testid="view-workspace">Workspace</div>,
}));
// `AppCenter` 从门面 `@/features/settings` 取具名 `SettingsView` —— 必须 mock 那个路径
vi.mock('@/features/settings', () => ({
  SettingsView: () => <div data-testid="view-settings">Settings</div>,
}));
vi.mock('@/app/dock/wrappers/LibraryPanelWrapper', () => ({
  default: () => <div data-testid="view-library">Library</div>,
}));
vi.mock('@/app/dock/wrappers/TasksPanelWrapper', () => ({
  default: () => <div data-testid="view-tasks">Tasks</div>,
}));

import AppCenter from '../AppCenter';
import { CENTER_VIEW_FRAME_CLASS } from '../CenterViewFrame';

const VIEWS = ['normal', 'settings', 'library', 'tasks'] as const;

beforeEach(() => {
  vi.restoreAllMocks();
  useAppViewStore.setState({ appView: 'normal' });
  vi.spyOn(useLibraryStore.getState(), 'refreshPrompts').mockResolvedValue(undefined);
});

describe('中心视图几何对齐', () => {
  it('四个视图各自**恰好一层**框架，且类串逐字相同', () => {
    // 一个 render 实例走完四个视图（用 `rerender`，不手动 cleanup ——
    // 那是全局 setup 的职责，且 rerender 更贴近真实的视图切换）。
    useAppViewStore.setState({ appView: VIEWS[0] });
    const { rerender } = render(<AppCenter />);
    // 基线：框架类串的**逐字快照**（几何只有一套定义，任何视图都不许偏离这一个）
    const baseline = CENTER_VIEW_FRAME_CLASS;

    for (const view of VIEWS) {
      useAppViewStore.setState({ appView: view });
      rerender(<AppCenter />);

      // 恰好一个框架：0 个 = 视图裸奔；2 个 = 有视图自己又套了一层（正是对不齐的来源）
      expect(screen.getAllByTestId('center-view-frame')).toHaveLength(1);
      // 逐字相同：**集合相等**（不是「包含」）—— 多一个类也是偏离基准，少一个也是
      const frame = screen.getByTestId('center-view-frame');
      expect([...frame.classList].sort()).toEqual([...baseline.split(' ')].sort());
    }
  });

  it('框架不含内缩 / 圆角：外圈内缩的唯一所有者是 DockLayout 的 center-area', () => {
    useAppViewStore.setState({ appView: VIEWS[0] });
    render(<AppCenter />);

    const frame = screen.getByTestId('center-view-frame');
    expect(frame.className).not.toMatch(/(^|\s)p[xytrbl]?-/);
    expect(frame.className).not.toMatch(/(^|\s)m[xytrbl]?-/);
    expect(frame.className).not.toMatch(/(^|\s)rounded/);
    // 但必须是海面 + 尺寸链（缺了这两条，岛就没有对比物 / 填不满）
    expect(frame).toHaveClass('bg-bg-primary', 'flex-1', 'min-h-0', 'flex', 'flex-col');
  });
});
