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
   onRemoteSessionReady,
}: RemoteProjectViewProps) {
   const auth = remoteAuthStore.get(entry.id);
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
               <RemoteTerminalView
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
            </div>
         )}
      </div>
   );
}

export default React.memo(RemoteProjectView);