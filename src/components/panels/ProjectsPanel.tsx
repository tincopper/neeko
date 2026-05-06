import React, { useCallback, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IS_WINDOWS } from "../../utils/platform";
import {
   useAppContext,
   useProjectActionsContext,
   useWslContext,
   useRemoteContext,
} from "../../contexts";
import ProjectItem from "../project/ProjectItem";
import GitDialog, { DialogState } from "../project/GitDialog";
import CommitDialog from "../project/CommitDialog";
import { WSLItem, RemoteItem } from "../connections/RemoteItems";
import { useAppStore } from "../../store/appStore";

const ProjectsPanel: React.FC = () => {
   const { config, agents, ideCommandOverrides, showToast } = useAppContext();
   const projects = useAppStore((state) => state.projects);
   const activeProjectId = useAppStore((state) => state.activeProjectId);
   const {
      onRemoveProject,
      onSelectProject,
      onSelectFile,
      onRefreshGit,
      onBackToMainTerminal,
      onOpenIde,
      onOpenWorktreeTerminal,
      onSelectWorktreeFile,
      onSaveProjectSettings,
      onDragEnd,
   } = useProjectActionsContext();
   const {
      wslEntries,
      activeWslKey,
      wslOpenSessions,
      onSelectWslProject,
      onCloseWslProject,
      onRemoveWslProject,
      onRemoveWslEntry,
      onAddWslProject,
      onSelectWslFile,
      onRefreshWslGit,
      onOpenWslIde,
      onOpenWslWorktreeTerminal,
   } = useWslContext();
   const {
      remoteEntries,
      activeRemoteKey,
      remoteOpenSessions,
      onSelectRemoteProject,
      onCloseRemoteProject,
      onRemoveRemoteProject,
      onRemoveRemoteEntry,
      onAddRemoteProject,
      onSelectRemoteFile,
      onRefreshRemoteGit,
      onOpenRemoteIde,
      onOpenRemoteWorktreeTerminal,
      invokeRemoteGit,
   } = useRemoteContext();

   const [dialog, setDialog] = useState<DialogState | null>(null);
   const [commitProjectId, setCommitProjectId] = useState<string | null>(null);
   const [remoteHomeDir, setRemoteHomeDir] = useState<string>("");

   useEffect(() => {
      if (!dialog || dialog.type !== "new-worktree" || dialog.source?.type !== "remote" || !dialog.source.entryId || !invokeRemoteGit) {
         setRemoteHomeDir("");
         return;
      }
      invokeRemoteGit("get_remote_home_dir", dialog.source.entryId, {})
         .then((dir) => setRemoteHomeDir(dir as string))
         .catch(() => setRemoteHomeDir(""));
   }, [dialog, invokeRemoteGit]);

   const handleOpenDialog = useCallback(
      (d: { type: string; source: { type: string; distro?: string; entryId?: string; projectPath: string }; branches: string[] }) => {
         setDialog(d as DialogState);
      },
      []
   );

   const handleCommit = useCallback((projectId: string) => {
      setCommitProjectId(projectId);
   }, []);

   const handlePush = useCallback(async (projectId: string) => {
      try {
         await invoke("push_command", { projectId, setUpstream: false });
         onRefreshGit(projectId);
      } catch (e) {
         showToast?.(String(e), "error");
      }
   }, [onRefreshGit, showToast]);

   const handlePull = useCallback(async (projectId: string) => {
      try {
         await invoke("pull_command", { projectId });
         onRefreshGit(projectId);
      } catch (e) {
         showToast?.(String(e), "error");
      }
   }, [onRefreshGit, showToast]);

   const isEmpty =
      projects.length === 0 &&
      (IS_WINDOWS ? wslEntries.length === 0 : true) &&
      remoteEntries.length === 0;

   return (
      <>
         <div className="flex flex-col flex-1">
            {isEmpty ? (
               <div className="no-projects p-5 text-center text-text-muted text-[0.86em]">No projects added</div>
            ) : (
               <>
                  {projects.map((project) => (
                     <ProjectItem
                        key={project.id}
                        project={project}
                        isActive={activeProjectId === project.id}
                        actions={{
                           onSelectProject,
                           onRemoveProject,
                           onSelectFile,
                           onRefreshGit,
                           onBackToMainTerminal,
                           onOpenDialog: setDialog,
                           onCommit: handleCommit,
                           onPush: handlePush,
                           onPull: handlePull,
                           onOpenIde,
                           onOpenWorktreeTerminal,
                           onSelectWorktreeFile,
                           onRefresh: onRefreshGit,
                           onSaveProjectSettings,
                           onDragEnd,
                           onShowToast: showToast,
                        }}
                        viewConfig={{
                           ideCommandOverrides,
                           agents,
                           config,
                        }}
                     />
                  ))}

                  {IS_WINDOWS &&
                     wslEntries.map((entry) => (
                        <WSLItem
                           key={entry.id}
                           entry={entry}
                           activeKey={activeWslKey}
                           openSessions={wslOpenSessions}
                           onSelectProject={onSelectWslProject}
                           onCloseProject={onCloseWslProject}
                           onRemoveProject={onRemoveWslProject}
                           onRemoveEntry={onRemoveWslEntry}
                           onAddProject={onAddWslProject}
                           onSelectFile={onSelectWslFile}
                           onRefreshGit={onRefreshWslGit}
                           onOpenIde={onOpenWslIde}
                           onOpenWorktreeTerminal={onOpenWslWorktreeTerminal}
                           onOpenDialog={handleOpenDialog}
                           ideCommandOverrides={ideCommandOverrides}
                           onRefresh={
                              onRefreshWslGit
                                 ? (distro, projectId) => {
                                    const e = wslEntries.find((en) => en.distro === distro);
                                    const p = e?.projects.find((pr) => pr.id === projectId);
                                    if (p) onRefreshWslGit(distro, p.id, p.path);
                                 }
                                 : undefined
                           }
                           agents={agents}
                           config={config}
                            onSaveProjectSettings={
                               onSaveProjectSettings
                                  ? (agentId, ideCmd) => {
                                     const e = wslEntries.find((en) => en.distro === activeWslKey?.distro);
                                     const p = e?.projects.find((pr) => pr.id === activeWslKey?.projectId);
                                     if (p) onSaveProjectSettings(p.id, agentId, ideCmd);
                                  }
                                  : undefined
                            }
                            onShowToast={showToast}
                         />
                      ))}

                   {remoteEntries.map((entry) => (
                     <RemoteItem
                        key={entry.id}
                        entry={entry}
                        activeKey={activeRemoteKey}
                        openSessions={remoteOpenSessions}
                        onSelectProject={onSelectRemoteProject}
                        onCloseProject={onCloseRemoteProject}
                        onRemoveProject={onRemoveRemoteProject}
                        onRemoveEntry={onRemoveRemoteEntry}
                        onAddProject={onAddRemoteProject}
                        onSelectFile={onSelectRemoteFile}
                        onRefreshGit={onRefreshRemoteGit}
                        onOpenIde={onOpenRemoteIde}
                        onOpenWorktreeTerminal={onOpenRemoteWorktreeTerminal}
                        invokeRemoteGit={invokeRemoteGit}
                        onOpenDialog={handleOpenDialog}
                        ideCommandOverrides={ideCommandOverrides}
                        onRefresh={
                           onRefreshRemoteGit
                              ? (entryId, projectId) => {
                                 const e = remoteEntries.find((en) => en.id === entryId);
                                 const p = e?.projects.find((pr) => pr.id === projectId);
                                 if (p) onRefreshRemoteGit(entryId, p.id, p.path);
                              }
                              : undefined
                        }
                        agents={agents}
                        config={config}
                         onSaveProjectSettings={
                            onSaveProjectSettings
                               ? (agentId, ideCmd) => {
                                  const e = remoteEntries.find((en) => en.id === activeRemoteKey?.host);
                                  const p = e?.projects.find((pr) => pr.id === activeRemoteKey?.projectId);
                                  if (p) onSaveProjectSettings(p.id, agentId, ideCmd);
                               }
                               : undefined
                         }
                         onShowToast={showToast}
                      />
                   ))}
               </>
            )}
         </div>

         {dialog && (
            <GitDialog
               dialog={dialog}
               onClose={() => setDialog(null)}
               onRefreshGit={onRefreshGit}
               remoteHomeDir={remoteHomeDir}
               onRefreshAfterWslSsh={
                  dialog.source
                     ? (() => {
                        const src = dialog.source;
                        if (!src) return;
                        if (src.type === "wsl" && src.distro && onRefreshWslGit) {
                           const entry = wslEntries.find((e) => e.distro === src.distro);
                           const project = entry?.projects.find((p) => p.path === src.projectPath);
                           if (entry && project) {
                              onRefreshWslGit(src.distro, project.id, src.projectPath);
                           }
                        } else if (src.type === "remote" && src.entryId && onRefreshRemoteGit) {
                           const entry = remoteEntries.find((e) => e.id === src.entryId);
                           const project = entry?.projects.find((p) => p.path === src.projectPath);
                           if (entry && project) {
                              onRefreshRemoteGit(src.entryId, project.id, src.projectPath);
                           }
                        }
                     })
                     : undefined
               }
            />
          )}
          {commitProjectId && (
             <CommitDialog
                projectId={commitProjectId}
                onClose={() => setCommitProjectId(null)}
                onRefreshGit={onRefreshGit}
             />
          )}
       </>
   );
};

export default React.memo(ProjectsPanel);
