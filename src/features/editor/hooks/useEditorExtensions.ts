import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { history, historyKeymap, indentWithTab, defaultKeymap } from '@codemirror/commands';
import { foldGutter, indentOnInput, bracketMatching } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  keymap,
  tooltips,
} from '@codemirror/view';
import { useMemo } from 'react';

import { navigateCaretExtension } from '@/features/editor/navigateCaret';
import { neekoSearchExtension } from '@/features/editor/searchPanel';
import { createCmTheme } from '@/shared/utils/codemirror';
import { imeSpaceGuard } from '@/shared/utils/codemirrorIme';

interface UseEditorExtensionsParams {
  fontFamily: string;
  fontSize: number;
  langExtension: Extension | null | undefined;
  saveKeymap: Extension;
  viewStateExt: Extension;
  lspClientExt: Extension[];
  lspKeymap: Extension;
  linkHighlightExt: Extension;
  bpGutterExt: Extension[];
  handleLnClick: (view: EditorView, lineFrom: number) => boolean;
  handleLnHover: (view: EditorView, lineFrom: number) => boolean;
  handleLnLeave: (view: EditorView) => boolean;
}

/**
 * 组装 CodeMirror extensions：tooltips 挂载、断点 gutter、基础能力、
 * 语言/LSP 扩展。返回含主题的 [extensions, cmTheme] 对。
 */
export function useEditorExtensions({
  fontFamily,
  fontSize,
  langExtension,
  saveKeymap,
  viewStateExt,
  lspClientExt,
  lspKeymap,
  linkHighlightExt,
  bpGutterExt,
  handleLnClick,
  handleLnHover,
  handleLnLeave,
}: UseEditorExtensionsParams) {
  // Create theme object (new reference triggers CodeMirror reconfigure)
  const cmTheme = useMemo(() => createCmTheme(fontFamily, fontSize), [fontFamily, fontSize]);

  // Build CodeMirror extensions
  const extensions = useMemo<Extension[]>(() => {
    const exts: Extension[] = [];

    // Tooltips (completion info panel, hover docs, signature help) are
    // rendered as CHILDREN of the CodeMirror DOM by default, which sits
    // inside `overflow-hidden` containers (FileViewer + ResizablePanel).
    // When CM6 positions tooltips as `absolute` (iOS devices, or after its
    // fixed→absolute fallback detection), `overflow: hidden` clips them at
    // the editor edge — the completion popup gets cropped and looks
    // "covered" by the left/right dock islands. Mounting the tooltip layer
    // on `document.body` puts it outside that clipping chain; `fixed`
    // positioning keeps it viewport-anchored with a top-level z-index.
    // Must be registered FIRST so it wins the `tooltipConfig` facet
    // (facet combine picks the first config with `parent`).
    exts.push(tooltips({ position: 'fixed', parent: document.body }));

    // Order: breakpoint gutter (optional) → line numbers (always) → rest.
    // lineNumbers is ALWAYS registered here so debug sessions never remove it.
    if (bpGutterExt.length > 0) {
      exts.push(...bpGutterExt);
    }
    exts.push(
      lineNumbers({
        formatNumber: (n) => String(n),
        domEventHandlers: {
          mousedown(view, line) {
            return handleLnClick(view, line.from);
          },
          mouseover(view, line) {
            return handleLnHover(view, line.from);
          },
          mouseout(view) {
            return handleLnLeave(view);
          },
        },
      }),
    );

    exts.push(
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      navigateCaretExtension,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      saveKeymap,
      // 页内内容搜索：查找面板 + Ctrl+F / Ctrl+G / Esc + 高亮所有选中匹配
      neekoSearchExtension(),
      highlightSelectionMatches(),
      keymap.of(searchKeymap),
      cmTheme,
      viewStateExt,
      imeSpaceGuard(),
    );

    if (langExtension) exts.push(langExtension);

    // LSP: @codemirror/lsp-client plugin (hover, diagnostics, completion, document sync)
    // + custom keybinding (F12/Shift+F12) + link highlight (Cmd/Ctrl+hover underline)
    exts.push(...lspClientExt);
    exts.push(lspKeymap);
    exts.push(linkHighlightExt);

    return exts;
  }, [
    langExtension,
    cmTheme,
    saveKeymap,
    viewStateExt,
    lspClientExt,
    lspKeymap,
    linkHighlightExt,
    bpGutterExt,
    handleLnClick,
    handleLnHover,
    handleLnLeave,
  ]);

  return { extensions, cmTheme };
}
