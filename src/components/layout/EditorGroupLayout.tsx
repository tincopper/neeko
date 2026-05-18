import React, { useCallback, useEffect, useRef } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "../ui/resizable";
import EditorGroupPane from "./EditorGroupPane";
import { useEditorGroupLayout } from "../../hooks/useEditorGroupLayout";
import { useAppStore } from "../../store/appStore";
import type { AgentConfig, AppConfig, Tab } from "../../types";

interface EditorGroupLayoutProps {
  tabKey: string;
  allTabs: Tab[];
  activeTabId: string | null;
  onAddTerminalTab: () => void;
  agents: AgentConfig[];
  compactMode: boolean;
  showAgentBar: boolean;
  hiddenAgentIds: string[];
  onToggleHiddenAgent: (agentId: string) => void;
  onAgentClick: (agent: AgentConfig) => void;
  onCloseOtherTabs?: (tabId: string) => void;
  onCloseAllTabs?: () => void;
  config: AppConfig;
  showToast: (msg: string, type?: "info" | "error") => void;
  wslProject?: { distro: string; project: { id: string } } | null;
  buildLayoutId: (groupId: string, tabId: string | null) => string;
}

function EditorGroupLayout({
  tabKey,
  onAddTerminalTab,
  agents,
  compactMode,
  showAgentBar,
  hiddenAgentIds,
  onToggleHiddenAgent,
  onAgentClick,
  onCloseOtherTabs,
  onCloseAllTabs,
  config,
  showToast,
  wslProject,
  buildLayoutId,
}: EditorGroupLayoutProps) {
  const {
    layout,
    isSplit,
    leftTabs,
    rightTabs,
    leftActiveTabId,
    rightActiveTabId,
    activeGroupId,
    splitRight,
    moveToRight,
    moveToLeft,
    setActiveGroup,
    setSplitRatio,
    activateTabInGroup,
    pinnedTab,
    pinnedPanelRatio,
    pinTab,
    unpinTab,
    setPinnedPanelRatio,
  } = useEditorGroupLayout(tabKey);

  const handleActivateTab = useCallback(
    (tabId: string) => activateTabInGroup(tabId),
    [activateTabInGroup],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => useAppStore.getState().closeTab(tabKey, tabId),
    [tabKey],
  );

  const handleCloseOtherTabs = useCallback(
    (tabId: string) => onCloseOtherTabs?.(tabId),
    [onCloseOtherTabs],
  );

  const handleCloseAllTabs = useCallback(
    () => onCloseAllTabs?.(),
    [onCloseAllTabs],
  );

  // Panel IDs — stable per tabKey
  const pinnedPanelId = `pinned-${tabKey}`;
  const leftPanelId   = `left-${tabKey}`;
  const rightPanelId  = `right-${tabKey}`;

  // ── defaultLayout: fixed at mount, never re-derived from store ──
  // The key changes when panel count changes, forcing a fresh group mount with a
  // new ref. This is the same pattern react-resizable-panels expects.
  const hasPinned = !!pinnedTab;
  // "p" prefix = pinned present, "s" suffix = split present
  const groupKey = `${hasPinned ? "p" : ""}${isSplit ? "s" : ""}-${tabKey}`;
  const prevGroupKeyRef = useRef<string>(groupKey);

  const defaultLayoutRef = useRef<Record<string, number> | null>(null);

  // Re-initialise the seed whenever the panel configuration changes
  // (pin appears/disappears, split appears/disappears).
  if (defaultLayoutRef.current === null || prevGroupKeyRef.current !== groupKey) {
    prevGroupKeyRef.current = groupKey;

    if (!hasPinned && !isSplit) {
      // Case A — no group needed, but keep ref in sync
      defaultLayoutRef.current = {};
    } else if (hasPinned && !isSplit) {
      // Case B: pinned + left
      const pinPct = Math.round(pinnedPanelRatio * 100);
      defaultLayoutRef.current = {
        [pinnedPanelId]: pinPct,
        [leftPanelId]: 100 - pinPct,
      };
    } else if (hasPinned && isSplit) {
      // Case C: pinned + left + right
      const pinPct  = Math.round(pinnedPanelRatio * 100);
      const rest    = 100 - pinPct;
      const leftPct = Math.round(rest * layout.ratio);
      defaultLayoutRef.current = {
        [pinnedPanelId]: pinPct,
        [leftPanelId]:   leftPct,
        [rightPanelId]:  rest - leftPct,
      };
    } else {
      // Case D: left + right (no pin)
      const leftPct = Math.round(layout.ratio * 100);
      defaultLayoutRef.current = {
        [leftPanelId]:  leftPct,
        [rightPanelId]: 100 - leftPct,
      };
    }
  }

  const defaultLayout = defaultLayoutRef.current!;

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
            const leftPct  = lm[leftPanelId]  ?? 0;
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
    [hasPinned, isSplit, pinnedPanelId, leftPanelId, rightPanelId, setPinnedPanelRatio, setSplitRatio],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  // Layout IDs used by EditorGroupPane internals
  const leftLayoutId   = buildLayoutId("left",   leftActiveTabId);
  const rightLayoutId  = buildLayoutId("right",  rightActiveTabId);
  const pinnedLayoutId = buildLayoutId("pinned", pinnedTab?.id ?? null);

  // ── Context menu extras: injected by Layout so EditorGroupPane stays pin-unaware ──
  const pinnedTabId = layout.pinnedTabId;

  const pinnedContextMenuExtras = useCallback(
    (_tabId: string) => [
      { label: "Unpin Tab", action: () => unpinTab() },
    ],
    [unpinTab],
  );

  const normalContextMenuExtras = useCallback(
    (tabId: string) => {
      const isPinnedTab = tabId === pinnedTabId;
      if (isPinnedTab) {
        return [{ label: "Unpin Tab", action: () => unpinTab() }];
      }
      return [{ label: "Pin Tab", action: () => pinTab(tabId) }];
    },
    [pinnedTabId, pinTab, unpinTab],
  );

  // ── Shared props for every EditorGroupPane ──
  const sharedPaneProps = {
    tabKey,
    onAddTerminalTab,
    agents,
    compactMode,
    showAgentBar,
    hiddenAgentIds,
    onToggleHiddenAgent,
    onAgentClick,
    config,
    showToast,
    wslProject,
    onActivateTab: handleActivateTab,
    onCloseTab:    handleCloseTab,
    onSplitRight:  splitRight,
    onMoveToRight: moveToRight,
    onMoveToLeft:  moveToLeft,
    onCloseOtherTabs: handleCloseOtherTabs,
    onCloseAllTabs:   handleCloseAllTabs,
    pinnedTabId,
    contextMenuExtras: normalContextMenuExtras,
  };

  // ── Case A: no pin, no split — no ResizablePanelGroup needed ──
  if (!hasPinned && !isSplit) {
    return (
      <EditorGroupPane
        {...sharedPaneProps}
        groupId="left"
        tabs={leftTabs}
        activeTabId={leftActiveTabId}
        isFocused={activeGroupId === "left"}
        onFocusGroup={() => setActiveGroup("left")}
        layoutId={leftLayoutId}
      />
    );
  }

  // ── Cases B / C / D — single ResizablePanelGroup, 2 or 3 panels ──
  return (
    <ResizablePanelGroup
      key={groupKey}
      orientation="horizontal"
      id={`editor-group-${tabKey}`}
      defaultLayout={defaultLayout}
      onLayoutChanged={handleLayoutChange}
      className="flex-1 rounded-lg bg-bg-primary"
    >
      {/* ── Pinned panel (leftmost, Cases B & C) ── */}
      {hasPinned && (
        <>
          <ResizablePanel
            id={pinnedPanelId}
            minSize={10}
            className="py-0.5 pr-0.5 min-w-0"
          >
            <div className="flex-1 flex flex-col overflow-hidden min-w-0 rounded-lg shadow-sm bg-bg-secondary">
              <EditorGroupPane
                {...sharedPaneProps}
                groupId="pinned"
                tabs={pinnedTab ? [pinnedTab] : []}
                activeTabId={pinnedTab?.id ?? null}
                isFocused={false}
                onFocusGroup={() => {}}
                layoutId={pinnedLayoutId}
                // Pin panel: no split/move/close operations — only Unpin
                onSplitRight={() => {}}
                onMoveToRight={() => {}}
                onMoveToLeft={() => {}}
                onCloseTab={() => {}}
                onCloseOtherTabs={undefined}
                onCloseAllTabs={undefined}
                contextMenuExtras={pinnedContextMenuExtras}
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
        style={isSplit ? { paddingRight: "2px" } : hasPinned ? { paddingLeft: "2px" } : { paddingLeft: "2px" }}
      >
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 rounded-lg shadow-sm bg-bg-secondary">
          <EditorGroupPane
            {...sharedPaneProps}
            groupId="left"
            tabs={leftTabs}
            activeTabId={leftActiveTabId}
            isFocused={activeGroupId === "left"}
            onFocusGroup={() => setActiveGroup("left")}
            layoutId={leftLayoutId}
          />
        </div>
      </ResizablePanel>

      {/* ── Right panel (Cases C & D) ── */}
      {isSplit && (
        <>
          <ResizableHandle id={`split-handle-${tabKey}`} />
          <ResizablePanel
            id={rightPanelId}
            minSize={10}
            className="py-0.5 pl-0.5 min-w-0"
          >
            <div className="flex-1 flex flex-col overflow-hidden min-w-0 rounded-lg shadow-sm bg-bg-secondary">
              <EditorGroupPane
                {...sharedPaneProps}
                groupId="right"
                tabs={rightTabs}
                activeTabId={rightActiveTabId}
                isFocused={activeGroupId === "right"}
                onFocusGroup={() => setActiveGroup("right")}
                layoutId={rightLayoutId}
              />
            </div>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}

export default React.memo(EditorGroupLayout);
