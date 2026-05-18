import React, { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SplitLayout, TerminalView, WSLTerminalView } from "../terminal";
import type { SplitStateInfo } from "../terminal/SplitLayout";
import DiffView from "../DiffView";
import { FileViewer, HtmlPreview } from "../files";
import { GitLogPanel } from "../gitlog";
import UnifiedTabBar from "./UnifiedTabBar";
import AgentIcon from "./AgentIcon";
import ContextMenu from "../project/ContextMenu";
import type { ContextMenuItem } from "../project/ContextMenu";
import SettingsPanel from "../SettingsPanel";
import type { AgentConfig, AppConfig, EditorGroupId, Tab } from "../../types";
import { cn } from "../../utils/cn";
import { useEditorContext, EditorProvider } from "../../contexts/editor-context";
import { useAppContext } from "../../contexts";

interface EditorGroupPaneProps {
  /** "left" | "right" for normal groups; "pinned" for the fixed pin panel */
  groupId: EditorGroupId | "pinned";
  tabKey: string;
  tabs: Tab[];
  activeTabId: string | null;
  /** The currently-pinned tab id — forwarded to UnifiedTabBar to render the pin indicator. */
  pinnedTabId?: string | null;
  isFocused: boolean;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTerminalTab: () => void;
  onSplitRight: (tabId: string) => void;
  onMoveToRight: (tabId: string) => void;
  onMoveToLeft: (tabId: string) => void;
  onFocusGroup: () => void;
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
  layoutId: string;
  /**
   * Extra context-menu items injected by the parent layout.
   * Rendered after the built-in split/move items, separated by a divider.
   * This keeps pin logic (and any future layout-level actions) out of EditorGroupPane.
   */
  contextMenuExtras?: (tabId: string) => import("../project/ContextMenu").ContextMenuItem[];
}

function EditorGroupPane({
  groupId,
  tabs,
  activeTabId,
  pinnedTabId = null,
  isFocused,
  onActivateTab,
  onCloseTab,
  onAddTerminalTab,
  onSplitRight,
  onMoveToRight,
  onMoveToLeft,
  onFocusGroup,
  agents,
  compactMode,
  showAgentBar,
  hiddenAgentIds,
  onAgentClick,
  onCloseOtherTabs,
  onCloseAllTabs,
  config,
  showToast,
  wslProject,
  layoutId,
  contextMenuExtras,
}: EditorGroupPaneProps) {
  const globalEditorCtx = useEditorContext();
  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? null, [tabs, activeTabId]);
  const [installedMap, setInstalledMap] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (agents.length === 0) return;
    const agentIds = agents.map((a) => a.id);
    invoke<Record<string, boolean>>("check_agents_installed", { agentIds })
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

  const allEnabledAgents = useMemo(
    () => agents.filter((a) => a.enabled).sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  const showAgentBarContent = showAgentBar && activeTab?.data.kind === "terminal" && (enabledAgents.length > 0 || allEnabledAgents.length > 0);
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
      { label: "Close", action: () => onCloseTab(tabId) },
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
  }, [contextMenu, groupId, onCloseTab, onCloseOtherTabs, onCloseAllTabs, onSplitRight, onMoveToRight, onMoveToLeft, contextMenuExtras]);

  // Settings tab close
  const handleCloseSettingsTab = useCallback(() => {
    if (activeTab?.data.kind === "settings") onCloseTab(activeTab.id);
  }, [activeTab, onCloseTab]);

  const { saveConfig } = useAppContext();

  const handleSettingsConfigChange = useCallback(
    (next: AppConfig) => {
      saveConfig(next);
    },
    [saveConfig],
  );

  const localEditorCtx = useMemo(() => ({
    ...globalEditorCtx,
    activeTabId,
    onActivateTab,
    onCloseTab,
    onAddTab: onAddTerminalTab,
  }), [globalEditorCtx, activeTabId, onActivateTab, onCloseTab, onAddTerminalTab]);

  return (
    <EditorProvider value={localEditorCtx}>
    <div
      className={cn(
        "flex-1 flex flex-col overflow-hidden min-h-0",
        isFocused ? "ring-1 ring-[var(--border-color)]/30" : "",
      )}
      onClick={onFocusGroup}
    >
      {/* Tab Bar */}
      {tabs.length > 0 && (
        <div className="shrink-0 bg-bg-secondary">
          <div className="h-8 flex items-center px-2 gap-1">
            <div className="flex-1 min-w-0">
              <UnifiedTabBar
                tabs={tabs}
                activeTabId={activeTabId}
                pinnedTabId={pinnedTabId}
                onActivateTab={onActivateTab}
                onCloseTab={onCloseTab}
                onAddTerminalTab={onAddTerminalTab}
                onContextMenu={handleTabContextMenu}
                agents={agents}
              />
            </div>
          </div>

          {showAgentBarRow && (
            <div className="h-8 px-2 pb-1 flex items-center gap-1">
              {showAgentBarContent && (
                <>
                  <div className="relative shrink-0">
                    <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0 h-6">
                      {enabledAgents.map((agent) => {
                        const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true);
                        const selected = currentAgentId === agent.id;
                        return (
                          <button
                            key={agent.id}
                            className={`tb-icon-btn flex items-center gap-1.5 px-2 h-6 rounded-md transition-colors ${selected ? "text-text-primary bg-bg-hover" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"} ${!installed ? "opacity-50" : ""}`}
                            style={{ fontSize: "var(--terminal-font-size)" }}
                            onClick={() => handleAgentClick(agent)}
                            disabled={!installed}
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
        {activeTab?.data.kind === "settings" ? (
          <SettingsPanel
            fullPage
            onConfigChange={handleSettingsConfigChange}
            onClose={handleCloseSettingsTab}
          />
        ) : (
          <>
            {activeTab?.data.kind === "terminal" && (
              <div className="terminal-pane-container flex-1 flex flex-row overflow-hidden min-h-0 p-0 m-0">
                <SplitLayout
                  layoutId={layoutId}
                  renderPane={(paneId) =>
                    wslProject ? (
                      <WSLTerminalView paneId={paneId} />
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
                onBack={() => onCloseTab(activeTab.id)}
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

            <div
              className={cn(
                "flex-1 min-h-0",
                activeTab?.data.kind === "gitLog" ? "flex flex-col" : "hidden",
              )}
            >
              <GitLogPanel />
            </div>
          </>
        )}
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
