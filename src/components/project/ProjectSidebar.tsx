import React, { useCallback, useRef, useState } from "react";
import { Project, WSLEntrySession, WSLProject, RemoteEntrySession, RemoteProject, AgentConfig, AppConfig } from "../../types";
import { IS_WINDOWS } from "../../utils/platform";
import ProjectItem from "./ProjectItem";
import GitDialog, { DialogState } from "./GitDialog";
import { WSLItem, RemoteItem, ActiveWslKey, ActiveRemoteKey } from "../connections/RemoteItems";

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

interface ProjectSidebarProps {
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
  onOpenSettings: () => void;
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
  initialSidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
  suppressResizeRef?: React.MutableRefObject<boolean>;
  loading: boolean;
  ideCommandOverrides?: Record<string, string>;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (projectId: string, agentId: string | null, ideCommand: string | null) => void;
  onDragEnd?: (draggedId: string, targetId: string) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
}

const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
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
  onOpenSettings: _onOpenSettings,
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
  initialSidebarWidth,
  onSidebarWidthChange,
  suppressResizeRef,
  loading: _loading,
  ideCommandOverrides,
  agents,
  config,
  onSaveProjectSettings,
  onDragEnd,
  onShowToast,
}) => {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  // Wrapper to accept WSL/Remote dialog objects (type is string literal union at runtime)
  const handleOpenDialog = useCallback((d: { type: string; source: { type: string; distro?: string; entryId?: string; projectPath: string }; branches: string[] }) => {
    setDialog(d as DialogState);
  }, []);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(initialSidebarWidth ?? 280);

  // 初始化 CSS 变量（随 initialSidebarWidth 变化更新，处理异步 load_session 返回后的情况）
  React.useEffect(() => {
    if (initialSidebarWidth) {
      document.documentElement.style.setProperty("--sidebar-width", `${Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, initialSidebarWidth))}px`);
    }
  }, [initialSidebarWidth]);

  const updateWidth = useCallback((w: number) => {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
    document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    const current = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width") || "280"
    );
    startWidth.current = current;
    if (suppressResizeRef) suppressResizeRef.current = true;

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      updateWidth(startWidth.current + (e.clientX - startX.current));
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (suppressResizeRef) suppressResizeRef.current = false;
      // 拖拽结束后持久化
      if (onSidebarWidthChange) {
        const final = parseInt(
          getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width") || "280"
        );
        onSidebarWidthChange(final);
      }
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [updateWidth, onSidebarWidthChange, suppressResizeRef]);

  const isEmpty = projects.length === 0
    && (IS_WINDOWS ? wslEntries.length === 0 : true)
    && remoteEntries.length === 0;

  return (
    <>
      <div className="sidebar">
        <div className="sidebar-resize-handle" onMouseDown={onMouseDown} />
        <div className="project-list">
          {isEmpty ? (
            <div className="no-projects">No projects added</div>
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
                  onOpenSettings={_onOpenSettings}
                  onRefresh={onRefreshGit}
                  agents={agents}
                  config={config}
                  onSaveProjectSettings={onSaveProjectSettings}
                  onDragEnd={onDragEnd}
                  onShowToast={onShowToast}
                />
              ))}

              {/* WSL 发行版 */}
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
                  onOpenSettings={_onOpenSettings}
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

              {/* SSH 远程服务器 */}
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
                  onOpenSettings={_onOpenSettings}
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

export default React.memo(ProjectSidebar);
