import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { DOCK_VIEW_META, appViewKey, panelView, tabHostView, tabKindView } from '@/shared/dock';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';

import { DockRegistryProvider, type DockViewRegistry } from '../../DockRegistryContext';
import DockZone from '../DockZone';

/**
 * `DockZone` 的两条契约（P5）：
 *
 * 1. 渲染列表是**声明表口径**（`host: 'none'` 的视图有落位但没有 zone 内容）——
 *    用「registry 里有没有 component」过滤会漏掉 Library（它**有**组件，只是渲染在中心区），
 *    结果是 LibraryPanel 被当成左栏面板挂载；
 * 2. 前台只从 `zoneFrontView` 取（回落逻辑的唯一实现处）—— 消费侧再写一份
 *    `views.includes(activeView) ? activeView : views[0]`，两份兜底必然漂移。
 */

const STUB_REGISTRY: DockViewRegistry = Object.fromEntries(
  Object.entries(DOCK_VIEW_META).map(([view, meta]) => [
    view,
    {
      ...meta,
      title: view,
      icon: 'X',
      component: (() => (
        <div data-testid={view} />
      )) as unknown as DockViewRegistry[string]['component'],
    },
  ]),
);

function renderZone(zoneId: 'left' | 'right') {
  return render(
    <DockRegistryProvider registry={STUB_REGISTRY}>
      <DockZone zoneId={zoneId} />
    </DockRegistryProvider>,
  );
}

/** 该视图是否被前台隐藏（DockZone 用 CSS hidden 而不是卸载）。 */
function isHidden(view: string): boolean {
  return screen.getByTestId(view).closest('.hidden') !== null;
}

beforeEach(() => {
  useDockStore.setState({ ...createDefaultDockState(), leftZoneExpandedBeforeLibrary: null });
});

describe('DockZone — 渲染列表只含「有 zone 内容」的视图', () => {
  it('host:none 的视图不在 zone 内渲染（Library 只在中心区渲染）', () => {
    renderZone('left');

    expect(screen.queryByTestId(appViewKey('library'))).not.toBeInTheDocument();
    expect(screen.getByTestId(panelView('projects'))).toBeInTheDocument();
  });

  it('种类级入口（host:none）也不进 zone', () => {
    renderZone('right');

    expect(screen.queryByTestId(tabKindView('agent-chat'))).not.toBeInTheDocument();
    expect(screen.queryByTestId(tabKindView('terminal'))).not.toBeInTheDocument();
  });
});

describe('DockZone — 前台只来自 zoneFrontView', () => {
  it('activeView 指向 host:none（library 落在同槽）→ 回落到槽内首个可渲染视图', () => {
    useDockStore.setState((state) => ({
      zones: { ...state.zones, left: { expanded: true, activeView: appViewKey('library') } },
    }));
    renderZone('left');

    expect(isHidden(panelView('projects'))).toBe(false);
  });

  it('activeView 是槽内视图 → 只有它可见，其余用 hidden 隐藏（不卸载）', () => {
    useDockStore.getState().activateView(panelView('files'));
    renderZone('right');

    expect(isHidden(panelView('files'))).toBe(false);
    expect(isHidden(panelView('gitControl'))).toBe(true);
  });

  it('槽内没有可渲染视图 → 不渲染（不留空岛）', () => {
    useDockStore.setState((state) => ({
      placements: { [appViewKey('library')]: state.placements[appViewKey('library')] },
      zones: { ...state.zones, left: { expanded: true, activeView: appViewKey('library') } },
    }));
    const { container } = renderZone('left');

    expect(container).toBeEmptyDOMElement();
  });

  it('槽收起 → 不渲染（即使前台有内容）', () => {
    useDockStore.getState().setSlotExpanded('right', false);
    const { container } = renderZone('right');

    expect(container).toBeEmptyDOMElement();
  });

  it('前台是槽位宿主时照常渲染宿主组件（可见性由布局层的 isZoneRenderable 决定，不在这里重复判据）', () => {
    useDockStore.getState().activateView(tabHostView('right'));
    renderZone('right');

    expect(screen.getByTestId(tabHostView('right'))).toBeInTheDocument();
    expect(isHidden(tabHostView('right'))).toBe(false);
  });
});
