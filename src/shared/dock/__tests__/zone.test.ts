// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { DockLayoutState, DockPlacement, DockSlot, ViewKey } from '../types';
import { appViewKey, panelView, tabHostView, tabKindView } from '../viewKey';
import { isZoneRenderable, zoneFrontView, zoneHostedViews } from '../zone';

/**
 * Zone 可见性是**内容的函数**（P5 判据）。
 *
 * 夹具刻意混入 `host: 'none'` 的视图（`appView:library` / `tabKind:*`）：它们有落位
 * （图标占某一栏）但没有 zone 内容 —— 前台指向它们时不得渲染一座空岛，也不算「有内容」。
 * 无状态面板（files / gitControl / projects）「有内容」恒真；只有槽位宿主的内容随
 * workspace 变化，因此判据必须由调用方注入**条数**`hostTabCount`（shared 层不持有 tab 域）。
 * 条数而不是布尔：「非空」（`> 0`）只在 `isZoneRenderable` 内部决定一处，消费侧不做布尔映射；
 * 且同一事实还要驱动「到达 = 条数增加」的揭示（1 → 2 必须可观测）。
 */

const PROJECTS = panelView('projects');
const FILES = panelView('files');
const GIT = panelView('gitControl');
const LEFT_HOST = tabHostView('left');
const RIGHT_HOST = tabHostView('right');
const LIBRARY = appViewKey('library');
const AGENT_CHAT = tabKindView('agent-chat');

function makeState(args: {
  left?: readonly ViewKey[];
  right?: readonly ViewKey[];
  expanded?: Partial<Record<DockSlot, boolean>>;
  active?: Partial<Record<DockSlot, ViewKey | null>>;
}): DockLayoutState {
  const placements: Record<string, DockPlacement> = {};
  const fill = (views: readonly ViewKey[], slot: DockSlot): void => {
    views.forEach((view, order) => {
      placements[view] = { view, slot, order, onBar: true };
    });
  };
  const left = args.left ?? [PROJECTS, LEFT_HOST, LIBRARY];
  const right = args.right ?? [FILES, GIT, RIGHT_HOST, AGENT_CHAT];
  fill(left, 'left');
  fill(right, 'right');
  return {
    placements,
    zones: {
      left: {
        expanded: args.expanded?.left ?? true,
        activeView:
          args.active !== undefined && 'left' in args.active ? (args.active.left ?? null) : left[0],
      },
      right: {
        expanded: args.expanded?.right ?? false,
        activeView:
          args.active !== undefined && 'right' in args.active
            ? (args.active.right ?? null)
            : right[0],
      },
    },
  };
}

describe('zoneHostedViews — 槽内会渲染进 zone 的视图（声明表口径）', () => {
  it('排除 host:none 的视图（library / 种类级入口只有落位，没有 zone 内容）', () => {
    const state = makeState({
      left: [PROJECTS, LIBRARY, LEFT_HOST],
      right: [FILES, AGENT_CHAT],
    });
    expect(zoneHostedViews(state, 'left')).toEqual([PROJECTS, LEFT_HOST]);
    expect(zoneHostedViews(state, 'right')).toEqual([FILES]);
  });

  it('槽内全是 host:none → 空（该槽没有任何可渲染内容）', () => {
    const state = makeState({ left: [LIBRARY, AGENT_CHAT] });
    expect(zoneHostedViews(state, 'left')).toEqual([]);
  });

  it('顺序即槽内 order（与 placementsInSlot 同源）', () => {
    const state = makeState({ right: [GIT, FILES] });
    expect(zoneHostedViews(state, 'right')).toEqual([GIT, FILES]);
  });

  it('声明表里不存在的落位（坏快照 / 已删视图）→ 忽略（不抛、不渲染）', () => {
    const state = makeState({ left: [PROJECTS, 'panel:ghost' as ViewKey] });
    expect(zoneHostedViews(state, 'left')).toEqual([PROJECTS]);
  });
});

