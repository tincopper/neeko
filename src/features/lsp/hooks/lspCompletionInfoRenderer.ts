import { autocompletion, snippet } from '@codemirror/autocomplete';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { serverCompletionSource } from '@codemirror/lsp-client';
import type { Extension } from '@codemirror/state';
import { EditorView, tooltips, type Rect } from '@codemirror/view';

import {
  buildFunctionSnippet,
  buildInfoPanel,
  buildListItem,
  buildModuleNodeFromCompletion,
} from './completionRenderer';
import { completionTheme } from './completionTheme';

/**
 * Calculate width / height from a `Rect` ({left, right, top, bottom}).
 * CM6's `Rect` deliberately omits derived dimensions.
 */
function rectSize(r: Rect): { width: number; height: number } {
  return { width: r.right - r.left, height: r.bottom - r.top };
}

/**
 * Flip the info tooltip to the side with more room when the default placement
 * would overflow the viewport horizontally. CM6's built-in `positionInfo` keeps
 * the tooltip on the right of the completion list, which overflows on narrow
 * panes or when the caret sits near the right edge.
 *
 * Coordinate system — this is the tricky part. CM6 renders the info panel as a
 * CHILD of the completion-list tooltip DOM (`addInfoPane` does
 * `this.dom.appendChild(wrap)`), and `placeInfo` copies the returned `style`
 * straight onto it. The list tooltip is `position: fixed`, so the info panel's
 * absolute coordinates must be RELATIVE TO THE LIST DOM, not the viewport.
 * Returning viewport coordinates shifts the panel by `(list.left, list.top)`
 * and makes it overlap/clip against the list ("info panel covers the
 * dropdown"). We therefore subtract `list.top`/`list.left` from every value.
 *
 * Vertically the panel tracks the currently selected option (`option.top`,
 * IDEA-style) instead of pinning to the top of the list. It is clamped on
 * both edges so the panel never detaches from the list visually:
 *   - top    >= list.top    (never floats above the list)
 *   - bottom <= list.bottom (never hangs below the list)
 * and additionally clamped to the viewport so it never overflows the screen.
 *
 * When neither side has room for the full panel width, the panel sits on the
 * side with more space and narrows to what fits there (min 120px) instead of
 * overflowing the viewport edge — it never overlaps the list, so the dropdown
 * always stays readable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function flipPositionInfo(
  _view: EditorView,
  list: Rect,
  option: Rect,
  infoRect: Rect,
  space: Rect,
) {
  const info = rectSize(infoRect);
  const listWidth = list.right - list.left;
  const gap = 4;

  const rightAvail = space.right - (list.right + gap);
  const leftAvail = list.left - gap - space.left;
  const fitsRight = rightAvail >= info.width;
  const fitsLeft = leftAvail >= info.width;

  // Prefer the right unless it overflows and the left has room. When neither
  // side can fit the full width, pick the side with more room so the panel
  // can stay as wide (and as inside the viewport) as possible.
  const side: 'left' | 'right' =
    fitsRight || (!fitsLeft && rightAvail >= leftAvail) ? 'right' : 'left';

  // Follow the selected option vertically (IDEA-style), but keep the panel
  // visually anchored to the list — it must never drift above the list top
  // or below the list bottom. Then clamp to the viewport as a final safety.
  // All rects are viewport coordinates; convert to list-relative at the end.
  const optionTop = option?.top ?? list.top;
  const listMinTop = list.top;
  const listMaxTop = list.bottom - info.height;
  const viewportMinTop = space.top;
  const viewportMaxTop = space.bottom - info.height;

  // Clamp within the list range first, then within the viewport.
  // When the panel is taller than the list, pin to the list top (the
  // panel will extend past the list bottom but at least starts aligned).
  const clampedToList =
    listMaxTop >= listMinTop ? Math.max(listMinTop, Math.min(optionTop, listMaxTop)) : listMinTop;
  const top = Math.max(viewportMinTop, Math.min(clampedToList, viewportMaxTop));

  // Shrink the panel when the chosen side cannot fit its full width, so it
  // never spills past the viewport edge or slides over the completion list.
  // The 120px floor keeps the panel legible even when the side is tiny
  // (a sliver of the panel may then cross the edge — unavoidable, and far
  // better than hiding the documentation entirely).
  const available = side === 'right' ? rightAvail : leftAvail;
  const panelWidth = Math.min(info.width, Math.max(120, available));

  const style = [
    `top: ${Math.max(0, top - list.top)}px`,
    side === 'right' ? `left: ${listWidth + gap}px` : `right: ${listWidth + gap}px`,
    `max-width: ${panelWidth}px`,
    'max-height: 340px',
    'overflow-y: auto',
  ].join(';');

  return {
    style,
    class: `cm-tooltip cm-tooltip-${side} cm-lsp-completion-info-wrapper`,
  };
}

/** LSP CompletionItemKind values that benefit from parameter auto-fill. */
const FUNCTION_KINDS = new Set([2 /* Method */, 3 /* Function */, 4 /* Constructor */]);

