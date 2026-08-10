import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { applyDebugCurrentLine, resolveDebugHighlightLine } from '@/features/debug';
import { useDebugStore } from '@/features/debug/store/debugStore';
import { useEditorStore } from '@/shared/store/editorStore';
import type { FileTab } from '@/shared/types';
import {
  getViewSnapshot,
  setViewSnapshot,
  type SerializedSelection,
} from '@/shared/utils/editorViewState';

import { applyNavigateCaret } from '../navigateCaret';

interface UseEditorViewSnapshotParams {
  tabKey: string;
  tabId: string;
  tab: FileTab;
  absFilePath: string;
  bpSyncEffect: (lines: number[]) => import('@codemirror/state').StateEffect<unknown>;
  lastSyncedBpKeyRef: React.MutableRefObject<string>;
  setSelectionLines: (sel: { startLine: number; endLine: number } | null) => void;
  setToolbarPos: (pos: { top: number; left: number } | null) => void;
  editorViewRef: React.MutableRefObject<EditorView | null>;
  setEditorViewEpoch: (updater: (n: number) => number) => void;
}

/**
 * CodeMirror 视图生命周期：scrollTop/selection 快照保存与恢复、
 * pending LSP 导航目标应用、卸载兜底保存、status bar 光标同步。
 */
