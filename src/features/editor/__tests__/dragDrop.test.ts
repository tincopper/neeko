import { describe, expect, it } from 'vitest';

import {
  PINNED_DROP_PREFIX,
  editorPaneRegionClass,
  resolveCollision,
  resolveDragTab,
  resolveDropAction,
  shouldShowPinDropZone,
} from '../dragDrop';

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

describe('resolveDragTab — DragOverlay 内容解析', () => {
  const leftTabs = [
    { id: 'tabA', title: 'A' },
    { id: 'tabB', title: 'B' },
  ];
  const rightTabs = [{ id: 'tabC', title: 'C' }];

  it('activeId 命中 leftTabs → 返回该 tab', () => {
    expect(resolveDragTab('tabB', leftTabs, rightTabs)).toEqual({ id: 'tabB', title: 'B' });
  });

  it('activeId 命中 rightTabs → 返回该 tab', () => {
    expect(resolveDragTab('tabC', leftTabs, rightTabs)).toEqual({ id: 'tabC', title: 'C' });
  });

  it('activeId 不在任一组（pinned 自身 / 非法 id）→ null', () => {
    expect(resolveDragTab('pinnedTab', leftTabs, rightTabs)).toBeNull();
    expect(resolveDragTab('ghost', leftTabs, rightTabs)).toBeNull();
  });
});

describe('editorPaneRegionClass — pane 根容器样式', () => {
  it('基础 class 恒在（布局骨架不因状态丢失）', () => {
    const cls = editorPaneRegionClass({
      groupId: 'left',
      activeGroupId: null,
      isOverDropTarget: false,
    });
    expect(cls).toContain('flex-1');
    expect(cls).toContain('overflow-hidden');
  });

  it('激活组带默认 focus ring', () => {
    const cls = editorPaneRegionClass({
      groupId: 'left',
      activeGroupId: 'left',
      isOverDropTarget: false,
    });
    expect(cls).toContain('ring-1');
  });

  it('pinned 区域 over → drop 高亮（accent ring-2），替换默认 focus ring', () => {
    const cls = editorPaneRegionClass({
      groupId: 'pinned',
      activeGroupId: 'pinned',
      isOverDropTarget: true,
    });
    expect(cls).toContain('ring-2');
    expect(cls).toContain('ring-accent');
    expect(cls).not.toContain('ring-1');
  });

  it('非 pinned 组 over → 无 drop 高亮（只有基础/激活样式）', () => {
    const cls = editorPaneRegionClass({
      groupId: 'left',
      activeGroupId: 'left',
      isOverDropTarget: true,
    });
    expect(cls).not.toContain('ring-accent');
    expect(cls).not.toContain('ring-2');
  });
});

describe('resolveDropAction — pinned tab 拖出（unpin 移动）', () => {
  const pinnedDropId = `${PINNED_DROP_PREFIX}:p1:pinned`;
  const base = {
    activeId: 'pinnedA',
    pinnedDropId,
    leftIds: ['tabL'],
    rightIds: ['tabR'],
    pinnedIds: ['pinnedA', 'pinnedB'],
  };

  it('拖到 left 组 tab 上 → unpin 到 left（带 overId）', () => {
    expect(resolveDropAction({ ...base, overId: 'tabL' })).toEqual({
      type: 'unpin',
      tabId: 'pinnedA',
      groupId: 'left',
      overId: 'tabL',
    });
  });

  it('拖到 right 组 tab 上 → unpin 到 right', () => {
    expect(resolveDropAction({ ...base, overId: 'tabR' })).toEqual({
      type: 'unpin',
      tabId: 'pinnedA',
      groupId: 'right',
      overId: 'tabR',
    });
  });

  it('拖回 pinned 面板区域（pinnedDropId）→ none（不支持 pinned 内部排序）', () => {
    expect(resolveDropAction({ ...base, overId: pinnedDropId })).toEqual({ type: 'none' });
  });

  it('拖到另一个 pinned tab 上 → none（over 不在 left/right）', () => {
    expect(resolveDropAction({ ...base, overId: 'pinnedB' })).toEqual({ type: 'none' });
  });

  it('非 pinned tab 拖到 pinned 区域 → pin（pinnedIds 不影响原语义）', () => {
    expect(
      resolveDropAction({
        activeId: 'tabL',
        overId: pinnedDropId,
        pinnedDropId,
        leftIds: ['tabL'],
        rightIds: [],
        pinnedIds: ['pinnedA'],
      }),
    ).toEqual({ type: 'pin', tabId: 'tabL' });
  });

  it('未传 pinnedIds（默认 []）→ 原 reorder/pin 语义不回归', () => {
    expect(
      resolveDropAction({
        activeId: 'tabL',
        overId: 'tabL2',
        pinnedDropId,
        leftIds: ['tabL', 'tabL2'],
        rightIds: [],
      }),
    ).toEqual({ type: 'reorder', tabId: 'tabL', overId: 'tabL2', groupId: 'left' });
  });
});

describe('resolveDragTab — pinned 组也可作为拖拽源', () => {
  const leftTabs = [{ id: 'tabA', title: 'A' }];
  const rightTabs = [{ id: 'tabC', title: 'C' }];
  const pinnedTabs = [{ id: 'pinnedA', title: 'P' }];

  it('activeId 命中 pinnedTabs → 返回该 tab（pinned 可拖出）', () => {
    expect(resolveDragTab('pinnedA', leftTabs, rightTabs, pinnedTabs)).toEqual({
      id: 'pinnedA',
      title: 'P',
    });
  });

  it('不传 pinnedTabs 时行为不变（默认 []）', () => {
    expect(resolveDragTab('pinnedA', leftTabs, rightTabs)).toBeNull();
  });
});

describe('shouldShowPinDropZone — 无 pinned 面板时的动态 pin drop zone', () => {
  it('无 pinned、拖拽中、拖的是非 pinned tab → 显示', () => {
    expect(
      shouldShowPinDropZone({ hasPinned: false, dragActiveTabId: 'tabA', pinnedIds: [] }),
    ).toBe(true);
  });

  it('已有 pinned 面板 → 不显示（真实 pinned pane 已提供 drop target）', () => {
    expect(
      shouldShowPinDropZone({ hasPinned: true, dragActiveTabId: 'tabA', pinnedIds: ['pinnedA'] }),
    ).toBe(false);
  });

  it('拖的是 pinned tab → 不显示（pinned tab 拖出与 pin 无关）', () => {
    expect(
      shouldShowPinDropZone({
        hasPinned: false,
        dragActiveTabId: 'pinnedA',
        pinnedIds: ['pinnedA'],
      }),
    ).toBe(false);
  });

  it('非拖拽状态（dragActiveTabId 为 null）→ 不显示', () => {
    expect(shouldShowPinDropZone({ hasPinned: false, dragActiveTabId: null, pinnedIds: [] })).toBe(
      false,
    );
  });
});
