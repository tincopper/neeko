import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SessionStore, WSLEntrySession, RemoteEntrySession, Project, FileChange, GitBranchInfo, Worktree, GitStatusDiff } from "../types";
import { useAppStore } from "../store/appStore";

/** 将后端 git status 字符串映射为前端 FileChange.status */
function mapGitStatus(status: string): FileChange["status"] {
   switch (status) {
      case "Untracked": return "Untracked";
      case "Added": return "Added";
      case "Deleted": return "Deleted";
      case "Renamed": return "Renamed";
      default: return "Modified";
   }
}

export function useSessionBootstrap(deps: {
   loadProjects: () => Promise<void>;
   setWslEntries: React.Dispatch<React.SetStateAction<WSLEntrySession[]>>;
   setRemoteEntries: React.Dispatch<React.SetStateAction<RemoteEntrySession[]>>;
   restoreWorktreeState: (worktreeState: Record<string, string>) => void;
   restoreAuthFromEntries: (entries: RemoteEntrySession[]) => void;
}) {
   const [initialSidebarWidth, setInitialSidebarWidth] = useState<number>(280);
   const [initializing, setInitializing] = useState(true);

   useEffect(() => {
      deps.loadProjects().then(async () => {
         try {
            const projects = await invoke<Project[]>("list_projects");
            const defaultGitInfo = {
               current_branch: "",
               branches: [] as string[],
               worktrees: [] as Worktree[],
               changed_files: [] as FileChange[],
               is_clean: true,
            };

            const patchGitInfo = (projectId: string, patch: Partial<typeof defaultGitInfo>) => {
               useAppStore.setState((state) => {
                  const nextProjects = state.projects.map((proj) => {
                     if (proj.id !== projectId) return proj;
                     return { ...proj, git_info: { ...(proj.git_info ?? defaultGitInfo), ...patch } };
                  });
                  return {
                     projects: nextProjects,
                     activeProject: state.activeProjectId === projectId
                        ? nextProjects.find(proj => proj.id === projectId) ?? state.activeProject
                        : state.activeProject,
                  };
               });
            };

            for (const p of projects) {
               if (!p.git_info?.changed_files?.length) {
                  // split 轻量路径：与 watcher git-changed 处理一致，避免重量级 refresh_git_info
                  invoke<FileChange[]>("get_worktree_changed_files", { projectId: p.id, worktreePath: "" })
                     .then((changedFiles) => {
                        patchGitInfo(p.id, { changed_files: changedFiles, is_clean: changedFiles.length === 0 });
                     })
                     .catch(() => { });

                  invoke<GitBranchInfo>("get_git_branch_info_command", { projectId: p.id })
                     .then((branchInfo) => {
                        patchGitInfo(p.id, {
                           current_branch: branchInfo.current_branch,
                           branches: branchInfo.branches,
                           worktrees: branchInfo.worktrees,
                        });
                     })
                     .catch(() => { });
               }
            }
         } catch { }
      });

      invoke<SessionStore>("load_session").then((session) => {
         const wslE = session.wsl_entries ?? [];
         const remoteE = session.remote_entries ?? [];
         deps.setWslEntries(wslE);
         deps.setRemoteEntries(remoteE);
         if (session.sidebar_width) {
            setInitialSidebarWidth(session.sidebar_width);
         }
         const wtState = session.worktree_state;
         if (wtState && typeof wtState === "object") {
            deps.restoreWorktreeState(wtState);
         }
         deps.restoreAuthFromEntries(remoteE);
         setInitializing(false);
      }).catch(console.error);

      const unlistenPromise = listen<string>("git-changed", (event) => {
         const projectId = event.payload;

         // split 轻量路径：分别获取 changed_files 和 branch_info，避免全量 refresh_git_info
         const defaultGitInfo = {
            current_branch: "",
            branches: [] as string[],
            worktrees: [] as Worktree[],
            changed_files: [] as FileChange[],
            is_clean: true,
         };

         const updateGitInfo = (patch: Partial<typeof defaultGitInfo>) => {
            useAppStore.setState((state) => {
               const nextProjects = state.projects.map((p) => {
                  if (p.id !== projectId) return p;
                  return { ...p, git_info: { ...(p.git_info ?? defaultGitInfo), ...patch } };
               });
               return {
                  projects: nextProjects,
                  activeProject: state.activeProjectId === projectId
                     ? nextProjects.find(p => p.id === projectId) ?? state.activeProject
                     : state.activeProject,
               };
            });
         };

         // 1. 获取变更文件列表（轻量）
         invoke<FileChange[]>("get_worktree_changed_files", { projectId, worktreePath: "" })
            .then((changedFiles) => {
               updateGitInfo({ changed_files: changedFiles, is_clean: changedFiles.length === 0 });
            })
            .catch((e) => console.error("[SessionBootstrap] get_worktree_changed_files failed:", e));

         // 2. 获取分支信息（异步，不阻塞文件列表更新）
         invoke<GitBranchInfo>("get_git_branch_info_command", { projectId })
            .then((branchInfo) => {
               updateGitInfo({
                  current_branch: branchInfo.current_branch,
                  branches: branchInfo.branches,
                  worktrees: branchInfo.worktrees,
               });
            })
            .catch((e) => console.error("[SessionBootstrap] get_git_branch_info_command failed:", e));
      });

      // 增量 diff 事件：直接 patch store，无需重新请求后端
      const unlistenDiffPromise = listen<GitStatusDiff>("git-status-diff", (event) => {
         const diff = event.payload;
         if (!diff.project_id) return;
         useAppStore.getState().patchChangedFiles(diff.project_id, {
            added: diff.added.map((f) => ({
               path: f.path,
               status: mapGitStatus(f.status),
               additions: 0,
               deletions: 0,
            })),
            removed: diff.removed,
            modified: diff.modified.map((f) => ({
               path: f.path,
               status: mapGitStatus(f.status),
               additions: 0,
               deletions: 0,
            })),
         });
      });

      return () => {
         unlistenPromise.then((unlisten) => unlisten());
         unlistenDiffPromise.then((unlisten) => unlisten());
      };
   }, []);

   return { initialSidebarWidth, initializing };
}
