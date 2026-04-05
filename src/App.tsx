import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IS_WINDOWS } from "./utils/platform";
import ProjectSidebar, { AddProjectModal } from "./components/project";
import SettingsPanel from "./components/SettingsPanel";
import MainContent from "./components/MainContent";
import { TitleBar } from "./components/layout";
import { AppToast } from "./components/AppToast";
import { launchAgentInTerminal } from "./components/terminal";
import { WSLDialog, RemoteDialog, RemoteAuthDialog } from "./components/connections";
import { AgentConfig } from "./types";
import type { WSLEntrySession, RemoteEntrySession } from "./types";
import type { ActiveWslKey } from "./components/connections";
import type { ActiveRemoteKey } from "./hooks/useRemoteProjects";
import { useToast } from "./hooks/useToast";
import { useSideTerminalResize } from "./hooks/useSideTerminalResize";
import { useWorktreeState } from "./hooks/useWorktreeState";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useAppConfig } from "./hooks/useAppConfig";
import { useLocalProjects } from "./hooks/useLocalProjects";
import { useWslProjects, type SaveSessionFn } from "./hooks/useWslProjects";
import { useRemoteProjects } from "./hooks/useRemoteProjects";
import { useWslActions } from "./hooks/useWslActions";
import { useRemoteActions } from "./hooks/useRemoteActions";
import { useCrossDomainRefs } from "./hooks/useCrossDomainRefs";
import { useSessionBootstrap } from "./hooks/useSessionBootstrap";
import "./styles.css";

const noop = () => {};

// ── re-export to keep hook import clean ──
export type { ActiveWslKey, ActiveRemoteKey };

