import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import ProjectSidebar from "./components/project";
import TerminalView, { launchAgentInTerminal, destroyTerminalCache } from "./components/TerminalView";
import SideTerminalView from "./components/SideTerminalView";
import WorktreeTerminalView from "./components/WorktreeTerminalView";
import DiffView from "./components/DiffView";
import SettingsPanel, { AppConfig } from "./components/SettingsPanel";
import { WSLDialog, RemoteDialog, RemoteAuthDialog } from "./components/WSLDialog";
import WSLTerminalView, { wslCacheKey, destroyWslCache, launchAgentInWslTerminal } from "./components/WSLTerminalView";
import RemoteTerminalView, { remoteCacheKey, destroyRemoteCache, launchAgentInRemoteTerminal } from "./components/RemoteTerminalView";
import { WSLEntrySession, WSLProject, RemoteEntrySession, RemoteProject, AuthMethod } from "./types";
import type { ActiveWslKey, ActiveRemoteKey } from "./components/project/RemoteItems";
import { useToast } from "./hooks/useToast";
import { useSideTerminalResize } from "./hooks/useSideTerminalResize";
import { useWorktreeState } from "./hooks/useWorktreeState";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import AddProjectModal from "./components/AddProjectModal";
import TitleBar from "./components/TitleBar";
import "./styles.css";

