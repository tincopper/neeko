import { useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { launchAgentInWslTerminal, wslCacheKey, refreshWslTerminal } from "../components/terminal";
import type { Project, WSLEntrySession, WSLProject, RemoteEntrySession, RemoteProject, GitInfo, AgentConfig, AppConfig } from "../types";
import type { DiffSetter, RemoteDiffState } from "./useCrossDomainRefs";
import type { WorktreeItem } from "./useWorktreeState";

export function useWslActions(deps: {
  setActiveProjectId: (id: string | null) => void;
  setActiveProject: (p: Project | null) => void;
  setActiveRemoteKey: (k: { host: string; projectId: string } | null) => void;
  setActiveRemoteProject: (p: { entry: RemoteEntrySession; project: RemoteProject } | null) => void;
  setWslEntries: React.Dispatch<React.SetStateAction<WSLEntrySession[]>>;
  setActiveWslKey: React.Dispatch<React.SetStateAction<{ distro: string; projectId: string } | null>>;
  setActiveWslProject: React.Dispatch<React.SetStateAction<{ distro: string; project: WSLProject } | null>>;
  activeWslProject: { distro: string; project: WSLProject } | null;
  wslEntries: WSLEntrySession[];
  wslEntriesRefForSave: React.MutableRefObject<WSLEntrySession[]>;
  remoteEntriesRefForSave: React.MutableRefObject<RemoteEntrySession[]>;
  setRemoteDiffStateRef: DiffSetter<RemoteDiffState>;
  remoteActiveWtBranchSetterRef: React.MutableRefObject<((b: string) => void) | null>;
  remoteOpenedWtSetterRef: React.MutableRefObject<((u: WorktreeItem[] | ((p: WorktreeItem[]) => WorktreeItem[])) => void) | null>;
  remoteWorktreePathSetterRef: React.MutableRefObject<((p: string | null) => void) | null>;
  config: AppConfig;
  showToast: (msg: string, type?: "info" | "error") => void;
  saveSession: (wsl?: WSLEntrySession[], remote?: RemoteEntrySession[]) => Promise<void>;
}) {
  // ── Diff state ──
  const [wslDiffState, setWslDiffState] = useState<{
    distro: string; projectPath: string; filePath: string;
  } | null>(null);

  // ── Worktree state ──
  const [activeWslWorktreePath, setActiveWslWorktreePath] = useState<string | null>(null);
  const [wslActiveWtBranch, setWslActiveWtBranch] = useState("");
  const [wslOpenedWt, setWslOpenedWt] = useState<WorktreeItem[]>([]);
  const wslOpenedWtRef = useRef<WorktreeItem[]>([]);
  const activeWslWorktreePathRef = useRef<string | null>(null);
  wslOpenedWtRef.current = wslOpenedWt;
  activeWslWorktreePathRef.current = activeWslWorktreePath;

  // ── Select WSL project ──
  const handleSelectWslProject = useCallback((distro: string, project: WSLProject) => {
    deps.setActiveProjectId(null);
    deps.setActiveProject(null);
    deps.setActiveWslKey({ distro, projectId: project.id });
    deps.setActiveWslProject({ distro, project });
    deps.setActiveRemoteKey(null);
    deps.setActiveRemoteProject(null);
    setWslDiffState(null);
    deps.setRemoteDiffStateRef.current?.(null);
    setActiveWslWorktreePath(null);
    deps.remoteWorktreePathSetterRef.current?.(null);
    setWslActiveWtBranch("");
    deps.remoteActiveWtBranchSetterRef.current?.("");
    setWslOpenedWt([]);
    deps.remoteOpenedWtSetterRef.current?.([]);

    invoke<GitInfo>("refresh_wsl_git_info", { distro, projectPath: project.path })
      .then(gitInfo => {
        deps.setActiveWslProject(prev => prev?.project.id === project.id
          ? { ...prev, project: { ...prev.project, git_info: gitInfo } }
          : prev
        );
        deps.setWslEntries(prev => prev.map(e => ({
          ...e,
          projects: e.projects.map(p => p.id === project.id ? { ...p, git_info: gitInfo } : p)
        })));
      })
      .catch(() => {});
  }, [deps.setActiveProjectId, deps.setActiveProject, deps.setActiveWslKey, deps.setActiveWslProject,
      deps.setActiveRemoteKey, deps.setActiveRemoteProject, deps.setWslEntries]);

  // ── Select WSL file (diff) ──
  const handleSelectWslFile = useCallback((distro: string, projectPath: string, filePath: string) => {
    setWslDiffState({ distro, projectPath, filePath });
  }, []);

  // ── Refresh WSL git ──
  const handleRefreshWslGit = useCallback(async (distro: string, projectId: string, projectPath: string) => {
    const gitInfo = await invoke<GitInfo>("refresh_wsl_git_info", { distro, projectPath }).catch(() => null);
    if (!gitInfo) return;
    deps.setWslEntries(prev => prev.map(e => ({
      ...e,
      projects: e.projects.map(p => p.id === projectId ? { ...p, git_info: gitInfo } : p)
    })));
    deps.setActiveWslProject(prev =>
      prev?.project.id === projectId ? { ...prev, project: { ...prev.project, git_info: gitInfo } } : prev
    );
  }, [deps.setWslEntries, deps.setActiveWslProject]);

  // ── Open WSL IDE ──
  const handleOpenWslIde = useCallback((distro: string, projectPath: string, ide: string) => {
    if (!ide) { deps.showToast("No IDE selected for this project", "error"); return; }
    invoke("open_wsl_ide", { distro, projectPath, ide }).catch(e => deps.showToast(String(e), "error"));
  }, [deps.showToast]);

  // ── Open WSL worktree terminal ──
  const handleOpenWslWorktreeTerminal = useCallback((_distro: string, worktreePath: string, branch: string) => {
    setActiveWslWorktreePath(worktreePath);
    setWslActiveWtBranch(branch);
    setWslOpenedWt(prev => {
      if (prev.some(w => w.path === worktreePath)) return prev;
      return [...prev, { path: worktreePath, branch }];
    });
    setWslDiffState(null);
    deps.setRemoteDiffStateRef.current?.(null);
  }, []);

  // ── Select WSL agent ──
  const handleSelectWslAgent = useCallback((agent: AgentConfig | null) => {
    const proj = deps.activeWslProject;
    if (!proj) return;
    const key = wslCacheKey(proj.distro, proj.project.id);
    if (agent) {
      const cmd = deps.config.agentCommandOverrides?.[agent.id] ?? agent.command;
      launchAgentInWslTerminal(key, cmd, agent.args);
    }
    const agentId = agent?.id ?? null;
    const newEntries = deps.wslEntries.map(e => ({
      ...e,
      projects: e.projects.map(p =>
        p.id === proj.project.id ? { ...p, selected_agent: agentId } : p
      ),
    }));
    deps.setWslEntries(newEntries);
    deps.setActiveWslProject(prev =>
      prev ? { ...prev, project: { ...prev.project, selected_agent: agentId } } : prev
    );
    if (!agent) {
      refreshWslTerminal(key);
    }
    invoke("save_session", { wslEntries: newEntries, remoteEntries: deps.remoteEntriesRefForSave.current }).catch(console.error);
  }, [deps.activeWslProject, deps.wslEntries, deps.setWslEntries, deps.setActiveWslProject, deps.config.agentCommandOverrides]);

  return {
    wslDiffState, setWslDiffState,
    activeWslWorktreePath, setActiveWslWorktreePath,
    wslActiveWtBranch, setWslActiveWtBranch,
    wslOpenedWt, setWslOpenedWt,
    wslOpenedWtRef, activeWslWorktreePathRef,
    handleSelectWslProject,
    handleSelectWslFile,
    handleRefreshWslGit,
    handleOpenWslIde,
    handleOpenWslWorktreeTerminal,
    handleSelectWslAgent,
  };
}
