import React, { useCallback, useState } from "react";
import { IS_WINDOWS } from "../../utils/platform";
import { useAppContext } from "../../context/app-context";
import { useProjectContext } from "../../context/project-context";
import { useConnectionContext } from "../../context/connection-context";
import ProjectItem from "../project/ProjectItem";
import GitDialog, { DialogState } from "../project/GitDialog";
import { WSLItem, RemoteItem } from "../connections/RemoteItems";

const ProjectsPanel: React.FC = () => {
   const { config, agents, ideCommandOverrides, showToast } = useAppContext();
   const {
      projects,
      activeProjectId,
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
   } = useProjectContext();
   const {
      wslEntries,
      remoteEntries,
      activeWslKey,
      activeRemoteKey,
      wslOpenSessions,
      remoteOpenSessions,
      onSelectWslProject,
      onCloseWslProject,
      onRemoveWslProject,
      onRemoveWslEntry,
      onAddWslProject,
      onSelectRemoteProject,
      onCloseRemoteProject,
      onRemoveRemoteProject,
      onRemoveRemoteEntry,
      onAddRemoteProject,
      onSelectWslFile,
      onSelectRemoteFile,
      onRefreshWslGit,
      onRefreshRemoteGit,
      onOpenWslIde,
      onOpenRemoteIde,
      onOpenWslWorktreeTerminal,
      onOpenRemoteWorktreeTerminal,
      invokeRemoteGit,
   } = useConnectionContext();

   const [dialog, setDialog] = useState<DialogState | null>(null);

   const handleOpenDialog = useCallback(
      (d: { type: string; source: { type: string; distro?: string; entryId?: string; projectPath: string }; branches: string[] }) => {
         setDialog(d as DialogState);
      },
      []
   );

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
                        onSelectProject={onSelectProject}
                        onRemoveProject={onRemoveProject}
                        onSelectFile={onSelectFile}
                        onRefreshGit={onRefreshGit}
                        onBackToMainTerminal={onBackToMainTerminal}
                        onOpenDialog={setDialog}
                        onOpenIde={onOpenIde}
                        onOpenWorktreeTerminal={onOpenWorktreeTerminal}
                        onSelectWorktreeFile={onSelectWorktreeFile}
                        ideCommandOverrides={ideCommandOverrides}
                        onRefresh={onRefreshGit}
                        agents={agents}
                        config={config}
                        onSaveProjectSettings={onSaveProjectSettings}
                        onDragEnd={onDragEnd}
                        onShowToast={showToast}
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
      </>
   );
};

export default React.memo(ProjectsPanel);
