import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { IS_WINDOWS } from "./utils/platform";
import ProjectSidebar, { AddProjectModal } from "./components/project";
import SettingsPanel from "./components/SettingsPanel";
import MainContent from "./components/MainContent";
import { TitleBar } from "./components/layout";
import { launchAgentInTerminal, wslCacheKey, launchAgentInWslTerminal, remoteCacheKey, launchAgentInRemoteTerminal } from "./components/terminal";
import { WSLDialog, RemoteDialog, RemoteAuthDialog } from "./components/connections";
import { WSLProject, RemoteProject, AgentConfig, GitInfo } from "./types";
import type { WSLEntrySession, RemoteEntrySession, AuthMethod } from "./types";
import type { ActiveWslKey } from "./components/connections";
import type { ActiveRemoteKey } from "./hooks/useRemoteProjects";
import { useToast } from "./hooks/useToast";
import { useSideTerminalResize } from "./hooks/useSideTerminalResize";
import { useWorktreeState, type WorktreeItem } from "./hooks/useWorktreeState";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useAppConfig } from "./hooks/useAppConfig";
import { useLocalProjects } from "./hooks/useLocalProjects";
import { useWslProjects, type SaveSessionFn } from "./hooks/useWslProjects";
import { useRemoteProjects } from "./hooks/useRemoteProjects";
import "./styles.css";

// ── re-export to keep hook import clean ──
export type { ActiveWslKey, ActiveRemoteKey };

