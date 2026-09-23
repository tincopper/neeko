/**
 * References Peek 右预览：只读 CodeMirror（语言高亮复用共享语言扩展）。
 *
 * 无自建语言逻辑：高亮来自 `getLanguageExtension(filePath)`（编辑器同源，
 * 缓存 + 在途去重内建）；语言包缺失/加载失败 → 纯文本渲染，不抛错。
 * 文档静态（选中切换即重建视图），无协同编辑，无装饰映射问题。
 */
import { EditorState } from '@codemirror/state';
import { Decoration, EditorView, lineNumbers } from '@codemirror/view';
import React, { useEffect, useRef } from 'react';

import {
  getCachedLanguageExtension,
  getLanguageExtension,
  neekoSyntaxHighlighting,
} from '@/shared/utils/codemirror';

const previewTheme = EditorView.theme({
  // 定高链：宿主（flex-1 min-h-0）给确定高度，editor 100% 继承后内层 scroller
  // 才会溢出滚动；否则 editor 随内容撑开、内外两层都没滚动（主编辑器同模式）。
  '&': { backgroundColor: 'transparent', height: '100%' },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    fontSize: '12.5px',
    lineHeight: '20px',
    padding: '8px 0 16px',
  },
  '.cm-lineNumbers': { color: 'var(--text-muted)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px' },
  '.peek-cm-line': { backgroundColor: 'rgba(60, 130, 255, 0.15)' },
  '.peek-cm-match': { backgroundColor: 'rgba(234, 179, 8, 0.32)', borderRadius: '2px' },
});

interface ReferencesPeekPreviewProps {
  filePath: string;
  lines: string[];
  baseLine0: number;
  matchLineIdx: number;
  matchStartChar: number;
  matchEndChar: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function ReferencesPeekPreviewView({
  filePath,
  lines,
  baseLine0,
  matchLineIdx,
  matchStartChar,
  matchEndChar,
}: ReferencesPeekPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent || lines.length === 0) return;
    let cancelled = false;
    let view: EditorView | null = null;

    void (async () => {
      const lang =
        getCachedLanguageExtension(filePath) ??
        (await getLanguageExtension(filePath).catch(() => null));
      if (cancelled || hostRef.current !== parent) return;

      const doc = lines.join('\n');
      const mIdx = clamp(matchLineIdx, 0, lines.length - 1);
      let lineOff = 0;
      for (let i = 0; i < mIdx; i++) lineOff += lines[i].length + 1;
      const lineLen = lines[mIdx].length;
      const cs = clamp(matchStartChar, 0, lineLen);
      const ce = clamp(Math.max(matchEndChar, cs), 0, lineLen);

      const ranges = [Decoration.line({ class: 'peek-cm-line' }).range(lineOff)];
      if (ce > cs) {
        ranges.push(
          Decoration.mark({
            class: 'peek-cm-match',
            attributes: { 'data-testid': 'peek-match' },
          }).range(lineOff + cs, lineOff + ce),
        );
      }

      const state = EditorState.create({
        doc,
        extensions: [
          ...(lang ? [lang] : []),
          neekoSyntaxHighlighting(),
          lineNumbers({ formatNumber: (n) => String(baseLine0 + n) }),
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          previewTheme,
          EditorView.decorations.of(Decoration.set(ranges)),
        ],
      });
      if (cancelled) return;
      view = new EditorView({ state, parent });
      // 打开/切换即把命中行滚到可视区中央（预览窗格可继续上下滚动浏览全文）。
      view.dispatch({
        selection: { anchor: lineOff },
        effects: EditorView.scrollIntoView(lineOff, { y: 'center' }),
      });
    })();

    return () => {
      cancelled = true;
      view?.destroy();
      view = null;
    };
  }, [filePath, lines, baseLine0, matchLineIdx, matchStartChar, matchEndChar]);

  if (lines.length === 0) {
    return (
      <div className="flex-1 min-w-0 px-4 py-6 text-center text-[13px] text-text-muted">
        Preview unavailable
      </div>
    );
  }
  return (
    <div
      ref={hostRef}
      data-testid="peek-preview"
      // 定界不定滚：滚动由 CM 自带 scroller 负责，外层再挂 overflow 会叠出第二条滚动条。
      className="flex-1 min-h-0 min-w-0 overflow-hidden"
    />
  );
}

export const ReferencesPeekPreview = React.memo(ReferencesPeekPreviewView);
