import React, { useCallback, useState, useEffect, useMemo } from "react";
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
import { useProjectStore } from "../../store/projectStore";
import { useAheadBehindSync } from "../../hooks/useAheadBehindSync";

const ProjectsPanel: React.FC = () => {
   const { config, agents, ideCommandOverrides, showToast } = useAppContext();
   const projects = useProjectStore((state) => state.projects);
   const activeProjectId = useProjectStore((state) => state.activeProjectId);
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
      onSelectWslProject,
      onRemoveWslProject,
      onRemoveWslEntry,
      onAddWslProject,
      onRefreshWslGit,
      onOpenWslIde,
      onOpenWslWorktreeTerminal,
      onWslDragEnd,
   } = useWslContext();
   const {
      remoteEntries,
      activeRemoteKey,
      onSelectRemoteProject,
      onRemoveRemoteProject,
      onRemoveRemoteEntry,
      onAddRemoteProject,
      onRefreshRemoteGit,
      onOpenRemoteIde,
      onOpenRemoteWorktreeTerminal,
      invokeRemoteGit,
      onRemoteDragEnd,
   } = useRemoteContext();

   const [dialog, setDialog] = useState<DialogState | null>(null);
   const [commitProjectId, setCommitProjectId] = useState<string | null>(null);
   const [remoteHomeDir, setRemoteHomeDir] = useState<string>("");

   useAheadBehindSync();

   useEffect(() => {
      if (!dialog || dialog.type !== "new-worktree" || dialog.source?.type !== "remote" || !dialog.source.entryId || !invokeRemoteGit) {
         setRemoteHomeDir("");
         return;
      }
      invokeRemoteGit("get_remote_home_dir", dialog.source.entryId, {})
         .then((dir) => setRemoteHomeDir(dir as string))
         .catch(() => setRemoteHomeDir(""));
   }, [dialog, invokeRemoteGit]);

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

   /**
    * isLast 派生：整个 ProjectsPanel 中位于绝对末尾的项目卡才不画 hairline。
    * 顺序：local 项目 → WSL section（按 entry，按 project）→ Remote section（按 entry，按 project）。
    */
   const lastCardId = useMemo<{ kind: "local" | "wsl" | "remote"; entryId?: string; projectId: string } | null>(() => {
      const wslEnabled = IS_WINDOWS;
      // Reverse search: remote → wsl → local
      for (let i = remoteEntries.length - 1; i >= 0; i--) {
         const entry = remoteEntries[i];
         if (entry.projects.length > 0) {
            return { kind: "remote", entryId: entry.id, projectId: entry.projects[entry.projects.length - 1].id };
         }
      }
      if (wslEnabled) {
         for (let i = wslEntries.length - 1; i >= 0; i--) {
            const entry = wslEntries[i];
            if (entry.projects.length > 0) {
               return { kind: "wsl", entryId: entry.id, projectId: entry.projects[entry.projects.length - 1].id };
            }
         }
      }
      if (projects.length > 0) {
         return { kind: "local", projectId: projects[projects.length - 1].id };
      }
      return null;
   }, [projects, wslEntries, remoteEntries]);

   return (
      <>
         <div className="flex flex-col flex-1">
            {isEmpty ? (
               <div className="no-projects p-5 text-center text-text-muted text-[0.86em]">No projects added</div>
            ) : (
               <>
                  {projects.map((project) => {
                     const isLast =
                        lastCardId?.kind === "local" && lastCardId.projectId === project.id;
                     return (
                     <ProjectItem
                        key={project.id}
                        project={project}
                        isActive={activeProjectId === project.id}
                        isLast={isLast}
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
                     );
                  })}

                  {IS_WINDOWS &&
                     wslEntries.map((entry) => (
                        <WSLItem
                           key={entry.id}
                           entry={entry}
                           activeKey={activeWslKey}
                           lastProjectId={
                              lastCardId?.kind === "wsl" && lastCardId.entryId === entry.id
                                 ? lastCardId.projectId
                                 : null
                           }
                           onSelectProject={onSelectWslProject}
                           onRemoveProject={onRemoveWslProject}
                           onRemoveEntry={onRemoveWslEntry}
                           onAddProject={onAddWslProject}
                           onOpenIde={onOpenWslIde}
                           onOpenWorktreeTerminal={onOpenWslWorktreeTerminal}
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
                             onDragEnd={onWslDragEnd}
                          />
                      ))}

                   {remoteEntries.map((entry) => (
                     <RemoteItem
                        key={entry.id}
                        entry={entry}
                        activeKey={activeRemoteKey}
                        lastProjectId={
                           lastCardId?.kind === "remote" && lastCardId.entryId === entry.id
                              ? lastCardId.projectId
                              : null
                        }
                        onSelectProject={onSelectRemoteProject}
                        onRemoveProject={onRemoveRemoteProject}
                        onRemoveEntry={onRemoveRemoteEntry}
                        onAddProject={onAddRemoteProject}
                        onOpenIde={onOpenRemoteIde}
                        onOpenWorktreeTerminal={onOpenRemoteWorktreeTerminal}
                        invokeRemoteGit={invokeRemoteGit}
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
                          onDragEnd={onRemoteDragEnd}
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
