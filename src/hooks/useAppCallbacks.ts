import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IS_WINDOWS } from "../utils/platform";
import { launchAgentInTerminal, refreshTerminal } from "../components/terminal";
import { AgentConfig } from "../types";
import type { Project, WSLEntrySession, RemoteEntrySession, AuthMethod } from "../types";
import type { SaveSessionFn } from "./useWslProjects";

const noop = () => {};

export interface UseAppCallbacksParams {
  // Config
  agentCommandOverrides: Record<string, string> | undefined;
  // Project state
  activeProject: Project | null;
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setActiveProject: React.Dispatch<React.SetStateAction<Project | null>>;
  // IDE
  handleOpenIde: (project: { id: string; selected_ide: string | null }) => Promise<void>;
  // Toast
  showToast: (message: string, type?: "info" | "error") => void;
  // Worktree
  activeWorktreePath: string | null;
  setActiveWorktreePath: (path: string | null) => void;
  setActiveWorktreeBranch: (branch: string) => void;
  setOpenedWorktrees: React.Dispatch<React.SetStateAction<import("./useWorktreeState").WorktreeItem[]>>;
  activeProjectIdRef: React.MutableRefObject<string | null>;
  saveWorktreeState: (projectId: string, wtPath: string | null) => void;
  // Session
  saveSession: SaveSessionFn;
  wslEntriesRefForSave: React.MutableRefObject<WSLEntrySession[]>;
  remoteEntriesRefForSave: React.MutableRefObject<RemoteEntrySession[]>;
  // WSL actions
  setWslDiffState: (s: null) => void;
  // Remote actions
  setRemoteDiffState: (s: null) => void;
  // Remote auth
  pendingAuthEntry: { id: string } | null;
  setRemoteAuthStore: React.Dispatch<React.SetStateAction<Map<string, AuthMethod>>>;
  setPendingAuthEntry: (entry: null) => void;
  setRemoteEntries: React.Dispatch<React.SetStateAction<RemoteEntrySession[]>>;
  remoteEntriesRef: React.MutableRefObject<RemoteEntrySession[]>;
  setActiveRemoteKey: (key: null) => void;
  setActiveRemoteProject: (project: null) => void;
  // UI
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAddMenu: React.Dispatch<React.SetStateAction<boolean>>;
  handleAddProject: () => void;
  setWslDialogOpen: (open: boolean) => void;
  setRemoteDialogOpen: (open: boolean) => void;
}

export interface UseAppCallbacksResult {
  handleSelectLocalAgent: (agent: AgentConfig | null) => void;
  handleOpenIdeCallback: (project: { id: string; selected_ide: string | null }) => void;
  handleOpenIdeForSidebar: (projectId: string) => void;
  handleBackToMainTerminal: (projectId: string) => void;
  handleOpenWorktreeTerminal: (worktreePath: string, branch: string) => void;
  handleSaveProjectSettings: (projectId: string, agentId: string | null, ideCommand: string | null) => Promise<void>;
  handleWslDiffBack: () => void;
  handleRemoteDiffBack: () => void;
  handleRemoteAuthCancel: () => void;
  handleRemoteAuthSuccess: (auth: AuthMethod, saved_auth: string | null | undefined) => void;
  handleToggleSettings: () => void;
  handleToggleAddMenu: () => void;
  handleAddProjectClick: () => void;
  handleAddWslClick: () => void;
  handleAddRemoteClick: () => void;
  handleAddWslOrNoop: (() => void) | typeof noop;
}