export function useEditorViewSnapshot({
  tabKey,
  tabId,
  tab,
  absFilePath,
  bpSyncEffect,
  lastSyncedBpKeyRef,
  setSelectionLines,
  setToolbarPos,
  editorViewRef,
  setEditorViewEpoch,
}: UseEditorViewSnapshotParams) {
  const editorRestoredRef = useRef(false);

  /** 文件 reload 后标记为未恢复，允许下一次 onCreateEditor 重放快照逻辑 */
  const resetEditorRestored = useCallback(() => {
    editorRestoredRef.current = false;
  }, []);

  // 把当前 EditorView 状态写回缓存
  const saveEditorSnapshot = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;
    try {
      const selJson = view.state.selection.toJSON() as SerializedSelection;
      setViewSnapshot(tabKey, tabId, 'editor', {
        scrollTop: view.scrollDOM.scrollTop,
        selection: selJson,
      });
    } catch {
      // toJSON 极少失败；失败时仅落 scrollTop
      setViewSnapshot(tabKey, tabId, 'editor', {
        scrollTop: view.scrollDOM.scrollTop,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref read inside callback only
  }, [tabKey, tabId]);

  // updateListener: selection / scroll / geometry 变化都更新一次缓存
  // Use a ref wrapper for the snapshot callback to avoid passing a ref-using
  // closure through useMemo, which trips the react-hooks/refs rule even though
  // the ref is only read inside the CodeMirror update listener (not during render).
  const snapshotRef = useRef(saveEditorSnapshot);
  useEffect(() => {
    snapshotRef.current = saveEditorSnapshot;
  }, [saveEditorSnapshot]);

  const viewStateExt = useMemo(() => {
    // The update listener callback below accesses snapshotRef.current(), but that
    // only runs inside the CodeMirror update listener — never during render.
    // eslint-disable-next-line react-hooks/refs
    return EditorView.updateListener.of((u) => {
      const view = u.view;

      if (u.selectionSet || u.geometryChanged || u.viewportChanged || u.docChanged) {
        // eslint-disable-next-line react-hooks/refs
        snapshotRef.current();
      }

      // Update cursor position for the StatusBar
      if (u.selectionSet || u.docChanged) {
        const pos = view.state.selection.main.head;
        const lineObj = view.state.doc.lineAt(pos);
        useEditorStore.getState().setCursorPosition({
          line: lineObj.number,
          col: pos - lineObj.from,
        });
      }

      // Extract selection lines for AI toolbar
      if (u.selectionSet) {
        const sel = view.state.selection.main;
        if (!sel.empty) {
          const fromLine = view.state.doc.lineAt(sel.from).number;
          const toLine = view.state.doc.lineAt(sel.to).number;
          setSelectionLines({ startLine: fromLine, endLine: toLine });

          const coords = view.coordsAtPos(sel.to);
          if (coords) {
            setToolbarPos({
              top: coords.bottom + 4,
              left: coords.left,
            });
          }
        } else {
          setSelectionLines(null);
          setToolbarPos(null);
        }
      }
    });
  }, [setSelectionLines, setToolbarPos]);

  // CodeMirror 初始化完成后：捕获 view 引用，恢复上次的 scrollTop/selection
  const handleCreateEditor = useCallback(
    (view: EditorView) => {
      editorViewRef.current = view;
      setEditorViewEpoch((n) => n + 1);
      // Apply any breakpoints already in the store (effect may have run before view existed)
      const lines = useDebugStore.getState().breakpoints[tab.projectId]?.[absFilePath] ?? [];
      lastSyncedBpKeyRef.current = `${absFilePath}:${lines.join(',')}`;
      view.dispatch({ effects: bpSyncEffect(lines) });
      // Re-apply debug current-line if we stopped before the editor mounted.
      const dbg = useDebugStore.getState();
      const hl = resolveDebugHighlightLine(
        absFilePath,
        tab.filePath,
        dbg.stoppedAt,
        dbg.session?.status,
      );
      applyDebugCurrentLine(view, hl);
      if (editorRestoredRef.current) return;

      // Check for pending LSP navigation target (go-to-definition / find-references)
      const pending = useEditorStore.getState().pendingNavigateTarget;
      if (pending && pending.tabKey === tabKey && pending.tabId === tabId) {
        // Defer one frame so layout is measured before scroll/focus
        requestAnimationFrame(() => {
          applyNavigateCaret(view, pending.line, pending.col);
        });
        // Delay clear to survive React StrictMode double-mount
        queueMicrotask(() => {
          useEditorStore.getState().setPendingNavigateTarget(null);
        });
        editorRestoredRef.current = true;
        return;
      }

      const snap = getViewSnapshot(tabKey, tabId, 'editor');
      if (!snap) {
        editorRestoredRef.current = true;
        return;
      }

      // 等下一帧让 CodeMirror 完成首屏 measure 再 scroll，避免被覆盖
      requestAnimationFrame(() => {
        try {
          if (snap.selection) {
            const docLen = view.state.doc.length;
            const safe = snap.selection.ranges.every((r) => r.anchor <= docLen && r.head <= docLen);
            if (safe) {
              view.dispatch({
                selection: EditorSelection.fromJSON(snap.selection),
                scrollIntoView: false,
              });
            }
          }
          const maxScroll = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
          view.scrollDOM.scrollTop = Math.min(snap.scrollTop, maxScroll);
        } catch (e) {
          console.warn('[FileEditor] restore editor view failed', e);
        } finally {
          editorRestoredRef.current = true;
        }
      });
    },
    [
      tabKey,
      tabId,
      tab.projectId,
      tab.filePath,
      absFilePath,
      bpSyncEffect,
      editorViewRef,
      lastSyncedBpKeyRef,
      setEditorViewEpoch,
    ],
  );

  // 卸载兜底：再保存一次（updateListener 大多已覆盖，但保险起见）
  useEffect(() => {
    return () => {
      saveEditorSnapshot();
      editorViewRef.current = null;
      editorRestoredRef.current = false;
    };
  }, [saveEditorSnapshot, editorViewRef]);

  // Listen for pending LSP navigation target (existing tabs – go-to-definition / find-references)
  useEffect(() => {
    const unsubscribe = useEditorStore.subscribe((state) => {
      const pending = state.pendingNavigateTarget;
      if (pending && pending.tabKey === tabKey && pending.tabId === tabId) {
        const view = editorViewRef.current;
        if (view) {
          requestAnimationFrame(() => {
            applyNavigateCaret(view, pending.line, pending.col);
          });
          useEditorStore.getState().setPendingNavigateTarget(null);
        }
      }
    });
    return unsubscribe;
  }, [tabKey, tabId, editorViewRef]);

  return { handleCreateEditor, viewStateExt, resetEditorRestored };
}