describe('zoneFrontView — 「该槽前台是谁」的唯一派生点', () => {
  it('activeView 是槽内可渲染视图 → 原样返回', () => {
    const state = makeState({ active: { left: LEFT_HOST } });
    expect(zoneFrontView(state, 'left')).toBe(LEFT_HOST);
  });

  it('activeView 指向 host:none（library 落在同槽）→ 回落到槽内首个可渲染视图', () => {
    const state = makeState({ left: [PROJECTS, LIBRARY, LEFT_HOST], active: { left: LIBRARY } });
    expect(zoneFrontView(state, 'left')).toBe(PROJECTS);
  });

  it('activeView 悬挂（不在槽内）→ 回落到槽内首个可渲染视图', () => {
    const state = makeState({ left: [PROJECTS, LEFT_HOST], active: { left: FILES } });
    expect(zoneFrontView(state, 'left')).toBe(PROJECTS);
  });

  it('activeView 为 null → 回落首个可渲染视图', () => {
    const state = makeState({ left: [PROJECTS, LEFT_HOST], active: { left: null } });
    expect(zoneFrontView(state, 'left')).toBe(PROJECTS);
  });

  it('槽内没有可渲染视图 → null（不是空岛，由调用方收起该槽）', () => {
    const state = makeState({ left: [LIBRARY] });
    expect(zoneFrontView(state, 'left')).toBeNull();
  });

  it('空槽 → null', () => {
    const state = makeState({ left: [] });
    expect(zoneFrontView(state, 'left')).toBeNull();
  });

  it('展开态不影响「前台是谁」（前台是布局事实，可见性另算）', () => {
    const state = makeState({ right: [FILES, RIGHT_HOST], expanded: { right: false } });
    expect(zoneFrontView(state, 'right')).toBe(FILES);
  });
});

describe('isZoneRenderable — zone 是否占位（可见性从内容派生）', () => {
  it('未展开 → false（即使前台有内容）', () => {
    const state = makeState({ right: [FILES], expanded: { right: false } });
    expect(isZoneRenderable(state, 'right', 1)).toBe(false);
  });

  it('前台是槽位宿主且宿主无 tab → false（空宿主不占位）', () => {
    const state = makeState({
      right: [FILES, RIGHT_HOST],
      expanded: { right: true },
      active: { right: RIGHT_HOST },
    });
    expect(isZoneRenderable(state, 'right', 0)).toBe(false);
  });

  it('前台是槽位宿主且宿主有 tab → true', () => {
    const state = makeState({
      right: [FILES, RIGHT_HOST],
      expanded: { right: true },
      active: { right: RIGHT_HOST },
    });
    expect(isZoneRenderable(state, 'right', 1)).toBe(true);
  });

  it('宿主有 2 条 tab → true（「非空」判据只看 > 0，不问具体条数）', () => {
    const state = makeState({
      right: [FILES, RIGHT_HOST],
      expanded: { right: true },
      active: { right: RIGHT_HOST },
    });
    expect(isZoneRenderable(state, 'right', 2)).toBe(true);
  });

  it('前台是无状态面板 → true，宿主有无 tab 无关', () => {
    const state = makeState({
      right: [FILES, RIGHT_HOST],
      expanded: { right: true },
      active: { right: FILES },
    });
    expect(isZoneRenderable(state, 'right', 0)).toBe(true);
    expect(isZoneRenderable(state, 'right', 2)).toBe(true);
  });

  it('前台落在 host:none 的视图上 → 按回落后的前台判定（无状态面板 → true）', () => {
    const state = makeState({
      left: [PROJECTS, LIBRARY],
      expanded: { left: true },
      active: { left: LIBRARY },
    });
    expect(isZoneRenderable(state, 'left', 0)).toBe(true);
  });

  it('槽内没有可渲染视图 → false（无论展开态与 hostTabCount）', () => {
    const state = makeState({ left: [LIBRARY], expanded: { left: true } });
    expect(isZoneRenderable(state, 'left', 1)).toBe(false);
  });

  it('槽内只有声明表外的落位 → false（不知构造、不可渲染）', () => {
    const state = makeState({ left: ['panel:ghost' as ViewKey], expanded: { left: true } });
    expect(isZoneRenderable(state, 'left', 1)).toBe(false);
  });

  it('前台是左宿主且左宿主有 tab → true（左右同一规则，不特判）', () => {
    const state = makeState({
      left: [PROJECTS, LEFT_HOST],
      expanded: { left: true },
      active: { left: LEFT_HOST },
    });
    expect(isZoneRenderable(state, 'left', 1)).toBe(true);
    expect(isZoneRenderable(state, 'left', 0)).toBe(false);
  });
});
