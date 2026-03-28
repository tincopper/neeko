import React from "react";
import { TerminalView, destroyTerminalCache, SideTerminalView, WorktreeTerminalView, WSLTerminalView, RemoteTerminalView } from "./terminal";
import DiffView from "./DiffView";
import type { Project, WSLProject, RemoteProject, RemoteEntrySession, AuthMethod, AppConfig } from "../types";


interface MainContentProps {
  config: AppConfig;
  // local
  activeProject: Project | null;
  activeWorktreePath: string | null;
  activeWorktreeBranch: string;
  sideTerminalOpen: boolean;
  sideTerminalWidth: number;
  handleSideDividerMouseDown: (e: React.MouseEvent) => void;
  setSideTerminalOpen: (open: boolean) => void;
  handleSelectProject: (projectId: string) => void;
  handleAddProject: () => void;
  // wsl
  activeWslProject: { distro: string; project: WSLProject } | null;
  wslSideTerminalOpen: Set<string>;
  setWslSideTerminalOpen: (updater: (prev: Set<string>) => Set<string>) => void;
  setWslOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;
  // remote
  activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
  remoteAuthStore: Map<string, AuthMethod>;
  remoteSideTerminalOpen: Set<string>;
  setRemoteSideTerminalOpen: (updater: (prev: Set<string>) => Set<string>) => void;
  setRemoteOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;
  suppressResizeRef?: React.MutableRefObject<boolean>;
}

function MainContent({
  config,
  activeProject,
  activeWorktreePath,
  activeWorktreeBranch,
  sideTerminalOpen,
  sideTerminalWidth,
  handleSideDividerMouseDown,
  setSideTerminalOpen,
  handleSelectProject,
  handleAddProject,
  activeWslProject,
  wslSideTerminalOpen,
  setWslSideTerminalOpen,
  setWslOpenSessions,
  activeRemoteProject,
  remoteAuthStore,
  remoteSideTerminalOpen,
  setRemoteSideTerminalOpen,
  setRemoteOpenSessions,
  suppressResizeRef,
}: MainContentProps) {
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
          <div className="terminal-pane-container">
            <WSLTerminalView
              distro={activeWslProject.distro}
              projectId={activeWslProject.project.id}
              projectName={activeWslProject.project.name}
              projectPath={activeWslProject.project.path}
              fontSize={config.fontSize}
              fontFamily={config.fontFamily}
              selectedAgentId={activeWslProject.project.selected_agent}
              onSessionReady={(pid) => {
                setWslOpenSessions(prev => new Set(prev).add(pid));
              }}
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
                  projectPath={activeWslProject.project.path}
                  fontSize={config.fontSize}
                  fontFamily={config.fontFamily}
                  cacheKeySuffix=":side"
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
        </div>
      )}

      {/* SSH 终端视图 */}
      {activeRemoteProject && !activeProject && !activeWslProject && (() => {
        const { entry, project } = activeRemoteProject;
        const auth = remoteAuthStore.get(entry.id);
        if (!auth) {
          return (
            <div className="empty-state">
              <div className="empty-body">
                <div className="empty-icon">🔑</div>
                <h2>Authentication required</h2>
                <p>Waiting for credentials...</p>
              </div>
            </div>
          );
        }
        return (
          <div className="content-area">
            <div className="terminal-pane-container">
              <RemoteTerminalView
                entryId={entry.id}
                projectId={project.id}
                projectName={project.name}
                projectPath={project.path}
                host={entry.host}
                port={entry.port}
                username={entry.username}
                auth={auth}
                fontSize={config.fontSize}
                fontFamily={config.fontFamily}
                selectedAgentId={project.selected_agent}
                onSessionReady={(pid) => {
                  setRemoteOpenSessions(prev => new Set(prev).add(pid));
                }}
              />
              {remoteSideTerminalOpen.has(project.id) && (
                <>
                  <div
                    className="terminal-pane-divider"
                    onMouseDown={handleSideDividerMouseDown}
                  />
                  <RemoteTerminalView
                    entryId={entry.id}
                    projectId={project.id}
                    projectName={project.name}
                    projectPath={project.path}
                    host={entry.host}
                    port={entry.port}
                    username={entry.username}
                    auth={auth}
                    fontSize={config.fontSize}
                    fontFamily={config.fontFamily}
                    cacheKeySuffix=":side"
                    sideMode
                    width={sideTerminalWidth}
                    onClose={() =>
                      setRemoteSideTerminalOpen(prev => {
                        const n = new Set(prev);
                        n.delete(project.id);
                        return n;
                      })
                    }
                  />
                </>
              )}
            </div>
          </div>
        );
      })()}

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
                  agentCommandOverrides={config.agentCommandOverrides}
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
              {sideTerminalOpen && !activeWorktreePath && (
                <>
                  <div
                    className="terminal-pane-divider"
                    onMouseDown={handleSideDividerMouseDown}
                  />
                  <SideTerminalView
                    project={activeProject}
                    fontSize={config.fontSize}
                    shell={config.shell}
                    fontFamily={config.fontFamily}
                    onClose={() => setSideTerminalOpen(false)}
                    onDestroy={() => destroyTerminalCache(`${activeProject.id}:side`)}
                    width={sideTerminalWidth}
                  />
                </>
              )}
              {sideTerminalOpen && activeWorktreePath && (
                <>
                  <div
                    className="terminal-pane-divider"
                    onMouseDown={handleSideDividerMouseDown}
                  />
                  <SideTerminalView
                    project={activeProject}
                    fontSize={config.fontSize}
                    shell={config.shell}
                    fontFamily={config.fontFamily}
                    onClose={() => setSideTerminalOpen(false)}
                    onDestroy={() => destroyTerminalCache(`${activeProject.id}:side:${activeWorktreePath}`)}
                    width={sideTerminalWidth}
                    worktreePath={activeWorktreePath}
                  />
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
