import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useDragResize } from '../useDragResize';

/**
 * 拖拽缩放 hook（Neeko Check F10 的回归网）：`DebugPanel` 的面板高度与侧栏宽度原先各写一份
 * 同构实现，本 hook 是唯一实现 —— 用测试钉住两端行为（轴向、夹取、持久化、卸载兜底），
 * 避免任一使用方退化。
 */
const spec = {
  storageKey: 'test.size',
  defaultSize: 300,
  min: 100,
  max: 500,
  axis: 'horizontal' as const,
  cursor: 'col-resize',
};

/** 在文档上派发一次鼠标事件（hook 的监听挂在 `document` 上）。 */
const fireMouse = (type: 'mousemove' | 'mouseup', clientX: number, clientY = 0) =>
  document.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }));

const startDrag = (clientX: number, clientY = 0) =>
  ({ preventDefault: () => {}, stopPropagation: () => {}, clientX, clientY }) as React.MouseEvent;

describe('useDragResize', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  afterEach(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  it('初值取默认尺寸；已持久化时取持久化值', () => {
    expect(renderHook(() => useDragResize(spec)).result.current.size).toBe(300);
    window.localStorage.setItem('test.size', '420');
    expect(renderHook(() => useDragResize(spec)).result.current.size).toBe(420);
  });

  it('水平轴：向右拖动增大（按 clientX 增量）', () => {
    const { result } = renderHook(() => useDragResize(spec));
    act(() => result.current.startResize(startDrag(100)));
    act(() => fireMouse('mousemove', 160));
    expect(result.current.size).toBe(360);
  });

  it('垂直轴：**向上**拖动增大（clientY 反向），并挂上对应光标', () => {
    const { result } = renderHook(() =>
      useDragResize({ ...spec, axis: 'vertical', cursor: 'row-resize' }),
    );
    act(() => result.current.startResize(startDrag(0, 400)));
    expect(document.body.style.cursor).toBe('row-resize');
    act(() => fireMouse('mousemove', 0, 340));
    expect(result.current.size).toBe(360);
  });

  it('夹取 min/max（max 支持函数形式：面板高度按视口比例）', () => {
    // 用函数形式覆盖 DebugPanel 的真实用法（`() => window.innerHeight * 0.7`）。
    const { result } = renderHook(() => useDragResize({ ...spec, max: () => 500 }));
    act(() => result.current.startResize(startDrag(100)));
    act(() => fireMouse('mousemove', -5000));
    expect(result.current.size).toBe(100); // min
    act(() => fireMouse('mousemove', 5000));
    expect(result.current.size).toBe(500); // max
  });

  it('松手持久化 + 清理拖动样式（不残留 cursor / userSelect）', () => {
    const { result } = renderHook(() => useDragResize(spec));
    act(() => result.current.startResize(startDrag(100)));
    act(() => fireMouse('mousemove', 200));
    act(() => fireMouse('mouseup', 200));
    expect(window.localStorage.getItem('test.size')).toBe('400');
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  it('拖动中卸载 → 兜底清理后台样式（关面板场景）', () => {
    const { result, unmount } = renderHook(() => useDragResize(spec));
    act(() => result.current.startResize(startDrag(100)));
    expect(document.body.style.userSelect).toBe('none');
    unmount();
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  it('持久化不可用（隐私模式）→ 不抛错，本次会话仍可拖动', () => {
    const setItem = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error('quota');
    };
    try {
      const { result } = renderHook(() => useDragResize(spec));
      act(() => result.current.startResize(startDrag(100)));
      act(() => fireMouse('mousemove', 150));
      expect(() => act(() => fireMouse('mouseup', 150))).not.toThrow();
      expect(result.current.size).toBe(350);
    } finally {
      window.localStorage.setItem = setItem;
    }
  });
});
