import React, { useCallback } from "react";
import { RemoteTerminalView, SplitLayout } from "./terminal";
import DiffView from "./DiffView";
import { useAppContext, useRemoteContext } from "../contexts";

function RemoteProjectView() {
   const { config } = useAppContext();
   const {
      activeRemoteProject,
      remoteAuthStore,
      remoteDiffState,
      onRemoteDiffBack,
      activeRemoteWorktreePath,
      setRemoteOpenSessions,
   } = useRemoteContext();

   if (!activeRemoteProject) {
      return null;
   }

   const { entry, project } = activeRemoteProject;
   const remoteLayoutId = `remote:${entry.id}:${project.id}:${activeRemoteWorktreePath ?? "main"}`;
   const auth = remoteAuthStore.get(entry.id);

   const onRemoteSessionReady = useCallback(
      (pid: string) => {
         setRemoteOpenSessions((prev) => new Set(prev).add(pid));
      },
      [setRemoteOpenSessions]
   );

   if (!auth) {
      return (
         <div className="empty-state flex-1 flex flex-col text-text-secondary">
            <div className="empty-body flex-1 flex flex-col items-center justify-center gap-4">
               <div className="empty-icon text-[3.43em] opacity-50">🔑</div>
               <h2 className="text-2xl font-semibold text-text-primary">Authentication required</h2>
               <p className="text-[var(--font-size)]">Waiting for credentials...</p>
            </div>
         </div>
      );
   }

   return (
      <div className="content-area flex-1 overflow-hidden flex flex-col">
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
            <div className="terminal-pane-container flex-1 flex flex-row overflow-hidden min-h-0 p-0 m-0">
               <SplitLayout
                  layoutId={remoteLayoutId}
                  renderPane={(paneId) => (
                     <RemoteTerminalView
                        paneId={paneId}
                        entryId={entry.id}
                        projectId={project.id}
                        projectName={project.name}
                        projectPath={activeRemoteWorktreePath ?? project.path}
                        host={entry.host}
                        port={entry.port}
                        username={entry.username}
                        auth={auth}
                        fontSize={config.terminalFontSize}
                        fontFamily={config.fontFamily}
                        cacheKeySuffix={activeRemoteWorktreePath ? `:wt:${btoa(activeRemoteWorktreePath).replace(/=/g, '')}` : ""}
                        selectedAgentId={project.selected_agent}
                        onSessionReady={onRemoteSessionReady}
                     />
                  )}
               />
            </div>
         )}
      </div>
   );
}

export default React.memo(RemoteProjectView);
