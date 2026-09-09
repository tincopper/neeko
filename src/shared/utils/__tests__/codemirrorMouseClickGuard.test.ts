import { EditorSelection } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeMouseClickGuardStyle } from '../codemirrorMouseClickGuard';

/** Queue of {pos, assoc} results returned by the fake posAndSideAtCoords, in call order. */
function makeView(mappings: Array<{ pos: number; assoc?: -1 | 1 }>, sel?: EditorSelection) {
  let call = 0;
  const view = {
    dom: { contains: vi.fn(() => true), ownerDocument: document },
    state: { selection: sel ?? EditorSelection.cursor(0), doc: { length: 1_000_000 } },
    posAndSideAtCoords: vi.fn(() => {
      const m = mappings[Math.min(call, mappings.length - 1)];
      call += 1;
      return { pos: m.pos, assoc: m.assoc ?? 1 };
    }),
    posAtDOM: vi.fn(),
    scrollDOM: { scrollTop: 0 },
    dispatch: vi.fn(),
  };
  return view as unknown as EditorView & {
    posAndSideAtCoords: ReturnType<typeof vi.fn>;
    posAtDOM: ReturnType<typeof vi.fn>;
    scrollDOM: { scrollTop: number };
    dispatch: ReturnType<typeof vi.fn>;
  };
}

function mouseEvent(
  type: string,
  opts: { x: number; y: number; button?: number; detail?: number; shiftKey?: boolean },
): MouseEvent {
  return new MouseEvent(type, {
    clientX: opts.x,
    clientY: opts.y,
    button: opts.button ?? 0,
    detail: opts.detail ?? 1,
    shiftKey: opts.shiftKey ?? false,
    bubbles: true,
  });
}

