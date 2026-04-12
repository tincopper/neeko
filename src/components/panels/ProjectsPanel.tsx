import React, { useCallback, useState } from "react";
import { Project, WSLEntrySession, WSLProject, RemoteEntrySession, RemoteProject } from "../../types";
import { IS_WINDOWS } from "../../utils/platform";
import { useAppContext } from "../../context/app-context";
import ProjectItem from "../project/ProjectItem";
import GitDialog, { DialogState } from "../project/GitDialog";
import { WSLItem, RemoteItem, ActiveWslKey, ActiveRemoteKey } from "../connections/RemoteItems";

interface ProjectsPanelProps {
  projects: Project[];
  activeProjectId: string | null;
  wslEntries: WSLEntrySession[];
  remoteEntries: RemoteEntrySession[];
  activeWslKey: ActiveWslKey;
  activeRemoteKey: ActiveRemoteKey;
  wslOpenSessions: Set<string>;
  remoteOpenSessions: Set<string>;
  onAddProject: () => void;
  onRemoveProject: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectFile: (projectId: string, filePath: string) => void;
  onRefreshGit: (projectId: string) => void;
  onBackToMainTerminal: (projectId: string) => void;
  onOpenIde?: (projectId: string) => void;
  onOpenSideTerminal?: (projectId: string) => void;
  onOpenWorktreeTerminal?: (projectId: string, worktreePath: string, branch: string) => void;
  onSelectWorktreeFile?: (worktreePath: string, filePath: string) => void;
  onSelectWslProject: (distro: string, project: WSLProject) => void;
  onCloseWslProject: (entryId: string, projectId: string) => void;
  onRemoveWslProject: (entryId: string, projectId: string) => void;
  onRemoveWslEntry: (entryId: string) => void;
  onAddWslProject: (entryId: string) => void;
  onSelectRemoteProject: (host: string, project: RemoteProject) => void;
  onCloseRemoteProject: (entryId: string, projectId: string) => void;
  onRemoveRemoteProject: (entryId: string, projectId: string) => void;
  onRemoveRemoteEntry: (entryId: string) => void;
  onAddRemoteProject: (entryId: string) => void;
  onOpenWslSideTerminal?: (entryId: string, projectId: string) => void;
  onOpenRemoteSideTerminal?: (entryId: string, projectId: string) => void;
  onSelectWslFile?: (distro: string, projectPath: string, filePath: string) => void;
  onSelectRemoteFile?: (entryId: string, projectPath: string, filePath: string) => void;
  onRefreshWslGit?: (distro: string, projectId: string, projectPath: string) => void;
  onRefreshRemoteGit?: (entryId: string, projectId: string, projectPath: string) => void;
  onOpenWslIde?: (distro: string, projectPath: string, ide: string) => void;
  onOpenRemoteIde?: (entryId: string, projectPath: string, ide: string) => void;
  onOpenWslWorktreeTerminal?: (distro: string, worktreePath: string, branch: string) => void;
  onOpenRemoteWorktreeTerminal?: (entryId: string, worktreePath: string, branch: string) => void;
  invokeRemoteGit?: (command: string, entryId: string, extra: Record<string, unknown>) => Promise<unknown>;
  onSaveProjectSettings?: (projectId: string, agentId: string | null, ideCommand: string | null) => void;
  onDragEnd?: (draggedId: string, targetId: string) => void;
}

