// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  applyActivate,
  applyMove,
  applyOnBar,
  applyToggle,
  hasSlotViews,
  isViewVisible,
  slotPlacements,
  slotViews,
} from '../placement';
import type { DockLayoutState, DockPlacement, DockSlot, ViewKey } from '../types';
import { appViewKey, panelView } from '../viewKey';

/**
 * 落位纯函数的**行为规格**（design §6 的七条 + G3/G4 不变量）。
 *
 * 夹具刻意用 4 个视图、左右各 2 个：跨槽 / 同槽 / 空槽三种形态都能不靠声明表构造，
 * 于是这些用例只钉算法，不钉 `DOCK_VIEW_META` 的内容（后者由 store 的迁移/清洗用例守）。
 */

const PROJECTS = panelView('projects');
const LIBRARY = appViewKey('library');
const FILES = panelView('files');
const GIT = panelView('gitControl');

const LEFT: ViewKey[] = [PROJECTS, LIBRARY];
const RIGHT: ViewKey[] = [FILES, GIT];

function makeState(
  left: readonly ViewKey[] = LEFT,
  right: readonly ViewKey[] = RIGHT,
  zoneState: Partial<Record<DockSlot, { expanded: boolean; activeView: ViewKey | null }>> = {},
): DockLayoutState {
  const placements: Record<string, DockPlacement> = {};
  const fill = (views: readonly ViewKey[], slot: DockSlot) =>
    views.forEach((view, order) => {
      placements[view] = { view, slot, order, onBar: true };
    });
  fill(left, 'left');
  fill(right, 'right');
  return {
    placements,
    zones: {
      left: zoneState.left ?? { expanded: true, activeView: left[0] ?? null },
      right: zoneState.right ?? { expanded: false, activeView: right[0] ?? null },
    },
  };
}

/** G4：任意 move 序列后 activeView 必须仍在槽内（或 null）。 */
function expectNoDanglingActiveView(state: DockLayoutState): void {
  for (const slot of ['left', 'right'] as const) {
    const activeView = state.zones[slot].activeView;
    if (activeView === null) continue;
    expect(slotViews(state, slot)).toContain(activeView);
  }
}

describe('slotPlacements / slotViews / hasSlotViews / isViewVisible', () => {
  it('按 order 升序给出槽内落位，且不从别的槽串入', () => {
    const state = makeState([LIBRARY, PROJECTS], [GIT, FILES]);
    // 插入顺序（对象键序）刻意与 order 相反：读取面必须按 order 排，而不是按键序
    const scrambled: DockLayoutState = {
      ...state,
      placements: {
        [PROJECTS]: state.placements[PROJECTS],
        [LIBRARY]: state.placements[LIBRARY],
        [GIT]: state.placements[GIT],
        [FILES]: state.placements[FILES],
      },
    };

    expect(slotPlacements(scrambled, 'left').map((p) => p.view)).toEqual([LIBRARY, PROJECTS]);
    expect(slotViews(scrambled, 'right')).toEqual([GIT, FILES]);
  });

  it('重复 order（坏快照）时按 view 兜底排序，读取面仍确定性', () => {
    const state = makeState([PROJECTS, LIBRARY]);
    const tie: DockLayoutState = {
      ...state,
      placements: {
        ...state.placements,
        [PROJECTS]: { ...state.placements[PROJECTS], order: 0 },
        [LIBRARY]: { ...state.placements[LIBRARY], order: 0 },
      },
    };

    expect(slotViews(tie, 'left')).toEqual([LIBRARY, PROJECTS]);
  });

  it('hasSlotViews 只看该槽', () => {
    const state = makeState([], [FILES]);

    expect(hasSlotViews(state, 'left')).toBe(false);
    expect(hasSlotViews(state, 'right')).toBe(true);
  });

  it('isViewVisible = 该视图所在槽前台且展开（面板按需加载的门控口径）', () => {
    const state = makeState(LEFT, RIGHT, { right: { expanded: false, activeView: FILES } });
    expect(isViewVisible(state, FILES)).toBe(false);

    const expanded = makeState(LEFT, RIGHT, { right: { expanded: true, activeView: FILES } });
    expect(isViewVisible(expanded, FILES)).toBe(true);
    expect(isViewVisible(expanded, GIT)).toBe(false);
  });
});

