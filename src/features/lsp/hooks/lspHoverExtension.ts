import { LSPPlugin } from '@codemirror/lsp-client';
import type { Extension, Text } from '@codemirror/state';
import type { Tooltip, TooltipView } from '@codemirror/view';
import { EditorView, closeHoverTooltips, hoverTooltip } from '@codemirror/view';

import { useBrowserStore } from '@/shared/store/browserStore';
import { useDockStore } from '@/shared/store/dockStore';
import { isJdtUri } from '@/shared/utils/jdt';

import { isModKeyHeld } from '../modKeyState';
import { LatestRequestTracker } from '../requestTracker';
import { normalizeHoverContents } from '../utils/hoverContent';

interface LspHoverRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface LspHoverResult {
  range?: LspHoverRange;
  contents: string | { kind: string; value: string };
}
/**
 * Convert an LSP `{line, character}` position to a CodeMirror document
 * offset. Equivalent to `fromPosition` in @codemirror/lsp-client/src/pos.ts
 * (which is not publicly exported).
 */
function offsetFromPos(doc: Text, pos: { line: number; character: number }): number {
  const line = doc.line(pos.line + 1);
  return line.from + pos.character;
}

/** Per-view trackers: each editor instance has its own hover generation counter. */
const hoverTrackers = new WeakMap<EditorView, LatestRequestTracker>();

function getHoverTracker(view: EditorView): LatestRequestTracker {
  let tracker = hoverTrackers.get(view);
  if (!tracker) {
    tracker = new LatestRequestTracker();
    hoverTrackers.set(view, tracker);
  }
  return tracker;
}

/**
 * Custom hover tooltip extension that replaces @codemirror/lsp-client's
 * `hoverTooltips()` to fix these issues:
 *
 * 1. Tooltip clipping at top window edge — the upstream hardcodes
 *    `above: true` which forces the tooltip upward even when the target
 *    is near the top of the editor. We omit `above` entirely so
 *    CodeMirror auto-decides the placement.
 *
 * 2. Horizontal scrollbar inconsistency — handled in CSS
 *    (src/styles/index.css).
 *
 * 3. Links in hover tooltips: `jdt://` hrefs (javadoc `@link`) are routed
 *    to `onOpenJdtLink` (the definition pipeline renders the classfile
 *    read-only); every other link opens the app's built-in browser panel.
 *    Modelled after vscode-java's `fixJdtSchemeHoverLinks`.
 *
 * 4. Flood control: only the latest hover generation may produce a tooltip
 *    (stale in-flight responses are dropped). Backend also cancels prior
 *    textDocument/hover via $/cancelRequest.
 *
 * 5. Jump affordance: while the jump modifier (Cmd/Ctrl) is held, docs
 *    are suppressed entirely and any open tooltip closes on mousedown —
 *    otherwise the tooltip DOM intercepts Cmd+Click / double-click and
 *    the jump never reaches the editor.
 *
 * 6. Hover doc normalization — jdtls (and any server answering
 *    `MarkedString[]`) returns a contents array, which `docToHTML`
 *    renders as empty; `normalizeHoverContents` flattens every legal
 *    `Hover.contents` shape into a single MarkupContent first.
 */
export function createLspHoverTooltips(
  config: {
    hoverTime?: number;
    /**
     * `jdt://` 链接点击回调（VSCode `fixJdtSchemeHoverLinks` 的对应物）。
     * 仅在共享 client 首建时被工厂捕获——各宿主实例回调行为等价
     * （全部经 store 驱动，jdt 目标恒为跨文件分支，无 per-file 视图依赖）。
     */
    onOpenJdtLink?: (uri: string) => void;
  } = {},
): Extension[] {
  return [
    hoverTooltip((view, pos, side) => lspTooltipSource(view, pos, side, config), {
      hideOn: (tr) => tr.docChanged,
      // Slightly higher than CodeMirror default to cut mousemove noise
      hoverTime: config.hoverTime ?? 300,
    }),
    EditorView.domEventHandlers({
      mousedown(_event, view) {
        // 按下即收起 docs：tooltip 悬在点击位置上方会截获 Cmd+Click /
        // 双击的第二击。不吞事件（return false），编辑器默认行为照常。
        view.dispatch({ effects: closeHoverTooltips });
        return false;
      },
    }),
  ];
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
function lspTooltipSource(
  view: EditorView,
  pos: number,
  _side: -1 | 1,
  config: { onOpenJdtLink?: (uri: string) => void },
): Promise<Tooltip | null> {
  // Cmd/Ctrl 按住 = 用户正准备跳转：抑制 docs 弹出，避免遮挡点击目标
  //（链接高亮下划线已提供导航视觉提示）。VSCode 同款行为。
  if (isModKeyHeld()) return Promise.resolve(null);

  const plugin = LSPPlugin.get(view);
  if (!plugin) return Promise.resolve(null);

  const tracker = getHoverTracker(view);
  const token = tracker.next();

  return tracker
    .runIfCurrent(token, () => hoverRequest(plugin, pos))
    .then((result: unknown) => {
      // Stale or empty — do not show a tooltip
      if (!result || !tracker.isCurrent(token)) return null;

      const hover = result as LspHoverResult;
      // jdtls（及任意 MarkedString 形态服务器）的 contents 数组必须先归一，
      // 否则 docToHTML（只认 string / MarkupContent）渲染为空。
      const normalized = normalizeHoverContents(hover.contents);
      if (!normalized) return null;
      const tooltip: Tooltip = {
        pos: hover.range ? offsetFromPos(view.state.doc, hover.range.start) : pos,
        end: hover.range ? offsetFromPos(view.state.doc, hover.range.end) : pos,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        create(_editorView: EditorView): TooltipView {
          const el = document.createElement('div');
          el.className = 'cm-lsp-hover-tooltip cm-lsp-documentation';
          el.innerHTML = plugin.docToHTML(normalized);

          // Delegated click handler: intercept <a> clicks —
          // jdt:// → 宿主导航（definition 管线，classContents 只读展示）；
          // 其余 → 内置浏览器面板。
          el.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const anchor = target.closest('a');
            if (!anchor?.href) return;
            e.preventDefault();
            e.stopPropagation();
            if (isJdtUri(anchor.href) && config.onOpenJdtLink) {
              config.onOpenJdtLink(anchor.href);
              return;
            }
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
