import {
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  gutter,
  GutterMarker,
  type DecorationSet,
} from '@codemirror/view';
import { useMemo, useRef } from 'react';

import { useDebugStore } from '../store/debugStore';

// ── Effects / fields (exported so FileViewer lineNumbers can drive hover) ─

export const setBreakpointsEffect = StateEffect.define<readonly number[]>();
export const setHoverLineEffect = StateEffect.define<number | null>();
export const setCurrentLineEffect = StateEffect.define<number | null>();

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-breakpoint-marker';
    el.title = 'Breakpoint';
    return el;
  }
  eq() {
    return true;
  }
}

class BreakpointHoverMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-breakpoint-marker cm-breakpoint-marker--hover';
    el.title = 'Add breakpoint';
    return el;
  }
  eq() {
    return true;
  }
}

const breakpointMarker = new BreakpointMarker();
const breakpointHoverMarker = new BreakpointHoverMarker();

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
const currentLineDecoField = StateField.define<DecorationSet>({
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

export function setBreakpointHoverLine(
  view: EditorView,
  lineFrom: number | null,
): boolean {
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
export function applyDebugCurrentLine(
  view: EditorView,
  line: number | null,
): void {
  try {
    view.dispatch({ effects: setCurrentLineEffect.of(line) });
  } catch {
    // field not installed
  }
}

// ── Extension pack (NO lineNumbers — FileViewer always owns that) ─────────

function buildBreakpointOnlyExtensions(
  onToggle: (line: number) => void,
): Extension[] {
  const handleClick = (view: EditorView, lineFrom: number) =>
    toggleBreakpointAt(view, lineFrom, onToggle);

  return [
    breakpointField,
    hoverLineField,
    currentLineDecoField,
    gutter({
      class: 'cm-breakpoint-gutter',
      markers(view) {
        try {
          const bps = view.state.field(breakpointField);
          const hover = view.state.field(hoverLineField);
          const bpSet = new Set(bps);
          const byLine = new Map<number, GutterMarker>();

          for (const line of bps) {
            if (line >= 1 && line <= view.state.doc.lines) {
              byLine.set(line, breakpointMarker);
            }
          }
          if (
            hover != null &&
            hover >= 1 &&
            hover <= view.state.doc.lines &&
            !bpSet.has(hover)
          ) {
            byLine.set(hover, breakpointHoverMarker);
          }

          const builder = new RangeSetBuilder<GutterMarker>();
          for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
            const from = view.state.doc.line(line).from;
            builder.add(from, from, byLine.get(line)!);
          }
          return builder.finish();
        } catch {
          return new RangeSetBuilder<GutterMarker>().finish();
        }
      },
      domEventHandlers: {
        mousedown(view, line) {
          return handleClick(view, line.from);
        },
        mouseover(view, line) {
          return setBreakpointHoverLine(view, line.from);
        },
        mouseout(view) {
          return clearBreakpointHoverLine(view);
        },
      },
    }),
    EditorView.theme({
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
        backgroundColor:
          'color-mix(in srgb, var(--accent-red, #e06c75) 30%, transparent)',
        boxShadow:
          '0 0 0 1px color-mix(in srgb, var(--accent-red, #e06c75) 45%, transparent)',
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
    }),
  ];
}

const EMPTY_EXTENSIONS: Extension[] = [];
const syncEffectOf = (lines: readonly number[]) =>
  setBreakpointsEffect.of(lines);

/**
 * Breakpoint gutter + current-line highlight field.
 * Does **not** include `lineNumbers()` — FileViewer always provides that so
 * the number column never disappears during debug reconfiguration.
 */
export function useBreakpointGutterExtensions(
  projectId: string | null,
  filePath: string | null,
): {
  extensions: Extension[];
  /** Always false — line numbers are owned by FileViewer. */
  includesLineNumbers: boolean;
  syncEffect: (lines: readonly number[]) => ReturnType<typeof setBreakpointsEffect.of>;
  /** Toggle BP at line.from — wire into FileViewer lineNumbers mousedown. */
  onLineNumberClick: (view: EditorView, lineFrom: number) => boolean;
  onLineNumberHover: (view: EditorView, lineFrom: number) => boolean;
  onLineNumberLeave: (view: EditorView) => boolean;
} {
  const ctxRef = useRef({ projectId, filePath });
  ctxRef.current = { projectId, filePath };
  const toggleBreakpoint = useDebugStore((s) => s.toggleBreakpoint);

  const onToggle = (line: number) => {
    const ctx = ctxRef.current;
    if (!ctx.projectId || !ctx.filePath) return;
    void toggleBreakpoint(ctx.projectId, ctx.filePath, line);
  };

  // Stable handlers for FileViewer lineNumbers (always call latest onToggle via ref)
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  return useMemo(() => {
    const handlers = {
      onLineNumberClick: (view: EditorView, lineFrom: number) =>
        toggleBreakpointAt(view, lineFrom, (line) => onToggleRef.current(line)),
      onLineNumberHover: (view: EditorView, lineFrom: number) =>
        setBreakpointHoverLine(view, lineFrom),
      onLineNumberLeave: (view: EditorView) => clearBreakpointHoverLine(view),
    };

    if (!projectId || !filePath) {
      return {
        extensions: EMPTY_EXTENSIONS,
        includesLineNumbers: false,
        syncEffect: syncEffectOf,
        ...handlers,
      };
    }
    return {
      extensions: buildBreakpointOnlyExtensions((line) => onToggleRef.current(line)),
      includesLineNumbers: false,
      syncEffect: syncEffectOf,
      ...handlers,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filePath]);
}
