import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IS_WINDOWS } from "../utils/platform";
import { switchAgentInTerminal, refreshTerminal } from "../components/terminal";
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
  setActiveProjectId: React.Dispatch<React.SetStateAction<string | null>>;
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
  // Worktree diff
  setWorktreeDiffState: (s: { worktreePath: string; filePath: string } | null) => void;
  // Session
  saveSession: SaveSessionFn;
  wslEntriesRefForSave: React.MutableRefObject<WSLEntrySession[]>;
  remoteEntriesRefForSave: React.MutableRefObject<RemoteEntrySession[]>;
  // WSL actions
  setWslDiffState: (s: null) => void;
  // Remote actions
  setRemoteDiffState: (s: null) => void;
  // 用于 switchAgentInTerminal 的终端参数
  terminalFontSize?: number;
  terminalShell?: string;
  terminalFontFamily?: string;
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
  handleAddProject: () => void;
  setWslDialogOpen: (open: boolean) => void;
  setRemoteDialogOpen: (open: boolean) => void;
}

export interface UseAppCallbacksResult {
  handleSelectLocalAgent: (agent: AgentConfig | null, cacheKey: string) => void;
  handleOpenIdeCallback: (project: { id: string; selected_ide: string | null }) => void;
  handleOpenIdeForSidebar: (projectId: string) => void;
  handleBackToMainTerminal: (projectId: string) => void;
  handleOpenWorktreeTerminal: (projectId: string, worktreePath: string, branch: string) => void;
  handleSelectWorktreeFile: (worktreePath: string, filePath: string) => void;
  handleWorktreeDiffBack: () => void;
  handleSaveProjectSettings: (projectId: string, agentId: string | null, ideCommand: string | null) => Promise<void>;
  handleWslDiffBack: () => void;
  handleRemoteDiffBack: () => void;
  handleRemoteAuthCancel: () => void;
  handleRemoteAuthSuccess: (auth: AuthMethod, saved_auth: string | null | undefined) => void;
  handleToggleSettings: () => void;
  handleAddProjectClick: () => void;
  handleAddWslClick: () => void;
  handleAddRemoteClick: () => void;
  handleAddWslOrNoop: (() => void) | typeof noop;
}

export function useAppCallbacks(params: UseAppCallbacksParams): UseAppCallbacksResult {
  const {
    agentCommandOverrides,
    activeProject, projects,
    setProjects, setActiveProject, setActiveProjectId,
    handleOpenIde, showToast,
    activeWorktreePath, setActiveWorktreePath, setActiveWorktreeBranch,
    setOpenedWorktrees, activeProjectIdRef, saveWorktreeState,
    setWorktreeDiffState,
    saveSession, wslEntriesRefForSave, remoteEntriesRefForSave,
    setWslDiffState, setRemoteDiffState,
    pendingAuthEntry, setRemoteAuthStore, setPendingAuthEntry,
    setRemoteEntries, remoteEntriesRef,
    setActiveRemoteKey, setActiveRemoteProject,
    terminalFontSize = 14,
    terminalShell = '',
    terminalFontFamily = '',
    setSettingsOpen,
    handleAddProject, setWslDialogOpen, setRemoteDialogOpen,
  } = params;

  // ── Agent / IDE ──
  const handleSelectLocalAgent = useCallback((agent: AgentConfig | null, cacheKey: string) => {
    if (activeProject) {
      const agentId = agent?.id ?? null;
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject.id ? { ...p, selected_agent: agentId } : p
        )
      );
      setActiveProject((prev) =>
        prev && prev.id === activeProject.id ? { ...prev, selected_agent: agentId } : prev
      );
      if (agent) {
        void switchAgentInTerminal(
          cacheKey,
          activeProject.path,
          activeProject.name,
          agent.id,
          terminalFontSize,
          terminalShell,
          terminalFontFamily,
          activeProject.id,
          agentCommandOverrides,
        );
      } else {
        setTimeout(() => refreshTerminal(activeProject.id), 50);
      }
    }
  }, [activeProject, agentCommandOverrides, terminalFontSize, terminalShell, terminalFontFamily, setProjects, setActiveProject]);

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
    setWorktreeDiffState(null);
    invoke("set_view_terminal", { projectId }).catch(() => {});
  }, [activeWorktreePath, setActiveWorktreePath, setActiveWorktreeBranch, setWorktreeDiffState]);

  const handleOpenWorktreeTerminal = useCallback(async (projectId: string, worktreePath: string, branch: string) => {
    // 若目标项目未激活，先激活它，确保 MainContent 的 {activeProject ?} 分支能渲染
    if (activeProjectIdRef.current !== projectId) {
      setActiveProjectId(projectId);
      await invoke("set_active_project", { projectId });
    }
    setWorktreeDiffState(null);
    setActiveWorktreePath(worktreePath);
    setActiveWorktreeBranch(branch);
    setOpenedWorktrees((prev) => {
      if (prev.some((w) => w.path === worktreePath)) return prev;
      return [...prev, { path: worktreePath, branch }];
    });
    saveWorktreeState(projectId, worktreePath);
    invoke("set_view_terminal", { projectId }).catch(() => {});
  }, [setActiveProjectId, setActiveWorktreePath, setActiveWorktreeBranch, setOpenedWorktrees, saveWorktreeState, activeProjectIdRef, setWorktreeDiffState]);

  // ── Worktree file diff ──
  const handleSelectWorktreeFile = useCallback((worktreePath: string, filePath: string) => {
    setWorktreeDiffState({ worktreePath, filePath });
  }, [setWorktreeDiffState]);

  const handleWorktreeDiffBack = useCallback(() => {
    setWorktreeDiffState(null);
  }, [setWorktreeDiffState]);

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
  const handleAddProjectClick = useCallback(() => { handleAddProject(); }, [handleAddProject]);
  const handleAddWslClick = useCallback(() => { setWslDialogOpen(true); }, [setWslDialogOpen]);
  const handleAddRemoteClick = useCallback(() => { setRemoteDialogOpen(true); }, [setRemoteDialogOpen]);
  const handleAddWslOrNoop = IS_WINDOWS ? handleAddWslClick : noop;

  return {
    handleSelectLocalAgent,
    handleOpenIdeCallback,
    handleOpenIdeForSidebar,
    handleBackToMainTerminal,
    handleOpenWorktreeTerminal,
    handleSelectWorktreeFile,
    handleWorktreeDiffBack,
    handleSaveProjectSettings,
    handleWslDiffBack,
    handleRemoteDiffBack,
    handleRemoteAuthCancel,
    handleRemoteAuthSuccess,
    handleToggleSettings,
    handleAddProjectClick,
    handleAddWslClick,
    handleAddRemoteClick,
    handleAddWslOrNoop,
  };
}
