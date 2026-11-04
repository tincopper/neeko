import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { panelView } from '@/shared/dock';

import type { DockBarEntry } from '../DockBar';
import { barDropId, useDockBarDnd } from '../DockBarDnd';

/**
 * DragOverlay 的状态归属：浮层跟着 `dragStart` 出现、`dragEnd` / `dragCancel`
 * **无条件**清空。指针的真实拖拽在 jsdom 里无法复现（无 rect / 无 pointer capture），
 * 所以状态机放在 hook 里直测 —— 与 `useEditorDnd` 同构。
 */

const PROJECTS = panelView('projects');
const FILES = panelView('files');

// preview 是 app 注入的 ReactNode（图标映射在 app registry）：这里用字符串占位，
// 只断言「选中的是哪一条」。内容本体由 DockBarDragPreview.test.tsx 覆盖。
const LEFT: DockBarEntry[] = [{ view: PROJECTS, node: null, preview: 'preview:projects' }];
const RIGHT: DockBarEntry[] = [{ view: FILES, node: null, preview: 'preview:files' }];

function renderDnd(onMoveView = vi.fn()) {
  const { result } = renderHook(() =>
    useDockBarDnd({ leftBarItems: LEFT, rightBarItems: RIGHT, onMoveView }),
  );
  return { result, onMoveView };
}

const startEvent = (id: string) => ({ active: { id } }) as unknown as DragStartEvent;

describe('useDockBarDnd — 跟手浮层状态', () => {
  it('未拖拽时没有浮层内容', () => {
    const { result } = renderDnd();

    expect(result.current.dragPreview).toBeNull();
  });

  it('dragStart 后浮层内容 = 被拖图标所在条目的 preview（两栏都查）', () => {
    const { result } = renderDnd();

    act(() => result.current.handleDragStart(startEvent(FILES)));
    expect(result.current.dragPreview).toBe(RIGHT[0].preview);

    act(() => result.current.handleDragStart(startEvent(PROJECTS)));
    expect(result.current.dragPreview).toBe(LEFT[0].preview);
  });

  it('未知 id 不产生浮层（不猜、不渲染别人的图标）', () => {
    const { result } = renderDnd();

    act(() => result.current.handleDragStart(startEvent('tab:some-tab')));

    expect(result.current.dragPreview).toBeNull();
  });

  it('dragEnd 无条件清空浮层（over 为 null 也要收起）', () => {
    const { result } = renderDnd();

    act(() => result.current.handleDragStart(startEvent(FILES)));
    act(() =>
      result.current.handleDragEnd({
        active: { id: FILES },
        over: null,
      } as unknown as DragEndEvent),
    );

    expect(result.current.dragPreview).toBeNull();
  });

  it('dragCancel（Esc / 拖出窗口）同样清空', () => {
    const { result } = renderDnd();

    act(() => result.current.handleDragStart(startEvent(FILES)));
    act(() => result.current.handleDragCancel());

    expect(result.current.dragPreview).toBeNull();
  });
});

describe('useDockBarDnd — onDragEnd 仍然只提取 id', () => {
  it('落到栏容器 → 目标槽、省略下标（追加末尾）', () => {
    const { result, onMoveView } = renderDnd();

    act(() =>
      result.current.handleDragEnd({
        active: { id: FILES },
        over: { id: barDropId('left') },
      } as unknown as DragEndEvent),
    );

    expect(onMoveView).toHaveBeenCalledWith(FILES, 'left', undefined);
  });

  it('落到某条图标 → 该图标所在槽 + 槽内下标', () => {
    const { result, onMoveView } = renderDnd();

    act(() =>
      result.current.handleDragEnd({
        active: { id: FILES },
        over: { id: PROJECTS },
      } as unknown as DragEndEvent),
    );

    expect(onMoveView).toHaveBeenCalledWith(FILES, 'left', 0);
  });

  it('指针不在任何 droppable 里（over = null）⇒ 不算一次移动', () => {
    const { result, onMoveView } = renderDnd();

    act(() =>
      result.current.handleDragEnd({
        active: { id: FILES },
        over: null,
      } as unknown as DragEndEvent),
    );

    expect(onMoveView).not.toHaveBeenCalled();
  });
});