describe('applyMove — design §6 行为规格', () => {
  it('1. 未知视图 → 返回原引用，不抛', () => {
    const state = makeState();
    expect(applyMove(state, { view: panelView('ghost'), to: 'left' })).toBe(state);
  });

  it('1. 非法槽位 → 返回原引用，不抛', () => {
    const state = makeState();
    expect(applyMove(state, { view: FILES, to: 'top' as DockSlot })).toBe(state);
  });

  it('2. 同槽同位置 → 返回原引用（避免无意义 re-render）', () => {
    const state = makeState();
    expect(applyMove(state, { view: FILES, to: 'right', index: 0 })).toBe(state);
  });

  it('3. 目标 index 越界 → clamp 到 [0, len]', () => {
    const state = makeState();

    const negative = applyMove(state, { view: FILES, to: 'left', index: -5 });
    expect(slotViews(negative, 'left')).toEqual([FILES, PROJECTS, LIBRARY]);

    const overflow = applyMove(state, { view: FILES, to: 'left', index: 99 });
    expect(slotViews(overflow, 'left')).toEqual([PROJECTS, LIBRARY, FILES]);
  });

  it('3. 目标 index 为 NaN → 追加到末尾', () => {
    const state = makeState();
    const moved = applyMove(state, { view: FILES, to: 'left', index: Number.NaN });

    expect(slotViews(moved, 'left')).toEqual([PROJECTS, LIBRARY, FILES]);
  });

  it('4. 跨槽移动：两槽 order 各自归一化，目标槽展开并前台，源槽前台改指邻位', () => {
    const state = makeState(LEFT, RIGHT, {
      left: { expanded: true, activeView: PROJECTS },
      right: { expanded: false, activeView: FILES },
    });

    const moved = applyMove(state, { view: PROJECTS, to: 'right', index: 1 });

    expect(slotViews(moved, 'right')).toEqual([FILES, PROJECTS, GIT]);
    expect(slotPlacements(moved, 'right').map((p) => p.order)).toEqual([0, 1, 2]);

    expect(slotViews(moved, 'left')).toEqual([LIBRARY]);
    expect(slotPlacements(moved, 'left').map((p) => p.order)).toEqual([0]);

    // D2：移动意图 = 想看到它
    expect(moved.zones.right).toEqual({ expanded: true, activeView: PROJECTS });
    // 源槽前台改指邻位（原位置 0 → 新的第 0 项）
    expect(moved.zones.left.activeView).toBe(LIBRARY);
    expectNoDanglingActiveView(moved);
  });

  it('4. 源槽前台不是被移动项时保持不变', () => {
    const state = makeState(LEFT, RIGHT, { left: { expanded: true, activeView: LIBRARY } });
    const moved = applyMove(state, { view: PROJECTS, to: 'right' });

    expect(moved.zones.left.activeView).toBe(LIBRARY);
    expectNoDanglingActiveView(moved);
  });

  it('5. 同槽重排：只重算该槽，activeView 与 expanded 不变', () => {
    const state = makeState(LEFT, RIGHT, { right: { expanded: false, activeView: GIT } });

    const moved = applyMove(state, { view: FILES, to: 'right', index: 1 });

    expect(slotViews(moved, 'right')).toEqual([GIT, FILES]);
    expect(slotPlacements(moved, 'right').map((p) => p.order)).toEqual([0, 1]);
    expect(moved.zones.right).toEqual({ expanded: false, activeView: GIT });
    // 左槽引用不变（同槽重排不该惊动另一个槽的订阅者）
    expect(moved.zones.left).toBe(state.zones.left);
  });

  it('6. 移走槽内最后一个视图 → activeView = null，expanded 不改（D5）', () => {
    const state = makeState([PROJECTS], [FILES], {
      left: { expanded: true, activeView: PROJECTS },
    });

    const moved = applyMove(state, { view: PROJECTS, to: 'right' });

    expect(slotViews(moved, 'left')).toEqual([]);
    expect(moved.zones.left).toEqual({ expanded: true, activeView: null });
  });

  it('6. 源槽前台悬挂（引用了不在槽内的视图）时被就地修成首个', () => {
    const state = makeState(LEFT, [FILES], {
      left: { expanded: true, activeView: GIT },
    });

    const moved = applyMove(state, { view: PROJECTS, to: 'right' });

    expect(moved.zones.left.activeView).toBe(LIBRARY);
    expectNoDanglingActiveView(moved);
  });

  it('7. 幂等：连续两次同样请求，第二次返回原引用', () => {
    const state = makeState();

    const once = applyMove(state, { view: PROJECTS, to: 'right', index: 1 });
    const twice = applyMove(once, { view: PROJECTS, to: 'right', index: 1 });

    expect(twice).toBe(once);
  });

  it('G4：一串随意 move 之后 activeView 永不悬挂', () => {
    let state = makeState();
    const steps: Array<Parameters<typeof applyMove>[1]> = [
      { view: PROJECTS, to: 'right', index: 0 },
      { view: GIT, to: 'left' },
      { view: LIBRARY, to: 'right', index: 1 },
      { view: FILES, to: 'left', index: 0 },
      { view: FILES, to: 'right', index: 2 },
    ];

    for (const step of steps) {
      state = applyMove(state, step);
      expectNoDanglingActiveView(state);
    }
    // 显式断言（helper 里的 expect 对 vitest/expect-expect 不可见）
    expect(state.zones.right.activeView).toBe(FILES);
  });
});

