import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import ProjectSidebar from "./components/ProjectSidebar";
import TerminalView from "./components/TerminalView";
import DiffView from "./components/DiffView";
import AgentSelector from "./components/AgentSelector";
import "./styles.css";

interface Project {
  id: string;
  name: string;
  path: string;
  git_info: {
    current_branch: string;
    branches: string[];
    worktrees: any[];
    changed_files: any[];
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

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (activeProjectId) {
      const project = projects.find((p) => p.id === activeProjectId);
      setActiveProject(project || null);
    } else {
      setActiveProject(null);
    }
  }, [activeProjectId, projects]);

  const log = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    console.log(`[${ts}] [App] ${msg}`);
  };

  const loadProjects = async () => {
    try {
      log("Loading projects...");
      const projectList = await invoke<Project[]>("list_projects");
      log(`Loaded ${projectList.length} projects`);
      setProjects(projectList);
    } catch (error) {
      console.error("[App] Failed to load projects:", error);
    }
  };

  const handleAddProject = async () => {
    log("Add Project button clicked");
    try {
      log("Opening directory dialog...");
      const selected = await invoke<string | null>("open_directory_dialog");
      log(`Dialog result: ${selected}`);

      if (selected) {
        setLoading(true);
        log(`Adding project: ${selected}`);
        const project = await invoke<Project>("add_project", { path: selected });
        log(`Project added: ${project.name} (${project.id})`);
        setProjects(prev => [...prev, project]);
        setActiveProjectId(project.id);
        setActiveProject(project);  // 直接设置，避免批量更新问题
        log("Active project set directly");
      } else {
        log("Dialog returned null, showing manual input");
        setShowManualInput(true);
      }
    } catch (error) {
      console.error("[App] Failed to open dialog:", error);
      log("Dialog error, showing manual input");
      setShowManualInput(true);
    } finally {
      setLoading(false);
    }
  };

  const handleManualAdd = async () => {
    if (!manualPath.trim()) return;
    log(`Manual add: ${manualPath}`);

    try {
      setLoading(true);
      log(`Adding project from manual path: ${manualPath}`);
      const project = await invoke<Project>("add_project", { path: manualPath.trim() });
      log(`Project added: ${project.name} (${project.id})`);
      setProjects(prev => [...prev, project]);
      setActiveProjectId(project.id);
      setActiveProject(project);  // 直接设置，避免批量更新问题
      setManualPath("");
      setShowManualInput(false);
      log("Active project set directly");
    } catch (error) {
      console.error("[App] Failed to add project:", error);
      alert("Failed to add project: " + error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveProject = async (projectId: string) => {
    log(`Removing project: ${projectId}`);
    try {
      await invoke("remove_project", { projectId });
      setProjects(projects.filter((p) => p.id !== projectId));
      if (activeProjectId === projectId) {
        setActiveProjectId(projects.length > 1 ? projects[0].id : null);
      }
      log("Project removed");
    } catch (error) {
      console.error("[App] Failed to remove project:", error);
    }
  };

  const handleSelectProject = async (projectId: string) => {
    log(`Project selected: ${projectId}`);
    const project = projects.find(p => p.id === projectId);
    log(`Project name: ${project?.name}, path: ${project?.path}`);
    setActiveProjectId(projectId);
    if (project) {
      setActiveProject(project);
      log("Active project set directly");
    }
    await invoke("set_active_project", { projectId });
    await invoke("set_view_terminal", { projectId });
    await loadProjects();
    log("View switched to terminal");
  };

  const handleSelectFile = async (projectId: string, filePath: string) => {
    log(`File selected: ${filePath} in project ${projectId}`);
    await invoke("set_view_diff", { projectId, filePath });
    await loadProjects();
  };

  const handleRefreshGit = async (projectId: string) => {
    try {
      await invoke("refresh_git_info", { projectId });
      await loadProjects();
    } catch (error) {
      console.error("Failed to refresh git info:", error);
    }
  };

  const isTerminalView = activeProject?.active_view?.Terminal !== undefined;
  const diffFilePath = activeProject?.active_view?.Diff?.file_path || null;

  return (
    <div className="app-container">
      <ProjectSidebar
        projects={projects}
        activeProjectId={activeProjectId}
        onAddProject={handleAddProject}
        onRemoveProject={handleRemoveProject}
        onSelectProject={handleSelectProject}
        onSelectFile={handleSelectFile}
        onRefreshGit={handleRefreshGit}
        loading={loading}
      />

      <div className="main-content">
        {activeProject ? (
          <>
            <div className="header-bar">
              <div className="project-info">
                <span className="project-name">{activeProject.name}</span>
                {activeProject.git_info && (
                  <span className="branch-name">
                    {activeProject.git_info.current_branch}
                  </span>
                )}
              </div>
              <AgentSelector projectId={activeProject.id} />
            </div>

            <div className="content-area">
              {isTerminalView ? (
                <TerminalView project={activeProject} />
              ) : diffFilePath ? (
                <DiffView
                  projectId={activeProject.id}
                  filePath={diffFilePath}
                  onBack={() => handleSelectProject(activeProject.id)}
                />
              ) : null}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">📁</div>
            <h2>Welcome to Neeko</h2>
            <p>Select a project or add a new one to get started</p>
            <button className="add-project-btn" onClick={handleAddProject}>
              Add Project
            </button>
          </div>
        )}
      </div>

      {/* Manual Path Input Modal */}
      {showManualInput && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Add Project</h3>
            <p>Enter the full path to your project directory:</p>
            <input
              type="text"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/home/user/projects/my-project"
              className="path-input"
              onKeyDown={(e) => e.key === "Enter" && handleManualAdd()}
            />
            <div className="modal-actions">
              <button
                className="cancel-btn"
                onClick={() => {
                  setShowManualInput(false);
                  setManualPath("");
                }}
              >
                Cancel
              </button>
              <button
                className="confirm-btn"
                onClick={handleManualAdd}
                disabled={!manualPath.trim() || loading}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
