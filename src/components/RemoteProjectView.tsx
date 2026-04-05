import React from "react";
import { RemoteTerminalView } from "./terminal";
import DiffView from "./DiffView";
import type { RemoteEntrySession, RemoteProject, AuthMethod, AppConfig } from "../types";

interface RemoteProjectViewProps {
  entry: RemoteEntrySession;
  project: RemoteProject;
  remoteAuthStore: Map<string, AuthMethod>;
  remoteDiffState: { entryId: string; host: string; port: number; username: string; auth: AuthMethod; projectPath: string; filePath: string } | null;
  config: AppConfig;
  onRemoteDiffBack: () => void;
  activeRemoteWorktreePath: string | null;
  remoteSideTerminalOpen: Set<string>;
  setRemoteSideTerminalOpen: (updater: (prev: Set<string>) => Set<string>) => void;
  handleSideDividerMouseDown: (e: React.MouseEvent) => void;
  sideTerminalWidth: number;
  onRemoteSessionReady: (pid: string) => void;
}

function RemoteProjectView({
  entry,
  project,
  remoteAuthStore,
  remoteDiffState,
  config,
  onRemoteDiffBack,
  activeRemoteWorktreePath,
  remoteSideTerminalOpen,
  setRemoteSideTerminalOpen,
  handleSideDividerMouseDown,
  sideTerminalWidth,
  onRemoteSessionReady,
}: RemoteProjectViewProps) {
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
      {remoteDiffState ? (
        <DiffView
          diffSource={{
            type: "remote",
            entryId: remoteDiffState.entryId,
            host: remoteDiffState.host,
            port: remoteDiffState.port,
            username: remoteDiffState.username,
            auth: remoteDiffState.auth,
            projectPath: remoteDiffState.projectPath,
          }}
          filePath={remoteDiffState.filePath}
          initialMode={config.diffMode}
          onBack={onRemoteDiffBack}
        />
      ) : (
        <div className="terminal-pane-container">
          <RemoteTerminalView
            entryId={entry.id}
            projectId={project.id}
            projectName={project.name}
            projectPath={activeRemoteWorktreePath ?? project.path}
            host={entry.host}
            port={entry.port}
            username={entry.username}
            auth={auth}
            fontSize={config.fontSize}
            fontFamily={config.fontFamily}
            cacheKeySuffix={activeRemoteWorktreePath ? `:wt:${btoa(activeRemoteWorktreePath).replace(/=/g, '')}` : ""}
            selectedAgentId={project.selected_agent}
            onSessionReady={onRemoteSessionReady}
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
                projectPath={activeRemoteWorktreePath ?? project.path}
                host={entry.host}
                port={entry.port}
                username={entry.username}
                auth={auth}
                fontSize={config.fontSize}
                fontFamily={config.fontFamily}
                cacheKeySuffix={activeRemoteWorktreePath ? `:side:wt:${btoa(activeRemoteWorktreePath).replace(/=/g, '')}` : ":side"}
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
      )}
    </div>
  );
}

export default React.memo(RemoteProjectView);
