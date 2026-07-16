import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { listProjects } from "../../project/api/projectApi";
import { getWorktreeChangedFiles, getGitBranchInfo } from "../../git/api/gitApi";
import { loadSession } from "../api/sessionApi";
import type { FileChange, Worktree, GitStatusDiff } from '@/shared/types';
import { useProjectStore } from '@/features/project/store';

/** 将后�?git status 字符串映射为前端 FileChange.status */
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
   restoreWorktreeState: (worktreeState: Record<string, string>) => void;
}) {
   const [initialSidebarWidth, setInitialSidebarWidth] = useState<number>(280);
   const [initializing, setInitializing] = useState(true);

   useEffect(() => {
      deps.loadProjects().then(async () => {
         try {
             const projects = await listProjects();
            const defaultGitInfo = {
               current_branch: "",
               branches: [] as string[],
               worktrees: [] as Worktree[],
               changed_files: [] as FileChange[],
               is_clean: true,
               git_provider: "",
            };

            const patchGitInfo = (projectId: string, patch: Partial<typeof defaultGitInfo>) => {
               useProjectStore.setState((state) => {
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
                  // split 轻量路径：与 watcher git-changed 处理一致，避免重量�?refresh_git_info
               getWorktreeChangedFiles(
                  p.id,
                  "",
               )
                  .then((changedFiles) => {
                     patchGitInfo(p.id, { changed_files: changedFiles, is_clean: changedFiles.length === 0 });
                  })
                  .catch(() => { });

               getGitBranchInfo(p.id)
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

      loadSession().then((session) => {
         if (session.sidebar_width) {
            setInitialSidebarWidth(session.sidebar_width);
         }
         const wtState = session.worktree_state;
         if (wtState && typeof wtState === "object") {
            deps.restoreWorktreeState(wtState);
         }

         // 恢复上次活动的项目（来自 session 持久化的 active_project_id）
         const activeId = session.active_project_id;
         if (activeId) {
           const state = useProjectStore.getState();
           const activeProj = state.projects.find((p) => p.id === activeId) ?? null;
           if (activeProj) {
             useProjectStore.setState({
               activeProjectId: activeId,
               activeProject: activeProj,
             });

             // 触发 git info 刷新，确保 commit panel 立即展示数据
             const defaultGitInfo = {
               current_branch: "",
               branches: [] as string[],
               worktrees: [] as Worktree[],
               changed_files: [] as FileChange[],
               is_clean: true,
               git_provider: "",
             };
             const patchGitInfo = (patch: Partial<typeof defaultGitInfo>) => {
               useProjectStore.setState((s) => {
                 const nextProjects = s.projects.map((p) =>
                   p.id === activeId ? { ...p, git_info: { ...(p.git_info ?? defaultGitInfo), ...patch } } : p,
                 );
                 return {
                   projects: nextProjects,
                   activeProject: s.activeProjectId === activeId
                     ? nextProjects.find((p) => p.id === activeId) ?? s.activeProject
                     : s.activeProject,
                 };
               });
             };
             getWorktreeChangedFiles(activeId, "").then((changedFiles) => {
               patchGitInfo({ changed_files: changedFiles, is_clean: changedFiles.length === 0 });
             }).catch(() => {});
             getGitBranchInfo(activeId).then((branchInfo) => {
               patchGitInfo({
                 current_branch: branchInfo.current_branch,
                 branches: branchInfo.branches,
                 worktrees: branchInfo.worktrees,
               });
             }).catch(() => {});
           }
         }

         setInitializing(false);
      }).catch(console.error);

      const unlistenPromise = listen<string>("git-changed", (event) => {
         const projectId = event.payload;

         // split 轻量路径：分别获�?changed_files �?branch_info，避免全�?refresh_git_info
         const defaultGitInfo = {
            current_branch: "",
            branches: [] as string[],
            worktrees: [] as Worktree[],
            changed_files: [] as FileChange[],
            is_clean: true,
            git_provider: "",
         };

         const updateGitInfo = (patch: Partial<typeof defaultGitInfo>) => {
            useProjectStore.setState((state) => {
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
          getWorktreeChangedFiles(
             projectId,
             "",
          )
             .then((changedFiles) => {
                updateGitInfo({ changed_files: changedFiles, is_clean: changedFiles.length === 0 });
             })
             .catch((e) => console.error("[SessionBootstrap] get_worktree_changed_files failed:", e));

          // 2. 获取分支信息（异步，不阻塞文件列表更新）
          getGitBranchInfo(projectId)
             .then((branchInfo) => {
                updateGitInfo({
                   current_branch: branchInfo.current_branch,
                   branches: branchInfo.branches,
                   worktrees: branchInfo.worktrees,
                });
             })
             .catch((e) => console.error("[SessionBootstrap] get_git_branch_info_command failed:", e));
      });

      // 增量 diff 事件：直�?patch store，无需重新请求后端
      const unlistenDiffPromise = listen<GitStatusDiff>("git-status-diff", (event) => {
         const diff = event.payload;
         if (!diff.project_id) return;
         useProjectStore.getState().patchChangedFiles(diff.project_id, {
            added: diff.added.map((f) => ({
               path: f.path,
               status: mapGitStatus(f.status),
               additions: f.additions ?? 0,
               deletions: f.deletions ?? 0,
            })),
            removed: diff.removed,
            modified: diff.modified.map((f) => ({
               path: f.path,
               status: mapGitStatus(f.status),
               additions: f.additions ?? 0,
               deletions: f.deletions ?? 0,
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