/**
 * Upgrade a function-like completion whose insert text is a bare name into a
 * snippet that fills its parameters. Mirrors the `@codemirror/lsp-client`
 * `insertTextFormat === 2` path so every function completion gets IDEA-style
 * argument placeholders — even when the server omits a snippet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function maybeAttachSnippetFallback(item: any): void {
  // Server already provided a snippet (or we must not touch its intent).
  if (item.insertTextFormat === 2) return;
  // Only function-like kinds benefit from parameter auto-fill.
  if (!FUNCTION_KINDS.has(item.kind)) return;

  // The text the server would insert (same precedence as lsp-client).
  const text = item.textEdit?.newText ?? item.textEditText ?? item.insertText ?? item.label;
  const hasExplicitInsert =
    item.textEdit?.newText != null || item.textEditText != null || item.insertText != null;

  // Extract a function name from whatever text would be inserted.
  let funcName: string | null = null;
  if (text.includes('(')) {
    // Already a call signature — only override when the server gave NO
    // insertText (otherwise it would insert the raw label, which is worse
    // than a snippet). When overriding, take the leading name.
    if (hasExplicitInsert) return;
    const m = /^([A-Za-z_$][\w$]*)\(/.exec(text);
    if (m) funcName = m[1];
  } else {
    const m = /^([A-Za-z_$][\w$]*)$/.exec(text);
    if (m) funcName = m[1];
  }
  if (!funcName) return;

  const snippetText = buildFunctionSnippet(funcName, item.label);
  item.apply = (view: EditorView, completion: Completion, from: number, to: number) =>
    snippet(snippetText)(view, completion, from, to);
}

/**
 * Wrap `@codemirror/lsp-client`'s `serverCompletionSource` so the selected
 * item's `info` panel shares the hover tooltip's `cm-lsp-hover-tooltip` class,
 * producing a pixel-identical look between code-completion detail and
 * mouse-hover documentation. Function completions without server snippets are
 * upgraded to parameter snippets (IDEA-style auto-fill).
 *
 * The wrapped source returns the same `CompletionResult` shape as the original.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createThemedCompletionSource(context: CompletionContext): Promise<any> {
  // Delegate to the canonical source — keep completion behavior identical.
  return Promise.resolve(serverCompletionSource(context)).then(
    (result: CompletionResult | null) => {
      if (!result) return null;

      // `CompletionResult` exposes the items on `.options`. The
      // `serverCompletionSource` captures documentation inside each option's
      // `info` closure — we lift the rendered HTML out of it below.
      const options = (result as unknown as { options?: unknown[] }).options ?? [];

      for (const option of options) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const item = option as any;

        maybeAttachSnippetFallback(item);

        // Apply the premium list-item look: icon type + cleaned detail.
        const listItem = buildListItem(item, item);
        if (listItem.type) item.type = listItem.type;
        if (listItem.detail) item.detail = listItem.detail;

        // Always attach a themed info panel - even without documentation,
        // the signature highlighting and structured returns add value.
        //
        // Note: `serverCompletionSource` does NOT copy `documentation` onto the
        // option object - it captures it inside the original `info` closure
        // (`() => renderDocInfo(plugin, item.documentation)`). So we resolve
        // docs by invoking the original renderer and reusing its HTML instead
        // of reading `item.documentation` (which is always undefined here).
        const originalInfo = typeof item.info === 'function' ? item.info : null;

        item.info = async function themedInfo() {
          let docHtml = '';
          if (originalInfo) {
            const rendered = await originalInfo();
            if (rendered instanceof HTMLElement) {
              docHtml = rendered.innerHTML;
            }
          }
          return buildInfoPanel(item, item, docHtml);
        };
      }

      return result;
    },
  );
}

/**
 * Drop-in replacement for `@codemirror/lsp-client`'s `serverCompletion()`.
 *
 * Returns an `Extension` that:
 *  1. Wraps the server completion source so info panels render with the
 *     hover tooltip class, matching mouse-hover docs.
 *  2. Upgrades bare-name function completions to parameter snippets so
 *     accepting them auto-fills arguments (IDEA-style).
 *  3. Overrides `positionInfo` so the detail panel follows the selected option
 *     and flips to the left when the editor's right edge would clip it.
 *
 * Pass `{ override: true }` to replace all completion sources (same semantics
 * as `serverCompletion`).
 */
export function createThemedServerCompletion(): Extension {
  // The `serverCompletionSource` already handles capability checks, document
  // syncing, and the LSP request lifecycle — we only re-skin the produced DOM
  // and upgrade function snippets. Note: `override` is unconditionally set so
  // our themed source is the only completion source — this is the same intent
  // as the upstream `serverCompletion({ override: true })` behavior.
  //
  // `completionTheme()` is an `EditorView.theme()` extension that injects
  // app-themed styles for the autocomplete dropdown, info panel, signature
  // help, and hover tooltips. Using `EditorView.theme()` (not global CSS)
  // is critical: CodeMirror ships a `baseTheme` with double-class selectors
  // (e.g. `.cm-tooltip.cm-tooltip-autocomplete`, specificity 0,2,0) that
  // would otherwise win over single-class rules in our stylesheet.
  //
  // `tooltips({ position: 'fixed' })` ensures the dropdown is positioned
  // relative to the viewport, not the editor container, so it can extend
  // past the editor's bottom edge without being clipped.
  return [
    completionTheme(),
    tooltips({ position: 'fixed' }),
    autocompletion({
      override: [createThemedCompletionSource],
      positionInfo: flipPositionInfo,
      closeOnBlur: true,
      // Premium list-item class (spacing + two-line layout via CSS).
      optionClass: () => 'cm-completion-item-enhanced',
      // Inject the module-path node (second line of each item).
      addToOptions: [
        {
          render: (completion) => buildModuleNodeFromCompletion(completion),
          position: 30,
        },
      ],
    }),
  ] as Extension;
}
