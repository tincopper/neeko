import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ProjectSidebar from "./components/project";
import TerminalView, { launchAgentInTerminal } from "./components/TerminalView";
import SideTerminalView from "./components/SideTerminalView";
import WorktreeTerminalView from "./components/WorktreeTerminalView";
import DiffView from "./components/DiffView";
import AgentSelector from "./components/AgentSelector";
import WindowControls from "./components/WindowControls";
import SettingsPanel, { AppConfig } from "./components/SettingsPanel";
import { IDE_PRESETS, getIdeCommand } from "./utils/idePresets";
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
  selected_ide: string | null;
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
  fontFamily: "",
  customIdes: [],
  ideCommandOverrides: {},
};

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);

  // Toast 通知
  const [toast, setToast] = useState<{
    message: string;
    type: "info" | "error";
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string, type: "info" | "error" = "info") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  };

  // 全局配置（持久化）
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Side Terminal 状态（每个项目独立）
  const [sideTerminalOpen, setSideTerminalOpen] = useState(false);

  // Worktree 终端状态（per-project，切换项目时保留各自状态）
  // key = projectId
  const [worktreeStateMap, setWorktreeStateMap] = useState<Record<string, {
    activePath: string | null;
    activeBranch: string;
    opened: { path: string; branch: string }[];
  }>>({});
  const activeWorktreePathRef = useRef<string | null>(null);
  const openedWorktreesRef = useRef<{ path: string; branch: string }[]>([]);
  // 稳定 ref，供 Ctrl+N 等 useEffect 闭包直接读取当前项目 ID
  const activeProjectIdRef = useRef<string | null>(null);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

  // 从 Map 中读取当前项目的 worktree 状态
  const currentWtState = activeProjectId ? (worktreeStateMap[activeProjectId] ?? { activePath: null, activeBranch: "", opened: [] }) : { activePath: null, activeBranch: "", opened: [] };
  const activeWorktreePath = currentWtState.activePath;
  const activeWorktreeBranch = currentWtState.activeBranch;
  const openedWorktrees = currentWtState.opened;

  // 稳定的 worktree state 更新函数（通过 ref 读取 projectId，避免闭包陷阱）
  const updateWtPath = (path: string | null, branch: string) => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    setWorktreeStateMap(prev => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? { activePath: null, activeBranch: "", opened: [] }), activePath: path, activeBranch: branch },
    }));
  };

  const setActiveWorktreePath = (path: string | null) => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    setWorktreeStateMap(prev => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? { activePath: null, activeBranch: "", opened: [] }), activePath: path },
    }));
  };

  const setActiveWorktreeBranch = (branch: string) => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    setWorktreeStateMap(prev => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? { activePath: null, activeBranch: "", opened: [] }), activeBranch: branch },
    }));
  };

  const setOpenedWorktrees = (updater: { path: string; branch: string }[] | ((prev: { path: string; branch: string }[]) => { path: string; branch: string }[])) => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    setWorktreeStateMap(prev => {
      const cur = prev[pid] ?? { activePath: null, activeBranch: "", opened: [] };
      const newOpened = typeof updater === "function" ? updater(cur.opened) : updater;
      return { ...prev, [pid]: { ...cur, opened: newOpened } };
    });
  };

  // Side Terminal 宽度（拖拽调整）
  const [sideTerminalWidth, setSideTerminalWidth] = useState(480);
  const sideResizingRef = useRef(false);
  const sideResizeStartX = useRef(0);
  const sideResizeStartWidth = useRef(480);
  const MIN_SIDE_WIDTH = 200;
  const MAX_SIDE_WIDTH = 1200;

  const handleSideDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    sideResizingRef.current = true;
    sideResizeStartX.current = e.clientX;
    sideResizeStartWidth.current = sideTerminalWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!sideResizingRef.current) return;
      // 向左拖动增大宽度（divider 在 side terminal 左侧）
      const delta = sideResizeStartX.current - ev.clientX;
      const next = Math.min(
        MAX_SIDE_WIDTH,
        Math.max(MIN_SIDE_WIDTH, sideResizeStartWidth.current + delta),
      );
      setSideTerminalWidth(next);
    };
    const onMouseUp = () => {
      sideResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };
  // 切换项目时关闭 side terminal
  const prevProjectIdRef = useRef<string | null>(null);

  // 同步字体大小到 CSS 变量
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--font-size",
      `${config.fontSize}px`,
    );
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

  // 添加项目时的 agent / IDE 选择 modal
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [selectedNewAgentId, setSelectedNewAgentId] = useState<string | null>(
    null,
  );
  const [pendingAgentOpen, setPendingAgentOpen] = useState(false);
  const pendingAgentRef = useRef<HTMLDivElement>(null);
  const [selectedNewIdeId, setSelectedNewIdeId] = useState<string | null>(null);
  const [pendingIdeOpen, setPendingIdeOpen] = useState(false);
  const pendingIdeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pendingIdeOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        pendingIdeRef.current &&
        !pendingIdeRef.current.contains(e.target as Node)
      ) {
        setPendingIdeOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pendingIdeOpen]);

  useEffect(() => {
    if (!pendingAgentOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        pendingAgentRef.current &&
        !pendingAgentRef.current.contains(e.target as Node)
      ) {
        setPendingAgentOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pendingAgentOpen]);

  // 切换项目时关闭 side terminal
  useEffect(() => {
    if (
      prevProjectIdRef.current !== null &&
      prevProjectIdRef.current !== activeProjectId
    ) {
      setSideTerminalOpen(false);
    }
    prevProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  // 快捷键：Ctrl+1~9 切换项目，Ctrl+Q 循环切换，Ctrl+Alt+T 打开 side terminal，Ctrl+W 关闭 side terminal
  const selectProjectRef = useRef<(id: string) => void>(() => {});
  const sideTerminalOpenRef = useRef(false);
  const isTerminalViewRef = useRef(false);

  // 同步 ref，让快捷键 handler 能读到最新状态（闭包中不更新）
  useEffect(() => {
    sideTerminalOpenRef.current = sideTerminalOpen;
  }, [sideTerminalOpen]);

  useEffect(() => {
    activeWorktreePathRef.current = activeWorktreePath;
  }, [activeWorktreePath]);

  useEffect(() => {
    openedWorktreesRef.current = openedWorktrees;
  }, [openedWorktrees]);

  // 打开当前项目 IDE
  const activeProjectRef = useRef<Project | null>(null);
  useEffect(() => {
    activeProjectRef.current = activeProject;
  }, [activeProject]);

  const handleOpenIde = async (project: Project) => {
    if (!project.selected_ide) {
      showToast("No IDE configured for this project", "error");
      return;
    }
    showToast(`Opening ${project.selected_ide}...`, "info");
    try {
      await invoke("open_ide", {
        ideCommand: project.selected_ide,
        projectPath: project.path,
      });
    } catch (e: any) {
      showToast(String(e), "error");
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Alt+T：在终端视图中打开 side terminal
      if (e.ctrlKey && e.altKey && e.code === "KeyT") {
        e.preventDefault();
        if (isTerminalViewRef.current) {
          setSideTerminalOpen(true);
        }
        return;
      }

      // Ctrl+N：在主终端和已打开的 worktree 终端之间循环切换
      if (e.ctrlKey && !e.altKey && e.code === "KeyN") {
        const opened = openedWorktreesRef.current;
        if (opened.length === 0) return;
        e.preventDefault();
        const cur = activeWorktreePathRef.current;
        if (cur === null) {
          const first = opened[0];
          updateWtPath(first.path, first.branch);
        } else {
          const idx = opened.findIndex((w) => w.path === cur);
          if (idx === opened.length - 1) {
            updateWtPath(null, "");
          } else {
            const next = opened[idx + 1];
            updateWtPath(next.path, next.branch);
          }
        }
        return;
      }

      // Ctrl+W：关闭 side terminal（仅当 side terminal 打开时）
      if (e.ctrlKey && !e.altKey && e.code === "KeyW") {
        if (sideTerminalOpenRef.current) {
          e.preventDefault();
          setSideTerminalOpen(false);
        }
        return;
      }

      // Ctrl+O：打开当前项目 IDE
      if (e.ctrlKey && !e.altKey && e.code === "KeyO") {
        const p = activeProjectRef.current;
        if (p) {
          e.preventDefault();
          handleOpenIde(p);
        }
        return;
      }

      if (!e.ctrlKey || e.altKey) return;

      if (e.code === "KeyQ") {
        e.preventDefault();
        if (projects.length === 0) return;
        const currentIndex = projects.findIndex(
          (p) => p.id === activeProjectId,
        );
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
            fontSize:
              typeof saved.fontSize === "number"
                ? saved.fontSize
                : DEFAULT_CONFIG.fontSize,
            diffMode: saved.diffMode === "split" ? "split" : "unified",
            shell:
              typeof saved.shell === "string"
                ? saved.shell
                : DEFAULT_CONFIG.shell,
            fontFamily:
              typeof saved.fontFamily === "string"
                ? saved.fontFamily
                : DEFAULT_CONFIG.fontFamily,
            customIdes: Array.isArray(saved.customIdes)
              ? saved.customIdes
              : DEFAULT_CONFIG.customIdes,
            ideCommandOverrides:
              saved.ideCommandOverrides &&
              typeof saved.ideCommandOverrides === "object"
                ? saved.ideCommandOverrides
                : DEFAULT_CONFIG.ideCommandOverrides,
          });
        }
      } catch (e) {
        console.error("[App] Failed to load config:", e);
      }
    })();
    loadAgents();
    loadProjects();

    // 监听后端文件变化事件，自动刷新 git 状态
    const unlistenPromise = listen<string>("git-changed", (event) => {
      const projectId = event.payload;
      invoke("refresh_git_info", { projectId })
        .then(() => loadProjects())
        .catch(() => loadProjects()); // 即使 refresh 失败也重新拉取列表
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
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
        const exists = projects.some((p) => p.path === selected);
        if (exists) {
          alert(`Project already added: ${selected}`);
          return;
        }
        setSelectedNewAgentId(null);
        setSelectedNewIdeId(null);
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
      // 将预设 ID 或自定义 ID 转换为实际命令字符串
      let ideCommand: string | null = null;
      if (selectedNewIdeId) {
        if (selectedNewIdeId.startsWith("custom:")) {
          const idx = parseInt(selectedNewIdeId.replace("custom:", ""));
          ideCommand = config.customIdes?.[idx]?.command ?? null;
        } else {
          const preset = IDE_PRESETS.find((i) => i.id === selectedNewIdeId);
          if (preset) {
            // 优先使用用户覆盖的命令
            ideCommand =
              config.ideCommandOverrides?.[preset.id] ?? getIdeCommand(preset);
          }
        }
      }
      const project = await invoke<Project>("add_project", {
        path: pendingPath,
        agentId: selectedNewAgentId,
        ide: ideCommand,
      });
      await invoke("save_session").catch(() => {});
      setProjects((prev) => [...prev, project]);
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
    if (activeProjectId !== projectId) {
      setActiveProjectId(projectId);
      await invoke("set_active_project", { projectId });
    }
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

  // 切换分支时回到主终端（若当前在 worktree 终端下）
  const handleBackToMainTerminal = (projectId: string) => {
    if (activeWorktreePath !== null) {
      setActiveWorktreePath(null);
      setActiveWorktreeBranch("");
    }
    invoke("set_view_terminal", { projectId }).catch(() => {});
  };

  const handleOpenWorktreeTerminal = (worktreePath: string, branch: string) => {
    // 激活该 worktree 终端
    setActiveWorktreePath(worktreePath);
    setActiveWorktreeBranch(branch);
    // 若尚未在已打开列表中则追加
    setOpenedWorktrees((prev) => {
      if (prev.some((w) => w.path === worktreePath)) return prev;
      return [...prev, { path: worktreePath, branch }];
    });
    // 确保 active_view 切换回 Terminal（避免 diff 视图遮挡）
    if (activeProjectId) {
      invoke("set_view_terminal", { projectId: activeProjectId }).catch(() => {});
    }
  };

  const isTerminalView = activeProject?.active_view === "Terminal";
  // 同步给快捷键 handler
  isTerminalViewRef.current = isTerminalView;
  // worktree 终端激活时也视为终端视图（Ctrl+W 等快捷键可用）
  isTerminalViewRef.current = isTerminalView || activeWorktreePath !== null;
  const diffFilePath =
    typeof activeProject?.active_view === "object"
      ? (activeProject.active_view as { Diff: { file_path: string } }).Diff
          ?.file_path || null
      : null;

  return (
    <div className="app-root">
      {/* 唯一标题栏：跨整个窗口宽度 */}
      <div className="titlebar" data-tauri-drag-region>
        {/* 左侧：NEEKO + 设置 + Add Project */}
        <div className="titlebar-left" data-tauri-drag-region>
          <span className="titlebar-appname" data-tauri-drag-region>
            NEEKO
          </span>
          <button
            className="tb-icon-btn"
            onClick={() => setSettingsOpen((v) => !v)}
            title="Settings"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle
                cx="8"
                cy="8"
                r="2.5"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            className="tb-icon-btn"
            onClick={handleAddProject}
            disabled={loading}
            title="Add Project"
          >
            {loading ? (
              "…"
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <line
                  x1="7"
                  y1="1"
                  x2="7"
                  y2="13"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <line
                  x1="1"
                  y1="7"
                  x2="13"
                  y2="7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
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
              <span className="titlebar-project-name" data-tauri-drag-region>
                {activeProject.name}
              </span>
              {activeProject.git_info && (
                <span className="titlebar-branch" data-tauri-drag-region>
                  {activeWorktreeBranch || activeProject.git_info.current_branch}
                </span>
              )}
              <AgentSelector
                projectId={activeProject.id}
                currentAgentId={activeProject.selected_agent}
                onSelectAgent={(agent) => {
                  if (agent) {
                    launchAgentInTerminal(
                      activeProject.id,
                      agent.command,
                      agent.args,
                    );
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
          onBackToMainTerminal={handleBackToMainTerminal}
          onOpenSettings={() => setSettingsOpen((v) => !v)}
          onOpenIde={(projectId) => {
            const p = projects.find((proj) => proj.id === projectId);
            if (p) handleOpenIde(p);
          }}
          onOpenSideTerminal={() => setSideTerminalOpen(true)}
          onOpenWorktreeTerminal={handleOpenWorktreeTerminal}
          loading={loading}
        />

        <div className="main-content">
          {activeProject ? (
            <div className="content-area">
              {isTerminalView || activeWorktreePath ? (
                <div className="terminal-pane-container">
                  {/* 主终端（始终挂载，worktree 终端激活时隐藏） */}
                  <div style={{ display: activeWorktreePath ? "none" : "contents" }}>
                    <TerminalView
                      project={activeProject}
                      fontSize={config.fontSize}
                      shell={config.shell}
                      fontFamily={config.fontFamily}
                    />
                  </div>
                  {/* Worktree 终端 */}
                  {activeWorktreePath && (
                    <WorktreeTerminalView
                      projectId={activeProject.id}
                      projectName={activeProject.name}
                      worktreePath={activeWorktreePath}
                      worktreeBranch={activeWorktreeBranch}
                      selectedAgent={activeProject.selected_agent}
                      fontSize={config.fontSize}
                      shell={config.shell}
                      fontFamily={config.fontFamily}
                    />
                  )}
                  {sideTerminalOpen && !activeWorktreePath && (
                    <>
                      <div
                        className="terminal-pane-divider"
                        onMouseDown={handleSideDividerMouseDown}
                      />
                      <SideTerminalView
                        project={activeProject}
                        fontSize={config.fontSize}
                        shell={config.shell}
                        fontFamily={config.fontFamily}
                        onClose={() => setSideTerminalOpen(false)}
                        width={sideTerminalWidth}
                      />
                    </>
                  )}
                  {sideTerminalOpen && activeWorktreePath && (
                    <>
                      <div
                        className="terminal-pane-divider"
                        onMouseDown={handleSideDividerMouseDown}
                      />
                      <SideTerminalView
                        project={activeProject}
                        fontSize={config.fontSize}
                        shell={config.shell}
                        fontFamily={config.fontFamily}
                        onClose={() => setSideTerminalOpen(false)}
                        width={sideTerminalWidth}
                        worktreePath={activeWorktreePath}
                      />
                    </>
                  )}
                </div>
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

        {/* 添加项目时选择 Agent 的 modal */}
        {pendingPath && (
          <div className="modal-overlay">
            <div className="modal" key={pendingPath}>
              <h3>Add Project</h3>
              <p className="modal-path">{pendingPath}</p>
              <label className="gh-dialog-label" style={{ marginTop: 12 }}>
                Agent
              </label>
              <div
                className="agent-selector"
                ref={pendingAgentRef}
                style={{ width: "100%", marginTop: 4 }}
              >
                <button
                  className="agent-dropdown-btn"
                  style={{ width: "100%" }}
                  onClick={() => setPendingAgentOpen((v) => !v)}
                >
                  {selectedNewAgentId ? (
                    <>
                      <span className="agent-icon">
                        {agents.find((a) => a.id === selectedNewAgentId)
                          ?.icon || "🤖"}
                      </span>
                      <span className="agent-name">
                        {agents.find((a) => a.id === selectedNewAgentId)?.name}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="agent-icon">⚡</span>
                      <span className="agent-name">None</span>
                    </>
                  )}
                  <span
                    className="dropdown-arrow"
                    style={{ marginLeft: "auto" }}
                  >
                    {pendingAgentOpen ? "−" : "+"}
                  </span>
                </button>
                {pendingAgentOpen && (
                  <div
                    className="agent-dropdown"
                    style={{ left: 0, right: 0, minWidth: "unset" }}
                  >
                    <div
                      className={`agent-option${!selectedNewAgentId ? " selected" : ""}`}
                      onClick={() => {
                        setSelectedNewAgentId(null);
                        setPendingAgentOpen(false);
                      }}
                    >
                      <span className="agent-icon">⚡</span>
                      <span className="agent-name">None</span>
                    </div>
                    {agents
                      .filter((a) => a.enabled)
                      .map((agent) => (
                        <div
                          key={agent.id}
                          className={`agent-option${selectedNewAgentId === agent.id ? " selected" : ""}`}
                          onClick={() => {
                            setSelectedNewAgentId(agent.id);
                            setPendingAgentOpen(false);
                          }}
                        >
                          <span className="agent-icon">
                            {agent.icon || "🤖"}
                          </span>
                          <span className="agent-name">{agent.name}</span>
                          <span className="agent-command">{agent.command}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* IDE 选择 */}
              <label className="gh-dialog-label" style={{ marginTop: 12 }}>
                IDE
              </label>
              <div
                className="agent-selector"
                ref={pendingIdeRef}
                style={{ width: "100%", marginTop: 4 }}
              >
                <button
                  className="agent-dropdown-btn"
                  style={{ width: "100%" }}
                  onClick={() => setPendingIdeOpen((v) => !v)}
                >
                  {selectedNewIdeId ? (
                    <>
                      <span className="agent-icon">
                        {selectedNewIdeId.startsWith("custom:")
                          ? "💻"
                          : IDE_PRESETS.find((i) => i.id === selectedNewIdeId)
                              ?.icon}
                      </span>
                      <span className="agent-name">
                        {selectedNewIdeId.startsWith("custom:")
                          ? config.customIdes?.[
                              parseInt(selectedNewIdeId.replace("custom:", ""))
                            ]?.name
                          : IDE_PRESETS.find((i) => i.id === selectedNewIdeId)
                              ?.name}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="agent-icon">💻</span>
                      <span className="agent-name">None</span>
                    </>
                  )}
                  <span
                    className="dropdown-arrow"
                    style={{ marginLeft: "auto" }}
                  >
                    {pendingIdeOpen ? "−" : "+"}
                  </span>
                </button>
                {pendingIdeOpen && (
                  <div
                    className="agent-dropdown"
                    style={{ left: 0, right: 0, minWidth: "unset" }}
                  >
                    <div
                      className={`agent-option${!selectedNewIdeId ? " selected" : ""}`}
                      onClick={() => {
                        setSelectedNewIdeId(null);
                        setPendingIdeOpen(false);
                      }}
                    >
                      <span className="agent-icon">💻</span>
                      <span className="agent-name">None</span>
                    </div>
                    {IDE_PRESETS.map((ide) => (
                      <div
                        key={ide.id}
                        className={`agent-option${selectedNewIdeId === ide.id ? " selected" : ""}`}
                        onClick={() => {
                          setSelectedNewIdeId(ide.id);
                          setPendingIdeOpen(false);
                        }}
                      >
                        <span className="agent-icon">{ide.icon}</span>
                        <span className="agent-name">{ide.name}</span>
                        <span className="agent-command">
                          {config.ideCommandOverrides?.[ide.id] ??
                            getIdeCommand(ide)}
                        </span>
                      </div>
                    ))}
                    {(config.customIdes || []).map((ide, idx) => {
                      const customId = `custom:${idx}`;
                      return (
                        <div
                          key={customId}
                          className={`agent-option${selectedNewIdeId === customId ? " selected" : ""}`}
                          onClick={() => {
                            setSelectedNewIdeId(customId);
                            setPendingIdeOpen(false);
                          }}
                        >
                          <span className="agent-icon">💻</span>
                          <span className="agent-name">{ide.name}</span>
                          <span className="agent-command">{ide.command}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button
                  className="cancel-btn"
                  onClick={() => setPendingPath(null)}
                >
                  Cancel
                </button>
                <button
                  className="confirm-btn"
                  onClick={handleConfirmAddProject}
                  disabled={loading}
                >
                  Add Project
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Settings Dialog — fixed overlay, outside app-container */}
      {settingsOpen && (
        <SettingsPanel
          config={config}
          onConfigChange={saveConfig}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Toast 通知 */}
      {toast && (
        <div className={`app-toast app-toast--${toast.type}`}>
          {toast.type === "info" ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm.75 4.5a.75.75 0 0 0-1.5 0v4a.75.75 0 0 0 1.5 0v-4Zm0 7a.75.75 0 0 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
            </svg>
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default App;
