import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import ProjectSidebar from "./components/project";
import TerminalView, { launchAgentInTerminal } from "./components/TerminalView";
import DiffView from "./components/DiffView";
import AgentSelector from "./components/AgentSelector";
import WindowControls from "./components/WindowControls";
import SettingsPanel, { AppConfig } from "./components/SettingsPanel";
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
  active_view: "Terminal" | { Diff: { file_path: string } };
}

interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  icon: string | null;
  enabled: boolean;
}

const DEFAULT_CONFIG: AppConfig = {
  fontSize: 14,
  diffMode: "unified",
  shell: "",
};

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);

  // 全局配置（持久化）
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 同步字体大小到 CSS 变量
  useEffect(() => {
    document.documentElement.style.setProperty("--font-size", `${config.fontSize}px`);
  }, [config.fontSize]);

  // 持久化保存配置
  const saveConfig = async (next: AppConfig) => {
    setConfig(next);
    try {
      await invoke("save_config", { config: next });
    } catch (e) {
      console.error("[App] Failed to save config:", e);
    }
  };

  // 添加项目时的 agent 选择 modal
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [selectedNewAgentId, setSelectedNewAgentId] = useState<string | null>(null);
  const [pendingAgentOpen, setPendingAgentOpen] = useState(false);
  const pendingAgentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pendingAgentOpen) return;
    const handler = (e: MouseEvent) => {
      if (pendingAgentRef.current && !pendingAgentRef.current.contains(e.target as Node)) {
        setPendingAgentOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pendingAgentOpen]);

  // 快捷键：Ctrl+1~9 切换到对应项目，Ctrl+Q 循环切换
  const selectProjectRef = useRef<(id: string) => void>(() => {});

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;

      if (e.code === "KeyQ") {
        e.preventDefault();
        if (projects.length === 0) return;
        const currentIndex = projects.findIndex(p => p.id === activeProjectId);
        const nextIndex = (currentIndex + 1) % projects.length;
        selectProjectRef.current(projects[nextIndex].id);
        return;
      }

      const match = e.code.match(/^Digit([1-9])$/);
      if (match) {
        e.preventDefault();
        const target = projects[parseInt(match[1]) - 1];
        if (target) selectProjectRef.current(target.id);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [projects, activeProjectId]);

  // 应用启动时加载配置、agents、projects
  useEffect(() => {
    (async () => {
      try {
        const saved = await invoke<Record<string, any>>("load_config");
        if (saved && typeof saved === "object") {
          setConfig({
            fontSize: typeof saved.fontSize === "number" ? saved.fontSize : DEFAULT_CONFIG.fontSize,
            diffMode: saved.diffMode === "split" ? "split" : "unified",
            shell: typeof saved.shell === "string" ? saved.shell : DEFAULT_CONFIG.shell,
          });
        }
      } catch (e) {
        console.error("[App] Failed to load config:", e);
      }
    })();
    loadAgents();
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

  const loadProjects = async () => {
    try {
      const projectList = await invoke<Project[]>("list_projects");
      setProjects(projectList);
    } catch (error) {
      console.error("[App] Failed to load projects:", error);
    }
  };

  const loadAgents = async () => {
    try {
      const agentList = await invoke<AgentConfig[]>("list_agents");
      setAgents(agentList);
    } catch (error) {
      console.error("[App] Failed to load agents:", error);
    }
  };

  const handleAddProject = async () => {
    try {
      setLoading(true);
      await loadAgents();
      const selected = await invoke<string | null>("open_directory_dialog");
      if (selected) {
        const exists = projects.some(p => p.path === selected);
        if (exists) {
          alert(`Project already added: ${selected}`);
          return;
        }
        setSelectedNewAgentId(null);
        setPendingPath(selected);
      }
    } catch (error) {
      console.error("[App] Failed to open dialog:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAddProject = async () => {
    if (!pendingPath) return;
    try {
      setLoading(true);
      const project = await invoke<Project>("add_project", {
        path: pendingPath,
        agentId: selectedNewAgentId,
      });
      await invoke("save_session").catch(() => {});
      setProjects(prev => [...prev, project]);
      setActiveProjectId(project.id);
      setActiveProject(project);
    } catch (error) {
      console.error("[App] Failed to add project:", error);
    } finally {
      setLoading(false);
      setPendingPath(null);
    }
  };

  const handleRemoveProject = async (projectId: string) => {
    try {
      await invoke("remove_project", { projectId });
      setProjects(projects.filter((p) => p.id !== projectId));
      if (activeProjectId === projectId) {
        setActiveProjectId(projects.length > 1 ? projects[0].id : null);
      }
    } catch (error) {
      console.error("[App] Failed to remove project:", error);
    }
  };

  const handleSelectProject = async (projectId: string) => {
    setActiveProjectId(projectId);
    await invoke("set_active_project", { projectId });
    await invoke("set_view_terminal", { projectId });
    await loadProjects();
  };
  selectProjectRef.current = handleSelectProject;

  const handleSelectFile = async (projectId: string, filePath: string) => {
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

  const isTerminalView = activeProject?.active_view === "Terminal";
  const diffFilePath =
    typeof activeProject?.active_view === "object"
      ? (activeProject.active_view as { Diff: { file_path: string } }).Diff?.file_path || null
      : null;

  return (
    <div className="app-root">
      {/* 唯一标题栏：跨整个窗口宽度 */}
      <div className="titlebar" data-tauri-drag-region>
        {/* 左侧：NEEKO + 设置 + Add Project */}
        <div className="titlebar-left" data-tauri-drag-region>
          <span className="titlebar-appname" data-tauri-drag-region>NEEKO</span>
          <button className="tb-icon-btn" onClick={() => setSettingsOpen(v => !v)} title="Settings">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
          <button className="tb-icon-btn" onClick={handleAddProject} disabled={loading} title="Add Project">
            {loading ? "…" : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            )}
          </button>
        </div>

        {/* 分隔线 */}
        <div className="titlebar-divider" data-tauri-drag-region />

        {/* 右侧：项目名/分支 + AgentSelector + 窗口控制 */}
        <div className="titlebar-right" data-tauri-drag-region>
          {activeProject ? (
            <>
              <span className="titlebar-project-name" data-tauri-drag-region>{activeProject.name}</span>
              {activeProject.git_info && (
                <span className="titlebar-branch" data-tauri-drag-region>{activeProject.git_info.current_branch}</span>
              )}
              <AgentSelector
                projectId={activeProject.id}
                currentAgentId={activeProject.selected_agent}
                onSelectAgent={(agent) => {
                  if (agent) {
                    launchAgentInTerminal(activeProject.id, agent.command, agent.args);
                  }
                  invoke("save_session").catch(() => {});
                }}
              />
            </>
          ) : (
            <span className="titlebar-placeholder" data-tauri-drag-region />
          )}
          <WindowControls />
        </div>
      </div>

      {/* 主体：侧栏 + 内容区，无独立标题行 */}
      <div className="app-container">
        <ProjectSidebar
          projects={projects}
          activeProjectId={activeProjectId}
          onAddProject={handleAddProject}
          onRemoveProject={handleRemoveProject}
          onSelectProject={handleSelectProject}
          onSelectFile={handleSelectFile}
          onRefreshGit={handleRefreshGit}
          onOpenSettings={() => setSettingsOpen(v => !v)}
          loading={loading}
        />

        <div className="main-content">
          {activeProject ? (
            <div className="content-area">
              {isTerminalView ? (
                <TerminalView project={activeProject} fontSize={config.fontSize} shell={config.shell} />
              ) : diffFilePath ? (
                <DiffView
                  projectId={activeProject.id}
                  filePath={diffFilePath}
                  initialMode={config.diffMode}
                  onBack={() => handleSelectProject(activeProject.id)}
                />
              ) : null}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-body">
                <div className="empty-icon">📁</div>
                <h2>Welcome to Neeko</h2>
                <p>Select a project or add a new one to get started</p>
                <button className="add-project-btn" onClick={handleAddProject}>
                  Add Project
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Settings Panel */}
        {settingsOpen && (
          <SettingsPanel
            config={config}
            onConfigChange={saveConfig}
            onClose={() => setSettingsOpen(false)}
          />
        )}

        {/* 添加项目时选择 Agent 的 modal */}
        {pendingPath && (
          <div className="modal-overlay">
            <div className="modal" key={pendingPath}>
              <h3>Add Project</h3>
              <p className="modal-path">{pendingPath}</p>
              <label className="gh-dialog-label" style={{ marginTop: 12 }}>Agent</label>
              <div className="agent-selector" ref={pendingAgentRef} style={{ width: "100%", marginTop: 4 }}>
                <button
                  className="agent-dropdown-btn"
                  style={{ width: "100%" }}
                  onClick={() => setPendingAgentOpen(v => !v)}
                >
                  {selectedNewAgentId ? (
                    <>
                      <span className="agent-icon">{agents.find(a => a.id === selectedNewAgentId)?.icon || "🤖"}</span>
                      <span className="agent-name">{agents.find(a => a.id === selectedNewAgentId)?.name}</span>
                    </>
                  ) : (
                    <>
                      <span className="agent-icon">⚡</span>
                      <span className="agent-name">None</span>
                    </>
                  )}
                  <span className="dropdown-arrow" style={{ marginLeft: "auto" }}>{pendingAgentOpen ? "▲" : "▼"}</span>
                </button>
                {pendingAgentOpen && (
                  <div className="agent-dropdown" style={{ left: 0, right: 0, minWidth: "unset" }}>
                    <div
                      className={`agent-option${!selectedNewAgentId ? " selected" : ""}`}
                      onClick={() => { setSelectedNewAgentId(null); setPendingAgentOpen(false); }}
                    >
                      <span className="agent-icon">⚡</span>
                      <span className="agent-name">None</span>
                    </div>
                    {agents.filter(a => a.enabled).map(agent => (
                      <div
                        key={agent.id}
                        className={`agent-option${selectedNewAgentId === agent.id ? " selected" : ""}`}
                        onClick={() => { setSelectedNewAgentId(agent.id); setPendingAgentOpen(false); }}
                      >
                        <span className="agent-icon">{agent.icon || "🤖"}</span>
                        <span className="agent-name">{agent.name}</span>
                        <span className="agent-command">{agent.command}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button className="cancel-btn" onClick={() => setPendingPath(null)}>
                  Cancel
                </button>
                <button className="confirm-btn" onClick={handleConfirmAddProject} disabled={loading}>
                  Add Project
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
