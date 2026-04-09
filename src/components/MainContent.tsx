import React, { useCallback } from "react";
import { TerminalView, destroyTerminalCache, SideTerminalView, WorktreeTerminalView, WSLTerminalView } from "./terminal";
import DiffView from "./DiffView";
import RemoteProjectView from "./RemoteProjectView";
import type { Project, WSLProject, RemoteProject, RemoteEntrySession, AuthMethod, AppConfig } from "../types";


interface MainContentProps {
  config: AppConfig;
  // local
  activeProject: Project | null;
  activeWorktreePath: string | null;
  activeWorktreeBranch: string;
  sideTerminalOpenSet: Set<string>;
  sideTerminalWidth: number;
  handleSideDividerMouseDown: (e: React.MouseEvent) => void;
  setSideTerminalOpen: (updater: (prev: Set<string>) => Set<string>) => void;
  focusedSideTerminalIndex: string | null;
  onFocusSideTerminal: (index: string | null) => void;
  handleSelectProject: (projectId: string) => void;
  handleAddProject: () => void;
  // wsl
  activeWslProject: { distro: string; project: WSLProject } | null;
  activeWslWorktreePath: string | null;
  wslSideTerminalOpen: Set<string>;
  setWslSideTerminalOpen: (updater: (prev: Set<string>) => Set<string>) => void;
  setWslOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;
  // remote
  activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
  activeRemoteWorktreePath: string | null;
  remoteAuthStore: Map<string, AuthMethod>;
  remoteSideTerminalOpen: Set<string>;
  setRemoteSideTerminalOpen: (updater: (prev: Set<string>) => Set<string>) => void;
  setRemoteOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;
  // diff state
  wslDiffState: { distro: string; projectPath: string; filePath: string } | null;
  remoteDiffState: { entryId: string; host: string; port: number; username: string; auth: AuthMethod; projectPath: string; filePath: string } | null;
  onWslDiffBack: () => void;
  onRemoteDiffBack: () => void;
  suppressResizeRef?: React.MutableRefObject<boolean>;
}

