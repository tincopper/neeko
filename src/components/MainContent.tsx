import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TerminalView, WorktreeTerminalView, WSLTerminalView } from "./terminal";
import DiffView from "./DiffView";
import RemoteProjectView from "./RemoteProjectView";
import FileViewer from "./panels/FileViewer";
import TerminalTabBar from "./layout/TerminalTabBar";
import AgentIcon from "./layout/AgentIcon";
import type {
   Project,
   WSLProject,
   RemoteProject,
   RemoteEntrySession,
   AuthMethod,
   AgentConfig,
   TerminalTab,
   FileTab,
} from "../types";
import { useAppContext } from "../context/app-context";

interface MainContentProps {
   activeProject: Project | null;
   activeWorktreePath: string | null;
   activeWorktreeBranch: string;
   handleSelectProject: (projectId: string) => void;
   handleAddProject: () => void;
   suppressResizeRef?: React.MutableRefObject<boolean>;

   tabs: TerminalTab[];
   activeTabId: string | null;
   onActivateTab: (tabId: string) => void;
   onCloseTab: (tabId: string) => void;
   onAddTab: () => void;
   onTabStatusChange?: (tabId: string, status: "Idle" | "Running" | "Failed") => void;

   agents: AgentConfig[];
   compactMode: boolean;
   showAgentBar: boolean;
   hiddenAgentIds: string[];
   onToggleHiddenAgent: (agentId: string) => void;
   onAgentClick: (agent: AgentConfig) => void;
   showToast: (message: string, type?: "info" | "error") => void;

   activeWslProject: { distro: string; project: WSLProject } | null;
   activeWslWorktreePath: string | null;
   setWslOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;

   activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
   activeRemoteWorktreePath: string | null;
   remoteAuthStore: Map<string, AuthMethod>;
   setRemoteOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;

   wslDiffState: { distro: string; projectPath: string; filePath: string } | null;
   remoteDiffState: {
      entryId: string;
      host: string;
      port: number;
      username: string;
      auth: AuthMethod;
      projectPath: string;
      filePath: string;
   } | null;
   worktreeDiffState: { worktreePath: string; filePath: string } | null;

   onWslDiffBack: () => void;
   onRemoteDiffBack: () => void;
   onWorktreeDiffBack: () => void;

   // File view props
   fileTabs: FileTab[];
   activeFileTabId: string | null;
   onFileCloseTab: (tabId: string) => void;
   onFileActivateTab: (tabId: string) => void;
   onFileSave: (content: string) => Promise<boolean>;
   onFileContentChange: (tabId: string, content: string) => void;
}

