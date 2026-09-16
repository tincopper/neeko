import type { EditorView } from '@codemirror/view';
import { useCallback, useEffect, useRef } from 'react';

import { EMPTY_BP_LINES, useDebugStore } from '@/features/runner/store/debugStore';

import { useBreakpointGutter } from './useBreakpointGutter';
import { useCurrentLineHighlight } from './useCurrentLineHighlight';

interface UseEditorBreakpointsParams {
  projectId: string;
  absFilePath: string;
  filePath: string;
  editorViewRef: React.MutableRefObject<EditorView | null>;
  editorViewEpoch: number;
}

/**
 * DAP 断点与当前行高亮：gutter 扩展、行号点击/悬停、store → CodeMirror 同步。
 */
export function useEditorBreakpoints({
  projectId,
  absFilePath,
  filePath,
  editorViewRef,
  editorViewEpoch,
}: UseEditorBreakpointsParams) {
  const loadBreakpoints = useDebugStore((s) => s.loadBreakpoints);
  // Select the stored array reference directly — never allocate a new [] here
  // (that would trip zustand's Object.is check and infinite-loop renders).
  const bpLines = useDebugStore((s) => s.breakpoints[projectId]?.[absFilePath] ?? EMPTY_BP_LINES);
  const {
    syncEffect: bpSyncEffect,
    onLineNumberClick,
    onLineNumberHover,
    onLineNumberLeave,
  } = useBreakpointGutter(projectId, absFilePath);
  // Current-line highlight field lives inside breakpointContributionExtensions
  // (assembled by the unified gutter); this only re-applies on stop.
  // 黄线只负责标记：光标跟随 / 接管 / 释放归 `useDebugStopReveal`。
  useCurrentLineHighlight(absFilePath, filePath, editorViewRef, editorViewEpoch);

  // Stable callbacks for lineNumbers handlers
  const handleLnClick = useCallback(
    (view: EditorView, lineFrom: number) => onLineNumberClick(view, lineFrom),
    [onLineNumberClick],
  );
  const handleLnHover = useCallback(
    (view: EditorView, lineFrom: number) => onLineNumberHover(view, lineFrom),
    [onLineNumberHover],
  );
  const handleLnLeave = useCallback(
    (view: EditorView) => onLineNumberLeave(view),
    [onLineNumberLeave],
  );
  const lastSyncedBpKeyRef = useRef<string>('');

  useEffect(() => {
    void loadBreakpoints(projectId);
  }, [projectId, loadBreakpoints]);

  // Sync store → CodeMirror breakpoint field (also after editor is created)
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    const key = `${absFilePath}:${bpLines.join(',')}`;
    if (key === lastSyncedBpKeyRef.current) return;
    lastSyncedBpKeyRef.current = key;
    view.dispatch({ effects: bpSyncEffect(bpLines) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref read inside effect only
  }, [bpLines, bpSyncEffect, absFilePath]);

  return {
    bpSyncEffect,
    lastSyncedBpKeyRef,
    handleLnClick,
    handleLnHover,
    handleLnLeave,
  };
}
