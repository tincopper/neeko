import React, { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { checkAgentsInstalled } from "@/features/agent/api/agentApi";
import DiffView from "@/features/git/components/diff";
import { PRDetailView } from '@/features/git/components/pr-detail';
import SplitLayout from '@/features/terminal/components/SplitLayout';
import TerminalView from '@/features/terminal/components/TerminalView';
import type { SplitStateInfo } from '@/features/terminal/components/SplitLayout';
import FileViewer from "./FileViewer";
import HtmlPreview from "./HtmlPreview";
import ConversationViewer from "@/features/conversation/components/ConversationViewer";
import { GitLogPanel } from '@/features/git/components/gitlog';
import TabBar from "./TabBar";
import AgentIcon from "@/features/agent/components/AgentIcon";
import ContextMenu from "@/features/project/components/ContextMenu";
import type { ContextMenuItem } from "@/features/project/components/ContextMenu";
import type { AgentConfig, AuthMethod, EditorGroupId } from '@/shared/types';
import { cn } from '@/lib/utils';
import { useEditorContext, EditorProvider } from '@/shared/contexts';
import { useAppContext } from '@/shared/contexts/AppContext';
import { useEditorGroupLayout } from "../hooks/useEditorGroupLayout";
import { useEditorStore } from '@/shared/store';
import { buildDiffSource } from '@/shared/utils/diffSource';

interface EditorGroupPaneProps {
  /** "left" | "right" for normal groups; "pinned" for the fixed pin panel */
  groupId: EditorGroupId | "pinned";
  /** Composite tab key �?used by the pane to lookup layout & store state */
  tabKey: string;
  onAddTerminalTab?: () => void;
  onFocusGroup: () => void;
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
  layoutId: string;
}

function EditorGroupPane({
  groupId,
  tabKey,
  onAddTerminalTab,
  onFocusGroup,
  remoteProject,
  layoutId,
}: EditorGroupPaneProps) {
  const globalEditorCtx = useEditorContext();
  const { agents, compactMode, showAgentBar, hiddenAgentIds, onAgentClick } = globalEditorCtx;
  const { config, showToast } = useAppContext();

  const layoutState = useEditorGroupLayout(tabKey);
  const {
    leftTabs,
    rightTabs,
    leftActiveTabId,
    rightActiveTabId,
    pinnedTab,
    activeGroupId,
    splitRight: onSplitRight,
    moveToRight: onMoveToRight,
    moveToLeft: onMoveToLeft,
    closeOtherTabs: onCloseOtherTabs,
    closeAllTabs: onCloseAllTabs,
    pinTab,
    unpinTab,
  } = layoutState;

  // Build context menu extras inline based on groupId
  const resolveContextMenuExtras = useCallback(
    (tabId: string): ContextMenuItem[] => {
      if (groupId === "pinned") {
        return [{ label: "Unpin Tab", action: () => unpinTab() }];
      }
      const isPinnedTab = tabId === layoutState.pinnedTab?.id;
      if (isPinnedTab) {
        return [{ label: "Unpin Tab", action: () => unpinTab() }];
      }
      return [{ label: "Pin Tab", action: () => pinTab(tabId) }];
    },
    [groupId, layoutState.pinnedTab?.id, pinTab, unpinTab],
  );

  const contextMenuExtras = resolveContextMenuExtras;

  // Derive tabs / activeTabId from layout state based on this pane's groupId
  const tabs = useMemo(() => {
    if (groupId === "left") return leftTabs;
    if (groupId === "right") return rightTabs;
    if (groupId === "pinned") return pinnedTab ? [pinnedTab] : [];
    return [];
  }, [groupId, leftTabs, rightTabs, pinnedTab]);

  const activeTabId = useMemo(() => {
    if (groupId === "left") return leftActiveTabId;
    if (groupId === "right") return rightActiveTabId;
    if (groupId === "pinned") return pinnedTab?.id ?? null;
    return null;
  }, [groupId, leftActiveTabId, rightActiveTabId, pinnedTab]);

  const handleActivateTab = useCallback(
    (tabId: string) => { useEditorStore.getState().activateTab(tabKey, tabId); },
    [tabKey],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (groupId === "pinned") return; // pinned panel: close is handled via Unpin, not store.closeTab
      useEditorStore.getState().closeTab(tabKey, tabId);
    },
    [tabKey, groupId],
  );

  const handleReorderTab = useCallback(
    (tabId: string, overId: string) => {
      if (groupId === "pinned") return;
      useEditorStore.getState().reorderTab(tabKey, groupId, tabId, overId);
    },
    [tabKey, groupId],
  );

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? null, [tabs, activeTabId]);
  const [installedMap, setInstalledMap] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (agents.length === 0) return;
    const agentIds = agents.map((a) => a.id);
    checkAgentsInstalled(agentIds)
      .then((result) => setInstalledMap(new Map(Object.entries(result))))
      .catch(() => {});
  }, [agents]);

  const handleAgentClick = useCallback(
    (agent: AgentConfig) => {
      const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true);
      if (!installed) {
        showToast(`${agent.name} (${agent.command}) is not installed`, "error");
        return;
      }
      if (!agent.enabled) return;
      onAgentClick(agent);
    },
    [installedMap, onAgentClick, showToast],
  );

  const currentAgentId =
    (activeTab?.data.kind === "terminal" ? activeTab.data.agentId : null) ?? null;

  const enabledAgents = useMemo(
    () => agents.filter((a) => a.enabled && !hiddenAgentIds.includes(a.id)),
    [agents, hiddenAgentIds],
  );

  const installedEnabledAgents = useMemo(
    () => enabledAgents.filter(
      (a) => installedMap.size === 0 || (installedMap.get(a.id) ?? true),
    ),
    [enabledAgents, installedMap],
  );

  const showAgentBarContent = showAgentBar && activeTab?.data.kind === "terminal" && installedEnabledAgents.length > 0;
  const showAgentBarRow = activeTab?.data.kind === "terminal";

  // Split state
  const [splitInfo, setSplitInfo] = useState<SplitStateInfo>({ paneCount: 1, canSplit: true, activePaneId: "p1" });
  const splitHorizontalRef = useRef<(() => void) | null>(null);
  const splitVerticalRef = useRef<(() => void) | null>(null);
  const closePaneRef = useRef<(() => void) | null>(null);

  const handleSplitStateChange = useCallback((info: SplitStateInfo) => setSplitInfo(info), []);
  const handleSetSplitHorizontal = useCallback((cb: () => void) => { splitHorizontalRef.current = cb; }, []);
  const handleSetSplitVertical = useCallback((cb: () => void) => { splitVerticalRef.current = cb; }, []);
  const handleSetClosePane = useCallback((cb: () => void) => { closePaneRef.current = cb; }, []);

  // Tab context menu
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);

  const handleTabContextMenu = useCallback((tabId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ tabId, x: e.clientX, y: e.clientY });
    onFocusGroup();
  }, [onFocusGroup]);

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!contextMenu) return [];
    const { tabId } = contextMenu;

    const isInRight = groupId === "right";
    const isPinnedGroup = groupId === "pinned";

    // Pin panel: delegate entirely to extras (Layout provides Unpin)
    if (isPinnedGroup) {
      return contextMenuExtras?.(tabId) ?? [];
    }

    const items: ContextMenuItem[] = [
      { label: "Close", action: () => handleCloseTab(tabId) },
    ];
    if (onCloseOtherTabs) {
      items.push({ label: "Close Others", action: () => onCloseOtherTabs(tabId) });
    }
    if (onCloseAllTabs) {
      items.push({ label: "Close All", action: () => onCloseAllTabs() });
    }
    items.push({ separator: true } as ContextMenuItem);
    if (!isInRight) {
      items.push({ label: "Split Right", action: () => onSplitRight(tabId) });
      items.push({ label: "Move to Right", action: () => onMoveToRight(tabId) });
    } else {
      items.push({ label: "Move to Left", action: () => onMoveToLeft(tabId) });
    }
    // Layout-injected extras (e.g. Pin Tab)
    const extras = contextMenuExtras?.(tabId);
    if (extras && extras.length > 0) {
      items.push({ separator: true } as ContextMenuItem);
      items.push(...extras);
    }
    return items;
  }, [contextMenu, groupId, handleCloseTab, onCloseOtherTabs, onCloseAllTabs, onSplitRight, onMoveToRight, onMoveToLeft, contextMenuExtras]);

  const localEditorCtx = useMemo(() => ({
    ...globalEditorCtx,
    activeTabId,
    onActivateTab: handleActivateTab,
    onCloseTab: handleCloseTab,
    onAddTab: onAddTerminalTab ?? (() => {}),
  }), [globalEditorCtx, activeTabId, handleActivateTab, handleCloseTab, onAddTerminalTab]);

  return (
    <EditorProvider value={localEditorCtx}>
    <div
      className={cn(
        "flex-1 flex flex-col overflow-hidden min-h-0",
        activeGroupId === groupId ? "ring-1 ring-[var(--border-color)]/30" : "",
      )}
      onClick={onFocusGroup}
    >
      {/* Tab Bar */}
      {tabs.length > 0 && (
        <div className="shrink-0 bg-bg-secondary">
          <div className="h-8 flex items-center px-2 gap-1">
            <div className="flex-1 min-w-0">
              <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                pinnedTabId={pinnedTab?.id ?? null}
                onActivateTab={handleActivateTab}
                onCloseTab={handleCloseTab}
                onAddTerminalTab={onAddTerminalTab}
                onContextMenu={handleTabContextMenu}
                reorderable={groupId !== "pinned"}
                onReorderTab={handleReorderTab}
                agents={installedEnabledAgents}
              />
            </div>
          </div>

          {showAgentBarRow && (
            <div className="h-8 px-2 pb-1 flex items-center gap-1">
              {showAgentBarContent && (
                <>
                  <div className="relative shrink-0">
                    <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0 h-6">
                      {installedEnabledAgents.map((agent) => {
                        const selected = currentAgentId === agent.id;
                        return (
                          <button
                            key={agent.id}
                            className={`tb-icon-btn flex items-center gap-1.5 px-2 h-6 rounded-md transition-colors ${selected ? "text-text-primary bg-bg-hover" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"}`}
                            style={{ fontSize: "var(--terminal-font-size)" }}
                            onClick={() => handleAgentClick(agent)}
                            title={agent.name}
                          >
                            <AgentIcon icon={agent.icon} />
                            {!compactMode && <span>{agent.name}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
              {!showAgentBarContent && <div className="flex-1" />}
              <div className="flex items-center gap-0.5 shrink-0 ml-auto">
                <button
                  className="tb-icon-btn flex items-center justify-center w-6 h-6 rounded-md transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                  title={splitInfo.canSplit ? "Split Horizontal" : "Maximum panes reached"}
                  disabled={!splitInfo.canSplit}
                  onClick={() => splitHorizontalRef.current?.()}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <rect x="1" y="2" width="10" height="8" stroke="currentColor" strokeWidth="1" />
                    <path d="M6 2V10" stroke="currentColor" strokeWidth="1" />
                  </svg>
                </button>
                <button
                  className="tb-icon-btn flex items-center justify-center w-6 h-6 rounded-md transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                  title={splitInfo.canSplit ? "Split Vertical" : "Maximum panes reached"}
                  disabled={!splitInfo.canSplit}
                  onClick={() => splitVerticalRef.current?.()}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <rect x="1" y="2" width="10" height="8" stroke="currentColor" strokeWidth="1" />
                    <path d="M1 6H11" stroke="currentColor" strokeWidth="1" />
                  </svg>
                </button>
                {splitInfo.paneCount > 1 && (
                  <button
                    className="tb-icon-btn flex items-center justify-center w-6 h-6 rounded-md transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                    title="Close Pane"
                    onClick={() => closePaneRef.current?.()}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab?.data.kind === "conversation" && (
          <ConversationViewer
            conversationId={activeTab.data.conversationId}
            agentId={activeTab.data.agentId}
            projectId={activeTab.projectId}
            conversationMeta={activeTab.data.conversationMeta ?? null}
            agents={enabledAgents}
            onBack={() => handleCloseTab(activeTab.id)}
            onResume={activeTab.data.onResume}
            showToast={showToast}
          />
        )}

        {activeTab?.data.kind === "terminal" && (
          <div className="terminal-pane-container flex-1 flex flex-row overflow-hidden min-h-0 p-0 m-0">
            <SplitLayout
              layoutId={layoutId}
              renderPane={(paneId) =>
                remoteProject ? (
                  <TerminalView
                    paneId={paneId}
                    remoteConfig={remoteProject}
                  />
                ) : (
                  <TerminalView paneId={paneId} />
                )
              }
              onSplitStateChange={handleSplitStateChange}
              onSplitHorizontal={handleSetSplitHorizontal}
              onSplitVertical={handleSetSplitVertical}
              onClosePane={handleSetClosePane}
            />
          </div>
        )}

        {activeTab?.data.kind === "diff" && (
          <DiffView
            diffSource={activeTab.data.diffSource}
            filePath={activeTab.data.filePath}
            initialMode={config.diffMode}
            onBack={() => handleCloseTab(activeTab.id)}
          />
        )}

        {activeTab?.data.kind === "file" && <FileViewer />}

        {activeTab?.data.kind === "html-preview" && (
          <HtmlPreview
            projectId={activeTab.projectId}
            filePath={activeTab.data.filePath}
            fileName={activeTab.data.fileName}
          />
        )}

        {activeTab?.data.kind === "prDetail" && (
          <PRDetailView
            key={activeTab.data.prNumber}
            projectId={activeTab.data.projectId}
            prNumber={activeTab.data.prNumber}
            prTitle={activeTab.data.prTitle}
            prState={activeTab.data.prState}
            prBody={activeTab.data.prBody}
            prAuthor={activeTab.data.prAuthor}
            prCreatedAt={activeTab.data.prCreatedAt}
            prUrl={activeTab.data.prUrl}
            prHeadRef={activeTab.data.prHeadRef}
            prBaseRef={activeTab.data.prBaseRef}
            onClose={() => handleCloseTab(activeTab.id)}
            onOpenDiff={(filePath) => {
              // Open diff in a new tab
              const tabId = `tab_${crypto.randomUUID()}`;
              const diffSource = buildDiffSource(null, null);
              const tab = {
                id: tabId,
                projectId: activeTab.projectId,
                title: filePath.split('/').pop() || filePath,
                order: 0,
                data: {
                  kind: 'diff' as const,
                  filePath,
                  fileName: filePath.split('/').pop() || filePath,
                  diffSource,
                },
              };
              useEditorStore.getState().addTab(tabKey, tab);
              useEditorStore.getState().activateTab(tabKey, tabId);
            }}
          />
        )}

        <div
          className={cn(
            "flex-1 min-h-0",
            activeTab?.data.kind === "gitLog" ? "flex flex-col" : "hidden",
          )}
        >
          <GitLogPanel />
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
    </EditorProvider>
  );
}

export default React.memo(EditorGroupPane);
