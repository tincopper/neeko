import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { switchAgentInRemoteTerminal, remoteCacheKey, refreshRemoteTerminal } from "../components/terminal";
import type { Project, RemoteEntrySession, RemoteProject, WSLProject, GitInfo, AgentConfig, AuthMethod, AppConfig, WSLEntrySession } from "../types";
import type { WorktreeItem } from "./useWorktreeState";

export function useRemoteActions(deps: {
  setActiveProjectId: (id: string | null) => void;
  setActiveProject: (p: Project | null) => void;
  setActiveWslKey: (k: { distro: string; projectId: string } | null) => void;
  setActiveWslProject: (p: { distro: string; project: WSLProject } | null) => void;
  setRemoteEntries: React.Dispatch<React.SetStateAction<RemoteEntrySession[]>>;
  setActiveRemoteKey: React.Dispatch<React.SetStateAction<{ host: string; projectId: string } | null>>;
  setActiveRemoteProject: React.Dispatch<React.SetStateAction<{
    entry: RemoteEntrySession; project: RemoteProject;
  } | null>>;
  activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
  remoteEntries: RemoteEntrySession[];
  remoteAuthStore: Map<string, AuthMethod>;
  config: AppConfig;
  showToast: (msg: string, type?: "info" | "error") => void;
  saveSession: (wsl?: WSLEntrySession[], remote?: RemoteEntrySession[]) => Promise<void>;
}) {
  // ── Diff state ──
  const [remoteDiffState, setRemoteDiffState] = useState<{
    entryId: string; host: string; port: number; username: string; auth: AuthMethod;
    projectPath: string; filePath: string;
  } | null>(null);

  // ── Worktree state ──
  const [activeRemoteWorktreePath, setActiveRemoteWorktreePath] = useState<string | null>(null);
  const [remoteActiveWtBranch, setRemoteActiveWtBranch] = useState("");
  const [remoteOpenedWt, setRemoteOpenedWt] = useState<WorktreeItem[]>([]);

  // ── invokeRemoteGit helper ──
  const invokeRemoteGit = useCallback(
    async (command: string, entryId: string, extra: Record<string, unknown>): Promise<unknown> => {
      const entry = deps.remoteEntries.find(e => e.id === entryId);
      const auth = deps.remoteAuthStore.get(entryId);
      if (!entry || !auth) throw new Error("No auth for entry");
      return invoke(command, {
        host: entry.host, port: entry.port, username: entry.username,
        auth, ...extra
      });
    },
    [deps.remoteEntries, deps.remoteAuthStore]
  );

  // ── Select Remote project ──
  const handleSelectRemoteProject = useCallback((host: string, project: RemoteProject) => {
    deps.setActiveProjectId(null);
    deps.setActiveProject(null);
    deps.setActiveWslKey(null);
    deps.setActiveWslProject(null);
    deps.setActiveRemoteKey({ host, projectId: project.id });
    setActiveRemoteWorktreePath(null);
    setRemoteActiveWtBranch("");
    setRemoteOpenedWt([]);

    const entry = deps.remoteEntries.find(e => e.host === host);
    if (entry) {
      deps.setActiveRemoteProject({ entry, project });
      setRemoteDiffState(null);

      const auth = deps.remoteAuthStore.get(entry.id);
      if (auth) {
        invoke<GitInfo>("refresh_remote_git_info", {
          host: entry.host, port: entry.port, username: entry.username,
          auth, projectPath: project.path,
        })
        .then(gitInfo => {
          deps.setActiveRemoteProject(prev => prev?.project.id === project.id
            ? { ...prev, project: { ...prev.project, git_info: gitInfo } }
            : prev
          );
          deps.setRemoteEntries(prev => prev.map(e => ({
            ...e,
            projects: e.projects.map(p => p.id === project.id ? { ...p, git_info: gitInfo } : p)
          })));
        })
        .catch(() => {});
      }
    }
  }, [deps.remoteEntries, deps.remoteAuthStore, deps.setActiveProjectId, deps.setActiveProject, deps.setActiveWslKey,
      deps.setActiveWslProject, deps.setActiveRemoteKey, deps.setActiveRemoteProject, deps.setRemoteEntries]);

  // ── Select Remote file (diff) ──
  const handleSelectRemoteFile = useCallback((entryId: string, projectPath: string, filePath: string) => {
    const entry = deps.remoteEntries.find(e => e.id === entryId);
    const auth = deps.remoteAuthStore.get(entryId);
    if (entry && auth) {
      setRemoteDiffState({ entryId, host: entry.host, port: entry.port, username: entry.username, auth, projectPath, filePath });
    }
  }, [deps.remoteEntries, deps.remoteAuthStore]);

  // ── Refresh Remote git ──
  const handleRefreshRemoteGit = useCallback(async (entryId: string, projectId: string, projectPath: string) => {
    const result = await invokeRemoteGit("refresh_remote_git_info", entryId, { projectPath }).catch(() => null);
    if (!result) return;
    const gitInfo = result as GitInfo;
    deps.setRemoteEntries(prev => prev.map(e => ({
      ...e,
      projects: e.projects.map(p => p.id === projectId ? { ...p, git_info: gitInfo } as RemoteProject : p)
    })));
    deps.setActiveRemoteProject(prev =>
      prev?.project.id === projectId ? { ...prev, project: { ...prev.project, git_info: gitInfo } } : prev
    );
  }, [invokeRemoteGit, deps.setRemoteEntries, deps.setActiveRemoteProject]);

  // ── Open Remote IDE ──
  const handleOpenRemoteIde = useCallback((entryId: string, projectPath: string, ide: string) => {
    if (!ide) { deps.showToast("No IDE selected for this project", "error"); return; }
    const entry = deps.remoteEntries.find(e => e.id === entryId);
    if (!entry) return;
    invoke("open_remote_ide", { host: entry.host, port: entry.port, username: entry.username, projectPath, ide })
      .catch(e => deps.showToast(String(e), "error"));
  }, [deps.remoteEntries, deps.showToast]);

  // ── Open Remote worktree terminal ──
  const handleOpenRemoteWorktreeTerminal = useCallback((_entryId: string, worktreePath: string, branch: string) => {
    setActiveRemoteWorktreePath(worktreePath);
    setRemoteActiveWtBranch(branch);
    setRemoteOpenedWt(prev => {
      if (prev.some(w => w.path === worktreePath)) return prev;
      return [...prev, { path: worktreePath, branch }];
    });
    setRemoteDiffState(null);
  }, []);

  // ── Select Remote agent ──
  const handleSelectRemoteAgent = useCallback((agent: AgentConfig | null) => {
    const proj = deps.activeRemoteProject;
    if (!proj) return;
    const key = remoteCacheKey(proj.entry.id, proj.project.id);
    if (agent) {
      void switchAgentInRemoteTerminal(
        key,
        agent.id,
        deps.config.agentCommandOverrides,
      );
    }
    const agentId = agent?.id ?? null;
    const newEntries = deps.remoteEntries.map(e => ({
      ...e,
      projects: e.projects.map(p =>
        p.id === proj.project.id ? { ...p, selected_agent: agentId } : p
      ),
    }));
    deps.setRemoteEntries(newEntries);
    deps.setActiveRemoteProject(prev =>
      prev ? { ...prev, project: { ...prev.project, selected_agent: agentId } } : prev
    );
    if (!agent) {
      setTimeout(() => refreshRemoteTerminal(key), 50);
    }
    deps.saveSession(undefined, newEntries).catch(console.error);
  }, [deps.activeRemoteProject, deps.remoteEntries, deps.setRemoteEntries, deps.setActiveRemoteProject, deps.config.agentCommandOverrides, deps.saveSession]);

  return {
    remoteDiffState, setRemoteDiffState,
    activeRemoteWorktreePath, setActiveRemoteWorktreePath,
    remoteActiveWtBranch, setRemoteActiveWtBranch,
    remoteOpenedWt, setRemoteOpenedWt,
    invokeRemoteGit,
    handleSelectRemoteProject,
    handleSelectRemoteFile,
    handleRefreshRemoteGit,
    handleOpenRemoteIde,
    handleOpenRemoteWorktreeTerminal,
    handleSelectRemoteAgent,
  };
}