function MainContent({
   activeProject,
   activeWorktreePath,
   activeWorktreeBranch,
   handleSelectProject,
   handleAddProject,
   suppressResizeRef,
   tabs,
   activeTabId,
   onActivateTab,
   onCloseTab,
   onAddTab,
   onTabStatusChange,
   agents,
   compactMode,
   showAgentBar,
   hiddenAgentIds,
   onToggleHiddenAgent,
   onAgentClick,
   showToast,
   activeWslProject,
   activeWslWorktreePath,
   setWslOpenSessions,
   activeRemoteProject,
   activeRemoteWorktreePath,
   remoteAuthStore,
   setRemoteOpenSessions,
   wslDiffState,
   remoteDiffState,
   worktreeDiffState,
   onWslDiffBack,
   onRemoteDiffBack,
   onWorktreeDiffBack,
   fileTabs,
   activeFileTabId,
   onFileCloseTab,
   onFileActivateTab,
   onFileSave,
   onFileContentChange,
}: MainContentProps) {
   const { config } = useAppContext();

   // Manage Presets dropdown
   const [managerOpen, setManagerOpen] = useState(false);
   const managerRef = useRef<HTMLDivElement>(null);

   useEffect(() => {
      if (!managerOpen) return;
      const handler = (e: MouseEvent) => {
         if (managerRef.current && !managerRef.current.contains(e.target as Node)) {
            setManagerOpen(false);
         }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
   }, [managerOpen]);

   const allEnabledAgents = useMemo(() => agents.filter((a) => a.enabled).sort((a, b) => a.name.localeCompare(b.name)), [agents]);

   const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
   const activeTabAgentId = activeTab?.agentId ?? null;

   // Agent installed status
   const [installedMap, setInstalledMap] = useState<Map<string, boolean>>(new Map());

   useEffect(() => {
      if (agents.length === 0) return;
      const agentIds = agents.map((a) => a.id);
      invoke<Record<string, boolean>>("check_agents_installed", { agentIds })
         .then((result) => setInstalledMap(new Map(Object.entries(result))))
         .catch((err) => console.error("[MainContent] Failed to check agents installed:", err));
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
      [installedMap, onAgentClick, showToast]
   );

   const currentAgentId =
      activeTab?.agentId ??
      activeProject?.selected_agent ??
      activeWslProject?.project.selected_agent ??
      activeRemoteProject?.project.selected_agent ??
      null;

   const enabledAgents = useMemo(() => agents.filter((a) => a.enabled && !hiddenAgentIds.includes(a.id)), [agents, hiddenAgentIds]);
   const hasActiveProject = !!(activeProject || activeWslProject || activeRemoteProject);
   const showAgentBarContent = showAgentBar && hasActiveProject && (enabledAgents.length > 0 || allEnabledAgents.length > 0);

   const handleTerminalTabStatusChange = useCallback(
      (status: "Idle" | "Running" | "Failed") => {
         if (activeTabId) {
            onTabStatusChange?.(activeTabId, status);
         }
      },
      [activeTabId, onTabStatusChange]
   );

   const onWslSessionReady = useCallback(
      (pid: string) => {
         setWslOpenSessions((prev) => new Set(prev).add(pid));
      },
      [setWslOpenSessions]
   );

   const onRemoteSessionReady = useCallback(
      (pid: string) => {
         setRemoteOpenSessions((prev) => new Set(prev).add(pid));
      },
      [setRemoteOpenSessions]
   );

   const isTerminalView = activeProject?.active_view === "Terminal";
   const diffFilePath =
      typeof activeProject?.active_view === "object"
         ? (activeProject.active_view as { Diff: { file_path: string } }).Diff?.file_path || null
         : null;

   // Determine if we should show FileViewer
   const showFileViewer = fileTabs.length > 0;

   return (
      <div className="main-content flex-1 flex flex-col overflow-hidden bg-bg-primary">
         {/* 终端头部：只在非 FileViewer 模式下显示 */}
         {hasActiveProject && !showFileViewer && (
            <div className="shrink-0 bg-bg-secondary border-b border-border">
               <div className="h-8 flex items-center px-2 gap-1">
                  <div className="flex-1 min-w-0">
                     <TerminalTabBar
                        tabs={tabs}
                        activeTabId={activeTabId}
                        onActivateTab={onActivateTab}
                        onCloseTab={onCloseTab}
                        onAddTab={onAddTab}
                     />
                  </div>
               </div>

               {showAgentBarContent && (
                  <div className="h-8 px-2 pb-1 flex items-center gap-1">
                     {/* Gear button */}
                     <div className="relative shrink-0" ref={managerRef}>
                        <button
                            className="tb-icon-btn flex items-center justify-center w-6 h-6 rounded-md transition-colors text-text-secondary hover:bg-white/10 hover:text-white"
                            style={{ fontSize: "var(--terminal-font-size)" }}
                           onClick={() => setManagerOpen((v) => !v)}
                           title="Manage Presets"
                        >
                           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37 1 .608 2.296.07 2.573-1.066z" />
                              <circle cx="12" cy="12" r="3" />
                           </svg>
                        </button>
                        {/* Manage Presets dropdown */}
                        {managerOpen && (
                           <div
                              className="absolute left-0 top-full mt-1 z-50 min-w-[180px] max-h-[280px] overflow-y-auto rounded-md border border-border bg-bg-secondary shadow-lg py-1"
                           >
                              {allEnabledAgents.map((agent) => {
                                 const pinned = !hiddenAgentIds.includes(agent.id);
                                 return (
                                    <div
                                       key={agent.id}
                                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer text-text-primary"
                                        style={{ fontSize: "var(--terminal-font-size)" }}
                                       onClick={() => onToggleHiddenAgent(agent.id)}
                                    >
                                       <AgentIcon icon={agent.icon} />
                                       <span className="flex-1 truncate">{agent.name}</span>
                                       {pinned ? (
                                          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-text-secondary shrink-0">
                                             <path d="M9.828.722a.5.5 0 01.354.146l4.95 4.95a.5.5 0 010 .707c-.48.48-1.307.848-2.21.988V14.5a.5.5 0 01-.5.5h-2a.5.5 0 01-.5-.5v-2.5H6v2.5a.5.5 0 01-.5.5h-2a.5.5 0 01-.5-.5V6.81c-.903-.14-1.73-.508-2.21-.988a.5.5 0 010-.707l4.95-4.95a.5.5 0 01.354-.146z" />
                                          </svg>
                                       ) : (
                                          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-white/10 text-text-secondary text-[10px] leading-none shrink-0">+</span>
                                       )}
                                    </div>
                                 );
                              })}
                           </div>
                        )}
                     </div>
                     {/* Agent buttons */}
                     <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0 h-6">
                     {enabledAgents.map((agent) => {
                        const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true);
                        const selected = currentAgentId === agent.id;
                        return (
                           <button
                              key={agent.id}
                               className={`tb-icon-btn flex items-center gap-1.5 px-2 h-6 rounded-md transition-colors ${selected ? "text-white bg-white/10" : "text-text-secondary hover:bg-white/10 hover:text-white"} ${!installed ? "opacity-50" : ""}`}
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
               )}
            </div>
         )}

         {activeWslProject && !activeProject && (
            <div className="content-area flex-1 overflow-hidden flex flex-col">
               {wslDiffState ? (
                  <DiffView
                     diffSource={{ type: "wsl", distro: wslDiffState.distro, projectPath: wslDiffState.projectPath }}
                     filePath={wslDiffState.filePath}
                     initialMode={config.diffMode}
                     onBack={onWslDiffBack}
                  />
               ) : (
                  <div className="terminal-pane-container flex-1 flex flex-row overflow-hidden min-h-0 p-0 m-0">
                     <WSLTerminalView
                        distro={activeWslProject.distro}
                        projectId={activeWslProject.project.id}
                        projectName={activeWslProject.project.name}
                        projectPath={activeWslWorktreePath ?? activeWslProject.project.path}
                        fontSize={config.terminalFontSize}
                        fontFamily={config.fontFamily}
                        cacheKeySuffix={
                           activeWslWorktreePath ? `:wt:${btoa(activeWslWorktreePath).replace(/=/g, "")}` : ""
                        }
                        selectedAgentId={activeWslProject.project.selected_agent}
                        onSessionReady={onWslSessionReady}
                     />
                  </div>
               )}
            </div>
         )}

         {activeRemoteProject && !activeProject && !activeWslProject && (
            <RemoteProjectView
               entry={activeRemoteProject.entry}
               project={activeRemoteProject.project}
               remoteAuthStore={remoteAuthStore}
               remoteDiffState={remoteDiffState}
               config={config}
               onRemoteDiffBack={onRemoteDiffBack}
               activeRemoteWorktreePath={activeRemoteWorktreePath}
               onRemoteSessionReady={onRemoteSessionReady}
            />
         )}

          {activeProject ? (
             <div className="content-area flex-1 overflow-hidden flex flex-col">
                {showFileViewer ? (
                   <FileViewer
                      tabs={fileTabs}
                      activeTabId={activeFileTabId}
                      theme={config.theme}
                      fontFamily={config.fontFamily}
                      editorFontSize={config.editorFontSize}
                      onSave={onFileSave}
                      onCloseTab={onFileCloseTab}
                      onActivateTab={onFileActivateTab}
                      onContentChange={onFileContentChange}
                   />
                ) : worktreeDiffState ? (
                  <DiffView
                     diffSource={{
                        type: "worktree",
                        projectId: activeProject.id,
                        worktreePath: worktreeDiffState.worktreePath,
                     }}
                     filePath={worktreeDiffState.filePath}
                     initialMode={config.diffMode}
                     onBack={onWorktreeDiffBack}
                  />
               ) : isTerminalView || activeWorktreePath ? (
                  <div className="terminal-pane-container flex-1 flex flex-row overflow-hidden min-h-0 p-0 m-0">
                     {!activeWorktreePath && (
                        <TerminalView
                           project={activeProject}
                           tabId={activeTabId}
                           tabAgentId={activeTabAgentId}
                           fontSize={config.terminalFontSize}
                           shell={config.shell}
                           fontFamily={config.fontFamily}
                           suppressResizeRef={suppressResizeRef}
                           agentCommandOverride={
                              config.agentCommandOverrides?.[
                              activeTabAgentId ?? activeProject.selected_agent ?? ""
                              ]
                           }
                           onTabStatusChange={handleTerminalTabStatusChange}
                        />
                     )}

                     {activeWorktreePath && (
                        <WorktreeTerminalView
                           projectId={activeProject.id}
                           projectName={activeProject.name}
                           worktreePath={activeWorktreePath}
                           worktreeBranch={activeWorktreeBranch}
                           selectedAgent={activeProject.selected_agent}
                           fontSize={config.terminalFontSize}
                           shell={config.shell}
                           fontFamily={config.fontFamily}
                        />
                     )}
                  </div>
               ) : diffFilePath ? (
                  <DiffView
                     projectId={activeProject.id}
                     filePath={diffFilePath}
                     initialMode={config.diffMode}
                     onBack={() => handleSelectProject(activeProject.id)}
                  />
               ) : null}
            </div>
         ) : !activeWslProject && !activeRemoteProject ? (
            <div className="empty-state flex-1 flex flex-col text-text-secondary">
               <div className="empty-body flex-1 flex flex-col items-center justify-center gap-4">
                  <div className="empty-icon text-[3.43em] opacity-50">📁</div>
                  <h2 className="text-2xl font-semibold text-text-primary">Welcome to Neeko</h2>
                  <p className="text-[var(--font-size)]">Select a project or add a new one to get started</p>
                  <button
                     className="add-project-btn mt-2 px-6 py-2.5 bg-accent-blue border-none rounded-md text-white text-[var(--font-size)] font-medium cursor-pointer transition-colors duration-200 hover:bg-[#005a9e]"
                     onClick={handleAddProject}
                  >
                     Add Project
                  </button>
               </div>
            </div>
         ) : null}
      </div>
   );
}

export default React.memo(MainContent);
