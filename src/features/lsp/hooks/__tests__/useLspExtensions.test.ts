import { EditorView } from '@codemirror/view';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLspHoverExtension } from '../useLspExtensions';

// jsdom 的 DOM Range 未实现 getClientRects / getBoundingClientRect，
// EditorView 初始 measure（measureTextSize → clientRectsFor）需要它们。
beforeAll(() => {
  const rect = () =>
    ({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  if (typeof Range.prototype.getClientRects !== 'function') {
    (Range.prototype as unknown as { getClientRects: () => DOMRectList }).getClientRects = () =>
      ({
        length: 0,
        item: () => null,
        [Symbol.iterator]: function* () {},
      }) as unknown as DOMRectList;
  }
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = rect;
  }
});

/** jsdom 无布局：mock 出非零的编辑器视口偏移，才能区分 client 坐标与 view 相对坐标。 */
function mockDomRect(view: EditorView, left: number, top: number): void {
  vi.spyOn(view.dom, 'getBoundingClientRect').mockReturnValue({
    left,
    top,
    width: 800,
    height: 600,
    right: left + 800,
    bottom: top + 600,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('useLspHoverExtension', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should_pass_client_coordinates_to_posAtCoords', async () => {
    // 回归测试：posAtCoords 期望 client 坐标（内部直接与 getClientRects 比较），
    // 传入减去 rect.left/top 的 view 相对坐标会让悬停位置系统性偏移。
    const onMouseMove = vi.fn();
    const { result } = renderHook(() => useLspHoverExtension(onMouseMove));

    const parent = document.body;
    const view = new EditorView({ doc: 'hello world', parent, extensions: [result.current] });
    mockDomRect(view, 100, 50);
    const posSpy = vi.spyOn(view, 'posAtCoords').mockReturnValue(3);

    view.contentDOM.dispatchEvent(new MouseEvent('mousemove', { clientX: 123, clientY: 75 }));
    await vi.advanceTimersByTimeAsync(300);

    expect(posSpy).toHaveBeenCalledWith({ x: 123, y: 75 });
    view.destroy();
  });

  it('should_report_zero_based_line_and_character_with_client_coords', async () => {
    const onMouseMove = vi.fn();
    const { result } = renderHook(() => useLspHoverExtension(onMouseMove));

    const view = new EditorView({
      doc: 'hello\nworld',
      parent: document.body,
      extensions: [result.current],
    });
    mockDomRect(view, 100, 50);
    // 'world' 的 'r'：doc offset 8 → line 2（1-based）→ 0-based line 1, character 2
    vi.spyOn(view, 'posAtCoords').mockReturnValue(8);

    view.contentDOM.dispatchEvent(new MouseEvent('mousemove', { clientX: 123, clientY: 75 }));
    await vi.advanceTimersByTimeAsync(300);

    expect(onMouseMove).toHaveBeenCalledWith(1, 2, 123, 75);
    view.destroy();
  });

  it('should_not_invoke_callback_when_posAtCoords_returns_null', async () => {
    const onMouseMove = vi.fn();
    const { result } = renderHook(() => useLspHoverExtension(onMouseMove));

    const view = new EditorView({
      doc: 'hello',
      parent: document.body,
      extensions: [result.current],
    });
    mockDomRect(view, 100, 50);
    vi.spyOn(view, 'posAtCoords').mockReturnValue(null);

    view.contentDOM.dispatchEvent(new MouseEvent('mousemove', { clientX: 123, clientY: 75 }));
    await vi.advanceTimersByTimeAsync(300);

    expect(onMouseMove).not.toHaveBeenCalled();
    view.destroy();
  });
});
