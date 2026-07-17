import { LSPPlugin } from '@codemirror/lsp-client';
import type { Extension, Text } from '@codemirror/state';
import type { EditorView, Tooltip, TooltipView } from '@codemirror/view';
import { hoverTooltip } from '@codemirror/view';

import { useBrowserStore } from '@/features/browser/store';
import { useDockStore } from '@/shared/store/dockStore';

import { LatestRequestTracker } from '../requestTracker';

/**
 * Convert an LSP `{line, character}` position to a CodeMirror document
 * offset. Equivalent to `fromPosition` in @codemirror/lsp-client/src/pos.ts
 * (which is not publicly exported).
 */
function offsetFromPos(doc: Text, pos: { line: number; character: number }): number {
  const line = doc.line(pos.line + 1);
  return line.from + pos.character;
}

/** Module-level tracker: only the newest hover response updates the tooltip. */
const hoverTracker = new LatestRequestTracker();

/**
 * Custom hover tooltip extension that replaces @codemirror/lsp-client's
 * `hoverTooltips()` to fix three issues:
 *
 * 1. Tooltip clipping at top window edge — the upstream hardcodes
 *    `above: true` which forces the tooltip upward even when the target
 *    is near the top of the editor. We omit `above` entirely so
 *    CodeMirror auto-decides the placement.
 *
 * 2. Horizontal scrollbar inconsistency — handled in CSS
 *    (src/styles/index.css).
 *
 * 3. Links in hover tooltips open in the app's built-in browser panel
 *    instead of as bare `<a>` tags. We attach a delegated click handler
 *    that intercepts `<a>` clicks and navigates the browser panel.
 *
 * 4. Flood control: only the latest hover generation may produce a tooltip
 *    (stale in-flight responses are dropped). Backend also cancels prior
 *    textDocument/hover via $/cancelRequest.
 */
export function createLspHoverTooltips(config: { hoverTime?: number } = {}): Extension {
  return hoverTooltip(lspTooltipSource, {
    hideOn: (tr) => tr.docChanged,
    // Slightly higher than CodeMirror default to cut mousemove noise
    hoverTime: config.hoverTime ?? 300,
  });
}

function hoverRequest(plugin: LSPPlugin, pos: number) {
  // Check server capabilities: if hoverProvider is explicitly false, skip
  // (null means server capabilities haven't been received yet — proceed anyway)
  if (plugin.client.serverCapabilities?.hoverProvider === false) return Promise.resolve(null);
  plugin.client.sync();
  // Use `any` for the generic types to avoid importing vscode-languageserver-protocol
  // directly (pnpm strict hoisting prevents the type-only import from resolving).
  return plugin.client.request<any, any>('textDocument/hover', {
    position: plugin.toPosition(pos),
    textDocument: { uri: plugin.uri },
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function lspTooltipSource(view: EditorView, pos: number, _side: -1 | 1): Promise<Tooltip | null> {
  const plugin = LSPPlugin.get(view);
  if (!plugin) return Promise.resolve(null);

  const token = hoverTracker.next();

  return hoverTracker.runIfCurrent(token, () => hoverRequest(plugin, pos)).then((result: any) => {
    // Stale or empty — do not show a tooltip
    if (!result || !hoverTracker.isCurrent(token)) return null;

    const tooltip: Tooltip = {
      pos: result.range ? offsetFromPos(view.state.doc, result.range.start) : pos,
      end: result.range ? offsetFromPos(view.state.doc, result.range.end) : pos,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      create(_editorView: EditorView): TooltipView {
        const el = document.createElement('div');
        el.className = 'cm-lsp-hover-tooltip cm-lsp-documentation';
        el.innerHTML = plugin.docToHTML(result.contents);

        // Delegated click handler: intercept <a> clicks and
        // navigate the app's built-in browser panel instead of
        // following the link normally.
        el.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          const anchor = target.closest('a');
          if (!anchor?.href) return;
          e.preventDefault();
          e.stopPropagation();
          useBrowserStore.getState().navigateTo(anchor.href);
          useDockStore.getState().activatePanel('right', 'browser');
        });

        return { dom: el };
      },
      // Deliberately omit `above` — let CodeMirror auto-decide
      // the direction based on available viewport space.
      strictSide: false,
    };
    return tooltip;
  });
}
