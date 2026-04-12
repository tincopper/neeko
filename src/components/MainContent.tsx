import React, { useCallback } from "react";
import { TerminalView, WorktreeTerminalView, WSLTerminalView } from "./terminal";
import DiffView from "./DiffView";
import RemoteProjectView from "./RemoteProjectView";
import type { Project, WSLProject, RemoteProject, RemoteEntrySession, AuthMethod, AppConfig, TerminalTab } from "../types";


interface MainContentProps {
  config: AppConfig;
  activeProject: Project | null;
  activeWorktreePath: string | null;
  activeWorktreeBranch: string;
  handleSelectProject: (projectId: string) => void;
  handleAddProject: () => void;
  suppressResizeRef?: React.MutableRefObject<boolean>;
  // tabs
  tabs: TerminalTab[];
  activeTabId: string | null;
  onTabStatusChange?: (tabId: string, status: "Idle" | "Running" | "Failed") => void;
  // wsl
  activeWslProject: { distro: string; project: WSLProject } | null;
  activeWslWorktreePath: string | null;
  setWslOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;
  // remote
  activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
  activeRemoteWorktreePath: string | null;
  remoteAuthStore: Map<string, AuthMethod>;
  setRemoteOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;
  // diff state
  wslDiffState: { distro: string; projectPath: string; filePath: string } | null;
  remoteDiffState: { entryId: string; host: string; port: number; username: string; auth: AuthMethod; projectPath: string; filePath: string } | null;
  worktreeDiffState: { worktreePath: string; filePath: string } | null;
  onWslDiffBack: () => void;
  onRemoteDiffBack: () => void;
  onWorktreeDiffBack: () => void;
}

function MainContent({
  config,
  activeProject,
  activeWorktreePath,
  activeWorktreeBranch,
  handleSelectProject,
  handleAddProject,
  suppressResizeRef,
  tabs,
  activeTabId,
  onTabStatusChange,
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
}: MainContentProps) {
  // 获取当前 active tab 的 agentId
  const activeTab = tabs.find(t => t.id === activeTabId);
  const activeTabAgentId = activeTab?.agentId ?? null;

  // 处理 Tab 状态变化
  const handleTabStatusChange = useCallback((status: "Idle" | "Running" | "Failed") => {
    if (activeTabId) {
      onTabStatusChange?.(activeTabId, status);
    }
  }, [activeTabId, onTabStatusChange]);
  const onWslSessionReady = useCallback((pid: string) => {
    setWslOpenSessions(prev => new Set(prev).add(pid));
  }, [setWslOpenSessions]);

  const onRemoteSessionReady = useCallback((pid: string) => {
    setRemoteOpenSessions(prev => new Set(prev).add(pid));
  }, [setRemoteOpenSessions]);

  const isTerminalView = activeProject?.active_view === "Terminal";
  const diffFilePath =
    typeof activeProject?.active_view === "object"
      ? (activeProject.active_view as { Diff: { file_path: string } }).Diff
          ?.file_path || null
      : null;

  return (
    <div className="main-content">
      {/* WSL 终端视图 */}
      {activeWslProject && !activeProject && (
        <div className="content-area">
          {wslDiffState ? (
            <DiffView
              diffSource={{ type: "wsl", distro: wslDiffState.distro, projectPath: wslDiffState.projectPath }}
              filePath={wslDiffState.filePath}
              initialMode={config.diffMode}
              onBack={onWslDiffBack}
            />
          ) : (
          <div className="terminal-pane-container">
            <WSLTerminalView
              distro={activeWslProject.distro}
              projectId={activeWslProject.project.id}
              projectName={activeWslProject.project.name}
              projectPath={activeWslWorktreePath ?? activeWslProject.project.path}
              fontSize={config.fontSize}
              fontFamily={config.fontFamily}
              cacheKeySuffix={activeWslWorktreePath ? `:wt:${btoa(activeWslWorktreePath).replace(/=/g, '')}` : ""}
              selectedAgentId={activeWslProject.project.selected_agent}
              onSessionReady={onWslSessionReady}
            />
          </div>
          )}
        </div>
      )}

      {/* SSH 终端视图 */}
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

      {/* 本地项目视图 */}
      {activeProject ? (
        <div className="content-area">
          {worktreeDiffState ? (
            <DiffView
              diffSource={{ type: "worktree", projectId: activeProject.id, worktreePath: worktreeDiffState.worktreePath }}
              filePath={worktreeDiffState.filePath}
              initialMode={config.diffMode}
              onBack={onWorktreeDiffBack}
            />
          ) : isTerminalView || activeWorktreePath ? (
            <div className="terminal-pane-container">
              {!activeWorktreePath && (
                <TerminalView
                  project={activeProject}
                  tabId={activeTabId}
                  tabAgentId={activeTabAgentId}
                  fontSize={config.fontSize}
                  shell={config.shell}
                  fontFamily={config.fontFamily}
                  suppressResizeRef={suppressResizeRef}
                  agentCommandOverride={activeTabAgentId ? config.agentCommandOverrides?.[activeTabAgentId] : undefined}
                  onTabStatusChange={handleTabStatusChange}
                />
              )}
              {activeWorktreePath && (
                <WorktreeTerminalView
                  projectId={activeProject.id}
                  projectName={activeProject.name}
                  worktreePath={activeWorktreePath}
                  worktreeBranch={activeWorktreeBranch}
                  selectedAgent={activeProject.selected_agent}
                  fontSize={config.fontSize}
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
        <div className="empty-state">
          <div className="empty-body">
            <div className="empty-icon">📁</div>
            <h2>Welcome to Neeko</h2>
            <p>Select a project or add a new one to get started</p>
            <button className="add-project-btn" onClick={handleAddProject}>
              Add Project
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default React.memo(MainContent);