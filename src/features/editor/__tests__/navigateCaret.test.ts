import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, it, expect } from 'vitest';

import {
  applyNavigateCaret,
  flashNavLineField,
  navigateCaretExtension,
  releaseDebugCaret,
  resolveDocPos,
} from '../navigateCaret';

function makeView(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [navigateCaretExtension],
    }),
    parent,
  });
}

/** 当前被标记为闪烁（`cm-nav-flash-line`）的行号（1-based）。 */
function flashLines(view: EditorView): number[] {
  const out: number[] = [];
  const iter = view.state.field(flashNavLineField).iter();
  while (iter.value) {
    out.push(view.state.doc.lineAt(iter.from).number);
    iter.next();
  }
  return out;
}

/** 等定时器到期（用真实定时器 + 极短 flashMs，与既有用例一致）。 */
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

describe('navigateCaret', () => {
  it('should_clamp_line_and_col_to_doc', () => {
    const view = makeView('hello\nworld\n');
    expect(resolveDocPos(view, 1, 0)).toEqual({ pos: 0, line: 1 });
    expect(resolveDocPos(view, 2, 2)?.line).toBe(2);
    expect(resolveDocPos(view, 2, 99)?.pos).toBe(view.state.doc.line(2).to);
    expect(resolveDocPos(view, 99, 0)?.line).toBe(view.state.doc.lines);
    view.destroy();
  });

  it('should_move_selection_to_target_on_apply', () => {
    const view = makeView('aaa\nbbb\nccc');
    const ok = applyNavigateCaret(view, 2, 1, { flashMs: 10 });
    expect(ok).toBe(true);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(2).from + 1);
    view.destroy();
  });

  it('should_return_false_for_empty_doc_edge', () => {
    const view = makeView('');
    // empty doc still has 1 empty line in CodeMirror
    const resolved = resolveDocPos(view, 1, 0);
    expect(resolved).not.toBeNull();
    view.destroy();
  });

  it('flash_auto_clears_after_flashMs', async () => {
    const view = makeView('a1\na2\n');
    applyNavigateCaret(view, 2, 0, { flashMs: 10 });
    expect(flashLines(view)).toEqual([2]);

    await tick();
    expect(flashLines(view)).toEqual([]);
    view.destroy();
  });

  /**
   * **回归**：闪烁的清理定时器必须**按视图**隔离。
   *
   * 旧实现用一个模块级单例定时器：后一次导航会 `clearTimeout` 掉前一个视图的清理，
   * 于是先被导航到的视图永久保留 `cm-nav-flash-line`（表现为"退出调试后还留一层蓝底"）。
   */
  it('another_view_flash_must_not_cancel_this_view_clear', async () => {
    const a = makeView('a1\na2\n');
    const b = makeView('b1\nb2\n');

    applyNavigateCaret(a, 2, 0, { flashMs: 10 });
    applyNavigateCaret(b, 2, 0, { flashMs: 10 });
    expect(flashLines(a)).toEqual([2]);
    expect(flashLines(b)).toEqual([2]);

    await tick();
    expect(flashLines(a)).toEqual([]);
    expect(flashLines(b)).toEqual([]);

    a.destroy();
    b.destroy();
  });

  it('re_flashing_the_same_view_moves_the_highlight', async () => {
    const view = makeView('1\n2\n3\n');
    applyNavigateCaret(view, 1, 0, { flashMs: 50 });
    expect(flashLines(view)).toEqual([1]);

    // 同一视图再次导航：旧行不再高亮，只剩新行。
    applyNavigateCaret(view, 3, 0, { flashMs: 50 });
    expect(flashLines(view)).toEqual([3]);

    await tick(80);
    expect(flashLines(view)).toEqual([]);
    view.destroy();
  });

  /**
   * **调试光标释放**：停点结束时把光标还回调试跳转前的位置。
   *
   * 不还回去的后果（现场）：编辑器一直停在最后一个断点行，`cm-activeLine` 常亮。
   */
  it('release_debug_caret_restores_the_pre_debug_position', () => {
    const view = makeView('aaa\nbbb\nccc\n');
    // 用户原本的光标在第 3 行
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from } });
    const original = view.state.selection.main.head;

    applyNavigateCaret(view, 2, 0, { flashMs: 50, rememberPrevCaret: true });
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2);

    expect(releaseDebugCaret(view, 2)).toBe(true);
    expect(view.state.selection.main.head).toBe(original);
    view.destroy();
  });

  /** 用户自己把光标移走了 → 绝不夺走（宁可留下高亮，也不做惊吓式移动）。 */
  it('release_never_steals_a_caret_the_user_moved', () => {
    const view = makeView('aaa\nbbb\nccc\n');
    applyNavigateCaret(view, 2, 0, { flashMs: 50, rememberPrevCaret: true });

    // 用户在停点后自己点回第 1 行
    view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });

    expect(releaseDebugCaret(view, 2)).toBe(false);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(1);
    view.destroy();
  });

  /** 没有记录（非调试跳转）时释放是空操作。 */
  it('release_is_a_noop_without_a_recorded_caret', () => {
    const view = makeView('aaa\nbbb\n');
    applyNavigateCaret(view, 2, 0, { flashMs: 10 });

    expect(releaseDebugCaret(view, 2)).toBe(false);
    view.destroy();
  });

  /** 多次停点不得覆盖记录：释放要回到**用户原来的位置**，而不是上一次停止处。 */
  it('repeated_debug_stops_keep_the_original_position', () => {
    const view = makeView('1\n2\n3\n4\n');
    view.dispatch({ selection: { anchor: view.state.doc.line(4).from } });
    const original = view.state.selection.main.head;

    applyNavigateCaret(view, 2, 0, { flashMs: 10, rememberPrevCaret: true });
    applyNavigateCaret(view, 3, 0, { flashMs: 10, rememberPrevCaret: true });

    expect(releaseDebugCaret(view, 3)).toBe(true);
    expect(view.state.selection.main.head).toBe(original);
    view.destroy();
  });
});
