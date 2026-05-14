import React, { useCallback, useEffect, useMemo, useRef } from "react";
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
  } = useEditorGroupLayout(tabKey);

  const handleActivateTab = useCallback(
    (tabId: string) => {
      activateTabInGroup(tabId);
    },
    [activateTabInGroup],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      useAppStore.getState().closeTab(tabKey, tabId);
    },
    [tabKey],
  );

  const handleCloseOtherTabs = useCallback(
    (tabId: string) => {
      if (!onCloseOtherTabs) return;
      onCloseOtherTabs(tabId);
    },
    [onCloseOtherTabs],
  );

  const handleCloseAllTabs = useCallback(() => {
    if (!onCloseAllTabs) return;
    onCloseAllTabs();
  }, [onCloseAllTabs]);

  const leftLayoutId = buildLayoutId("left", leftActiveTabId);
  const rightLayoutId = buildLayoutId("right", rightActiveTabId);

  const leftPanelId = `left-${tabKey}`;
  const rightPanelId = `right-${tabKey}`;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLayoutChange = useCallback((layout: Record<string, number>) => {
    const leftPercent = layout[leftPanelId];
    if (leftPercent === undefined) return;
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      setSplitRatio(leftPercent / 100);
    }, 150);
  }, [setSplitRatio, leftPanelId]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const ratioPercent = Math.round(layout.ratio * 100);

  const defaultLayout = useMemo(() => ({
    [leftPanelId]: ratioPercent,
    [rightPanelId]: 100 - ratioPercent,
  }), [leftPanelId, rightPanelId, ratioPercent]);

  if (!isSplit) {
    return (
      <EditorGroupPane
        groupId="left"
        tabKey={tabKey}
        tabs={leftTabs}
        activeTabId={leftActiveTabId}
        isFocused={activeGroupId === "left"}
        onActivateTab={handleActivateTab}
        onCloseTab={handleCloseTab}
        onAddTerminalTab={onAddTerminalTab}
        onSplitRight={splitRight}
        onMoveToRight={moveToRight}
        onMoveToLeft={moveToLeft}
        onFocusGroup={() => setActiveGroup("left")}
        agents={agents}
        compactMode={compactMode}
        showAgentBar={showAgentBar}
        hiddenAgentIds={hiddenAgentIds}
        onToggleHiddenAgent={onToggleHiddenAgent}
        onAgentClick={onAgentClick}
        onCloseOtherTabs={handleCloseOtherTabs}
        onCloseAllTabs={handleCloseAllTabs}
        config={config}
        showToast={showToast}
        wslProject={wslProject}
        layoutId={leftLayoutId}
      />
    );
  }

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      id={`editor-split-${tabKey}`}
      defaultLayout={defaultLayout}
      onLayoutChanged={handleLayoutChange}
      className="flex-1 rounded-lg bg-bg-primary"
    >
      <ResizablePanel id={leftPanelId} minSize={30} className="py-0.5 pr-0.5">
        <div className="flex-1 flex flex-col overflow-hidden rounded-lg shadow-sm bg-bg-secondary">
          <EditorGroupPane
            groupId="left"
            tabKey={tabKey}
            tabs={leftTabs}
            activeTabId={leftActiveTabId}
            isFocused={activeGroupId === "left"}
            onActivateTab={handleActivateTab}
            onCloseTab={handleCloseTab}
            onAddTerminalTab={onAddTerminalTab}
            onSplitRight={splitRight}
            onMoveToRight={moveToRight}
            onMoveToLeft={moveToLeft}
            onFocusGroup={() => setActiveGroup("left")}
            agents={agents}
            compactMode={compactMode}
            showAgentBar={showAgentBar}
            hiddenAgentIds={hiddenAgentIds}
            onToggleHiddenAgent={onToggleHiddenAgent}
            onAgentClick={onAgentClick}
            onCloseOtherTabs={handleCloseOtherTabs}
            onCloseAllTabs={handleCloseAllTabs}
            config={config}
            showToast={showToast}
            wslProject={wslProject}
            layoutId={leftLayoutId}
          />
        </div>
      </ResizablePanel>
      <ResizableHandle id="editor-split-handle" />
      <ResizablePanel id={rightPanelId} minSize={30} className="py-0.5 pl-0.5">
        <div className="flex-1 flex flex-col overflow-hidden rounded-lg shadow-sm bg-bg-secondary">
          <EditorGroupPane
            groupId="right"
            tabKey={tabKey}
            tabs={rightTabs}
            activeTabId={rightActiveTabId}
            isFocused={activeGroupId === "right"}
            onActivateTab={handleActivateTab}
            onCloseTab={handleCloseTab}
            onAddTerminalTab={onAddTerminalTab}
            onSplitRight={splitRight}
            onMoveToRight={moveToRight}
            onMoveToLeft={moveToLeft}
            onFocusGroup={() => setActiveGroup("right")}
            agents={agents}
            compactMode={compactMode}
            showAgentBar={showAgentBar}
            hiddenAgentIds={hiddenAgentIds}
            onToggleHiddenAgent={onToggleHiddenAgent}
            onAgentClick={onAgentClick}
            onCloseOtherTabs={handleCloseOtherTabs}
            onCloseAllTabs={handleCloseAllTabs}
            config={config}
            showToast={showToast}
            wslProject={wslProject}
            layoutId={rightLayoutId}
          />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export default React.memo(EditorGroupLayout);