function App() {
  // ── Core hooks ────────────────────────────────────────────────────────────
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
    projects, setProjects, activeProjectId, setActiveProjectId,
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

  // ── Worktree state (local) ──
  const {
    activeWorktreePath, activeWorktreeBranch, openedWorktrees,
    activeWorktreePathRef, openedWorktreesRef,
    updateWtPath, setActiveWorktreePath, setActiveWorktreeBranch, setOpenedWorktrees,
  } = useWorktreeState(activeProjectIdRef);

  // ── Width persistence ──
  const suppressTerminalResizeRef = useRef(false);
  const sidebarWidthSaveTimeout = useRef<ReturnType<typeof setTimeout>>();

  const saveSessionPartial = useCallback((opts: { sidebarWidth?: number | null; sideTerminalWidth?: number | null }) => {
    invoke("save_session", {
      wslEntries: wslEntriesRefForSave.current,
      remoteEntries: remoteEntriesRefForSave.current,
      sidebarWidth: opts.sidebarWidth ?? null,
      sideTerminalWidth: opts.sideTerminalWidth ?? null,
    }).catch(console.error);
  }, []);

  const saveSidebarWidth = useCallback((width: number) => {
    clearTimeout(sidebarWidthSaveTimeout.current);
    sidebarWidthSaveTimeout.current = setTimeout(() => {
      saveSessionPartial({ sidebarWidth: width });
    }, 300);
  }, [saveSessionPartial]);

  const saveSideTerminalWidth = useCallback((width: number) => {
    saveSessionPartial({ sideTerminalWidth: Math.round(width) });
  }, [saveSessionPartial]);

  const { sideTerminalWidth, setSideTerminalWidth, handleSideDividerMouseDown } = useSideTerminalResize(480, saveSideTerminalWidth, suppressTerminalResizeRef);

  // ── Cross-domain setter refs ──
  const xdomain = useCrossDomainRefs();

  // ── Remote actions ──
  const remoteActions = useRemoteActions({
    setActiveProjectId, setActiveProject,
    setActiveWslKey, setActiveWslProject,
    setRemoteEntries, setActiveRemoteKey, setActiveRemoteProject,
    activeRemoteProject, remoteEntries,
    remoteEntriesRef, remoteAuthStore,
    wslEntriesRefForSave, remoteEntriesRefForSave,
    setWslDiffStateRef: xdomain.setWslDiffStateRef,
    wslActiveWtBranchSetterRef: xdomain.wslActiveWtBranchSetterRef,
    wslOpenedWtSetterRef: xdomain.wslOpenedWtSetterRef,
    wslWorktreePathSetterRef: xdomain.wslWorktreePathSetterRef,
    config, showToast, saveSession,
  });

  // ── WSL actions ──
  const wslActions = useWslActions({
    setActiveProjectId, setActiveProject,
    setActiveRemoteKey, setActiveRemoteProject,
    setWslEntries, setActiveWslKey, setActiveWslProject,
    activeWslProject, wslEntries,
    wslEntriesRefForSave, remoteEntriesRefForSave,
    setRemoteDiffStateRef: xdomain.setRemoteDiffStateRef,
    remoteActiveWtBranchSetterRef: xdomain.remoteActiveWtBranchSetterRef,
    remoteOpenedWtSetterRef: xdomain.remoteOpenedWtSetterRef,
    remoteWorktreePathSetterRef: xdomain.remoteWorktreePathSetterRef,
    config, showToast, saveSession,
  });

  // Wire cross-domain refs after both hooks return
  xdomain.setRemoteDiffStateRef.current = remoteActions.setRemoteDiffState;
  xdomain.remoteActiveWtBranchSetterRef.current = remoteActions.setRemoteActiveWtBranch;
  xdomain.remoteOpenedWtSetterRef.current = remoteActions.setRemoteOpenedWt;
  xdomain.remoteWorktreePathSetterRef.current = remoteActions.setActiveRemoteWorktreePath;
  xdomain.setWslDiffStateRef.current = wslActions.setWslDiffState;
  xdomain.wslActiveWtBranchSetterRef.current = wslActions.setWslActiveWtBranch;
  xdomain.wslOpenedWtSetterRef.current = wslActions.setWslOpenedWt;
  xdomain.wslWorktreePathSetterRef.current = wslActions.setActiveWslWorktreePath;

  // ── Side terminal state ──
  const sideTerminalOpen = activeProjectId ? (sideTerminalOpenMap[activeProjectId] ?? false) : false;
  const setSideTerminalOpen = useCallback((open: boolean) => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    setSideTerminalOpenMap(prev => ({ ...prev, [pid]: open }));
  }, [setSideTerminalOpenMap]);

  // ── Add menu ──
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

  // ── Session bootstrap ──
  const { initialSidebarWidth } = useSessionBootstrap({
    loadAgents, loadProjects,
    setWslEntries, setRemoteEntries,
    setSideTerminalWidth,
    worktreeStateRef,
    restoreAuthFromEntries,
  });

  // ── Ref sync ──────────────────────────────────────────────────────────────
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
    wslActions.wslOpenedWtRef.current = wslActions.wslOpenedWt;
    wslActions.activeWslWorktreePathRef.current = wslActions.activeWslWorktreePath;
    remoteActions.remoteOpenedWtRef.current = remoteActions.remoteOpenedWt;
    remoteActions.activeRemoteWorktreePathRef.current = remoteActions.activeRemoteWorktreePath;
  }, [sideTerminalOpen, wslEntries, activeWslKey, remoteEntries, activeRemoteKey,
      wslSideTerminalOpen, remoteSideTerminalOpen, activeWorktreePath, openedWorktrees,
      activeProject, wslActions.wslOpenedWt, wslActions.activeWslWorktreePath,
      remoteActions.remoteOpenedWt, remoteActions.activeRemoteWorktreePath]);

  // ── isTerminalView ref sync ──
  const isTerminalView = activeProject?.active_view === "Terminal";
  isTerminalViewRef.current = isTerminalView || activeWorktreePath !== null;

  // ── Agent / IDE callbacks (declared before keyboard shortcuts) ──
  const handleSelectLocalAgent = useCallback((agent: AgentConfig | null) => {
    if (agent && activeProject) {
      const cmd = config.agentCommandOverrides?.[agent.id] ?? agent.command;
      launchAgentInTerminal(activeProject.id, cmd, agent.args);
    }
  }, [activeProject, config.agentCommandOverrides]);

  const handleOpenIdeCallback = useCallback((project: { id: string; selected_ide: string | null }) => {
    if (!project.selected_ide) {
      showToast("No IDE configured for this project", "error");
      return;
    }
    showToast(`Opening ${project.selected_ide}...`, "info");
    handleOpenIde(project).catch((e: any) => showToast(String(e), "error"));
  }, [handleOpenIde, showToast]);

  // ── Keyboard shortcuts ──
  useKeyboardShortcuts({
    projects, activeProjectId,
    sideTerminalOpenRef, setSideTerminalOpen,
    wslEntriesRef, activeWslKeyRef, selectWslProjectRef,
    remoteEntriesRef, activeRemoteKeyRef, selectRemoteProjectRef,
    selectProjectRef,
    wslSideOpenRef, remoteSideOpenRef,
    setWslSideTerminalOpen, setRemoteSideTerminalOpen,
    activeWorktreePathRef, openedWorktreesRef, updateWtPath,
    wslOpenedWtRef: wslActions.wslOpenedWtRef,
    activeWslWorktreePathRef: wslActions.activeWslWorktreePathRef,
    setWslWorktreePath: wslActions.setActiveWslWorktreePath,
    setWslWtBranch: wslActions.setWslActiveWtBranch,
    remoteOpenedWtRef: remoteActions.remoteOpenedWtRef,
    activeRemoteWorktreePathRef: remoteActions.activeRemoteWorktreePathRef,
    setRemoteWorktreePath: remoteActions.setActiveRemoteWorktreePath,
    setRemoteWtBranch: remoteActions.setRemoteActiveWtBranch,
    isTerminalViewRef, activeProjectRef,
    handleOpenIde: handleOpenIdeCallback,
  });

  // ── Local worktree handlers ──
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

  // ── UI callbacks ──
  const handleToggleSettings = useCallback(() => setSettingsOpen((v) => !v), []);
  const handleToggleAddMenu = useCallback(() => setShowAddMenu(v => !v), []);
  const handleAddProjectClick = useCallback(() => { setShowAddMenu(false); handleAddProject(); }, [handleAddProject]);
  const handleAddWslClick = useCallback(() => { setShowAddMenu(false); setWslDialogOpen(true); }, []);
  const handleAddRemoteClick = useCallback(() => { setShowAddMenu(false); setRemoteDialogOpen(true); }, []);
  const handleAddWslOrNoop = IS_WINDOWS ? handleAddWslClick : noop;

  const handleOpenIdeForSidebar = useCallback((projectId: string) => {
    const p = projects.find((proj) => proj.id === projectId);
    if (p) handleOpenIdeCallback(p);
  }, [projects, handleOpenIdeCallback]);

  const handleOpenWslSideTerminal = useCallback((_: string, projectId: string) => {
    setWslSideTerminalOpen(prev => new Set(prev).add(projectId));
  }, [setWslSideTerminalOpen]);

  const handleOpenRemoteSideTerminal = useCallback((_: string, projectId: string) => {
    setRemoteSideTerminalOpen(prev => new Set(prev).add(projectId));
  }, [setRemoteSideTerminalOpen]);

  const handleSaveProjectSettings = useCallback(async (
    projectId: string,
    agentId: string | null,
    ideCommand: string | null,
  ) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, selected_agent: agentId, selected_ide: ideCommand }
          : p
      )
    );
    setActiveProject((prev) =>
      prev && prev.id === projectId
        ? { ...prev, selected_agent: agentId, selected_ide: ideCommand }
        : prev
    );
    try {
      await invoke("save_session", {
        wslEntries: wslEntriesRefForSave.current,
        remoteEntries: remoteEntriesRefForSave.current,
      });
    } catch (e) {
      console.error("Failed to save session after project settings change:", e);
    }
  }, [setProjects, setActiveProject]);

  const handleWslDiffBack = useCallback(() => {
    wslActions.setWslDiffState(null);
  }, [wslActions.setWslDiffState]);

  const handleRemoteDiffBack = useCallback(() => {
    remoteActions.setRemoteDiffState(null);
  }, [remoteActions.setRemoteDiffState]);

  const handleRemoteAuthCancel = useCallback(() => {
    setPendingAuthEntry(null);
    setActiveRemoteKey(null);
    setActiveRemoteProject(null);
  }, [setPendingAuthEntry, setActiveRemoteKey, setActiveRemoteProject]);

  const handleRemoteAuthSuccess = useCallback((auth: any, saved_auth: string | null | undefined) => {
    if (!pendingAuthEntry) return;
    setRemoteAuthStore(prev => new Map(prev).set(pendingAuthEntry.id, auth));
    setPendingAuthEntry(null);
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
  }, [pendingAuthEntry, setRemoteAuthStore, setPendingAuthEntry, setRemoteEntries, saveSession]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-root">
      <TitleBar
        activeProject={activeProject}
        activeWslProject={activeWslProject}
        activeRemoteProject={activeRemoteProject}
        activeWorktreeBranch={activeWorktreeBranch}
        activeWslWorktreeBranch={wslActions.wslActiveWtBranch}
        activeRemoteWorktreeBranch={remoteActions.remoteActiveWtBranch}
        showAddMenu={showAddMenu}
        loading={loading}
        onOpenSettings={handleToggleSettings}
        onToggleAddMenu={handleToggleAddMenu}
        onAddProject={handleAddProjectClick}
        onAddWsl={handleAddWslOrNoop}
        onAddRemote={handleAddRemoteClick}
        onSelectLocalAgent={handleSelectLocalAgent}
        onSelectWslAgent={wslActions.handleSelectWslAgent}
        onSelectRemoteAgent={remoteActions.handleSelectRemoteAgent}
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
          onSelectWslProject={wslActions.handleSelectWslProject}
          onCloseWslProject={handleCloseWslProject}
          onRemoveWslProject={handleRemoveWslProject}
          onRemoveWslEntry={handleRemoveWslEntry}
          onAddWslProject={handleAddWslProject}
          onSelectRemoteProject={remoteActions.handleSelectRemoteProject}
          onCloseRemoteProject={handleCloseRemoteProject}
          onRemoveRemoteProject={handleRemoveRemoteProject}
          onRemoveRemoteEntry={handleRemoveRemoteEntry}
          onAddRemoteProject={handleAddRemoteProject}
          onOpenWslSideTerminal={handleOpenWslSideTerminal}
          onOpenRemoteSideTerminal={handleOpenRemoteSideTerminal}
          onSelectWslFile={wslActions.handleSelectWslFile}
          onSelectRemoteFile={remoteActions.handleSelectRemoteFile}
          onRefreshWslGit={wslActions.handleRefreshWslGit}
          onRefreshRemoteGit={remoteActions.handleRefreshRemoteGit}
          onOpenWslIde={wslActions.handleOpenWslIde}
          onOpenRemoteIde={remoteActions.handleOpenRemoteIde}
          onOpenWslWorktreeTerminal={wslActions.handleOpenWslWorktreeTerminal}
          onOpenRemoteWorktreeTerminal={remoteActions.handleOpenRemoteWorktreeTerminal}
          invokeRemoteGit={remoteActions.invokeRemoteGit}
          loading={loading}
          ideCommandOverrides={config.ideCommandOverrides}
          agents={agents}
          config={config}
          onSaveProjectSettings={handleSaveProjectSettings}
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
          activeWslWorktreePath={wslActions.activeWslWorktreePath}
          wslSideTerminalOpen={wslSideTerminalOpen}
          setWslSideTerminalOpen={setWslSideTerminalOpen}
          setWslOpenSessions={setWslOpenSessions}
          activeRemoteProject={activeRemoteProject}
          activeRemoteWorktreePath={remoteActions.activeRemoteWorktreePath}
          remoteAuthStore={remoteAuthStore}
          remoteSideTerminalOpen={remoteSideTerminalOpen}
          setRemoteSideTerminalOpen={setRemoteSideTerminalOpen}
          setRemoteOpenSessions={setRemoteOpenSessions}
          wslDiffState={wslActions.wslDiffState}
          remoteDiffState={remoteActions.remoteDiffState}
          onWslDiffBack={handleWslDiffBack}
          onRemoteDiffBack={handleRemoteDiffBack}
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
          onCancel={handleRemoteAuthCancel}
          onSuccess={handleRemoteAuthSuccess}
        />
      )}

      <AppToast toast={toast} />
    </div>
  );
}

export default App;
