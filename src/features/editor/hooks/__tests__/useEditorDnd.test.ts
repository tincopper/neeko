import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types/tab';

import { useEditorDnd } from '../useEditorDnd';

const leftTabs = [
  { id: 'tabA', title: 'A' },
  { id: 'tabB', title: 'B' },
] as unknown as Tab[];
const rightTabs = [{ id: 'tabC', title: 'C' }] as unknown as Tab[];

const pinnedTabs = [{ id: 'pinnedA', title: 'P' }] as unknown as Tab[];

function renderDnd() {
  return renderHook(() => useEditorDnd({ tabKey: 't1', leftTabs, rightTabs, pinnedTabs }));
}

describe('useEditorDnd — DragOverlay 状态', () => {
  it('dragStart 后 dragActiveTab 指向被拖 tab（left 组）', () => {
    const { result } = renderDnd();
    expect(result.current.dragActiveTab).toBeNull();

    act(() => {
      result.current.handleDragStart({ active: { id: 'tabA' } } as unknown as DragStartEvent);
    });

    expect(result.current.dragActiveTab).toEqual(leftTabs[0]);
  });

  it('dragStart 后 dragActiveTab 指向被拖 tab（right 组）', () => {
    const { result } = renderDnd();

    act(() => {
      result.current.handleDragStart({ active: { id: 'tabC' } } as unknown as DragStartEvent);
    });

    expect(result.current.dragActiveTab).toEqual(rightTabs[0]);
  });

  it('dragEnd 无条件清空状态（即使 over 为 null 提前 return）', () => {
    const { result } = renderDnd();

    act(() => {
      result.current.handleDragStart({ active: { id: 'tabA' } } as unknown as DragStartEvent);
    });
    expect(result.current.dragActiveTab).not.toBeNull();

    act(() => {
      // over 为 null：resolveDropAction 走 none 分支，状态也必须清空
      result.current.handleDragEnd({
        active: { id: 'tabA' },
        over: null,
      } as unknown as DragEndEvent);
    });

    expect(result.current.dragActiveTab).toBeNull();
  });

  it('dragEnd 正常 pin/reorder 后同样清空状态', () => {
    const { result } = renderDnd();

    act(() => {
      result.current.handleDragStart({ active: { id: 'tabA' } } as unknown as DragStartEvent);
    });

    act(() => {
      result.current.handleDragEnd({
        active: { id: 'tabA' },
        over: { id: `${'pinned-drop'}:t1:pinned` },
      } as unknown as DragEndEvent);
    });

    expect(result.current.dragActiveTab).toBeNull();
  });

  it('dragCancel 清空状态', () => {
    const { result } = renderDnd();

    act(() => {
      result.current.handleDragStart({ active: { id: 'tabB' } } as unknown as DragStartEvent);
    });
    act(() => {
      result.current.handleDragCancel();
    });

    expect(result.current.dragActiveTab).toBeNull();
  });

  it('dragEnd 分发 pin 动作（行为不回归）', () => {
    const pinSpy = vi.spyOn(useEditorStore.getState(), 'pinTab');
    const { result } = renderDnd();

    act(() => {
      result.current.handleDragEnd({
        active: { id: 'tabA' },
        over: { id: 'pinned-drop:t1:pinned' },
      } as unknown as DragEndEvent);
    });

    expect(pinSpy).toHaveBeenCalledWith('t1', 'tabA');
    pinSpy.mockRestore();
  });
});

describe('useEditorDnd — pinned tab 拖出（unpin 分发）', () => {
  it('pinned tab dragStart → dragActiveTab 从 pinnedTabs 解析', () => {
    const { result } = renderDnd();

    act(() => {
      result.current.handleDragStart({ active: { id: 'pinnedA' } } as unknown as DragStartEvent);
    });

    expect(result.current.dragActiveTab).toEqual(pinnedTabs[0]);
  });

  it('pinned tab 拖到 left tab 上 → 分发 unpinTabTo', () => {
    const unpinSpy = vi.spyOn(useEditorStore.getState(), 'unpinTabTo');
    const { result } = renderDnd();

    act(() => {
      result.current.handleDragEnd({
        active: { id: 'pinnedA' },
        over: { id: 'tabA' },
      } as unknown as DragEndEvent);
    });

    expect(unpinSpy).toHaveBeenCalledWith('t1', 'pinnedA', 'left', 'tabA');
    unpinSpy.mockRestore();
  });

  it('pinned tab 拖回 pinned 区域（droppable id）→ 不分发任何动作', () => {
    const pinSpy = vi.spyOn(useEditorStore.getState(), 'pinTab');
    const unpinSpy = vi.spyOn(useEditorStore.getState(), 'unpinTabTo');
    const { result } = renderDnd();

    act(() => {
      result.current.handleDragEnd({
        active: { id: 'pinnedA' },
        over: { id: 'pinned-drop:t1:pinned' },
      } as unknown as DragEndEvent);
    });

    expect(pinSpy).not.toHaveBeenCalled();
    expect(unpinSpy).not.toHaveBeenCalled();
    pinSpy.mockRestore();
    unpinSpy.mockRestore();
  });
});
