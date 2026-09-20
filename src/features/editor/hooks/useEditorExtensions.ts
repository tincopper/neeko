import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { history, historyKeymap, indentWithTab, defaultKeymap } from '@codemirror/commands';
import { foldGutter, indentOnInput, bracketMatching } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import {
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  keymap,
  tooltips,
} from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { useMemo } from 'react';

import { navigateCaretExtension } from '@/features/editor/navigateCaret';
import { neekoSearchExtension } from '@/features/editor/searchPanel';
import { lspDiagnosticsProjection } from '@/features/lsp';
import { createCmTheme } from '@/shared/utils/codemirror';
import { imeSpaceGuard } from '@/shared/utils/codemirrorIme';
import { mouseClickGuard } from '@/shared/utils/codemirrorMouseClickGuard';

interface UseEditorExtensionsParams {
  fontFamily: string;
  fontSize: number;
  langExtension: Extension | null | undefined;
  saveKeymap: Extension;
  viewStateExt: Extension;
  lspClientExt: Extension[];
  lspKeymap: Extension;
  quickFixExt: Extension;
  cmdClickExt: Extension;
  linkHighlightExt: Extension;
  bpGutterExt: Extension[];
  handleLnClick: (view: EditorView, lineFrom: number) => boolean;
  handleLnHover: (view: EditorView, lineFrom: number) => boolean;
  handleLnLeave: (view: EditorView) => boolean;
}

/**
 * 组装 CodeMirror extensions：tooltips 挂载、断点 gutter、基础能力、
 * 语言/LSP 扩展。返回含主题的 [extensions, cmTheme] 对。
 *
 * **不变量（配置纯净）**：本 memo 产出的数组是 `@uiw/react-codemirror` 的
 * `extensions` prop——它一变，宿主就 dispatch `StateEffect.reconfigure` 重建整个
 * 扩展世界（lint 等经 appendConfig 惰性安装的扩展会被丢掉）。因此依赖项**只能**
 * 是配置输入（字体、语言扩展、稳定 keymap/扩展引用），**禁止**把活文档内容、
 * `isDirty` 或每次渲染新建的 tab 对象接进来。回归护栏见
 * `__tests__/lspDiagnosticsProjection.test.ts` 与 useEditorSave/useLspNavigation 的稳定性用例。
 */
export function useEditorExtensions({
  fontFamily,
  fontSize,
  langExtension,
  saveKeymap,
  viewStateExt,
  lspClientExt,
  lspKeymap,
  quickFixExt,
  cmdClickExt,
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

    // Order: unified gutter (breakpoint + run single column) → line numbers → rest.
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
      mouseClickGuard(),
      imeSpaceGuard(),
    );

    if (langExtension) exts.push(langExtension);

    // LSP 诊断投影：让 `setDiagnostics` 推送的波浪线在编辑器配置重建（reconfigure
    // 丢弃 lint 经 appendConfig 惰性安装的渲染扩展）后自愈。刻意**不**放进
    // `lspClientExt`——它随 client 挂载/释放起落，会把投影字段一起摘掉；
    // 这里按「编辑器级稳定扩展」装配，生命周期 = EditorView。
    exts.push(lspDiagnosticsProjection());

    // LSP: @codemirror/lsp-client plugin (hover, diagnostics, completion, document sync)
    // + custom keybinding (F12/Shift+F12) + Cmd+Click jump + link highlight
    // (Cmd/Ctrl+hover underline)
    exts.push(...lspClientExt);
    exts.push(lspKeymap);
    exts.push(quickFixExt);
    exts.push(cmdClickExt);
    exts.push(linkHighlightExt);

    return exts;
  }, [
    langExtension,
    cmTheme,
    saveKeymap,
    viewStateExt,
    lspClientExt,
    lspKeymap,
    quickFixExt,
    cmdClickExt,
    linkHighlightExt,
    bpGutterExt,
    handleLnClick,
    handleLnHover,
    handleLnLeave,
  ]);

  return { extensions, cmTheme };
}
