import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import type { AuthMethod } from '@/shared/types';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/ui/Resizable';

import { useEditorGroupLayout } from '../hooks/useEditorGroupLayout';

import EditorDndShell from './EditorDndShell';
import EditorGroupPane from './EditorGroupPane';

interface EditorGroupLayoutProps {
  tabKey: string;
  onAddTerminalTab: () => void;
  remoteProject?: {
    entryId: string;
    projectId: string;
    projectName: string;
    projectPath: string;
    host: string;
    port: number;
    username: string;
    auth: AuthMethod;
    cacheKeySuffix?: string;
    onSessionReady?: (pid: string) => void;
  } | null;
  buildLayoutId: (groupId: string, tabId: string | null) => string;
}

function EditorGroupLayout({
  tabKey,
  onAddTerminalTab,
  remoteProject,
  buildLayoutId,
}: EditorGroupLayoutProps) {
  const {
    layout,
    isSplit,
    leftTabs,
    rightTabs,
    leftActiveTabId,
    rightActiveTabId,
    setActiveGroup,
    setSplitRatio,
    pinnedTabs,
    pinnedActiveTab,
    pinnedPanelRatio,
    setPinnedPanelRatio,
  } = useEditorGroupLayout(tabKey);

  // Panel IDs — stable per tabKey
  const pinnedPanelId = `pinned-${tabKey}`;
  const leftPanelId = `left-${tabKey}`;
  const rightPanelId = `right-${tabKey}`;

  // ── defaultLayout: computed via useMemo, never mutated ──
  const hasPinned = pinnedTabs.length > 0;
  const groupKey = `${hasPinned ? 'p' : ''}${isSplit ? 's' : ''}-${tabKey}`;

  const defaultLayout = useMemo(() => {
    if (!hasPinned && !isSplit) {
      // Case A — no group needed
      return {};
    }
    if (hasPinned && !isSplit) {
      // Case B: pinned + left
      const pinPct = Math.round(pinnedPanelRatio * 100);
      return {
        [pinnedPanelId]: pinPct,
        [leftPanelId]: 100 - pinPct,
      };
    }
    if (hasPinned && isSplit) {
      // Case C: pinned + left + right
      const pinPct = Math.round(pinnedPanelRatio * 100);
      const rest = 100 - pinPct;
      const leftPct = Math.round(rest * layout.ratio);
      return {
        [pinnedPanelId]: pinPct,
        [leftPanelId]: leftPct,
        [rightPanelId]: rest - leftPct,
      };
    }
    // Case D: left + right (no pin)
    const leftPct = Math.round(layout.ratio * 100);
    return {
      [leftPanelId]: leftPct,
      [rightPanelId]: 100 - leftPct,
    };
  }, [
    hasPinned,
    isSplit,
    pinnedPanelRatio,
    layout.ratio,
    pinnedPanelId,
    leftPanelId,
    rightPanelId,
  ]);

  // ── onLayoutChanged: persist ratio back to store ──
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleLayoutChange = useCallback(
    (lm: Record<string, number>) => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;

        if (hasPinned) {
          // Save pinned panel ratio
          const pinPct = lm[pinnedPanelId];
          if (pinPct !== undefined) setPinnedPanelRatio(pinPct / 100);

          if (isSplit) {
            // Derive left/right ratio from their share of the remaining space
            const leftPct = lm[leftPanelId] ?? 0;
            const rightPct = lm[rightPanelId] ?? 0;
            const total = leftPct + rightPct;
            if (total > 0) setSplitRatio(leftPct / total);
          }
        } else if (isSplit) {
          const leftPct = lm[leftPanelId];
          if (leftPct !== undefined) setSplitRatio(leftPct / 100);
        }
      }, 150);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      hasPinned,
      isSplit,
      pinnedPanelId,
      leftPanelId,
      rightPanelId,
      setPinnedPanelRatio,
      setSplitRatio,
    ],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  // Layout IDs used by EditorGroupPane internals
  const leftLayoutId = buildLayoutId('left', leftActiveTabId);
  const rightLayoutId = buildLayoutId('right', rightActiveTabId);
  const pinnedLayoutId = buildLayoutId('pinned', pinnedActiveTab?.id ?? null);

  // ── Case A: no pin, no split — no ResizablePanelGroup needed ──
  let content: React.ReactNode;
  if (!hasPinned && !isSplit) {
    content = (
      <EditorGroupPane
        tabKey={tabKey}
        onAddTerminalTab={onAddTerminalTab}
        remoteProject={remoteProject}
        groupId="left"
        onFocusGroup={() => setActiveGroup('left')}
        layoutId={leftLayoutId}
      />
    );
  } else if (hasPinned && !isSplit && leftTabs.length === 0) {
    // ── Case A2: pin only, no other tabs — pin pane fills the entire area ──
    // Avoids rendering an empty left panel beside the pinned panel.
    content = (
      <EditorGroupPane
        tabKey={tabKey}
        onAddTerminalTab={onAddTerminalTab}
        remoteProject={remoteProject}
        groupId="pinned"
        onFocusGroup={() => {}}
        layoutId={pinnedLayoutId}
      />
    );
  } else {
    // ── Cases B / C / D — single ResizablePanelGroup, 2 or 3 panels ──
    content = (
      <ResizablePanelGroup
        key={groupKey}
        orientation="horizontal"
        id={`editor-group-${tabKey}`}
        defaultLayout={defaultLayout}
        onLayoutChanged={handleLayoutChange}
        className="flex-1 rounded-lg overflow-hidden bg-bg-primary"
      >
        {/* ── Pinned panel (leftmost, Cases B & C) ── */}
        {hasPinned && (
          <>
            <ResizablePanel id={pinnedPanelId} minSize={10} className="py-0.5 pr-0.5 min-w-0">
              <div className="flex-1 flex flex-col overflow-hidden min-w-0 rounded-lg shadow-sm bg-bg-secondary">
                <EditorGroupPane
                  tabKey={tabKey}
                  onAddTerminalTab={onAddTerminalTab}
                  remoteProject={remoteProject}
                  groupId="pinned"
                  onFocusGroup={() => {}}
                  layoutId={pinnedLayoutId}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle id={`pin-handle-${tabKey}`} />
          </>
        )}

        {/* ── Left panel (always present in Cases B / C / D) ── */}
        <ResizablePanel
          id={leftPanelId}
          minSize={10}
          className="py-0.5 min-w-0"
          // Add right padding only when there's no right panel
          style={
            isSplit
              ? { paddingRight: '2px' }
              : hasPinned
                ? { paddingLeft: '2px' }
                : { paddingLeft: '2px' }
          }
        >
          <div className="flex-1 flex flex-col overflow-hidden min-w-0 rounded-lg shadow-sm bg-bg-secondary">
            <EditorGroupPane
              tabKey={tabKey}
              onAddTerminalTab={onAddTerminalTab}
              remoteProject={remoteProject}
              groupId="left"
              onFocusGroup={() => setActiveGroup('left')}
              layoutId={leftLayoutId}
            />
          </div>
        </ResizablePanel>

        {/* ── Right panel (Cases C & D) ── */}
        {isSplit && (
          <>
            <ResizableHandle id={`split-handle-${tabKey}`} />
            <ResizablePanel id={rightPanelId} minSize={10} className="py-0.5 pl-0.5 min-w-0">
              <div className="flex-1 flex flex-col overflow-hidden min-w-0 rounded-lg shadow-sm bg-bg-secondary">
                <EditorGroupPane
                  tabKey={tabKey}
                  onAddTerminalTab={onAddTerminalTab}
                  remoteProject={remoteProject}
                  groupId="right"
                  onFocusGroup={() => setActiveGroup('right')}
                  layoutId={rightLayoutId}
                />
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    );
  }

  // 共享 DndContext 装配壳：拖拽事件 / DragOverlay / 动态 pin zone 收敛在
  // EditorDndShell，本组件只保留布局骨架。
  return (
    <EditorDndShell
      tabKey={tabKey}
      leftTabs={leftTabs}
      rightTabs={rightTabs}
      pinnedTabs={pinnedTabs}
      hasPinned={hasPinned}
    >
      {content}
    </EditorDndShell>
  );
}

export default React.memo(EditorGroupLayout);
