import type { Extension, Range, EditorState } from '@codemirror/state';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, gutter, GutterMarker } from '@codemirror/view';
import { useMemo } from 'react';

import type { LspDiagnostic } from '../types';

/**
 * Builds a DecorationSet from diagnostics and the current editor state.
 * Converts LSP 0-based line/character positions to absolute offsets.
 */
function buildDecorations(diagnostics: LspDiagnostic[], state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  for (const d of diagnostics) {
    const { start, end } = d.range;

    let className = 'cm-lsp-info';
    if (d.severity !== null && d.severity <= 1) className = 'cm-lsp-error';
    else if (d.severity !== null && d.severity <= 2) className = 'cm-lsp-warning';

    try {
      const fromLine = state.doc.line(start.line + 1);
      const toLine = state.doc.line(end.line + 1);
      const from = fromLine.from + Math.min(start.character, fromLine.length);
      const to = toLine.from + Math.min(end.character, toLine.length);
      if (from < to && from >= 0 && to <= state.doc.length) {
        decos.push(Decoration.mark({ class: className }).range(from, to));
      }
    } catch {
      // Skip diagnostics whose line is outside the document
    }
  }
  return Decoration.set(decos, true);
}

/**
 * Creates CodeMirror extensions for displaying LSP diagnostics.
 * Renders squiggly underlines for errors/warnings and gutter markers.
 */
export function useLspDiagnosticExtensions(diagnostics: LspDiagnostic[]) {
  return useMemo(() => {
    if (diagnostics.length === 0) return [];

    const extensions: Extension[] = [];

    // 1. StateField for squiggly underline decorations
    const effect = StateEffect.define<LspDiagnostic[]>();

    const diagField = StateField.define<DecorationSet>({
      create(state) {
        return buildDecorations(diagnostics, state);
      },
      update(value, tr) {
        for (const e of tr.effects) {
          if (e.is(effect)) {
            return buildDecorations(e.value, tr.state);
          }
        }
        return value;
      },
      provide: (field) => EditorView.decorations.from(field),
    });
    extensions.push(diagField);

    // 2. Theme for squiggly underlines and gutter markers
    extensions.push(
      EditorView.theme({
        '.cm-lsp-error': {
          textDecoration: 'underline wavy #ef4444',
          textUnderlineOffset: '3px',
        },
        '.cm-lsp-warning': {
          textDecoration: 'underline wavy #eab308',
          textUnderlineOffset: '3px',
        },
        '.cm-lsp-info': {
          textDecoration: 'underline wavy #3b82f6',
          textUnderlineOffset: '3px',
        },
        '.cm-lsp-gutter': {
          width: '16px',
          minWidth: '16px',
        },
        '.cm-lsp-gutter .cm-lsp-marker': {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          fontSize: '10px',
        },
        '.cm-lsp-gutter .cm-lsp-marker-error': {
          color: '#ef4444',
        },
        '.cm-lsp-gutter .cm-lsp-marker-warning': {
          color: '#eab308',
        },
        '.cm-lsp-gutter .cm-lsp-marker-info': {
          color: '#3b82f6',
        },
      }),
    );

    // 3. Gutter markers for lines with diagnostics
    const lineMap = new Map<number, number | null>();
    for (const d of diagnostics) {
      const line = d.range.start.line + 1; // 1-based for gutter
      const existing = lineMap.get(line);
      if (existing === undefined) {
        lineMap.set(line, d.severity);
      } else if (d.severity !== null && (existing === null || d.severity < existing)) {
        // Lower severity number = more severe (1=error)
        lineMap.set(line, d.severity);
      }
    }

    class DiagMarker extends GutterMarker {
      severity: number | null;
      constructor(severity: number | null) {
        super();
        this.severity = severity;
      }
      toDOM() {
        const el = document.createElement('span');
        el.className = 'cm-lsp-marker';
        if (this.severity !== null && this.severity <= 1) {
          el.classList.add('cm-lsp-marker-error');
        } else if (this.severity !== null && this.severity <= 2) {
          el.classList.add('cm-lsp-marker-warning');
        } else {
          el.classList.add('cm-lsp-marker-info');
        }
        el.textContent = '●';
        return el;
      }
    }

    extensions.push(
      gutter({
        class: 'cm-lsp-gutter',
        lineMarker: (_view, lineInfo) => {
          const lineNum = lineInfo.from;
          const sev = lineMap.get(lineNum);
          return sev !== undefined ? new DiagMarker(sev) : null;
        },
      }),
    );

    return extensions;
  }, [diagnostics]);
}

/**
 * Creates a CodeMirror mouse-handler extension for LSP hover.
 * Captures mousemove events, debounces (300ms), and resolves the
 * line/character position to call the `onMouseMove` callback.
 */
export function useLspHoverExtension(
  onMouseMove: (line: number, character: number, x: number, y: number) => void,
): Extension {
  return useMemo(() => {
    const timerState = { current: null as ReturnType<typeof setTimeout> | null };

    return EditorView.domEventHandlers({
      mousemove(event, view) {
        if (timerState.current) clearTimeout(timerState.current);

        timerState.current = setTimeout(() => {
          timerState.current = null;
          const rect = view.dom.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          const pos = view.posAtCoords({ x, y });
          if (pos === null) return;

          const lineObj = view.state.doc.lineAt(pos);
          const line = lineObj.number - 1; // 0-based for LSP
          const character = pos - lineObj.from;

          onMouseMove(line, character, event.clientX, event.clientY);
        }, 300);
      },
      mouseleave() {
        if (timerState.current) {
          clearTimeout(timerState.current);
          timerState.current = null;
        }
      },
    });
  }, [onMouseMove]);
}
