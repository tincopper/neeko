import { autocompletion } from '@codemirror/autocomplete';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { LSPPlugin, serverCompletionSource } from '@codemirror/lsp-client';
import type { Extension } from '@codemirror/state';
import type { EditorView, Rect } from '@codemirror/view';

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
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function flipPositionInfo(
  _view: EditorView,
  list: Rect,
  _option: Rect,
  infoRect: Rect,
  space: Rect,
) {
  const info = rectSize(infoRect);
  const fitsRight = list.right + info.width <= space.right;
  const fitsLeft = list.left - info.width >= space.left;

  // Prefer the right unless it overflows and the left has room.
  const side: 'left' | 'right' = fitsRight || !fitsLeft ? 'right' : 'left';

  const style = [
    'position: absolute',
    `top: ${Math.max(space.top, list.top)}px`,
    side === 'right' ? `left: ${list.right + 4}px` : `right: ${4}px`,
    'max-height: 340px',
    'overflow-y: auto',
  ].join(';');

  return {
    style,
    class: `cm-tooltip cm-tooltip-${side} cm-lsp-completion-info-wrapper`,
  };
}

/**
 * Wrap `@codemirror/lsp-client`'s `serverCompletionSource` so the selected
 * item's `info` panel shares the hover tooltip's `cm-lsp-hover-tooltip` class,
 * producing a pixel-identical look between code-completion detail and
 * mouse-hover documentation.
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
      // `serverCompletionSource` attaches `documentation` to each option.
      const options = (result as unknown as { options?: unknown[] }).options ?? [];
      const view: EditorView = context.view!;

      for (const option of options) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const item = option as any;
        if (typeof item.info !== 'function') continue;
        const originalInfo = item.info;

        item.info = function themedInfo() {
          const plugin = LSPPlugin.get(view);
          const doc = item.documentation as string | { kind: string; value: string } | undefined;

          if (!plugin || !doc) {
            // Fall back to the library's default renderer if we can't theme.
            return originalInfo();
          }

          const dom = document.createElement('div');
          dom.className = 'cm-lsp-hover-tooltip cm-lsp-documentation cm-lsp-completion-info';
          // `docToHTML` accepts `string | MarkupContent`. Cast keeps callers
          // honest about the source-shaped input without widening the type.
          dom.innerHTML = plugin.docToHTML(doc as Parameters<typeof plugin.docToHTML>[0]);
          return dom;
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
 *  2. Overrides `positionInfo` so the detail panel flips to the left when the
 *     editor's right edge would clip it.
 *
 * Pass `{ override: true }` to replace all completion sources (same semantics
 * as `serverCompletion`).
 */
export function createThemedServerCompletion(): Extension {
  // The `serverCompletionSource` already handles capability checks, document
  // syncing, and the LSP request lifecycle — we only re-skin the produced DOM.
  // Note: `override` is unconditionally set so our themed source is the only
  // completion source — this is the same intent as the upstream
  // `serverCompletion({ override: true })` behavior.
  return autocompletion({
    override: [createThemedCompletionSource],
    positionInfo: flipPositionInfo,
    closeOnBlur: true,
  }) as Extension;
}
