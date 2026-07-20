/**
 * Apply go-to-line navigation: selection + scroll + focus + temporary line flash.
 * Without focus the caret does not blink and users cannot see where they landed.
 */
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/** 1-based line to flash, or null to clear. */
export const flashNavLineEffect = StateEffect.define<number | null>();

const flashNavLineField = StateField.define<DecorationSet>({
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
          builder.add(
            lineObj.from,
            lineObj.from,
            Decoration.line({ class: "cm-nav-flash-line" }),
          );
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
  y?: "start" | "center" | "end" | "nearest";
}

let flashClearTimer: ReturnType<typeof setTimeout> | null = null;

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

  const y = opts.y ?? "center";
  const flashMs = opts.flashMs ?? 1400;

  view.dispatch({
    selection: { anchor: resolved.pos, head: resolved.pos },
    effects: [
      EditorView.scrollIntoView(resolved.pos, { y }),
      flashNavLineEffect.of(resolved.line),
    ],
  });

  // Focus after paint so tab-switch mounts still get a blinking caret.
  requestAnimationFrame(() => {
    try {
      view.focus();
    } catch {
      // view may be destroyed
    }
  });

  if (flashClearTimer != null) {
    clearTimeout(flashClearTimer);
    flashClearTimer = null;
  }
  flashClearTimer = setTimeout(() => {
    flashClearTimer = null;
    try {
      view.dispatch({ effects: flashNavLineEffect.of(null) });
    } catch {
      // view destroyed
    }
  }, flashMs);

  return true;
}
