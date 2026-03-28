import React, { useCallback, useRef, useState } from "react";
import { Project, WSLEntrySession, WSLProject, RemoteEntrySession, RemoteProject } from "../../types";
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
  onOpenWorktreeTerminal?: (worktreePath: string, branch: string) => void;
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
  initialSidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
  suppressResizeRef?: React.MutableRefObject<boolean>;
  loading: boolean;
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
  initialSidebarWidth,
  onSidebarWidthChange,
  suppressResizeRef,
  loading: _loading,
}) => {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(initialSidebarWidth ?? 280);

  // 初始化 CSS 变量
  React.useEffect(() => {
    if (initialSidebarWidth) {
      document.documentElement.style.setProperty("--sidebar-width", `${Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, initialSidebarWidth))}px`);
    }
  }, []);

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
        />
      )}
    </>
  );
};

export default ProjectSidebar;
