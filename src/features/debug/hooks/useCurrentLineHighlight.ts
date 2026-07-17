import { useEffect, type RefObject } from 'react';
import type { EditorView } from '@codemirror/view';

import { useDebugStore } from '../store/debugStore';
import { applyDebugCurrentLine } from './useBreakpointGutter';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** Loose path equality for DAP abs paths vs editor relative/abs paths. */
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
 * Extensions themselves come from `useBreakpointGutterExtensions` (includes the field).
 */
export function useCurrentLineHighlight(
  absFilePath: string | null,
  tabFilePath: string | null,
  editorViewRef: RefObject<EditorView | null>,
  viewEpoch = 0,
): void {
  const stoppedAt = useDebugStore((s) => s.stoppedAt);
  const sessionStatus = useDebugStore((s) => s.session?.status ?? null);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    const line = resolveDebugHighlightLine(
      absFilePath,
      tabFilePath,
      stoppedAt,
      sessionStatus,
    );
    applyDebugCurrentLine(view, line);
  }, [
    stoppedAt,
    sessionStatus,
    absFilePath,
    tabFilePath,
    editorViewRef,
    viewEpoch,
  ]);
}