const ProjectsPanel: React.FC<ProjectsPanelProps> = ({
  projects,
  activeProjectId,
  wslEntries,
  remoteEntries,
  activeWslKey,
  activeRemoteKey,
  wslOpenSessions,
  remoteOpenSessions,
  onAddProject: _onAddProject,
  onRemoveProject,
  onSelectProject,
  onSelectFile,
  onRefreshGit,
  onBackToMainTerminal,
  onOpenIde,
  onOpenSideTerminal,
  onOpenWorktreeTerminal,
  onSelectWorktreeFile,
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
  onOpenWslSideTerminal,
  onOpenRemoteSideTerminal,
  onSelectWslFile,
  onSelectRemoteFile,
  onRefreshWslGit,
  onRefreshRemoteGit,
  onOpenWslIde,
  onOpenRemoteIde,
  onOpenWslWorktreeTerminal,
  onOpenRemoteWorktreeTerminal,
  invokeRemoteGit,
  onSaveProjectSettings,
  onDragEnd,
}) => {
  const { config, agents, ideCommandOverrides, showToast } = useAppContext();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  // Wrapper to accept WSL/Remote dialog objects (type is string literal union at runtime)
  const handleOpenDialog = useCallback((d: { type: string; source: { type: string; distro?: string; entryId?: string; projectPath: string }; branches: string[] }) => {
    setDialog(d as DialogState);
  }, []);

  const isEmpty = projects.length === 0
    && (IS_WINDOWS ? wslEntries.length === 0 : true)
    && remoteEntries.length === 0;

  return (
    <>
      <div className="flex flex-col flex-1">
        {isEmpty ? (
          <div className="no-projects p-5 text-center text-text-muted text-[0.86em]">No projects added</div>
        ) : (
          <>
            {/* 本地项目 */}
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
                onOpenSideTerminal={onOpenSideTerminal}
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

            {/* WSL 发行�?*/}
            {IS_WINDOWS && wslEntries.map((entry) => (
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
                onOpenSideTerminal={onOpenWslSideTerminal}
                onSelectFile={onSelectWslFile}
                onRefreshGit={onRefreshWslGit}
                onOpenIde={onOpenWslIde}
                onOpenWorktreeTerminal={onOpenWslWorktreeTerminal}
                onOpenDialog={handleOpenDialog}
                ideCommandOverrides={ideCommandOverrides}
                onRefresh={onRefreshWslGit ? (distro, projectId) => {
                  const e = wslEntries.find(en => en.distro === distro);
                  const p = e?.projects.find(pr => pr.id === projectId);
                  if (p) onRefreshWslGit(distro, p.id, p.path);
                } : undefined}
                agents={agents}
                config={config}
                onSaveProjectSettings={onSaveProjectSettings ? (agentId, ideCmd) => {
                  const e = wslEntries.find(en => en.distro === activeWslKey?.distro);
                  const p = e?.projects.find(pr => pr.id === activeWslKey?.projectId);
                  if (p) onSaveProjectSettings(p.id, agentId, ideCmd);
                } : undefined}
              />
            ))}

            {/* SSH 远程服务�?*/}
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
                onOpenSideTerminal={onOpenRemoteSideTerminal}
                onSelectFile={onSelectRemoteFile}
                onRefreshGit={onRefreshRemoteGit}
                onOpenIde={onOpenRemoteIde}
                onOpenWorktreeTerminal={onOpenRemoteWorktreeTerminal}
                invokeRemoteGit={invokeRemoteGit}
                onOpenDialog={handleOpenDialog}
                ideCommandOverrides={ideCommandOverrides}
                onRefresh={onRefreshRemoteGit ? (entryId, projectId) => {
                  const e = remoteEntries.find(en => en.id === entryId);
                  const p = e?.projects.find(pr => pr.id === projectId);
                  if (p) onRefreshRemoteGit(entryId, p.id, p.path);
                } : undefined}
                agents={agents}
                config={config}
                onSaveProjectSettings={onSaveProjectSettings ? (agentId, ideCmd) => {
                  const e = remoteEntries.find(en => en.id === activeRemoteKey?.host);
                  const p = e?.projects.find(pr => pr.id === activeRemoteKey?.projectId);
                  if (p) onSaveProjectSettings(p.id, agentId, ideCmd);
                } : undefined}
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
          onRefreshAfterWslSsh={dialog.source ? (() => {
            const src = dialog.source!;
            if (src.type === "wsl" && src.distro && onRefreshWslGit) {
              // 找到 projectId：从 wslEntries 中按 projectPath 匹配
              const entry = wslEntries.find(e => e.distro === src.distro);
              const project = entry?.projects.find(p => p.path === src.projectPath);
              if (entry && project) {
                onRefreshWslGit(src.distro, project.id, src.projectPath);
              }
            } else if (src.type === "remote" && src.entryId && onRefreshRemoteGit) {
              const entry = remoteEntries.find(e => e.id === src.entryId);
              const project = entry?.projects.find(p => p.path === src.projectPath);
              if (entry && project) {
                onRefreshRemoteGit(src.entryId, project.id, src.projectPath);
              }
            }
          }) : undefined}
        />
      )}
    </>
  );
};

export default React.memo(ProjectsPanel);
