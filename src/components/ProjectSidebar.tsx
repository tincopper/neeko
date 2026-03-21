import React from "react";

interface FileChange {
  path: string;
  status: "Modified" | "Added" | "Deleted" | "Renamed" | "Untracked";
  additions: number;
  deletions: number;
}

interface Project {
  id: string;
  name: string;
  path: string;
  git_info: {
    current_branch: string;
    branches: string[];
    worktrees: any[];
    changed_files: FileChange[];
    is_clean: boolean;
  } | null;
  terminal: {
    id: string;
    pid: number | null;
    status: "Idle" | "Running" | "Failed";
    history: string[];
    agent: any;
  };
  selected_agent: string | null;
  active_view: { Terminal: {} } | { Diff: { file_path: string } };
}

interface ProjectSidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  onAddProject: () => void;
  onRemoveProject: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectFile: (projectId: string, filePath: string) => void;
  onRefreshGit: (projectId: string) => void;
  loading: boolean;
}

const getStatusColor = (status: "Idle" | "Running" | "Failed"): string => {
  switch (status) {
    case "Idle":
      return "status-idle";
    case "Running":
      return "status-running";
    case "Failed":
      return "status-failed";
    default:
      return "status-idle";
  }
};

const getFileStatusIcon = (status: FileChange["status"]): string => {
  switch (status) {
    case "Modified":
      return "M";
    case "Added":
      return "A";
    case "Deleted":
      return "D";
    case "Renamed":
      return "R";
    case "Untracked":
      return "?";
    default:
      return " ";
  }
};

const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  projects,
  activeProjectId,
  onAddProject,
  onRemoveProject,
  onSelectProject,
  onSelectFile,
  onRefreshGit,
  loading,
}) => {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h3>Projects</h3>
        <button
          className="add-btn"
          onClick={onAddProject}
          disabled={loading}
          title="Add Project"
        >
          {loading ? "..." : "+"}
        </button>
      </div>

      <div className="project-list">
        {projects.length === 0 ? (
          <div className="no-projects">No projects added</div>
        ) : (
          projects.map((project) => (
            <div
              key={project.id}
              className={`project-item ${activeProjectId === project.id ? "active" : ""}`}
            >
              <div
                className="project-header"
                onClick={() => onSelectProject(project.id)}
              >
                <span className={`status-indicator ${getStatusColor(project.terminal.status)}`} />
                <span className="project-name">{project.name}</span>
                <button
                  className="refresh-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshGit(project.id);
                  }}
                  title="Refresh"
                >
                  🔄
                </button>
                <button
                  className="remove-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveProject(project.id);
                  }}
                  title="Remove"
                >
                  ×
                </button>
              </div>

              {project.git_info && (
                <div className="git-info">
                  <div className="branch-info">
                    <span className="branch-icon">⎇</span>
                    <span className="branch-name">{project.git_info.current_branch}</span>
                  </div>

                  {project.git_info.changed_files.length > 0 && (
                    <div className="changed-files">
                      {project.git_info.changed_files.map((file, index) => (
                        <div
                          key={index}
                          className="file-item"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectFile(project.id, file.path);
                          }}
                        >
                          <span className={`file-status status-${file.status.toLowerCase()}`}>
                            {getFileStatusIcon(file.status)}
                          </span>
                          <span className="file-path" title={file.path}>
                            {file.path.split("/").pop()}
                          </span>
                          <span className="file-changes">
                            <span className="additions">+{file.additions}</span>
                            <span className="deletions">-{file.deletions}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ProjectSidebar;
