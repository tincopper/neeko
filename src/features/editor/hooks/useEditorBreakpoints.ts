import type { EditorView } from '@codemirror/view';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  EMPTY_BP_ENTRIES,
  breakpointSyncKey,
  toVisualEntries,
  useDebugStore,
} from '@/features/runner/store/debugStore';

import { useBreakpointGutter } from './useBreakpointGutter';
import { useCurrentLineHighlight } from './useCurrentLineHighlight';

interface UseEditorBreakpointsParams {
  projectId: string;
  absFilePath: string;
  editorViewRef: React.MutableRefObject<EditorView | null>;
  editorViewEpoch: number;
}

/**
 * DAP 断点与当前行高亮：gutter 扩展、行号点击/悬停、store → CodeMirror 同步。
 *
 * 断点列 field 存**视觉态** entries：mute 折叠为 disabled（`isBreakpointEffective`，
 * 评审 P16 单一来源），gutter 贡献据此画灰空心。mute 切换时本组件 effect 重跑、
 * 重新下发 field。
 */
export function useEditorBreakpoints({
  projectId,
  absFilePath,
  editorViewRef,
  editorViewEpoch,
}: UseEditorBreakpointsParams) {
  const loadBreakpoints = useDebugStore((s) => s.loadBreakpoints);
  // Select the stored array reference directly — never allocate a new [] here
  // (that would trip zustand's Object.is check and infinite-loop renders).
  const bpEntries = useDebugStore(
    (s) => s.breakpoints[projectId]?.[absFilePath] ?? EMPTY_BP_ENTRIES,
  );
  const muted = useDebugStore((s) => (projectId ? !!s.breakpointsMuted[projectId] : false));
  const {
    syncEffect: bpSyncEffect,
    onLineNumberClick,
    onLineNumberHover,
    onLineNumberLeave,
  } = useBreakpointGutter(projectId, absFilePath);
  // Current-line highlight field lives inside breakpointContributionExtensions
  // (assembled by the unified gutter); this only re-applies on stop.
  // 黄线只负责标记：光标跟随 / 接管 / 释放归 `useDebugStopReveal`。
  useCurrentLineHighlight(absFilePath, editorViewRef, editorViewEpoch);

  // 视觉态 entries：mute 下全行 disabled（置灰空心），单个 enabled 位不动。
  // 推导与同步键统一走 shared（架构审查：原两份内联实现会漂移）。
  const visualEntries = useMemo(() => toVisualEntries(bpEntries, muted), [bpEntries, muted]);

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
    const key = breakpointSyncKey(absFilePath, visualEntries);
    if (key === lastSyncedBpKeyRef.current) return;
    lastSyncedBpKeyRef.current = key;
    view.dispatch({ effects: bpSyncEffect(visualEntries) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref read inside effect only
  }, [visualEntries, bpSyncEffect, absFilePath]);

  return {
    bpSyncEffect,
    lastSyncedBpKeyRef,
    handleLnClick,
    handleLnHover,
    handleLnLeave,
  };
}