function App() {
  // ── Hooks ─────────────────────────────────────────────────────────────────
  const { config, settingsOpen, setSettingsOpen, saveConfig } = useAppConfig();
  const { toast, showToast } = useToast();

  const local = useLocalProjects();

  // ── Unified session save (stable via refs) ──
  const wslEntriesRefForSave = useRef<WSLEntrySession[]>([]);
  const remoteEntriesRefForSave = useRef<RemoteEntrySession[]>([]);
  const worktreeStateRef = useRef<Record<string, string>>({});
  const wtSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveWorktreeState = useCallback((projectId: string, wtPath: string | null) => {
    if (wtPath) {
      worktreeStateRef.current[projectId] = wtPath;
    } else {
      delete worktreeStateRef.current[projectId];
    }
    // Debounced save
    if (wtSaveTimerRef.current) clearTimeout(wtSaveTimerRef.current);
    wtSaveTimerRef.current = setTimeout(() => {
      invoke("save_session", { worktreeState: worktreeStateRef.current }).catch(() => {});
    }, 500);
  }, []);

  const saveSession: SaveSessionFn = useCallback(async (wslEntriesParam?: WSLEntrySession[], remoteEntriesParam?: RemoteEntrySession[]) => {
    const wsl = wslEntriesParam ?? wslEntriesRefForSave.current;
    const remote = remoteEntriesParam ?? remoteEntriesRefForSave.current;
    await invoke("save_session", { wslEntries: wsl, remoteEntries: remote });
  }, []);

  const wsl = useWslProjects(saveSession);
  const remote = useRemoteProjects(saveSession);

  const {
    projects, activeProjectId, setActiveProjectId,
    activeProject, setActiveProject,
    loading,
    pendingPath, setPendingPath,
    agents,
    sideTerminalOpenMap, setSideTerminalOpenMap,
    activeProjectIdRef, selectProjectRef, activeProjectRef, isTerminalViewRef,
    loadProjects, loadAgents,
    handleAddProject, handleConfirmAddProject, handleRemoveProject,
    handleSelectProject, handleSelectFile, handleRefreshGit, handleOpenIde,
  } = local;

  const {
    wslEntries, setWslEntries,
    activeWslKey, setActiveWslKey,
    activeWslProject, setActiveWslProject,
    wslOpenSessions, setWslOpenSessions,
    wslSideTerminalOpen, setWslSideTerminalOpen,
    wslDialogOpen, setWslDialogOpen,
    wslAddToEntryId,
    wslEntriesRef, activeWslKeyRef, selectWslProjectRef, wslSideOpenRef,
    handleWSLEntryAdd,
    handleCloseWslProject, handleRemoveWslProject, handleRemoveWslEntry,
    handleAddWslProject, handleWslDialogClose,
  } = wsl;

  const {
    remoteEntries, setRemoteEntries,
    activeRemoteKey, setActiveRemoteKey,
    activeRemoteProject, setActiveRemoteProject,
    remoteOpenSessions, setRemoteOpenSessions,
    remoteSideTerminalOpen, setRemoteSideTerminalOpen,
    remoteDialogOpen, setRemoteDialogOpen,
    remoteAddToEntryId,
    remoteAuthStore, setRemoteAuthStore,
    pendingAuthEntry, setPendingAuthEntry,
    remoteEntriesRef, activeRemoteKeyRef, selectRemoteProjectRef, remoteSideOpenRef,
    handleRemoteEntryAdd,
    handleCloseRemoteProject, handleRemoveRemoteProject, handleRemoveRemoteEntry,
    handleAddRemoteProject, handleRemoteDialogClose,
    restoreAuthFromEntries,
  } = remote;

  // ── Side terminal state ───────────────────────────────────────────────────
  const sideTerminalOpen = activeProjectId ? (sideTerminalOpenMap[activeProjectId] ?? false) : false;
  const setSideTerminalOpen = useCallback((open: boolean) => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    setSideTerminalOpenMap(prev => ({ ...prev, [pid]: open }));
  }, [setSideTerminalOpenMap]);

  // ── Worktree state ────────────────────────────────────────────────────────
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

  // ── Width persistence callbacks ──
  const suppressTerminalResizeRef = useRef(false);
  const sidebarWidthSaveTimeout = useRef<ReturnType<typeof setTimeout>>();
  const saveSidebarWidth = useCallback((width: number) => {
    clearTimeout(sidebarWidthSaveTimeout.current);
    sidebarWidthSaveTimeout.current = setTimeout(() => {
      invoke("save_session", {
        wslEntries: wslEntriesRefForSave.current,
        remoteEntries: remoteEntriesRefForSave.current,
        sidebarWidth: width,
        sideTerminalWidth: null,
      }).catch(console.error);
    }, 300);
  }, []);

  const saveSideTerminalWidth = useCallback((width: number) => {
    invoke("save_session", {
      wslEntries: wslEntriesRefForSave.current,
      remoteEntries: remoteEntriesRefForSave.current,
      sidebarWidth: null,
      sideTerminalWidth: Math.round(width),
    }).catch(console.error);
  }, []);

  const { sideTerminalWidth, setSideTerminalWidth, handleSideDividerMouseDown } = useSideTerminalResize(480, saveSideTerminalWidth, suppressTerminalResizeRef);

  // ── Add menu ──────────────────────────────────────────────────────────────
  const [showAddMenu, setShowAddMenu] = useState(false);

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

  // ── Ref sync (rerender-use-ref-transient-values) ──────────────────────────
  const sideTerminalOpenRef = useRef(false);
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
    wslEntriesRefForSave.current = wslEntries;
    remoteEntriesRefForSave.current = remoteEntries;
  }, [sideTerminalOpen, wslEntries, activeWslKey, remoteEntries, activeRemoteKey,
      wslSideTerminalOpen, remoteSideTerminalOpen, activeWorktreePath, openedWorktrees,
      activeProject]);

  // ── WSL/SSH diff state (声明在 handleSelectWslProject 之前，避免 TDZ 歧义) ──
  const [wslDiffState, setWslDiffState] = useState<{
    distro: string; projectPath: string; filePath: string;
  } | null>(null);
  const [remoteDiffState, setRemoteDiffState] = useState<{
    entryId: string; host: string; port: number; username: string; auth: AuthMethod; projectPath: string; filePath: string;
  } | null>(null);

  // ── WSL/SSH worktree state (同上) ────────────────────────────────────────
  const [activeWslWorktreePath, setActiveWslWorktreePath] = useState<string | null>(null);
  const [activeRemoteWorktreePath, setActiveRemoteWorktreePath] = useState<string | null>(null);
  const [wslActiveWtBranch, setWslActiveWtBranch] = useState("");
  const [remoteActiveWtBranch, setRemoteActiveWtBranch] = useState("");
  const [wslOpenedWt, setWslOpenedWt] = useState<WorktreeItem[]>([]);
  const [remoteOpenedWt, setRemoteOpenedWt] = useState<WorktreeItem[]>([]);
  const wslOpenedWtRef = useRef<WorktreeItem[]>([]);
  const remoteOpenedWtRef = useRef<WorktreeItem[]>([]);
  const activeWslWorktreePathRef = useRef<string | null>(null);
  const activeRemoteWorktreePathRef = useRef<string | null>(null);
  wslOpenedWtRef.current = wslOpenedWt;
  remoteOpenedWtRef.current = remoteOpenedWt;
  activeWslWorktreePathRef.current = activeWslWorktreePath;
  activeRemoteWorktreePathRef.current = activeRemoteWorktreePath;

  // ── Cross-domain select handlers ──────────────────────────────────────────
  const handleSelectWslProject = useCallback((distro: string, project: WSLProject) => {
    setActiveProjectId(null);
    setActiveProject(null);
    setActiveWslKey({ distro, projectId: project.id });
    setActiveWslProject({ distro, project });
    setActiveRemoteKey(null);
    setActiveRemoteProject(null);
    setWslDiffState(null);
    setRemoteDiffState(null);
    setActiveWslWorktreePath(null);
    setActiveRemoteWorktreePath(null);
    setWslActiveWtBranch("");
    setRemoteActiveWtBranch("");
    setWslOpenedWt([]);
    setRemoteOpenedWt([]);

    // 异步刷新 git_info
    invoke<GitInfo>("refresh_wsl_git_info", { distro, projectPath: project.path })
      .then(gitInfo => {
        setActiveWslProject(prev => prev?.project.id === project.id
          ? { ...prev, project: { ...prev.project, git_info: gitInfo } }
          : prev
        );
        setWslEntries(prev => prev.map(e => ({
          ...e,
          projects: e.projects.map(p => p.id === project.id ? { ...p, git_info: gitInfo } : p)
        })));
      })
      .catch(() => {});
  }, [setActiveProjectId, setActiveProject, setActiveWslKey, setActiveWslProject, setActiveRemoteKey, setActiveRemoteProject, setWslEntries]);
  selectWslProjectRef.current = handleSelectWslProject;

  const handleSelectRemoteProject = useCallback((host: string, project: RemoteProject) => {
    setActiveProjectId(null);
    setActiveProject(null);
    setActiveWslKey(null);
    setActiveWslProject(null);
    setActiveRemoteKey({ host, projectId: project.id });
    setActiveWslWorktreePath(null);
    setActiveRemoteWorktreePath(null);
    setWslActiveWtBranch("");
    setRemoteActiveWtBranch("");
    setWslOpenedWt([]);
    setRemoteOpenedWt([]);
    const entry = remoteEntriesRef.current.find(e => e.host === host);
    if (entry) {
      setActiveRemoteProject({ entry, project });
      setWslDiffState(null);
      setRemoteDiffState(null);

      // 异步刷新 git_info
      const auth = remoteAuthStore.get(entry.id);
      if (auth) {
        invoke<GitInfo>("refresh_remote_git_info", {
          host: entry.host, port: entry.port, username: entry.username,
          auth, projectPath: project.path,
        })
        .then(gitInfo => {
          setActiveRemoteProject(prev => prev?.project.id === project.id
            ? { ...prev, project: { ...prev.project, git_info: gitInfo } }
            : prev
          );
          setRemoteEntries(prev => prev.map(e => ({
            ...e,
            projects: e.projects.map(p => p.id === project.id ? { ...p, git_info: gitInfo } : p)
          })));
        })
        .catch(() => {});
      }
    }
  }, [remoteAuthStore, setActiveProjectId, setActiveProject, setActiveWslKey, setActiveWslProject, setActiveRemoteKey, setActiveRemoteProject, setRemoteEntries]);
  selectRemoteProjectRef.current = handleSelectRemoteProject;

  // ── invokeRemoteGit helper (方案 B: 自动注入 auth) ─────────────────────────
  const invokeRemoteGit = useCallback(
    async (command: string, entryId: string, extra: Record<string, unknown>): Promise<unknown> => {
      const entry = remoteEntriesRef.current.find(e => e.id === entryId);
      const auth = remoteAuthStore.get(entryId);
      if (!entry || !auth) throw new Error("No auth for entry");
      return invoke(command, {
        host: entry.host, port: entry.port, username: entry.username,
        auth, ...extra
      });
    },
    [remoteAuthStore]
  );

  // ── WSL/SSH callbacks for sidebar ──────────────────────────────────────────
  const handleSelectWslFile = useCallback((distro: string, projectPath: string, filePath: string) => {
    setWslDiffState({ distro, projectPath, filePath });
  }, []);

  const handleSelectRemoteFile = useCallback((entryId: string, projectPath: string, filePath: string) => {
    const entry = remoteEntriesRef.current.find(e => e.id === entryId);
    const auth = remoteAuthStore.get(entryId);
    if (entry && auth) {
      setRemoteDiffState({ entryId, host: entry.host, port: entry.port, username: entry.username, auth, projectPath, filePath });
    }
  }, [remoteAuthStore]);

  const handleRefreshWslGit = useCallback(async (distro: string, projectId: string, projectPath: string) => {
    const gitInfo = await invoke<GitInfo>("refresh_wsl_git_info", { distro, projectPath }).catch(() => null);
    if (!gitInfo) return;
    setWslEntries(prev => prev.map(e => ({
      ...e,
      projects: e.projects.map(p => p.id === projectId ? { ...p, git_info: gitInfo } : p)
    })));
    setActiveWslProject(prev =>
      prev?.project.id === projectId ? { ...prev, project: { ...prev.project, git_info: gitInfo } } : prev
    );
  }, [setWslEntries, setActiveWslProject]);

  const handleRefreshRemoteGit = useCallback(async (entryId: string, projectId: string, projectPath: string) => {
    const result = await invokeRemoteGit("refresh_remote_git_info", entryId, { projectPath }).catch(() => null);
    if (!result) return;
    const gitInfo = result as GitInfo;
    setRemoteEntries(prev => prev.map(e => ({
      ...e,
      projects: e.projects.map(p => p.id === projectId ? { ...p, git_info: gitInfo } as RemoteProject : p)
    })));
    setActiveRemoteProject(prev =>
      prev?.project.id === projectId ? { ...prev, project: { ...prev.project, git_info: gitInfo } } : prev
    );
  }, [invokeRemoteGit, setRemoteEntries, setActiveRemoteProject]);

  const handleOpenWslIde = useCallback((distro: string, projectPath: string, ide: string) => {
    if (!ide) { showToast("No IDE selected for this project", "error"); return; }
    invoke("open_wsl_ide", { distro, projectPath, ide }).catch(e => showToast(String(e), "error"));
  }, [showToast]);

  const handleOpenRemoteIde = useCallback((entryId: string, projectPath: string, ide: string) => {
    if (!ide) { showToast("No IDE selected for this project", "error"); return; }
    const entry = remoteEntriesRef.current.find(e => e.id === entryId);
    if (!entry) return;
    invoke("open_remote_ide", { host: entry.host, port: entry.port, username: entry.username, projectPath, ide })
      .catch(e => showToast(String(e), "error"));
  }, [showToast]);

  // ── WSL/SSH worktree handlers (state declared above) ─────────────────────

  const handleOpenWslWorktreeTerminal = useCallback((_distro: string, worktreePath: string, branch: string) => {
    setActiveWslWorktreePath(worktreePath);
    setWslActiveWtBranch(branch);
    setWslOpenedWt(prev => {
      if (prev.some(w => w.path === worktreePath)) return prev;
      return [...prev, { path: worktreePath, branch }];
    });
    setWslDiffState(null);
    setRemoteDiffState(null);
  }, []);

  const handleOpenRemoteWorktreeTerminal = useCallback((_entryId: string, worktreePath: string, branch: string) => {
    setActiveRemoteWorktreePath(worktreePath);
    setRemoteActiveWtBranch(branch);
    setRemoteOpenedWt(prev => {
      if (prev.some(w => w.path === worktreePath)) return prev;
      return [...prev, { path: worktreePath, branch }];
    });
    setWslDiffState(null);
    setRemoteDiffState(null);
  }, []);

  // IDE open helper (used by keyboard shortcuts and sidebar)
  const handleOpenIdeCallback = useCallback((project: { id: string; selected_ide: string | null }) => {
    if (!project.selected_ide) {
      showToast("No IDE configured for this project", "error");
      return;
    }
    showToast(`Opening ${project.selected_ide}...`, "info");
    handleOpenIde(project).catch((e: any) => showToast(String(e), "error"));
  }, [handleOpenIde, showToast]);

  // ── Worktree handlers ─────────────────────────────────────────────────────
  const handleBackToMainTerminal = useCallback((projectId: string) => {
    if (activeWorktreePath !== null) {
      setActiveWorktreePath(null);
      setActiveWorktreeBranch("");
    }
    invoke("set_view_terminal", { projectId }).catch(() => {});
  }, [activeWorktreePath, setActiveWorktreePath, setActiveWorktreeBranch]);

  const handleOpenWorktreeTerminal = useCallback((worktreePath: string, branch: string) => {
    setActiveWorktreePath(worktreePath);
    setActiveWorktreeBranch(branch);
    setOpenedWorktrees((prev) => {
      if (prev.some((w) => w.path === worktreePath)) return prev;
      return [...prev, { path: worktreePath, branch }];
    });
    if (activeProjectIdRef.current) {
      saveWorktreeState(activeProjectIdRef.current, worktreePath);
      invoke("set_view_terminal", { projectId: activeProjectIdRef.current }).catch(() => {});
    }
  }, [setActiveWorktreePath, setActiveWorktreeBranch, setOpenedWorktrees, saveWorktreeState]);

  // ── isTerminalView ref sync ───────────────────────────────────────────────
  const isTerminalView = activeProject?.active_view === "Terminal";
  isTerminalViewRef.current = isTerminalView || activeWorktreePath !== null;

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
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
    wslOpenedWtRef,
    activeWslWorktreePathRef,
    setWslWorktreePath: setActiveWslWorktreePath,
    setWslWtBranch: setWslActiveWtBranch,
    remoteOpenedWtRef,
    activeRemoteWorktreePathRef,
    setRemoteWorktreePath: setActiveRemoteWorktreePath,
    setRemoteWtBranch: setRemoteActiveWtBranch,
    isTerminalViewRef,
    activeProjectRef,
    handleOpenIde: handleOpenIdeCallback,
  });

  // ── Startup: listen for git changes ───────────────────────────────────────
  const [initialSidebarWidth, setInitialSidebarWidth] = useState<number>(280);

  useEffect(() => {
    loadAgents();
    loadProjects();

    // 统一加载所有会话数据
    invoke<any>("load_session").then((session: any) => {
      const wslE = session.wsl_entries ?? [];
      const remoteE = session.remote_entries ?? [];
      setWslEntries(wslE);
      setRemoteEntries(remoteE);
      if (session.sidebar_width) {
        setInitialSidebarWidth(session.sidebar_width);
      }
      if (session.side_terminal_width) {
        setSideTerminalWidth(session.side_terminal_width);
      }
      // Restore worktree state per project
      const wtState = session.worktree_state;
      if (wtState && typeof wtState === "object") {
        worktreeStateRef.current = wtState;
      }
      // Restore SSH auth from saved credentials
      restoreAuthFromEntries(remoteE);
    }).catch(console.error);

    const unlistenPromise = listen<string>("git-changed", (event) => {
      const projectId = event.payload;
      invoke("refresh_git_info", { projectId })
        .then(() => loadProjects())
        .catch(() => loadProjects());
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // ── Agent selection callbacks ─────────────────────────────────────────────
  const handleSelectLocalAgent = useCallback((agent: AgentConfig | null) => {
    if (agent && activeProject) {
      const cmd = config.agentCommandOverrides?.[agent.id] ?? agent.command;
      launchAgentInTerminal(activeProject.id, cmd, agent.args);
    }
  }, [activeProject, config.agentCommandOverrides]);

  const handleSelectWslAgent = useCallback((agent: AgentConfig | null) => {
    if (!activeWslProject) return;
    const key = wslCacheKey(activeWslProject.distro, activeWslProject.project.id);
    if (agent) {
      const cmd = config.agentCommandOverrides?.[agent.id] ?? agent.command;
      launchAgentInWslTerminal(key, cmd, agent.args);
    }
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
    invoke("save_session", { wslEntries: newEntries, remoteEntries: remoteEntriesRefForSave.current }).catch(console.error);
  }, [activeWslProject, wslEntries, setWslEntries, setActiveWslProject]);

  const handleSelectRemoteAgent = useCallback((agent: AgentConfig | null) => {
    if (!activeRemoteProject) return;
    const key = remoteCacheKey(activeRemoteProject.entry.id, activeRemoteProject.project.id);
    if (agent) {
      const cmd = config.agentCommandOverrides?.[agent.id] ?? agent.command;
      launchAgentInRemoteTerminal(key, cmd, agent.args);
    }
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
    invoke("save_session", { wslEntries: wslEntriesRefForSave.current, remoteEntries: newEntries }).catch(console.error);
  }, [activeRemoteProject, remoteEntries, setRemoteEntries, setActiveRemoteProject]);

  const handleToggleSettings = useCallback(() => setSettingsOpen((v) => !v), []);
  const handleToggleAddMenu = useCallback(() => setShowAddMenu(v => !v), []);
  const handleAddProjectClick = useCallback(() => { setShowAddMenu(false); handleAddProject(); }, [handleAddProject]);
  const handleAddWslClick = useCallback(() => { setShowAddMenu(false); setWslDialogOpen(true); }, []);
  const handleAddRemoteClick = useCallback(() => { setShowAddMenu(false); setRemoteDialogOpen(true); }, []);

  const handleOpenIdeForSidebar = useCallback((projectId: string) => {
    const p = projects.find((proj) => proj.id === projectId);
    if (p) handleOpenIdeCallback(p);
  }, [projects, handleOpenIdeCallback]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-root">
      <TitleBar
        activeProject={activeProject}
        activeWslProject={activeWslProject}
        activeRemoteProject={activeRemoteProject}
        activeWorktreeBranch={activeWorktreeBranch}
        activeWslWorktreeBranch={wslActiveWtBranch}
        activeRemoteWorktreeBranch={remoteActiveWtBranch}
        showAddMenu={showAddMenu}
        loading={loading}
        onOpenSettings={handleToggleSettings}
        onToggleAddMenu={handleToggleAddMenu}
        onAddProject={handleAddProjectClick}
        onAddWsl={IS_WINDOWS ? handleAddWslClick : (() => {})}
        onAddRemote={handleAddRemoteClick}
        onSelectLocalAgent={handleSelectLocalAgent}
        onSelectWslAgent={handleSelectWslAgent}
        onSelectRemoteAgent={handleSelectRemoteAgent}
      />

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
          initialSidebarWidth={initialSidebarWidth}
          onSidebarWidthChange={saveSidebarWidth}
          suppressResizeRef={suppressTerminalResizeRef}
          onAddProject={handleAddProject}
          onRemoveProject={handleRemoveProject}
          onSelectProject={handleSelectProject}
          onSelectFile={handleSelectFile}
          onRefreshGit={handleRefreshGit}
          onBackToMainTerminal={handleBackToMainTerminal}
          onOpenSettings={handleToggleSettings}
          onOpenIde={handleOpenIdeForSidebar}
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
          onSelectWslFile={handleSelectWslFile}
          onSelectRemoteFile={handleSelectRemoteFile}
          onRefreshWslGit={handleRefreshWslGit}
          onRefreshRemoteGit={handleRefreshRemoteGit}
          onOpenWslIde={handleOpenWslIde}
          onOpenRemoteIde={handleOpenRemoteIde}
          onOpenWslWorktreeTerminal={handleOpenWslWorktreeTerminal}
          onOpenRemoteWorktreeTerminal={handleOpenRemoteWorktreeTerminal}
          invokeRemoteGit={invokeRemoteGit}
          loading={loading}
          ideCommandOverrides={config.ideCommandOverrides}
        />

        <MainContent
          config={config}
          activeProject={activeProject}
          activeWorktreePath={activeWorktreePath}
          activeWorktreeBranch={activeWorktreeBranch}
          sideTerminalOpen={sideTerminalOpen}
          sideTerminalWidth={sideTerminalWidth}
          handleSideDividerMouseDown={handleSideDividerMouseDown}
          setSideTerminalOpen={setSideTerminalOpen}
          handleSelectProject={handleSelectProject}
          handleAddProject={handleAddProject}
          suppressResizeRef={suppressTerminalResizeRef}
          activeWslProject={activeWslProject}
          activeWslWorktreePath={activeWslWorktreePath}
          wslSideTerminalOpen={wslSideTerminalOpen}
          setWslSideTerminalOpen={setWslSideTerminalOpen}
          setWslOpenSessions={setWslOpenSessions}
          activeRemoteProject={activeRemoteProject}
          activeRemoteWorktreePath={activeRemoteWorktreePath}
          remoteAuthStore={remoteAuthStore}
          remoteSideTerminalOpen={remoteSideTerminalOpen}
          setRemoteSideTerminalOpen={setRemoteSideTerminalOpen}
          setRemoteOpenSessions={setRemoteOpenSessions}
          wslDiffState={wslDiffState}
          remoteDiffState={remoteDiffState}
          onWslDiffBack={() => setWslDiffState(null)}
          onRemoteDiffBack={() => setRemoteDiffState(null)}
        />

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

      {settingsOpen && (
        <SettingsPanel
          config={config}
          onConfigChange={saveConfig}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {IS_WINDOWS && (
        <WSLDialog
          isOpen={wslDialogOpen}
          onClose={handleWslDialogClose}
          onAdd={handleWSLEntryAdd}
          existingEntries={wslEntries}
          selectedEntryId={wslAddToEntryId ?? undefined}
          agents={agents}
          config={config}
        />
      )}

        <RemoteDialog
          isOpen={remoteDialogOpen}
          onClose={handleRemoteDialogClose}
          onAdd={handleRemoteEntryAdd}
          existingEntries={remoteEntries}
          addProjectMode={remoteAddToEntryId !== null}
          selectedEntryId={remoteAddToEntryId ?? undefined}
          agents={agents}
          config={config}
          existingEntryAuth={remoteAuthStore}
      />

      {pendingAuthEntry && (
        <RemoteAuthDialog
          isOpen={true}
          host={pendingAuthEntry.host}
          port={pendingAuthEntry.port}
          username={pendingAuthEntry.username}
          onCancel={() => {
            setPendingAuthEntry(null);
            setActiveRemoteKey(null);
            setActiveRemoteProject(null);
          }}
          onSuccess={(auth, saved_auth) => {
            setRemoteAuthStore(prev => new Map(prev).set(pendingAuthEntry.id, auth));
            setPendingAuthEntry(null);
            // 如果用户选择记住密码，持久化到 entry
            if (saved_auth) {
              const entries = remoteEntriesRef.current;
              const idx = entries.findIndex(e => e.id === pendingAuthEntry.id);
              if (idx >= 0) {
                const updated = [...entries];
                updated[idx] = { ...updated[idx], saved_auth };
                setRemoteEntries(updated);
                saveSession(undefined, updated);
              }
            }
          }}
        />
      )}

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
