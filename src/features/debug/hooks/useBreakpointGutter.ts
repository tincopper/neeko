import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { useCallback, useMemo } from 'react';

import { useDebugStore } from '../store/debugStore';

// ── Effects / fields (exported so FileViewer lineNumbers can drive hover) ─

export const setBreakpointsEffect = StateEffect.define<readonly number[]>();
export const setHoverLineEffect = StateEffect.define<number | null>();
export const setCurrentLineEffect = StateEffect.define<number | null>();

/** 1-based lines with breakpoints. */
export const breakpointField = StateField.define<readonly number[]>({
  create: () => [],
  update(lines, tr) {
    for (const e of tr.effects) {
      if (e.is(setBreakpointsEffect)) return e.value;
    }
    return lines;
  },
});

/** 1-based line under mouse (hover ghost in BP gutter). */
export const hoverLineField = StateField.define<number | null>({
  create: () => null,
  update(line, tr) {
    for (const e of tr.effects) {
      if (e.is(setHoverLineEffect)) return e.value;
    }
    return line;
  },
});

/** Yellow current-statement line decoration. */
export const currentLineDecoField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setCurrentLineEffect)) {
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
            Decoration.line({ class: 'cm-debug-current-line' }),
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

// ── Helpers used by FileViewer lineNumbers handlers ───────────────────────

/** Toggle breakpoint at a document position (line.from). */
export function toggleBreakpointAt(
  view: EditorView,
  lineFrom: number,
  onToggle: (line: number) => void,
): boolean {
  try {
    const lineNo = view.state.doc.lineAt(lineFrom).number;
    // Only if the field is installed (debug pack present)
    let current: readonly number[] = [];
    try {
      current = view.state.field(breakpointField);
    } catch {
      return false;
    }
    const next = current.includes(lineNo)
      ? current.filter((l) => l !== lineNo)
      : [...current, lineNo].sort((a, b) => a - b);
    view.dispatch({ effects: setBreakpointsEffect.of(next) });
    onToggle(lineNo);
    return true;
  } catch {
    return false;
  }
}

export function setBreakpointHoverLine(view: EditorView, lineFrom: number | null): boolean {
  let next: number | null = null;
  if (lineFrom != null) {
    try {
      next = view.state.doc.lineAt(lineFrom).number;
    } catch {
      next = null;
    }
  }
  try {
    if (view.state.field(hoverLineField) === next) return false;
    view.dispatch({ effects: setHoverLineEffect.of(next) });
  } catch {
    return false;
  }
  return false;
}

export function clearBreakpointHoverLine(view: EditorView): boolean {
  try {
    if (view.state.field(hoverLineField) == null) return false;
    view.dispatch({ effects: setHoverLineEffect.of(null) });
  } catch {
    return false;
  }
  return false;
}

/** Apply yellow current-line highlight (1-based). */
export function applyDebugCurrentLine(view: EditorView, line: number | null): void {
  try {
    view.dispatch({ effects: setCurrentLineEffect.of(line) });
  } catch {
    // field not installed
  }
}

// ── Extension pack (NO lineNumbers — FileViewer always owns that) ─────────

/**
 * 断点 gutter 列样式（红点/ghost/行号 affordance/current-line 高亮）。
 * 统一 gutter 复用本主题（列宽由其覆盖为自适应），避免两处定义红点样式分叉。
 */
export const breakpointGutterTheme = EditorView.theme({
  '.cm-breakpoint-gutter': {
    width: '16px',
    minWidth: '16px',
    cursor: 'pointer',
  },
  '.cm-breakpoint-gutter .cm-gutterElement': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  '.cm-breakpoint-marker': {
    width: '9px',
    height: '9px',
    borderRadius: '50%',
    backgroundColor: 'var(--accent-red, #e06c75)',
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.25)',
  },
  '.cm-breakpoint-marker--hover': {
    backgroundColor: 'color-mix(in srgb, var(--accent-red, #e06c75) 30%, transparent)',
    boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent-red, #e06c75) 45%, transparent)',
  },
  // Line-number affordance only (numbers themselves come from FileViewer)
  '.cm-lineNumbers': {
    cursor: 'pointer',
    minWidth: '2.5em',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    cursor: 'pointer',
    paddingRight: '8px',
    color: 'var(--text-muted, #7f848e)',
  },
  '.cm-lineNumbers .cm-gutterElement:hover': {
    color: 'var(--text-primary, #abb2bf)',
  },
  '.cm-debug-current-line': {
    backgroundColor:
      'color-mix(in srgb, var(--accent-yellow, #e5c07b) 38%, transparent) !important',
    boxShadow: 'inset 3px 0 0 var(--accent-yellow, #e5c07b)',
  },
  '.cm-activeLine.cm-debug-current-line': {
    backgroundColor:
      'color-mix(in srgb, var(--accent-yellow, #e5c07b) 42%, transparent) !important',
  },
});

/** Store → CM breakpoint field 同步 effect 构造器（setBreakpointsEffect.of 的具名形态）。 */
export type BreakpointSyncEffect = (lines: readonly number[]) => StateEffect<readonly number[]>;

const syncEffectOf: BreakpointSyncEffect = (lines) => setBreakpointsEffect.of(lines);

/**
 * 断点 gutter 的行号交互与同步。断点列渲染已由统一 gutter 的
 * `breakpointContribution`（debug/gutter/breakpointContribution.ts）承担，
 * 本函数不再装配任何 CM 扩展 —— 只提供 store → field 同步的 effect 构造器
 * 与 FileViewer 行号列的点击/悬停处理器。
 */
export function useBreakpointGutter(
  projectId: string | null,
  filePath: string | null,
): {
  syncEffect: BreakpointSyncEffect;
  /** Toggle BP at line.from — wire into FileViewer lineNumbers mousedown. */
  onLineNumberClick: (view: EditorView, lineFrom: number) => boolean;
  onLineNumberHover: (view: EditorView, lineFrom: number) => boolean;
  onLineNumberLeave: (view: EditorView) => boolean;
} {
  const toggleBreakpoint = useDebugStore((s) => s.toggleBreakpoint);

  const onToggle = useCallback(
    (line: number) => {
      if (!projectId || !filePath) return;
      void toggleBreakpoint(projectId, filePath, line);
    },
    [projectId, filePath, toggleBreakpoint],
  );

  return useMemo(() => {
    const handlers = {
      onLineNumberClick: (view: EditorView, lineFrom: number) =>
        toggleBreakpointAt(view, lineFrom, (line) => onToggle(line)),
      onLineNumberHover: (view: EditorView, lineFrom: number) =>
        setBreakpointHoverLine(view, lineFrom),
      onLineNumberLeave: (view: EditorView) => clearBreakpointHoverLine(view),
    };

    return {
      syncEffect: syncEffectOf,
      ...handlers,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filePath, onToggle]);
}