// ── re-export to keep hook import clean ──
export type { ActiveWslKey, ActiveRemoteKey };

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

  // WSL 和远程项目状态
  const [wslEntries, setWslEntries] = useState<WSLEntrySession[]>([]);
  const [remoteEntries, setRemoteEntries] = useState<RemoteEntrySession[]>([]);
  const [wslDialogOpen, setWslDialogOpen] = useState(false);
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // 当前激活的 WSL / Remote 终端项目
  const [activeWslKey, setActiveWslKey] = useState<ActiveWslKey>(null);
  const [activeRemoteKey, setActiveRemoteKey] = useState<ActiveRemoteKey>(null);
  // 当前激活的 WSL 项目完整信息（用于渲染终端）
  const [activeWslProject, setActiveWslProject] = useState<{ distro: string; project: WSLProject } | null>(null);
  // 当前激活的 Remote 项目完整信息（用于渲染终端）
  const [activeRemoteProject, setActiveRemoteProject] = useState<{
    entry: RemoteEntrySession;
    project: RemoteProject;
  } | null>(null);
  // 已建立终端会话的项目 ID 集合（用于侧边栏显示活跃状态）
  const [wslOpenSessions, setWslOpenSessions] = useState<Set<string>>(new Set());
  // Remote 已建立会话的 projectId 集合（用于侧边栏显示活跃状态）
  const [remoteOpenSessions, setRemoteOpenSessions] = useState<Set<string>>(new Set());
  // SSH 认证信息内存缓存：entryId → AuthMethod（不持久化）
  const [remoteAuthStore, setRemoteAuthStore] = useState<Map<string, AuthMethod>>(new Map());
  // 等待重新登录的 entry（无 auth 缓存时弹出登录弹窗）
  const [pendingAuthEntry, setPendingAuthEntry] = useState<RemoteEntrySession | null>(null);
  // WSL / Remote side terminal 已打开的 projectId 集合
  const [wslSideTerminalOpen, setWslSideTerminalOpen] = useState<Set<string>>(new Set());
  const [remoteSideTerminalOpen, setRemoteSideTerminalOpen] = useState<Set<string>>(new Set());

  // 点击外部关闭添加菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.add-menu-dropdown') && !target.closest('.tb-icon-btn')) {
        setShowAddMenu(false);
      }
    };
    if (showAddMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showAddMenu]);

  const { toast, showToast } = useToast();

  // Stable ref for activeProjectId — declared early so hooks below can reference it
  // (rerender-use-ref-transient-values)
  const activeProjectIdRef = useRef<string | null>(null);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

  // 全局配置（持久化）
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Side Terminal 状态：per-project Map（key = projectId，value = open）
  // 切换项目时不关闭，保持各自的 side terminal 开关状态
  const [sideTerminalOpenMap, setSideTerminalOpenMap] = useState<Record<string, boolean>>({});
  const sideTerminalOpen = activeProjectId ? (sideTerminalOpenMap[activeProjectId] ?? false) : false;
  const setSideTerminalOpen = (open: boolean) => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    setSideTerminalOpenMap(prev => ({ ...prev, [pid]: open }));
  };

  const {
    activeWorktreePath,
    activeWorktreeBranch,
    openedWorktrees,
    activeWorktreePathRef,
    openedWorktreesRef,
    updateWtPath,
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    setOpenedWorktrees,
  } = useWorktreeState(activeProjectIdRef);

  const { sideTerminalWidth, handleSideDividerMouseDown } = useSideTerminalResize();

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

  // ── Stable refs for keyboard shortcuts and event handler closures ──────────
  // (rerender-use-ref-transient-values: keep latest values without re-running effects)
  const selectProjectRef = useRef<(id: string) => void>(() => {});
  const sideTerminalOpenRef = useRef(false);
  const isTerminalViewRef = useRef(false);
  const activeProjectRef = useRef<Project | null>(null);
  // WSL refs
  const wslEntriesRef = useRef<WSLEntrySession[]>([]);
  const activeWslKeyRef = useRef<ActiveWslKey>(null);
  const selectWslProjectRef = useRef<(distro: string, project: WSLProject) => void>(() => {});
  // Remote refs
  const remoteEntriesRef = useRef<RemoteEntrySession[]>([]);
  const activeRemoteKeyRef = useRef<ActiveRemoteKey>(null);
  const selectRemoteProjectRef = useRef<(host: string, project: RemoteProject) => void>(() => {});
  // Side terminal open state refs
  const wslSideOpenRef = useRef<Set<string>>(new Set());
  const remoteSideOpenRef = useRef<Set<string>>(new Set());

  // Sync all refs in a single effect (rerender-split-combined-hooks: combined here as all are
  // inert ref assignments with no side-effects)
  useEffect(() => {
    sideTerminalOpenRef.current = sideTerminalOpen;
    wslEntriesRef.current = wslEntries;
    activeWslKeyRef.current = activeWslKey;
    remoteEntriesRef.current = remoteEntries;
    activeRemoteKeyRef.current = activeRemoteKey;
    wslSideOpenRef.current = wslSideTerminalOpen;
    remoteSideOpenRef.current = remoteSideTerminalOpen;
    activeWorktreePathRef.current = activeWorktreePath;
    openedWorktreesRef.current = openedWorktrees;
    activeProjectRef.current = activeProject;
  }, [sideTerminalOpen, wslEntries, activeWslKey, remoteEntries, activeRemoteKey,
      wslSideTerminalOpen, remoteSideTerminalOpen, activeWorktreePath, openedWorktrees,
      activeProject]);

  const handleOpenIde = async (project: { id: string; selected_ide: string | null }) => {
    if (!project.selected_ide) {
      showToast("No IDE configured for this project", "error");
      return;
    }
    showToast(`Opening ${project.selected_ide}...`, "info");
    try {
      await invoke("open_ide", {
        ideCommand: project.selected_ide,
        projectPath: (activeProjectRef.current as Project | null)?.path ?? "",
      });
    } catch (e: any) {
      showToast(String(e), "error");
    }
  };

  // Keyboard shortcuts delegated to extracted hook
  // (bundle-barrel-imports, rerender-move-effect-to-event)
  useKeyboardShortcuts({
    projects,
    activeProjectId,
    sideTerminalOpenRef,
    setSideTerminalOpen,
    wslEntriesRef,
    activeWslKeyRef,
    selectWslProjectRef,
    remoteEntriesRef,
    activeRemoteKeyRef,
    selectRemoteProjectRef,
    selectProjectRef,
    wslSideOpenRef,
    remoteSideOpenRef,
    setWslSideTerminalOpen,
    setRemoteSideTerminalOpen,
    activeWorktreePathRef,
    openedWorktreesRef,
    updateWtPath,
    isTerminalViewRef,
    activeProjectRef,
    handleOpenIde,
  });

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
    loadWSLEntries();
    loadRemoteEntries();

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

  const loadWSLEntries = async () => {
    try {
      const entries = await invoke<WSLEntrySession[]>("load_wsl_entries");
      setWslEntries(entries);
    } catch (error) {
      console.error("[App] Failed to load WSL entries:", error);
    }
  };

  const loadRemoteEntries = async () => {
    try {
      const entries = await invoke<RemoteEntrySession[]>("load_remote_entries");
      setRemoteEntries(entries);
    } catch (error) {
      console.error("[App] Failed to load remote entries:", error);
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
      // 使用 Tauri dialog 插件的 JavaScript API 打开目录选择对话框
      const selected = await open({
        multiple: false,
        directory: true,
      });
      if (selected) {
        const exists = projects.some((p) => p.path === selected);
        if (exists) {
          alert(`Project already added: ${selected}`);
          return;
        }
        setPendingPath(selected);
      }
    } catch (error) {
      console.error("[App] Failed to open dialog:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleWSLEntryAdd = async (entry: WSLEntrySession) => {
    try {
      // 更新或添加条目
      const existingIndex = wslEntries.findIndex(e => e.id === entry.id);
      let newEntries: WSLEntrySession[];
      if (existingIndex >= 0) {
        newEntries = [...wslEntries];
        newEntries[existingIndex] = entry;
      } else {
        newEntries = [...wslEntries, entry];
      }
      setWslEntries(newEntries);
      await invoke("save_wsl_entries", { entries: newEntries });
    } catch (error) {
      console.error("[App] Failed to save WSL entry:", error);
    }
  };

  const handleRemoteEntryAdd = async (entry: RemoteEntrySession, auth: AuthMethod | null) => {
    try {
      // 更新或添加条目
      const existingIndex = remoteEntries.findIndex(e => e.id === entry.id);
      let newEntries: RemoteEntrySession[];
      if (existingIndex >= 0) {
        newEntries = [...remoteEntries];
        newEntries[existingIndex] = entry;
      } else {
        newEntries = [...remoteEntries, entry];
      }
      setRemoteEntries(newEntries);
      await invoke("save_remote_entries", { entries: newEntries });
      // 缓存 auth 到内存（新服务器时 auth 非 null）
      if (auth) {
        setRemoteAuthStore(prev => new Map(prev).set(entry.id, auth));
      }
    } catch (error) {
      console.error("[App] Failed to save remote entry:", error);
    }
  };

  // ── WSL 侧边栏回调 ────────────────────────────────────────────────────────

  const handleSelectWslProject = (distro: string, project: WSLProject) => {
    // 清除本地项目激活状态
    setActiveProjectId(null);
    setActiveProject(null);
    setActiveWslKey({ distro, projectId: project.id });
    setActiveWslProject({ distro, project });
    setActiveRemoteKey(null);
  };
  // 让快捷键 handler 闭包始终持有最新的函数引用
  selectWslProjectRef.current = handleSelectWslProject;

  // 关闭 WSL 项目终端（释放 PTY），但保留配置
  const handleCloseWslProject = (entryId: string, projectId: string) => {
    const entry = wslEntries.find(e => e.id === entryId);
    if (entry) {
      destroyWslCache(wslCacheKey(entry.distro, projectId));
      destroyWslCache(wslCacheKey(entry.distro, projectId) + ":side");
    }
    // 如果当前正在查看该项目终端，清除视图
    if (activeWslKey?.projectId === projectId) {
      setActiveWslKey(null);
      setActiveWslProject(null);
    }
    setWslOpenSessions(prev => { const n = new Set(prev); n.delete(projectId); return n; });
    setWslSideTerminalOpen(prev => { const n = new Set(prev); n.delete(projectId); return n; });
  };

  const handleRemoveWslProject = async (entryId: string, projectId: string) => {
    // 关闭终端并清除视图
    handleCloseWslProject(entryId, projectId);
    const newEntries = wslEntries.map(e => {
      if (e.id !== entryId) return e;
      return { ...e, projects: e.projects.filter(p => p.id !== projectId) };
    });
    setWslEntries(newEntries);
    await invoke("save_wsl_entries", { entries: newEntries }).catch(console.error);
  };

  const handleRemoveWslEntry = async (entryId: string) => {
    const entry = wslEntries.find(e => e.id === entryId);
    if (entry) {
      entry.projects.forEach(p => {
        const key = wslCacheKey(entry.distro, p.id);
        destroyWslCache(key);
        setWslOpenSessions(prev => {
          const next = new Set(prev);
          next.delete(p.id);
          return next;
        });
      });
      if (activeWslKey && entry.projects.some(p => p.id === activeWslKey.projectId)) {
        setActiveWslKey(null);
        setActiveWslProject(null);
      }
    }
    const newEntries = wslEntries.filter(e => e.id !== entryId);
    setWslEntries(newEntries);
    await invoke("save_wsl_entries", { entries: newEntries }).catch(console.error);
  };

  // "在已有发行版下添加项目" - 重新打开 WSL dialog 并预选该 entry
  const [wslAddToEntryId, setWslAddToEntryId] = useState<string | null>(null);
  const handleAddWslProject = (entryId: string) => {
    setWslAddToEntryId(entryId);
    setWslDialogOpen(true);
  };
  const handleWslDialogClose = () => { setWslDialogOpen(false); setWslAddToEntryId(null); };

  // ── Remote 侧边栏回调 ─────────────────────────────────────────────────────

  const handleSelectRemoteProject = (host: string, project: RemoteProject) => {
    setActiveProjectId(null);
    setActiveProject(null);
    setActiveWslKey(null);
    setActiveWslProject(null);
    setActiveRemoteKey({ host, projectId: project.id });
    // 找到对应的 entry，用于渲染终端视图
    const entry = remoteEntries.find(e => e.host === host);
    if (entry) setActiveRemoteProject({ entry, project });
  };
  // 让快捷键 handler 闭包始终持有最新的函数引用
  selectRemoteProjectRef.current = handleSelectRemoteProject;

  // 关闭 Remote 项目终端（释放 SSH 会话），但保留配置
  const handleCloseRemoteProject = (entryId: string, projectId: string) => {
    destroyRemoteCache(remoteCacheKey(entryId, projectId));
    destroyRemoteCache(remoteCacheKey(entryId, projectId) + ":side");
    if (activeRemoteKey?.projectId === projectId) {
      setActiveRemoteKey(null);
      setActiveRemoteProject(null);
    }
    setRemoteOpenSessions(prev => { const n = new Set(prev); n.delete(projectId); return n; });
    setRemoteSideTerminalOpen(prev => { const n = new Set(prev); n.delete(projectId); return n; });
  };

  const handleRemoveRemoteProject = async (entryId: string, projectId: string) => {
    handleCloseRemoteProject(entryId, projectId);
    const newEntries = remoteEntries.map(e => {
      if (e.id !== entryId) return e;
      return { ...e, projects: e.projects.filter(p => p.id !== projectId) };
    });
    setRemoteEntries(newEntries);
    await invoke("save_remote_entries", { entries: newEntries }).catch(console.error);
  };

  const handleRemoveRemoteEntry = async (entryId: string) => {
    const entry = remoteEntries.find(e => e.id === entryId);
    if (entry) {
      entry.projects.forEach(p => handleCloseRemoteProject(entryId, p.id));
      if (activeRemoteKey && entry.projects.some(p => p.id === activeRemoteKey.projectId)) {
        setActiveRemoteKey(null);
        setActiveRemoteProject(null);
      }
      // 清除该服务器的 auth 缓存
      setRemoteAuthStore(prev => { const next = new Map(prev); next.delete(entryId); return next; });
    }
    const newEntries = remoteEntries.filter(e => e.id !== entryId);
    setRemoteEntries(newEntries);
    await invoke("save_remote_entries", { entries: newEntries }).catch(console.error);
  };

  const [remoteAddToEntryId, setRemoteAddToEntryId] = useState<string | null>(null);
  const handleAddRemoteProject = (entryId: string) => {
    setRemoteAddToEntryId(entryId);
    setRemoteDialogOpen(true);
  };
  const handleRemoteDialogClose = () => { setRemoteDialogOpen(false); setRemoteAddToEntryId(null); };

  const handleConfirmAddProject = async (agentId: string | null, ideCommand: string | null) => {
    if (!pendingPath) return;
    try {
      setLoading(true);
      const project = await invoke<Project>("add_project", {
        path: pendingPath,
        agentId,
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
      // 清理 side terminal Map entry 并销毁对应 cache
      setSideTerminalOpenMap(prev => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      destroyTerminalCache(`${projectId}:side`);
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
  // Sync to ref (rerender-use-ref-transient-values) — worktree terminal also counts as terminal view
  isTerminalViewRef.current = isTerminalView || activeWorktreePath !== null;
  const diffFilePath =
    typeof activeProject?.active_view === "object"
      ? (activeProject.active_view as { Diff: { file_path: string } }).Diff
          ?.file_path || null
      : null;

  // Trigger SSH auth dialog via effect, not during render
  // (rerender-derived-state-no-effect: derive "needs auth" from state, schedule dialog open via effect)
  useEffect(() => {
    if (!activeRemoteProject) {
      setPendingAuthEntry(null);
      return;
    }
    const hasAuth = remoteAuthStore.has(activeRemoteProject.entry.id);
    if (!hasAuth) {
      setPendingAuthEntry(activeRemoteProject.entry);
    } else {
      setPendingAuthEntry(null);
    }
  }, [activeRemoteProject, remoteAuthStore]);

  return (
    <div className="app-root">
      <TitleBar
        activeProject={activeProject}
        activeWslProject={activeWslProject}
        activeRemoteProject={activeRemoteProject}
        activeWorktreeBranch={activeWorktreeBranch}
        showAddMenu={showAddMenu}
        loading={loading}
        onOpenSettings={() => setSettingsOpen((v) => !v)}
        onToggleAddMenu={() => setShowAddMenu(v => !v)}
        onAddProject={() => { setShowAddMenu(false); handleAddProject(); }}
        onAddWsl={() => { setShowAddMenu(false); setWslDialogOpen(true); }}
        onAddRemote={() => { setShowAddMenu(false); setRemoteDialogOpen(true); }}
        onSelectLocalAgent={(agent) => {
          if (agent) launchAgentInTerminal(activeProject!.id, agent.command, agent.args);
        }}
        onSelectWslAgent={(agent) => {
          if (!activeWslProject) return;
          const key = wslCacheKey(activeWslProject.distro, activeWslProject.project.id);
          if (agent) launchAgentInWslTerminal(key, agent.command, agent.args);
          const agentId = agent?.id ?? null;
          const newEntries = wslEntries.map(e => ({
            ...e,
            projects: e.projects.map(p =>
              p.id === activeWslProject.project.id ? { ...p, selected_agent: agentId } : p
            ),
          }));
          setWslEntries(newEntries);
          setActiveWslProject(prev =>
            prev ? { ...prev, project: { ...prev.project, selected_agent: agentId } } : prev
          );
          invoke("save_wsl_entries", { entries: newEntries }).catch(console.error);
        }}
        onSelectRemoteAgent={(agent) => {
          if (!activeRemoteProject) return;
          const key = remoteCacheKey(activeRemoteProject.entry.id, activeRemoteProject.project.id);
          if (agent) launchAgentInRemoteTerminal(key, agent.command, agent.args);
          const agentId = agent?.id ?? null;
          const newEntries = remoteEntries.map(e => ({
            ...e,
            projects: e.projects.map(p =>
              p.id === activeRemoteProject.project.id ? { ...p, selected_agent: agentId } : p
            ),
          }));
          setRemoteEntries(newEntries);
          setActiveRemoteProject(prev =>
            prev ? { ...prev, project: { ...prev.project, selected_agent: agentId } } : prev
          );
          invoke("save_remote_entries", { entries: newEntries }).catch(console.error);
        }}
      />
      {/* 主体：侧栏 + 内容区，无独立标题行 */}
      <div className="app-container">
        <ProjectSidebar
          projects={projects}
          activeProjectId={activeProjectId}
          wslEntries={wslEntries}
          remoteEntries={remoteEntries}
          activeWslKey={activeWslKey}
          activeRemoteKey={activeRemoteKey}
          wslOpenSessions={wslOpenSessions}
          remoteOpenSessions={remoteOpenSessions}
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
          onSelectWslProject={handleSelectWslProject}
          onCloseWslProject={handleCloseWslProject}
          onRemoveWslProject={handleRemoveWslProject}
          onRemoveWslEntry={handleRemoveWslEntry}
          onAddWslProject={handleAddWslProject}
          onSelectRemoteProject={handleSelectRemoteProject}
          onCloseRemoteProject={handleCloseRemoteProject}
          onRemoveRemoteProject={handleRemoveRemoteProject}
          onRemoveRemoteEntry={handleRemoveRemoteEntry}
          onAddRemoteProject={handleAddRemoteProject}
          onOpenWslSideTerminal={(_, projectId) =>
            setWslSideTerminalOpen(prev => new Set(prev).add(projectId))
          }
          onOpenRemoteSideTerminal={(_, projectId) =>
            setRemoteSideTerminalOpen(prev => new Set(prev).add(projectId))
          }
          loading={loading}
        />

        <div className="main-content">
          {/* WSL 终端视图 */}
          {activeWslProject && !activeProject && (
            <div className="content-area">
              <div className="terminal-pane-container">
                <WSLTerminalView
                  distro={activeWslProject.distro}
                  projectId={activeWslProject.project.id}
                  projectName={activeWslProject.project.name}
                  projectPath={activeWslProject.project.path}
                  fontSize={config.fontSize}
                  fontFamily={config.fontFamily}
                  selectedAgentId={activeWslProject.project.selected_agent}
                  onSessionReady={(pid) => {
                    setWslOpenSessions(prev => new Set(prev).add(pid));
                  }}
                />
                {wslSideTerminalOpen.has(activeWslProject.project.id) && (
                  <>
                    <div
                      className="terminal-pane-divider"
                      onMouseDown={handleSideDividerMouseDown}
                    />
                    <WSLTerminalView
                      distro={activeWslProject.distro}
                      projectId={activeWslProject.project.id}
                      projectName={activeWslProject.project.name}
                      projectPath={activeWslProject.project.path}
                      fontSize={config.fontSize}
                      fontFamily={config.fontFamily}
                      cacheKeySuffix=":side"
                      sideMode
                      width={sideTerminalWidth}
                      onClose={() =>
                        setWslSideTerminalOpen(prev => {
                          const n = new Set(prev);
                          n.delete(activeWslProject.project.id);
                          return n;
                        })
                      }
                    />
                  </>
                )}
              </div>
            </div>
          )}

          {/* SSH 终端视图 */}
          {activeRemoteProject && !activeProject && !activeWslProject && (() => {
            const { entry, project } = activeRemoteProject;
            const auth = remoteAuthStore.get(entry.id);
            // 无 auth 缓存：显示空白占位，弹窗由 useEffect 触发（见上方）
            if (!auth) {
              return (
                <div className="empty-state">
                  <div className="empty-body">
                    <div className="empty-icon">🔑</div>
                    <h2>Authentication required</h2>
                    <p>Waiting for credentials...</p>
                  </div>
                </div>
              );
            }
            return (
              <div className="content-area">
                <div className="terminal-pane-container">
                  <RemoteTerminalView
                    entryId={entry.id}
                    projectId={project.id}
                    projectName={project.name}
                    projectPath={project.path}
                    host={entry.host}
                    port={entry.port}
                    username={entry.username}
                    auth={auth}
                    fontSize={config.fontSize}
                    fontFamily={config.fontFamily}
                    selectedAgentId={project.selected_agent}
                    onSessionReady={(pid) => {
                      setRemoteOpenSessions(prev => new Set(prev).add(pid));
                    }}
                  />
                  {remoteSideTerminalOpen.has(project.id) && (
                    <>
                      <div
                        className="terminal-pane-divider"
                        onMouseDown={handleSideDividerMouseDown}
                      />
                      <RemoteTerminalView
                        entryId={entry.id}
                        projectId={project.id}
                        projectName={project.name}
                        projectPath={project.path}
                        host={entry.host}
                        port={entry.port}
                        username={entry.username}
                        auth={auth}
                        fontSize={config.fontSize}
                        fontFamily={config.fontFamily}
                        cacheKeySuffix=":side"
                        sideMode
                        width={sideTerminalWidth}
                        onClose={() =>
                          setRemoteSideTerminalOpen(prev => {
                            const n = new Set(prev);
                            n.delete(project.id);
                            return n;
                          })
                        }
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          {/* 本地项目视图 */}
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
                        onDestroy={() => destroyTerminalCache(`${activeProject.id}:side`)}
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
                        onDestroy={() => destroyTerminalCache(`${activeProject.id}:side:${activeWorktreePath}`)}
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
          ) : !activeWslProject && !activeRemoteProject ? (
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
          ) : null}
        </div>

        {pendingPath && (
          <AddProjectModal
            pendingPath={pendingPath}
            agents={agents}
            config={config}
            onConfirm={handleConfirmAddProject}
            onCancel={() => setPendingPath(null)}
            loading={loading}
          />
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

      {/* WSL Dialog */}
      <WSLDialog
        isOpen={wslDialogOpen}
        onClose={handleWslDialogClose}
        onAdd={handleWSLEntryAdd}
        existingEntries={wslEntries}
        selectedEntryId={wslAddToEntryId ?? undefined}
        agents={agents}
      />

      {/* Remote Dialog */}
      <RemoteDialog
        isOpen={remoteDialogOpen}
        onClose={handleRemoteDialogClose}
        onAdd={handleRemoteEntryAdd}
        existingEntries={remoteEntries}
        addProjectMode={remoteAddToEntryId !== null}
        selectedEntryId={remoteAddToEntryId ?? undefined}
        agents={agents}
        existingEntryAuth={remoteAuthStore}
      />

      {/* SSH 重新登录弹窗 */}
      {pendingAuthEntry && (
        <RemoteAuthDialog
          isOpen={true}
          host={pendingAuthEntry.host}
          port={pendingAuthEntry.port}
          username={pendingAuthEntry.username}
          onCancel={() => {
            setPendingAuthEntry(null);
            // 取消登录时退出该项目视图
            setActiveRemoteKey(null);
            setActiveRemoteProject(null);
          }}
          onSuccess={(auth) => {
            setRemoteAuthStore(prev => new Map(prev).set(pendingAuthEntry.id, auth));
            setPendingAuthEntry(null);
          }}
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
