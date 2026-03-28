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
import { WSLProject, RemoteProject, AgentConfig } from "./types";
import type { ActiveWslKey } from "./components/connections";
import type { ActiveRemoteKey } from "./hooks/useRemoteProjects";
import { useToast } from "./hooks/useToast";
import { useSideTerminalResize } from "./hooks/useSideTerminalResize";
import { useWorktreeState } from "./hooks/useWorktreeState";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useAppConfig } from "./hooks/useAppConfig";
import { useLocalProjects } from "./hooks/useLocalProjects";
import { useWslProjects } from "./hooks/useWslProjects";
import { useRemoteProjects } from "./hooks/useRemoteProjects";
import "./styles.css";

// ── re-export to keep hook import clean ──
export type { ActiveWslKey, ActiveRemoteKey };

function App() {
  // ── Hooks ─────────────────────────────────────────────────────────────────
  const { config, settingsOpen, setSettingsOpen, saveConfig } = useAppConfig();
  const { toast, showToast } = useToast();

  const local = useLocalProjects();
  const wsl = useWslProjects();
  const remote = useRemoteProjects();

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
    loadWSLEntries, handleWSLEntryAdd,
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
    loadRemoteEntries, handleRemoteEntryAdd,
    handleCloseRemoteProject, handleRemoveRemoteProject, handleRemoveRemoteEntry,
    handleAddRemoteProject, handleRemoteDialogClose,
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

  const { sideTerminalWidth, handleSideDividerMouseDown } = useSideTerminalResize();

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
  }, [sideTerminalOpen, wslEntries, activeWslKey, remoteEntries, activeRemoteKey,
      wslSideTerminalOpen, remoteSideTerminalOpen, activeWorktreePath, openedWorktrees,
      activeProject]);

  // ── Cross-domain select handlers ──────────────────────────────────────────
  const handleSelectWslProject = useCallback((distro: string, project: WSLProject) => {
    setActiveProjectId(null);
    setActiveProject(null);
    setActiveWslKey({ distro, projectId: project.id });
    setActiveWslProject({ distro, project });
    setActiveRemoteKey(null);
    setActiveRemoteProject(null);
  }, [setActiveProjectId, setActiveProject, setActiveWslKey, setActiveWslProject, setActiveRemoteKey, setActiveRemoteProject]);
  selectWslProjectRef.current = handleSelectWslProject;

  const handleSelectRemoteProject = useCallback((host: string, project: RemoteProject) => {
    setActiveProjectId(null);
    setActiveProject(null);
    setActiveWslKey(null);
    setActiveWslProject(null);
    setActiveRemoteKey({ host, projectId: project.id });
    const entry = remoteEntries.find(e => e.host === host);
    if (entry) setActiveRemoteProject({ entry, project });
  }, [remoteEntries, setActiveProjectId, setActiveProject, setActiveWslKey, setActiveWslProject, setActiveRemoteKey, setActiveRemoteProject]);
  selectRemoteProjectRef.current = handleSelectRemoteProject;

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
      invoke("set_view_terminal", { projectId: activeProjectIdRef.current }).catch(() => {});
    }
  }, [setActiveWorktreePath, setActiveWorktreeBranch, setOpenedWorktrees]);

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
    isTerminalViewRef,
    activeProjectRef,
    handleOpenIde: handleOpenIdeCallback,
  });

  // ── Startup: listen for git changes ───────────────────────────────────────
  useEffect(() => {
    loadAgents();
    loadProjects();
    if (IS_WINDOWS) loadWSLEntries();
    loadRemoteEntries();

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
      launchAgentInTerminal(activeProject.id, agent.command, agent.args);
    }
  }, [activeProject]);

  const handleSelectWslAgent = useCallback((agent: AgentConfig | null) => {
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
  }, [activeWslProject, wslEntries, setWslEntries, setActiveWslProject]);

  const handleSelectRemoteAgent = useCallback((agent: AgentConfig | null) => {
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
          loading={loading}
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
          activeWslProject={activeWslProject}
          wslSideTerminalOpen={wslSideTerminalOpen}
          setWslSideTerminalOpen={setWslSideTerminalOpen}
          setWslOpenSessions={setWslOpenSessions}
          activeRemoteProject={activeRemoteProject}
          remoteAuthStore={remoteAuthStore}
          remoteSideTerminalOpen={remoteSideTerminalOpen}
          setRemoteSideTerminalOpen={setRemoteSideTerminalOpen}
          setRemoteOpenSessions={setRemoteOpenSessions}
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
          onSuccess={(auth) => {
            setRemoteAuthStore(prev => new Map(prev).set(pendingAuthEntry.id, auth));
            setPendingAuthEntry(null);
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
