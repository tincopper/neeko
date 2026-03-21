import React, { useCallback, useRef, useState } from "react";
import { Project } from "../../types";
import ProjectItem from "./ProjectItem";
import GitDialog, { DialogState } from "./GitDialog";

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

interface ProjectSidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  onAddProject: () => void;
  onRemoveProject: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectFile: (projectId: string, filePath: string) => void;
  onRefreshGit: (projectId: string) => void;
  onOpenSettings: () => void;
  loading: boolean;
}

const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  projects,
  activeProjectId,
  onAddProject,
  onRemoveProject,
  onSelectProject,
  onSelectFile,
  onRefreshGit,
  onOpenSettings,
  loading,
}) => {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(280);

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
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [updateWidth]);

  return (
    <>
      <div className="sidebar">
        <div className="sidebar-resize-handle" onMouseDown={onMouseDown} />
        <div className="project-list">
          {projects.length === 0 ? (
            <div className="no-projects">No projects added</div>
          ) : (
            projects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                isActive={activeProjectId === project.id}
                onSelectProject={onSelectProject}
                onRemoveProject={onRemoveProject}
                onSelectFile={onSelectFile}
                onRefreshGit={onRefreshGit}
                onOpenDialog={setDialog}
              />
            ))
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
