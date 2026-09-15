import type { EditorView } from '@codemirror/view';
import { useEffect, useRef, type RefObject } from 'react';

import { useVisibleDebugSession } from '@/features/runner';
import { useDebugStore } from '@/features/runner/store/debugStore';

import { applyDebugCurrentLine } from './useBreakpointGutter';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Loose path equality for DAP abs paths vs editor relative/abs paths.
 *
 * 两侧都已是**规范源身份**（见 `sourceIdentityOf`：tab 身份、`stoppedAt.filePath`
 * 同一套归一），故这里只做路径形态容错，不再承担身份转换职责。
 */
export function debugPathsMatch(a: string, b: string): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.endsWith('/' + nb) || nb.endsWith('/' + na)) return true;
  const ba = na.split('/').pop() ?? '';
  const bb = nb.split('/').pop() ?? '';
  if (ba && ba === bb && (na.endsWith(nb) || nb.endsWith(na))) return true;
  return false;
}

export function resolveDebugHighlightLine(
  absFilePath: string | null,
  tabFilePath: string | null,
  stoppedAt: { filePath: string; line: number } | null,
  sessionStatus: string | null | undefined,
): number | null {
  // Highlight whenever we have a stopped location; status gate is soft
  // (backend may briefly report starting/running around the same moment).
  if (!stoppedAt || stoppedAt.line < 1) return null;
  if (sessionStatus && sessionStatus !== 'stopped' && sessionStatus !== 'starting') {
    return null;
  }
  if (absFilePath && debugPathsMatch(stoppedAt.filePath, absFilePath)) {
    return stoppedAt.line;
  }
  if (tabFilePath && debugPathsMatch(stoppedAt.filePath, tabFilePath)) {
    return stoppedAt.line;
  }
  return null;
}

// Re-export for FileViewer
export { applyDebugCurrentLine };

/**
 * Reactively apply / clear the debug current-line highlight.
 * The `currentLineDecoField` lives inside `breakpointContributionExtensions`
 * (assembled by the unified gutter); this hook only dispatches the highlight
 * effect on session stop / line change.
 *
 * 同时负责**释放调试放置的光标**：停点结束（跳走 / 继续运行 / 会话终止）时把它还回原位 ——
 * 与黄线同一原则：调试会话在编辑器上的临时副作用必须随停止一起撤销，否则
 * `cm-activeLine` 会一直亮在最后一个断点行。
 *
 * 释放能力由**调用方注入**（`releasePlacedCaret`，见 `editor` 域的 `releaseDebugCaret`）：
 * 光标语义属 editor 域，若本 hook 反向 import editor，会形成
 * `editor → debug → editor` 的依赖环（editor 侧已依赖 debug 的公开 hook）。
 * 注入还让本 hook 可脱离编辑器单测。
 *
 * @param releasePlacedCaret 释放"被放置的光标"：参数为视图与放置时的行号
 */
export function useCurrentLineHighlight(
  absFilePath: string | null,
  tabFilePath: string | null,
  editorViewRef: RefObject<EditorView | null>,
  viewEpoch: number,
  releasePlacedCaret: (view: EditorView, placedLine: number) => void,
): void {
  const session = useVisibleDebugSession();
  const stoppedAt = useDebugStore((s) => s.stoppedAt);
  // 黄线/停点只属于当前项目会话：跨项目残留会话的 stoppedAt 不得在别的项目编辑器上画线（#14）。
  const highlightedLine = resolveDebugHighlightLine(
    absFilePath,
    tabFilePath,
    session ? stoppedAt : null,
    session ? (session.status ?? null) : null,
  );
  /** 最近一次真正占用的行 —— 停点结束后用它判断"光标是否仍停在调试放的位置"。 */
  const lastHighlightedLine = useRef<number | null>(null);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    applyDebugCurrentLine(view, highlightedLine);
    if (highlightedLine === null) {
      if (lastHighlightedLine.current !== null) {
        // 停点结束（跳走 / 继续运行 / 会话终止）→ 释放调试放置的光标。
        releasePlacedCaret(view, lastHighlightedLine.current);
      }
      lastHighlightedLine.current = null;
    } else {
      lastHighlightedLine.current = highlightedLine;
    }
  }, [highlightedLine, editorViewRef, viewEpoch, releasePlacedCaret]);
}
