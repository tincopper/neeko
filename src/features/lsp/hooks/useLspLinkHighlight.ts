import { useMemo } from 'react';

import type { Extension } from '@codemirror/state';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';

import { lspGoToDefinition } from '../api/lspApi';
import { resolveLspPositionFromOffset } from '../position';
import { createDebouncedLatestRunner } from '../requestTracker';
import { definitionCacheKey, getOrFetchDefinition } from './lspCache';
import { IS_MACOS } from '@/shared/utils/platform';

/** Debounce for Cmd/Ctrl+hover definition probes (reduces gopls flood). */
const LINK_HIGHLIGHT_DEBOUNCE_MS = 150;

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

type LinkProbeArg = {
  clientX: number;
  clientY: number;
  view: EditorView;
};

type LinkProbeHit = {
  view: EditorView;
  from: number;
  to: number;
};

/**
 * CodeMirror extension that shows a clickable underline when
 * Cmd/Ctrl is held and the cursor hovers over a navigable symbol.
 *
 * Flood control:
 * - 150ms debounce on mousemove
 * - latest-wins: only the newest probe may update decorations
 * - backend cancels prior textDocument/definition via $/cancelRequest
 */
export function useLspLinkHighlightExtension(
  projectPath: string | null,
  languageId: string | null,
  uri: string,
): Extension {
  return useMemo(() => {
    if (!projectPath || !languageId || !uri) return [];

    const runner = createDebouncedLatestRunner<LinkProbeArg>({
      debounceMs: LINK_HIGHLIGHT_DEBOUNCE_MS,
    });

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
          const modKey = IS_MACOS ? event.metaKey : event.ctrlKey;
          if (!modKey) {
            runner.cancel();
            clearHighlight(view);
            return;
          }

          void runner
            .schedule(
              { clientX: event.clientX, clientY: event.clientY, view },
              async ({ clientX, clientY, view: v }): Promise<LinkProbeHit | false> => {
                const pos = v.posAtCoords({ x: clientX, y: clientY });
                const lspPos = resolveLspPositionFromOffset(pos, (p) =>
                  v.state.doc.lineAt(p),
                );
                if (pos === null || !lspPos) return false;

                const word = v.state.wordAt(pos);
                if (!word) return false;

                const key = definitionCacheKey(
                  projectPath,
                  uri,
                  lspPos.line,
                  lspPos.character,
                );
                const wrapped = await getOrFetchDefinition(key, () =>
                  lspGoToDefinition(
                    projectPath!,
                    languageId!,
                    uri,
                    lspPos.line,
                    lspPos.character,
                  ),
                );

                if (!wrapped?.lspResult) return false;

                const currentWord = v.state.wordAt(pos);
                return {
                  view: v,
                  from: currentWord?.from ?? word.from,
                  to: currentWord?.to ?? word.to,
                };
              },
            )
            .then((result) => {
              // null = superseded/cancelled — leave existing decorations alone
              if (result === null) return;
              if (result === false) {
                clearHighlight(view);
                return;
              }
              applyHighlight(result.view, result.from, result.to);
            })
            .catch(() => {
              // ignore — a newer schedule may already be in flight
            });
        },
        mouseleave(_event, view) {
          runner.cancel();
          clearHighlight(view);
        },
      }),
    ];
  }, [projectPath, languageId, uri]);
}