function MainContent({
  config,
  activeProject,
  activeWorktreePath,
  activeWorktreeBranch,
  sideTerminalOpenSet,
  sideTerminalWidth,
  handleSideDividerMouseDown,
  setSideTerminalOpen,
  focusedSideTerminalIndex,
  onFocusSideTerminal,
  handleSelectProject,
  handleAddProject,
  activeWslProject,
  activeWslWorktreePath,
  wslSideTerminalOpen,
  setWslSideTerminalOpen,
  setWslOpenSessions,
  activeRemoteProject,
  activeRemoteWorktreePath,
  remoteAuthStore,
  remoteSideTerminalOpen,
  setRemoteSideTerminalOpen,
  setRemoteOpenSessions,
  wslDiffState,
  remoteDiffState,
  onWslDiffBack,
  onRemoteDiffBack,
  suppressResizeRef,
}: MainContentProps) {
  // 稳定的 onSessionReady 回调，避免 WSL/Remote TerminalView 因回调引用变化重渲染
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
              // worktree 模式使用不同缓存键，避免与主终端冲突
              cacheKeySuffix={activeWslWorktreePath ? `:wt:${btoa(activeWslWorktreePath).replace(/=/g, '')}` : ""}
              selectedAgentId={activeWslProject.project.selected_agent}
              onSessionReady={onWslSessionReady}
            />
            {wslSideTerminalOpen.has(activeWslProject.project.id) && (
              <>
                <div
                  className="terminal-pane-divider"
                  onMouseDown={handleSideDividerMouseDown}
                />
                <WSLTerminalView
                  distro={activeWslProject.distro}
                  projectId={activeWslProject.project.id}
                  projectName={activeWslProject.project.name}
                  projectPath={activeWslWorktreePath ?? activeWslProject.project.path}
                  fontSize={config.fontSize}
                  fontFamily={config.fontFamily}
                  cacheKeySuffix={activeWslWorktreePath ? `:side:wt:${btoa(activeWslWorktreePath).replace(/=/g, '')}` : ":side"}
                  sideMode
                  width={sideTerminalWidth}
                  onClose={() =>
                    setWslSideTerminalOpen(prev => {
                      const n = new Set(prev);
                      n.delete(activeWslProject.project.id);
                      return n;
                    })
                  }
                />
              </>
            )}
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
          remoteSideTerminalOpen={remoteSideTerminalOpen}
          setRemoteSideTerminalOpen={setRemoteSideTerminalOpen}
          handleSideDividerMouseDown={handleSideDividerMouseDown}
          sideTerminalWidth={sideTerminalWidth}
          onRemoteSessionReady={onRemoteSessionReady}
        />
      )}

      {/* 本地项目视图 */}
      {activeProject ? (
        <div className="content-area">
          {isTerminalView || activeWorktreePath ? (
            <div className="terminal-pane-container">
              {/* 主终端（始终挂载，worktree 终端激活时隐藏） */}
              <div style={{ display: activeWorktreePath ? "none" : "contents" }}>
                <TerminalView
                  project={activeProject}
                  fontSize={config.fontSize}
                  shell={config.shell}
                  fontFamily={config.fontFamily}
                  suppressResizeRef={suppressResizeRef}
                  agentCommandOverride={config.agentCommandOverrides?.[activeProject.selected_agent ?? ""]}
                />
              </div>
              {/* Worktree 终端 */}
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
              {sideTerminalOpenSet.size > 0 && !activeWorktreePath && (
                <>
                  <div
                    className="terminal-pane-divider"
                    onMouseDown={handleSideDividerMouseDown}
                  />
                  <div className="side-terminal-grid-container" style={{ width: sideTerminalWidth }}>
                    {Array.from(sideTerminalOpenSet).map((indexStr) => {
                      const index = parseInt(indexStr, 10);
                      return (
                        <SideTerminalView
                          key={`${activeProject.id}:side:${index}`}
                          project={activeProject}
                          fontSize={config.fontSize}
                          shell={config.shell}
                          fontFamily={config.fontFamily}
                          onClose={() => setSideTerminalOpen(prev => {
                            const n = new Set(prev);
                            n.delete(indexStr);
                            return n;
                          })}
                          onDestroy={() => destroyTerminalCache(`${activeProject.id}:side:${index}`)}
                          index={index}
                          terminalCount={sideTerminalOpenSet.size}
                          isFocused={focusedSideTerminalIndex === indexStr}
                          onFocus={() => onFocusSideTerminal(indexStr)}
                        />
                      );
                    })}
                  </div>
                </>
              )}
              {sideTerminalOpenSet.size > 0 && activeWorktreePath && (
                <>
                  <div
                    className="terminal-pane-divider"
                    onMouseDown={handleSideDividerMouseDown}
                  />
                  <div className="side-terminal-grid-container" style={{ width: sideTerminalWidth }}>
                    {Array.from(sideTerminalOpenSet).map((indexStr) => {
                      const index = parseInt(indexStr, 10);
                      return (
                        <SideTerminalView
                          key={`${activeProject.id}:side:${index}`}
                          project={activeProject}
                          fontSize={config.fontSize}
                          shell={config.shell}
                          fontFamily={config.fontFamily}
                          onClose={() => setSideTerminalOpen(prev => {
                            const n = new Set(prev);
                            n.delete(indexStr);
                            return n;
                          })}
                          onDestroy={() => destroyTerminalCache(`${activeProject.id}:side:${index}`)}
                          index={index}
                          worktreePath={activeWorktreePath}
                          terminalCount={sideTerminalOpenSet.size}
                          isFocused={focusedSideTerminalIndex === indexStr}
                          onFocus={() => onFocusSideTerminal(indexStr)}
                        />
                      );
                    })}
                  </div>
                </>
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