export function useAppCallbacks(params: UseAppCallbacksParams): UseAppCallbacksResult {
  const {
    agentCommandOverrides,
    activeProject, projects,
    setProjects, setActiveProject,
    handleOpenIde, showToast,
    activeWorktreePath, setActiveWorktreePath, setActiveWorktreeBranch,
    setOpenedWorktrees, activeProjectIdRef, saveWorktreeState,
    saveSession, wslEntriesRefForSave, remoteEntriesRefForSave,
    setWslDiffState, setRemoteDiffState,
    pendingAuthEntry, setRemoteAuthStore, setPendingAuthEntry,
    setRemoteEntries, remoteEntriesRef,
    setActiveRemoteKey, setActiveRemoteProject,
    setSettingsOpen, setShowAddMenu,
    handleAddProject, setWslDialogOpen, setRemoteDialogOpen,
  } = params;

  // ── Agent / IDE ──
  const handleSelectLocalAgent = useCallback((agent: AgentConfig | null) => {
    if (activeProject) {
      if (agent) {
        const cmd = agentCommandOverrides?.[agent.id] ?? agent.command;
        launchAgentInTerminal(activeProject.id, cmd, agent.args);
      } else {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === activeProject.id ? { ...p, selected_agent: null } : p
          )
        );
        setActiveProject((prev) =>
          prev && prev.id === activeProject.id ? { ...prev, selected_agent: null } : prev
        );
        // 延迟重建终端，确保 selected_agent=null 状态已更新
        // 否则 refreshTerminal 立即触发重建时 project.selected_agent 仍是旧值
        setTimeout(() => refreshTerminal(activeProject.id), 50);
      }
    }
  }, [activeProject, agentCommandOverrides, setProjects, setActiveProject]);

  const handleOpenIdeCallback = useCallback((project: { id: string; selected_ide: string | null }) => {
    if (!project.selected_ide) {
      showToast("No IDE configured for this project", "error");
      return;
    }
    showToast(`Opening ${project.selected_ide}...`, "info");
    handleOpenIde(project).catch((e: unknown) => showToast(String(e), "error"));
  }, [handleOpenIde, showToast]);

  const handleOpenIdeForSidebar = useCallback((projectId: string) => {
    const p = projects.find((proj) => proj.id === projectId);
    if (p) handleOpenIdeCallback(p);
  }, [projects, handleOpenIdeCallback]);

  // ── Local worktree ──
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
  }, [setActiveWorktreePath, setActiveWorktreeBranch, setOpenedWorktrees, saveWorktreeState, activeProjectIdRef]);

  // ── Project settings ──
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
  }, [setProjects, setActiveProject, wslEntriesRefForSave, remoteEntriesRefForSave]);

  // ── Diff back ──
  const handleWslDiffBack = useCallback(() => {
    setWslDiffState(null);
  }, [setWslDiffState]);

  const handleRemoteDiffBack = useCallback(() => {
    setRemoteDiffState(null);
  }, [setRemoteDiffState]);

  // ── Remote auth ──
  const handleRemoteAuthCancel = useCallback(() => {
    setPendingAuthEntry(null);
    setActiveRemoteKey(null);
    setActiveRemoteProject(null);
  }, [setPendingAuthEntry, setActiveRemoteKey, setActiveRemoteProject]);

  const handleRemoteAuthSuccess = useCallback((auth: AuthMethod, saved_auth: string | null | undefined) => {
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
  }, [pendingAuthEntry, setRemoteAuthStore, setPendingAuthEntry, setRemoteEntries, saveSession, remoteEntriesRef]);

  // ── UI toggles ──
  const handleToggleSettings = useCallback(() => setSettingsOpen((v) => !v), [setSettingsOpen]);
  const handleToggleAddMenu = useCallback(() => setShowAddMenu(v => !v), [setShowAddMenu]);
  const handleAddProjectClick = useCallback(() => { setShowAddMenu(false); handleAddProject(); }, [handleAddProject, setShowAddMenu]);
  const handleAddWslClick = useCallback(() => { setShowAddMenu(false); setWslDialogOpen(true); }, [setShowAddMenu, setWslDialogOpen]);
  const handleAddRemoteClick = useCallback(() => { setShowAddMenu(false); setRemoteDialogOpen(true); }, [setShowAddMenu, setRemoteDialogOpen]);
  const handleAddWslOrNoop = IS_WINDOWS ? handleAddWslClick : noop;

  return {
    handleSelectLocalAgent,
    handleOpenIdeCallback,
    handleOpenIdeForSidebar,
    handleBackToMainTerminal,
    handleOpenWorktreeTerminal,
    handleSaveProjectSettings,
    handleWslDiffBack,
    handleRemoteDiffBack,
    handleRemoteAuthCancel,
    handleRemoteAuthSuccess,
    handleToggleSettings,
    handleToggleAddMenu,
    handleAddProjectClick,
    handleAddWslClick,
    handleAddRemoteClick,
    handleAddWslOrNoop,
  };
}
