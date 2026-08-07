import { describe, expect, it } from 'vitest';

import { PINNED_DROP_PREFIX, resolveCollision, resolveDropAction } from '../dragDrop';

describe('resolveCollision — pinned 面板区域优先命中', () => {
  const pinnedDropId = `${PINNED_DROP_PREFIX}:p1:pinned`;

  it('指针碰撞命中 pinnedDropId → 返回指针碰撞（pin 优先）', () => {
    const pointer = [{ id: pinnedDropId }, { id: 'tabB' }];
    const fallback = [{ id: 'tabB' }];
    expect(resolveCollision(pointer, pinnedDropId, fallback)).toEqual(pointer);
  });

  it('指针碰撞未命中 pinnedDropId → 回退最近中心判定', () => {
    const pointer = [{ id: 'tabB' }];
    const fallback = [{ id: 'tabB' }];
    expect(resolveCollision(pointer, pinnedDropId, fallback)).toEqual(fallback);
  });

  it('无指针碰撞（拖到空白处）→ 回退最近中心判定', () => {
    const fallback = [{ id: 'tabB' }];
    expect(resolveCollision([], pinnedDropId, fallback)).toEqual(fallback);
  });
});

describe('resolveDropAction — 跨面板拖拽动作判定', () => {
  const pinnedDropId = `${PINNED_DROP_PREFIX}:p1`;

  it('拖到 pinned 面板区域（overId 为 pinned droppable）→ 触发 pin', () => {
    const action = resolveDropAction({
      activeId: 'tabA',
      overId: pinnedDropId,
      pinnedDropId,
      leftIds: ['tabA', 'tabB'],
      rightIds: [],
    });

    expect(action).toEqual({ type: 'pin', tabId: 'tabA' });
  });

  it('left 组内部拖到相邻 tab → reorder left', () => {
    const action = resolveDropAction({
      activeId: 'tabA',
      overId: 'tabB',
      pinnedDropId,
      leftIds: ['tabA', 'tabB'],
      rightIds: [],
    });

    expect(action).toEqual({ type: 'reorder', tabId: 'tabA', overId: 'tabB', groupId: 'left' });
  });

  it('right 组内部拖到相邻 tab → reorder right', () => {
    const action = resolveDropAction({
      activeId: 'tabC',
      overId: 'tabD',
      pinnedDropId,
      leftIds: [],
      rightIds: ['tabC', 'tabD'],
    });

    expect(action).toEqual({ type: 'reorder', tabId: 'tabC', overId: 'tabD', groupId: 'right' });
  });

  it('left 与 right 跨组拖拽（无此需求）→ none', () => {
    const action = resolveDropAction({
      activeId: 'tabA',
      overId: 'tabC',
      pinnedDropId,
      leftIds: ['tabA'],
      rightIds: ['tabC'],
    });

    expect(action).toEqual({ type: 'none' });
  });

  it('overId 为空（未命中任何 target）→ none', () => {
    const action = resolveDropAction({
      activeId: 'tabA',
      overId: null,
      pinnedDropId,
      leftIds: ['tabA'],
      rightIds: [],
    });

    expect(action).toEqual({ type: 'none' });
  });

  it('active 不在 left/right（pinned 自身，不可拖）→ none', () => {
    const action = resolveDropAction({
      activeId: 'pinnedTab',
      overId: 'tabA',
      pinnedDropId,
      leftIds: ['tabA'],
      rightIds: [],
    });

    expect(action).toEqual({ type: 'none' });
  });
});