describe('applyActivate / applyToggle / applyOnBar', () => {
  it('applyActivate：展开该视图所在槽并置前台', () => {
    const state = makeState(LEFT, RIGHT, { right: { expanded: false, activeView: FILES } });

    const next = applyActivate(state, GIT);

    expect(next.zones.right).toEqual({ expanded: true, activeView: GIT });
    expect(next.placements).toBe(state.placements);
  });

  it('applyActivate：已在前台且展开 → 原引用；未知视图 → 原引用', () => {
    const state = makeState(LEFT, RIGHT, { right: { expanded: true, activeView: GIT } });

    expect(applyActivate(state, GIT)).toBe(state);
    expect(applyActivate(state, panelView('ghost'))).toBe(state);
  });

  it('applyToggle：前台且展开 → 收起（不改前台）', () => {
    const state = makeState(LEFT, RIGHT, { right: { expanded: true, activeView: GIT } });

    const next = applyToggle(state, GIT);

    expect(next.zones.right).toEqual({ expanded: false, activeView: GIT });
  });

  it('applyToggle：非前台或已收起 → 按激活处理', () => {
    const collapsed = makeState(LEFT, RIGHT, { right: { expanded: false, activeView: FILES } });
    expect(applyToggle(collapsed, FILES).zones.right).toEqual({
      expanded: true,
      activeView: FILES,
    });

    const otherActive = makeState(LEFT, RIGHT, { right: { expanded: true, activeView: FILES } });
    expect(applyToggle(otherActive, GIT).zones.right).toEqual({
      expanded: true,
      activeView: GIT,
    });
  });

  it('applyToggle：未知视图 → 原引用', () => {
    const state = makeState();
    expect(applyToggle(state, panelView('ghost'))).toBe(state);
  });

  it('applyOnBar：钉住/取消钉住，只动 onBar 字段', () => {
    const state = makeState();

    const off = applyOnBar(state, FILES, false);
    expect(off.placements[FILES]).toEqual({ ...state.placements[FILES], onBar: false });
    expect(off.zones).toBe(state.zones);

    const back = applyOnBar(off, FILES, true);
    expect(back.placements[FILES].onBar).toBe(true);
  });

  it('applyOnBar：同值 / 未知视图 → 原引用', () => {
    const state = makeState();

    expect(applyOnBar(state, FILES, true)).toBe(state);
    expect(applyOnBar(state, panelView('ghost'), false)).toBe(state);
  });
});
