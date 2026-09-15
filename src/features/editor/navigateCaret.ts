/**
 * Apply go-to-line navigation: selection + scroll + focus + temporary line flash.
 * Without focus the caret does not blink and users cannot see where they landed.
 */
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/** 1-based line to flash, or null to clear. */
export const flashNavLineEffect = StateEffect.define<number | null>();

/**
 * 闪烁行所在的装饰集合。
 *
 * 导出供测试断言（与 debug 的 `currentLineDecoField` 同例）；业务代码只经
 * [`applyNavigateCaret`] 操作它。
 */
export const flashNavLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(flashNavLineEffect)) {
        const line = e.value;
        if (line == null || line < 1 || line > tr.state.doc.lines) {
          return Decoration.none;
        }
        try {
          const lineObj = tr.state.doc.line(line);
          const builder = new RangeSetBuilder<Decoration>();
          builder.add(lineObj.from, lineObj.from, Decoration.line({ class: 'cm-nav-flash-line' }));
          return builder.finish();
        } catch {
          return Decoration.none;
        }
      }
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Install once in the CodeMirror extension list. */
export const navigateCaretExtension = flashNavLineField;

export interface NavigateCaretOptions {
  /** How long the destination line stays highlighted (ms). Default 1400. */
  flashMs?: number;
  /** Scroll vertical position. Default "center". */
  y?: 'start' | 'center' | 'end' | 'nearest';
  /**
   * 记录本次移动**之前**的光标位置，供 [`releaseDebugCaret`] 之后还原。
   *
   * 只由**调试停点**的跳转启用：那是会话的临时副作用，停止结束后应当释放；用户意图的跳转
   * （定义跳转 / 链接 / quick-open）必须保留光标，不能记录。
   */
  rememberPrevCaret?: boolean;
}

/**
 * 每个视图「调试跳转前」的光标位置（**只记录第一次**）。
 *
 * 只记第一次是有意的：一次调试会多次停点并反复移动光标，若每次都覆盖，释放时会回到
 * "上一次停点"而不是**用户原来的位置**。WeakMap 保证视图销毁后条目自动消失，不泄漏。
 */
const caretBeforeDebug = new WeakMap<EditorView, number>();

/**
 * 释放调试放置的光标：把它还回调试跳转前的位置。
 *
 * 为什么需要：调试把光标移到停止行是**会话的临时副作用**（与黄线、闪烁同类）。停止结束后
 * 不还回去，编辑器就会一直停在最后一个断点行 —— 表现为 `cm-activeLine` 常亮在断点处。
 *
 * 只在**光标仍停在我们放置的那一行**（且选区为空）时才还原：用户在停点后自己点过别处，
 * 就绝不夺走他的光标（宁可留下高亮，也不做会惊吓用户的光标移动）。
 *
 * @param placedLine 调试最后一次放置光标的行（1-based）
 * @returns 是否真的还原了光标
 */
export function releaseDebugCaret(view: EditorView, placedLine: number): boolean {
  const prev = caretBeforeDebug.get(view);
  caretBeforeDebug.delete(view);
  if (prev == null || prev > view.state.doc.length) {
    return false;
  }
  const sel = view.state.selection.main;
  if (!sel.empty || view.state.doc.lineAt(sel.head).number !== placedLine) {
    return false;
  }
  view.dispatch({ selection: { anchor: prev }, scrollIntoView: false });
  return true;
}

/**
 * 每个视图**各自**待执行的闪烁清理定时器。
 *
 * 为什么不能用一个模块级变量：闪烁是**每个视图自己的**状态（`flashNavLineField` 里存的是
 * 该视图的装饰）。单例定时器会被下一次导航 `clearTimeout` 掉，于是"上一个被导航到的视图"
 * 永远等不到清理 —— 表现为**退出调试后仍留一层蓝底**（`cm-nav-flash-line`）。
 * WeakMap 还顺带保证视图销毁后条目自动消失，不泄漏。
 */
const flashClearTimers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();

/** Clamp line/col to a valid document position. */
export function resolveDocPos(
  view: EditorView,
  line: number,
  col: number,
): { pos: number; line: number } | null {
  if (view.state.doc.lines < 1) return null;
  const lineNo = Math.min(Math.max(1, Math.floor(line)), view.state.doc.lines);
  try {
    const lineObj = view.state.doc.line(lineNo);
    const colClamped = Math.min(Math.max(0, Math.floor(col)), lineObj.length);
    return { pos: lineObj.from + colClamped, line: lineNo };
  } catch {
    return null;
  }
}

/**
 * Move caret to (line, col), center it, focus the editor (so the caret blinks),
 * and briefly highlight the destination line.
 *
 * @param line 1-based
 * @param col 0-based character offset within the line
 */
export function applyNavigateCaret(
  view: EditorView,
  line: number,
  col: number,
  opts: NavigateCaretOptions = {},
): boolean {
  const resolved = resolveDocPos(view, line, col);
  if (!resolved) return false;

  const y = opts.y ?? 'center';
  const flashMs = opts.flashMs ?? 1400;

  // 记录"调试跳转前"的光标位置（早于本次 dispatch 读取，故仍是用户原位置）。
  if (opts.rememberPrevCaret && !caretBeforeDebug.has(view)) {
    caretBeforeDebug.set(view, view.state.selection.main.head);
  }

  view.dispatch({
    selection: { anchor: resolved.pos, head: resolved.pos },
    effects: [EditorView.scrollIntoView(resolved.pos, { y }), flashNavLineEffect.of(resolved.line)],
  });

  // Focus after paint so tab-switch mounts still get a blinking caret.
  requestAnimationFrame(() => {
    try {
      view.focus();
    } catch {
      // view may be destroyed
    }
  });

  // 只取消**本视图**上一次的清理：其它视图的闪烁与本次导航无关，取消它就会留下永久蓝底。
  const pending = flashClearTimers.get(view);
  if (pending != null) {
    clearTimeout(pending);
  }
  const timer = setTimeout(() => {
    flashClearTimers.delete(view);
    try {
      view.dispatch({ effects: flashNavLineEffect.of(null) });
    } catch {
      // view destroyed
    }
  }, flashMs);
  flashClearTimers.set(view, timer);

  return true;
}
