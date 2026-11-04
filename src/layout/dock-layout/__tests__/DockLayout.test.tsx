import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Zone 可见性 = **内容**的函数（P5）。本测试只钉「接线」：布局层把
 * `tabHostTabCounts`（app 注入的内容事实）与派生判据 `isZoneRenderable` 接到
 * `ResizablePanel` 的尺寸上 —— 判据本身有纯函数用例（`shared/dock/__tests__/zone.test.ts`）。
 *
 * 内容事实是**条数**而不是布尔：「非空」只在 `isZoneRenderable` 内部（`> 0`）决定一处，
 * 消费侧不再做布尔映射（同一事实的更细形式，不是第二个判据）。
 *
 * 观测点是 panel 的 `defaultSize`：zone 不占位 = 宽度 0%（与右区既有的
 * 「无 zone 内容 → 0%」同一形态），而不是「渲染一座空岛再用文案解释」。
 */

vi.mock('@/ui/Resizable', () => ({
  ResizablePanelGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({
    id,
    defaultSize,
    children,
  }: {
    id: string;
    defaultSize?: string | number;
    children?: ReactNode;
  }) => (
    <div data-testid={`panel-${id}`} data-size={String(defaultSize)}>
      {children}
    </div>
  ),
  ResizableHandle: () => <div />,
}));
// `usePanelRef` 仍从真实库取（返回 null 引用的 stub）：DockLayout 的 imperative 分支
// 在无面板句柄时早退，本测试只看派生出来的尺寸。
vi.mock('react-resizable-panels', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePanelRef: () => ({ current: null }),
}));
vi.mock('../DockBar', () => ({ default: () => null }));
vi.mock('../DockBarDnd', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../DockZone', () => ({
  default: ({ zoneId }: { zoneId: string }) => <div data-testid={`zone-${zoneId}`} />,
}));

import { DOCK_VIEW_META, panelView, tabHostView } from '@/shared/dock';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';

import { DockRegistryProvider, type DockViewRegistry } from '../../DockRegistryContext';
import DockLayout from '../DockLayout';

/**
 * 只用到 `defaultSlotSize`（右槽宽度的默认值）；真实注册表由 `buildDockPanelRegistry`
 * 保证 hosted 视图必有 component，所以本层的可见性判据不看 registry。
 */
const REGISTRY: DockViewRegistry = Object.fromEntries(
  Object.entries(DOCK_VIEW_META).map(([view, meta]) => [
    view,
    {
      ...meta,
      title: view,
      icon: 'X',
      component: (() => null) as unknown as DockViewRegistry[string]['component'],
    },
  ]),
);

function renderLayout(tabHostTabCounts?: { left: number; right: number }) {
  return render(
    <DockRegistryProvider registry={REGISTRY}>
      <DockLayout tabHostTabCounts={tabHostTabCounts}>
        <div data-testid="center" />
      </DockLayout>
    </DockRegistryProvider>,
  );
}

/** 该 zone 是否占位（宽度 > 0%）。 */
function zoneTakesSpace(slot: 'left' | 'right'): boolean {
  const size = screen.getByTestId(`panel-${slot}-zone`).getAttribute('data-size');
  return size !== '0%';
}

beforeEach(() => {
  useDockStore.setState({ ...createDefaultDockState(), leftZoneExpandedBeforeLibrary: null });
});

describe('DockLayout — 空宿主不占位（可见性从内容派生）', () => {
  it('前台是槽位宿主且它没有 tab → 该槽 0%（不留空岛）', () => {
    useDockStore.getState().activateView(tabHostView('right'));
    renderLayout({ left: 0, right: 0 });

    expect(zoneTakesSpace('right')).toBe(false);
  });

  it('前台是槽位宿主且有 tab → 该槽按宿主默认尺寸占位', () => {
    useDockStore.getState().activateView(tabHostView('right'));
    renderLayout({ left: 0, right: 1 });

    expect(screen.getByTestId('panel-right-zone')).toHaveAttribute(
      'data-size',
      `${DOCK_VIEW_META[tabHostView('right')].defaultSlotSize}%`,
    );
  });

  it('多条 tab（计数 2）同样是「有内容」→ 照常占位', () => {
    useDockStore.getState().activateView(tabHostView('right'));
    renderLayout({ left: 0, right: 2 });

    expect(zoneTakesSpace('right')).toBe(true);
  });

  it('前台是无状态面板 → 与宿主有无 tab 无关，行为不变', () => {
    useDockStore.getState().setSlotExpanded('right', true);
    useDockStore.getState().activateView(panelView('files'));
    renderLayout({ left: 0, right: 0 });

    expect(zoneTakesSpace('right')).toBe(true);
  });

  it('左槽同一规则：前台是左宿主且无 tab → 左槽 0%（左栏不因「常驻」而豁免）', () => {
    useDockStore.getState().activateView(tabHostView('left'));
    renderLayout({ left: 0, right: 0 });

    expect(zoneTakesSpace('left')).toBe(false);
  });

  it('左槽前台是左宿主且有 tab → 占位（同一判据，不特判左右）', () => {
    useDockStore.getState().activateView(tabHostView('left'));
    renderLayout({ left: 1, right: 0 });

    expect(zoneTakesSpace('left')).toBe(true);
  });

  it('缺少注入（未连端口）时按「宿主无内容」处理（fail-closed，不凭空占位）', () => {
    useDockStore.getState().activateView(tabHostView('right'));
    renderLayout();

    expect(zoneTakesSpace('right')).toBe(false);
  });
});
