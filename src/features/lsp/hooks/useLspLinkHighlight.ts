import { useMemo } from 'react';

import type { Extension } from '@codemirror/state';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';

import { lspGoToDefinition } from '../api/lspApi';
import { definitionCacheKey, getOrFetchDefinition } from './lspCache';
import { IS_MACOS } from '@/shared/utils/platform';

const setLinkDeco = StateEffect.define<DecorationSet>();

/** Clear the link highlight decoration on an editor view. */
export function clearLinkHighlight(view: EditorView): void {
  view.dispatch({ effects: setLinkDeco.of(Decoration.none) });
}

const linkDecoField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setLinkDeco)) return e.value;
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const linkTheme = EditorView.theme({
  '.cm-lsp-link': {
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
    backgroundColor: 'rgba(60, 130, 255, 0.08)',
    borderRadius: '2px',
  },
});

/**
 * CodeMirror extension that shows a clickable underline when
 * Cmd/Ctrl is held and the cursor hovers over a navigable symbol.
 *
 * Works by sending a textDocument/definition request on hover
 * and underlining the word if the server responds with a location.
 */
export function useLspLinkHighlightExtension(
  projectPath: string | null,
  languageId: string | null,
  uri: string,
): Extension {
  return useMemo(() => {
    if (!projectPath || !languageId || !uri) return [];

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let requestSeq = 0;

    function applyHighlight(view: EditorView, from: number, to: number) {
      const deco = Decoration.mark({ class: 'cm-lsp-link' });
      view.dispatch({
        effects: setLinkDeco.of(Decoration.set([deco.range(from, to)])),
      });
    }

    function clearHighlight(view: EditorView) {
      view.dispatch({ effects: setLinkDeco.of(Decoration.none) });
    }

    return [
      linkDecoField,
      linkTheme,
      EditorView.domEventHandlers({
        mousemove(event, view) {
          if (debounceTimer) clearTimeout(debounceTimer);

          const modKey = IS_MACOS ? event.metaKey : event.ctrlKey;
          if (!modKey) {
            requestSeq++;
            clearHighlight(view);
            return;
          }

          const seq = ++requestSeq;

          debounceTimer = setTimeout(async () => {
            debounceTimer = null;
            if (seq !== requestSeq) return;

            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) return;

            const word = view.state.wordAt(pos);
            if (!word) return;

            const lineObj = view.state.doc.lineAt(pos);
            const line = lineObj.number - 1;
            const character = pos - lineObj.from;

            try {
              const key = definitionCacheKey(projectPath, uri, line, character);
              const wrapped = await getOrFetchDefinition(key, () =>
                lspGoToDefinition(projectPath!, languageId!, uri, line, character),
              );

              if (seq !== requestSeq) return;

              if (wrapped && wrapped.lspResult) {
                const currentWord = view.state.wordAt(pos);
                if (currentWord) {
                  applyHighlight(view, currentWord.from, currentWord.to);
                } else {
                  applyHighlight(view, word.from, word.to);
                }
              } else {
                clearHighlight(view);
              }
            } catch {
              if (seq === requestSeq) {
                clearHighlight(view);
              }
            }
          }, 50);
        },
        mouseleave(_event, view) {
          if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
          requestSeq++;
          clearHighlight(view);
        },
      }),
    ];
  }, [projectPath, languageId, uri]);
}