describe('makeMouseClickGuardStyle', () => {
  const DOWN = { x: 100, y: 200 };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should_return_null_for_non_primary_button', () => {
    const view = makeView([{ pos: 0 }]);
    const style = makeMouseClickGuardStyle(view, mouseEvent('mousedown', { ...DOWN, button: 2 }));
    expect(style).toBeNull();
  });

  it('should_return_null_for_double_click_falling_back_to_default_style', () => {
    const view = makeView([{ pos: 0 }]);
    const style = makeMouseClickGuardStyle(view, mouseEvent('mousedown', { ...DOWN, detail: 2 }));
    expect(style).toBeNull();
  });

  it('should_return_cursor_at_latest_mapping_for_stationary_click_with_inconsistent_mapping', () => {
    // Bug scenario: mousedown maps to the stale pre-scroll position (100),
    // mouseup maps elsewhere (5000). Default CM builds range(100, 5000) here.
    const view = makeView([{ pos: 100 }, { pos: 5000 }]);
    const style = makeMouseClickGuardStyle(view, mouseEvent('mousedown', DOWN));
    const sel = style!.get(mouseEvent('mouseup', DOWN), false, false);
    expect(sel.main.anchor).toBe(5000);
    expect(sel.main.head).toBe(5000);
    expect(sel.ranges).toHaveLength(1);
  });

  it('should_return_cursor_when_mapping_is_consistent', () => {
    const view = makeView([{ pos: 5000 }, { pos: 5000 }]);
    const style = makeMouseClickGuardStyle(view, mouseEvent('mousedown', DOWN));
    const sel = style!.get(mouseEvent('mouseup', DOWN), false, false);
    expect(sel.main.anchor).toBe(5000);
  });

  it('should_keep_default_drag_range_when_pointer_actually_moved', () => {
    const view = makeView([{ pos: 100 }, { pos: 5000 }]);
    const style = makeMouseClickGuardStyle(view, mouseEvent('mousedown', DOWN));
    const sel = style!.get(mouseEvent('mousemove', { x: 300, y: 400 }), false, false);
    expect(sel.main.anchor).toBe(100);
    expect(sel.main.head).toBe(5000);
  });

  it('should_extend_existing_selection_on_shift_click', () => {
    const view = makeView([{ pos: 100 }, { pos: 5000 }], EditorSelection.single(100));
    const style = makeMouseClickGuardStyle(view, mouseEvent('mousedown', DOWN));
    const sel = style!.get(mouseEvent('mouseup', { ...DOWN, shiftKey: true }), true, false);
    expect(sel.main.anchor).toBe(100);
    expect(sel.main.head).toBe(5000);
  });

  it('should_map_start_pos_through_doc_changes_in_update', () => {
    const view = makeView([{ pos: 100 }, { pos: 5000 }]);
    const style = makeMouseClickGuardStyle(view, mouseEvent('mousedown', DOWN))!;
    const changes = { mapPos: (p: number) => p + 10 };
    style.update({ docChanged: true, changes } as unknown as ViewUpdate);
    const sel = style.get(mouseEvent('mousemove', { x: 300, y: 400 }), false, false);
    expect(sel.main.anchor).toBe(110);
    expect(sel.main.head).toBe(5000);
  });

  it('should_map_consistently_when_get_is_called_with_mousedown_event', () => {
    // CM start(event) → get(mousedown): same coordinates re-mapped, must stay stable.
    const view = makeView([{ pos: 100 }, { pos: 100 }]);
    const style = makeMouseClickGuardStyle(view, mouseEvent('mousedown', DOWN));
    const sel = style!.get(mouseEvent('mousedown', DOWN), false, false);
    expect(sel.main.anchor).toBe(100);
  });

  it('should_restore_scroll_top_before_mapping_when_focus_scroll_drifted', () => {
    // WebKit focus 滚动回归：mousedown 时 scrollTop=1289（正确），CM focus 把视图
    // 滚走（无 JS 赋值，浏览器原生），mouseup 时 scrollTop 漂移到 200。修复必须
    // 在映射前恢复 mousedown 值，selection 才落在点击处。
    const view = makeView([{ pos: 8000 }, { pos: 8000 }]);
    view.scrollDOM.scrollTop = 1289; // mousedown 时的滚动位置
    const style = makeMouseClickGuardStyle(view, mouseEvent('mousedown', DOWN))!;
    view.scrollDOM.scrollTop = 200; // 模拟 focus 滚动漂移（mouseup 前）
    const sel = style.get(mouseEvent('mouseup', DOWN), false, false);
    expect(view.scrollDOM.scrollTop).toBe(1289); // 已恢复
    expect(sel.main.anchor).toBe(8000); // 基于恢复后 scrollTop 映射
  });

  it('should_not_restore_scroll_top_on_real_drag', () => {
    // 拖拽（moved >= 阈值）期间 scrollTop 变化可能是用户拖出视口的 auto-scroll，
    // 属于意图：不得恢复，否则抵消用户的滚动。
    const view = makeView([{ pos: 100 }, { pos: 5000 }]);
    view.scrollDOM.scrollTop = 1289;
    const style = makeMouseClickGuardStyle(view, mouseEvent('mousedown', DOWN))!;
    view.scrollDOM.scrollTop = 1500; // 用户拖拽引发的滚动
    const sel = style.get(mouseEvent('mousemove', { x: 300, y: 400 }), false, false);
    expect(view.scrollDOM.scrollTop).toBe(1500); // 不恢复
    expect(sel.main.anchor).toBe(100); // 拖选语义不变
  });

  it('should_use_native_posandsideatcoords_for_mapping', () => {
    // 简化后映射走 CM 原生 posAndSideAtCoords（与 basicMouseSelection 同路径），
    // 不再用 caretRangeFromPoint 命中测试层（2026-09-09 实证其假设不成立）。
    const view = makeView([{ pos: 5000 }, { pos: 5000 }]);
    const style = makeMouseClickGuardStyle(view, mouseEvent('mousedown', DOWN))!;
    const sel = style.get(mouseEvent('mouseup', DOWN), false, false);
    expect(view.posAndSideAtCoords).toHaveBeenCalled();
    expect(sel.main.anchor).toBe(5000);
  });
});
