import { useCallback } from "react";
import { useProjectStore } from "@/store/projectStore";
import type { GitInfo } from "@/types/git";

/**
 * Minimal command interface required by useRefreshGitInfo.
 * The full ProjectCommands type also satisfies this contract.
 */
interface RefreshGitCommands {
  refreshGitInfo(): Promise<GitInfo>;
}

/**
 * useRefreshGitInfo — extracts the git refresh + store mutation logic
 * into a reusable hook.
 *
 * Accepts commands with a refreshGitInfo method, returns a memoized
 * callback that takes a project identifier, calls refreshGitInfo,
 * and updates the zustand store with the fresh git data.
 *
 * @param commands - An object providing a refreshGitInfo() method,
 *                   or null (no-op when null).
 */
export function useRefreshGitInfo(commands: RefreshGitCommands | null) {
  return useCallback(
    async (project: { id: string; path: string }) => {
      if (!commands) return;
      const gitInfo = await commands.refreshGitInfo();
      useProjectStore.setState((state) => {
        const nextProjects = state.projects.map((p) =>
          p.id === project.id ? { ...p, git_info: gitInfo } : p,
        );
        return {
          projects: nextProjects,
          activeProject:
            state.activeProjectId === project.id
              ? (nextProjects.find((p) => p.id === project.id) ?? state.activeProject)
              : state.activeProject,
        };
      });
    },
    [commands],
  );
}
