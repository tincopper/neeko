import React, { useCallback } from "react";
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

  const ratioPercent = Math.round(layout.ratio * 100);

  return (
    <ResizablePanelGroup orientation="horizontal" id={`editor-split-${tabKey}`}>
      <ResizablePanel defaultSize={ratioPercent} minSize={30}>
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
      </ResizablePanel>
      <ResizableHandle id="editor-split-handle" withHandle />
      <ResizablePanel minSize={30}>
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
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export default React.memo(EditorGroupLayout);
