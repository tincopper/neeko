import { useState, useEffect, useRef, useCallback } from "react";
import { IS_WINDOWS } from "./utils/platform";
import { AddProjectModal } from "./components/project";
import SettingsPanel from "./components/SettingsPanel";
import { TitleBar } from "./components/layout";
import AppLayout from "./components/layout/AppLayout";
import { AppToast } from "./components/AppToast";
import { WSLDialog, RemoteDialog, RemoteAuthDialog } from "./components/connections";
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
import { useWslActions } from "./hooks/useWslActions";
import { useRemoteActions } from "./hooks/useRemoteActions";
import { useCrossDomainRefs } from "./hooks/useCrossDomainRefs";
import { useSessionBootstrap } from "./hooks/useSessionBootstrap";
import { useSessionPersistence } from "./hooks/useSessionPersistence";
import { useSideTerminalState } from "./hooks/useSideTerminalState";
import { useAppRefSync } from "./hooks/useAppRefSync";
import { useAppCallbacks } from "./hooks/useAppCallbacks";
import { AppProvider } from "./context/app-context";
import { SidebarProvider } from "./context/sidebar-context";

// ── re-export to keep hook import clean ──
export type { ActiveWslKey, ActiveRemoteKey };

function App() {
  // ── Core hooks ────────────────────────────────────────────────────────────
  const { config, settingsOpen, setSettingsOpen, saveConfig } = useAppConfig();
  const { toast, showToast } = useToast();
  const local = useLocalProjects();

  // ── Session persistence ──
  const session = useSessionPersistence();

  const wsl = useWslProjects(session.saveSession);
  const remote = useRemoteProjects(session.saveSession);

  const {
    projects, setProjects, activeProjectId, setActiveProjectId,
    activeProject, setActiveProject,
    loading,
    pendingPath, setPendingPath,
    agents, agentInstalledMap,
    sideTerminalOpenMap, setSideTerminalOpenMap,
    activeProjectIdRef, selectProjectRef, activeProjectRef, isTerminalViewRef,
    loadProjects, loadAgents,
    handleAddProject, handleConfirmAddProject, handleRemoveProject,
    handleSelectProject, handleSelectFile, handleRefreshGit, handleOpenIde,
    handleDragEnd,
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
    clearWorktreeForProject,
  } = useWorktreeState(activeProjectIdRef);

  // ── Width persistence ──
  const suppressTerminalResizeRef = useRef(false);

  // Auto-switch back to main terminal when active worktree is deleted.
  // The terminal cache is NOT destroyed, so the session persists for re-attachment.
  useEffect(() => {
    if (!activeWorktreePath || !activeProject?.git_info) return;
    const exists = activeProject.git_info.worktrees.some(wt => wt.path === activeWorktreePath);
    if (!exists) {
      setActiveWorktreePath(null);
      setActiveWorktreeBranch("");
    }
  }, [activeProject?.git_info?.worktrees, activeWorktreePath, setActiveWorktreePath, setActiveWorktreeBranch, activeProject?.git_info]);

  const { sideTerminalWidth, setSideTerminalWidth, handleSideDividerMouseDown } = useSideTerminalResize(480, session.saveSideTerminalWidth);

  // ── Cross-domain setter refs ──
  const xdomain = useCrossDomainRefs();

  // ── Remote actions ──
  const remoteActions = useRemoteActions({
    setActiveProjectId, setActiveProject,
    setActiveWslKey, setActiveWslProject,
    setRemoteEntries, setActiveRemoteKey, setActiveRemoteProject,
    activeRemoteProject, remoteEntries,
    remoteEntriesRef, remoteAuthStore,
    wslEntriesRefForSave: session.wslEntriesRefForSave,
    remoteEntriesRefForSave: session.remoteEntriesRefForSave,
    setWslDiffStateRef: xdomain.setWslDiffStateRef,
    wslActiveWtBranchSetterRef: xdomain.wslActiveWtBranchSetterRef,
    wslOpenedWtSetterRef: xdomain.wslOpenedWtSetterRef,
    wslWorktreePathSetterRef: xdomain.wslWorktreePathSetterRef,
    config, showToast, saveSession: session.saveSession,
  });

  // ── WSL actions ──
  const wslActions = useWslActions({
    setActiveProjectId, setActiveProject,
    setActiveRemoteKey, setActiveRemoteProject,
    setWslEntries, setActiveWslKey, setActiveWslProject,
    activeWslProject, wslEntries,
    wslEntriesRefForSave: session.wslEntriesRefForSave,
    remoteEntriesRefForSave: session.remoteEntriesRefForSave,
    setRemoteDiffStateRef: xdomain.setRemoteDiffStateRef,
    remoteActiveWtBranchSetterRef: xdomain.remoteActiveWtBranchSetterRef,
    remoteOpenedWtSetterRef: xdomain.remoteOpenedWtSetterRef,
    remoteWorktreePathSetterRef: xdomain.remoteWorktreePathSetterRef,
    config, showToast, saveSession: session.saveSession,
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
  const sideTerminal = useSideTerminalState(
    activeProjectId,
    activeProjectIdRef,
    sideTerminalOpenMap,
    setSideTerminalOpenMap,
    setWslSideTerminalOpen,
    setRemoteSideTerminalOpen,
  );

  // ── Worktree diff state ──
  const [worktreeDiffState, setWorktreeDiffState] = useState<{
    worktreePath: string; filePath: string;
  } | null>(null);

  // Clear worktree diff when switching projects
  useEffect(() => {
    setWorktreeDiffState(null);
  }, [activeProjectId]);

  // When switching local projects, always reset that project's activeWorktreePath
  // so the main terminal is shown instead of a stale worktree terminal.
  const handleSelectProjectWithClear = useCallback(async (projectId: string) => {
    clearWorktreeForProject(projectId);
    setWorktreeDiffState(null);
    await handleSelectProject(projectId);
  }, [clearWorktreeForProject, handleSelectProject, setWorktreeDiffState]);

  // ── Session bootstrap ──
  const { initialSidebarWidth } = useSessionBootstrap({
    loadAgents, loadProjects,
    setWslEntries, setRemoteEntries,
    setSideTerminalWidth,
    worktreeStateRef: session.worktreeStateRef,
    restoreAuthFromEntries,
  });

  // ── Ref sync ──
  const isTerminalView = activeProject?.active_view === "Terminal";
  useAppRefSync({
    sideTerminalOpenSet: sideTerminal.sideTerminalOpenSet,
    wslEntries, activeWslKey,
    remoteEntries, activeRemoteKey,
    wslSideTerminalOpen, remoteSideTerminalOpen,
    activeWorktreePath, openedWorktrees, activeProject,
    wslOpenedWt: wslActions.wslOpenedWt,
    activeWslWorktreePath: wslActions.activeWslWorktreePath,
    remoteOpenedWt: remoteActions.remoteOpenedWt,
    activeRemoteWorktreePath: remoteActions.activeRemoteWorktreePath,
    sideTerminalOpenSetRef: sideTerminal.sideTerminalOpenSetRef,
    wslEntriesRef, activeWslKeyRef,
    remoteEntriesRef, activeRemoteKeyRef,
    wslSideOpenRef, remoteSideOpenRef,
    activeWorktreePathRef, openedWorktreesRef, activeProjectRef,
    wslEntriesRefForSave: session.wslEntriesRefForSave,
    remoteEntriesRefForSave: session.remoteEntriesRefForSave,
    wslOpenedWtRef: wslActions.wslOpenedWtRef,
    activeWslWorktreePathRef: wslActions.activeWslWorktreePathRef,
    remoteOpenedWtRef: remoteActions.remoteOpenedWtRef,
    activeRemoteWorktreePathRef: remoteActions.activeRemoteWorktreePathRef,
    isTerminalViewRef,
    isTerminalView,
  });

  // ── App callbacks ──
  const callbacks = useAppCallbacks({
    agentCommandOverrides: config.agentCommandOverrides,
    terminalFontSize: config.fontSize ?? 14,
    terminalShell: config.shell ?? '',
    terminalFontFamily: config.fontFamily ?? '',
    activeProject, projects,
    setProjects, setActiveProject, setActiveProjectId,
    handleOpenIde, showToast,
    activeWorktreePath, setActiveWorktreePath, setActiveWorktreeBranch,
    setOpenedWorktrees, activeProjectIdRef,
    saveWorktreeState: session.saveWorktreeState,
    setWorktreeDiffState,
    saveSession: session.saveSession,
    wslEntriesRefForSave: session.wslEntriesRefForSave,
    remoteEntriesRefForSave: session.remoteEntriesRefForSave,
    setWslDiffState: wslActions.setWslDiffState,
    setRemoteDiffState: remoteActions.setRemoteDiffState,
    pendingAuthEntry, setRemoteAuthStore, setPendingAuthEntry,
    setRemoteEntries, remoteEntriesRef,
    setActiveRemoteKey, setActiveRemoteProject,
    setSettingsOpen,
    handleAddProject, setWslDialogOpen, setRemoteDialogOpen,
  });

  // Override selectProjectRef so keyboard shortcuts also clear worktree state on project switch.
  selectProjectRef.current = handleSelectProjectWithClear;

  // ── Keyboard shortcuts ──
  useKeyboardShortcuts({
    projects, activeProjectId,
    activeProjectIdRef,
    sideTerminalOpenRef: sideTerminal.sideTerminalOpenSetRef,
    setSideTerminalOpen: sideTerminal.setSideTerminalOpen,
    focusedSideTerminalIndex: sideTerminal.focusedSideTerminalIndex,
    setFocusedSideTerminalIndex: sideTerminal.setFocusedSideTerminalIndex,
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
    handleOpenIde: callbacks.handleOpenIdeCallback,
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="w-screen h-screen flex flex-col">
      <TitleBar
        activeProject={activeProject}
        activeWslProject={activeWslProject}
        activeRemoteProject={activeRemoteProject}
        activeWorktreeBranch={activeWorktreeBranch}
        activeWslWorktreeBranch={wslActions.wslActiveWtBranch}
        activeRemoteWorktreeBranch={remoteActions.remoteActiveWtBranch}
        loading={loading}
        installedMap={agentInstalledMap}
        onAddProject={callbacks.handleAddProjectClick}
        onAddWsl={callbacks.handleAddWslOrNoop}
        onAddRemote={callbacks.handleAddRemoteClick}
        onSelectLocalAgent={callbacks.handleSelectLocalAgent}
        onSelectWslAgent={wslActions.handleSelectWslAgent}
        onSelectRemoteAgent={remoteActions.handleSelectRemoteAgent}
        showToast={showToast}
      />

      <AppProvider
        value={{
          config,
          agents: agents ?? [],
          agentInstalledMap,
          loading,
          ideCommandOverrides: config.ideCommandOverrides ?? {},
          showToast,
        }}
      >
        <SidebarProvider
          initialPanelWidth={initialSidebarWidth}
          onPanelWidthPersist={session.saveSidebarWidth}
        >
            <AppLayout
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
              onOpenSettings={callbacks.handleToggleSettings}
              onSelectProject={handleSelectProjectWithClear}
              onSelectFile={handleSelectFile}
              onRefreshGit={handleRefreshGit}
              onBackToMainTerminal={callbacks.handleBackToMainTerminal}
              onOpenIde={callbacks.handleOpenIdeForSidebar}
              onOpenSideTerminal={sideTerminal.handleOpenSideTerminal}
              onOpenWorktreeTerminal={callbacks.handleOpenWorktreeTerminal}
              onSelectWorktreeFile={callbacks.handleSelectWorktreeFile}
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
              onOpenWslSideTerminal={sideTerminal.handleOpenWslSideTerminal}
              onOpenRemoteSideTerminal={sideTerminal.handleOpenRemoteSideTerminal}
              onSelectWslFile={wslActions.handleSelectWslFile}
              onSelectRemoteFile={remoteActions.handleSelectRemoteFile}
              onRefreshWslGit={wslActions.handleRefreshWslGit}
              onRefreshRemoteGit={remoteActions.handleRefreshRemoteGit}
              onOpenWslIde={wslActions.handleOpenWslIde}
              onOpenRemoteIde={remoteActions.handleOpenRemoteIde}
              onOpenWslWorktreeTerminal={wslActions.handleOpenWslWorktreeTerminal}
              onOpenRemoteWorktreeTerminal={remoteActions.handleOpenRemoteWorktreeTerminal}
              invokeRemoteGit={remoteActions.invokeRemoteGit}
              onDragEnd={handleDragEnd}
              onSaveProjectSettings={callbacks.handleSaveProjectSettings}
              activeProject={activeProject}
              activeWorktreePath={activeWorktreePath}
              activeWorktreeBranch={activeWorktreeBranch}
              sideTerminalOpenSet={sideTerminal.sideTerminalOpenSet}
              sideTerminalWidth={sideTerminalWidth}
              handleSideDividerMouseDown={handleSideDividerMouseDown}
              setSideTerminalOpen={sideTerminal.setSideTerminalOpen}
              focusedSideTerminalIndex={sideTerminal.focusedSideTerminalIndex}
              onFocusSideTerminal={sideTerminal.setFocusedSideTerminalIndex}
              handleSelectProject={handleSelectProjectWithClear}
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
              worktreeDiffState={worktreeDiffState}
              onWslDiffBack={callbacks.handleWslDiffBack}
              onRemoteDiffBack={callbacks.handleRemoteDiffBack}
              onWorktreeDiffBack={callbacks.handleWorktreeDiffBack}
              onShowToast={showToast}
            />
            {pendingPath && (
              <AddProjectModal
                pendingPath={pendingPath}
                onConfirm={handleConfirmAddProject}
                onCancel={() => setPendingPath(null)}
                loading={loading}
              />
            )}

          {settingsOpen && (
            <SettingsPanel
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
            />
          )}

          <RemoteDialog
            isOpen={remoteDialogOpen}
            onClose={handleRemoteDialogClose}
            onAdd={handleRemoteEntryAdd}
            existingEntries={remoteEntries}
            addProjectMode={remoteAddToEntryId !== null}
            selectedEntryId={remoteAddToEntryId ?? undefined}
            existingEntryAuth={remoteAuthStore}
          />

          {pendingAuthEntry && (
            <RemoteAuthDialog
              isOpen={true}
              host={pendingAuthEntry.host}
              port={pendingAuthEntry.port}
              username={pendingAuthEntry.username}
              onCancel={callbacks.handleRemoteAuthCancel}
              onSuccess={callbacks.handleRemoteAuthSuccess}
            />
          )}
          </SidebarProvider>
      </AppProvider>
      <AppToast toast={toast} />
    </div>
  );
}

export default App;
