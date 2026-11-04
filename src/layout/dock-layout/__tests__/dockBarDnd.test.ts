// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { appViewKey, panelView, type ViewKey } from '@/shared/dock';

import { barDropId, resolveDropTarget } from '../DockBarDnd';

/**
 * 拖拽落点的**唯一**翻译层：id → (目标槽, 目标下标)。
 * 算法（搬哪个视图、修哪个 activeView）在 store，这里只钉「id 怎么读」。
 */

const FILES = panelView('files');
const GIT = panelView('gitControl');
const LIBRARY = appViewKey('library');

const SLOT_VIEWS: Record<'left' | 'right', readonly ViewKey[]> = {
  left: [LIBRARY],
  right: [FILES, GIT],
};

describe('barDropId', () => {
  it('每槽一个稳定 marker（与 ViewKey 命名空间不冲突）', () => {
    expect(barDropId('left')).toBe('bar:left');
    expect(barDropId('right')).toBe('bar:right');
  });
});

describe('resolveDropTarget', () => {
  it('落到栏容器 → 该槽 + 省略下标（追加到末尾）', () => {
    expect(resolveDropTarget(barDropId('right'), SLOT_VIEWS)).toEqual({ slot: 'right' });
    expect(resolveDropTarget(barDropId('left'), SLOT_VIEWS)).toEqual({ slot: 'left' });
  });

  it('落到某条图标 → 它所在的槽 + 它的下标（跨栏时下标按目标栏算）', () => {
    expect(resolveDropTarget(GIT, SLOT_VIEWS)).toEqual({ slot: 'right', index: 1 });
    expect(resolveDropTarget(LIBRARY, SLOT_VIEWS)).toEqual({ slot: 'left', index: 0 });
  });

  it('未知 id → null（不猜、不把布局改坏）', () => {
    expect(resolveDropTarget('bar:top', SLOT_VIEWS)).toBeNull();
    expect(resolveDropTarget(panelView('ghost'), SLOT_VIEWS)).toBeNull();
  });

  it('空栏：只有容器 marker 可落，任何图标 id 都不属于它', () => {
    const empty = { left: [] as ViewKey[], right: [FILES] };
    expect(resolveDropTarget(barDropId('left'), empty)).toEqual({ slot: 'left' });
    expect(resolveDropTarget(GIT, empty)).toBeNull();
  });
});
