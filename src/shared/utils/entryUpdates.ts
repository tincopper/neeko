import type { Dispatch, SetStateAction } from "react";
import type { GitInfo } from '@/shared/types';

type ProjectWithId = {
  id: string;
};

type EntryWithProjects<TProject extends ProjectWithId> = {
  projects: TProject[];
};

export function applyStateAction<T>(prev: T, action: SetStateAction<T>): T {
  if (typeof action === "function") {
    return (action as (current: T) => T)(prev);
  }
  return action;
}

export function upsertEntryById<TEntry extends { id: string }>(
  entries: TEntry[],
  entry: TEntry,
): TEntry[] {
  const index = entries.findIndex((item) => item.id === entry.id);
  if (index < 0) {
    return [...entries, entry];
  }
  const next = [...entries];
  next[index] = entry;
  return next;
}

export function updateProjectInEntries<
  TProject extends ProjectWithId,
  TEntry extends EntryWithProjects<TProject>,
>(
  entries: TEntry[],
  projectId: string,
  updater: (project: TProject) => TProject,
): TEntry[] {
  return entries.map((entry) => ({
    ...entry,
    projects: entry.projects.map((project) => (
      project.id === projectId ? updater(project) : project
    )),
  })) as TEntry[];
}

interface BuildRefreshGitHandlerOptions<
  TProject extends { id: string; git_info?: GitInfo | null },
  TEntry extends EntryWithProjects<TProject>,
  TActiveProject,
  TContext,
> {
  refreshGitInfo: (projectPath: string, context: TContext) => Promise<GitInfo | null>;
  setEntries: Dispatch<SetStateAction<TEntry[]>>;
  setActiveProject: Dispatch<SetStateAction<TActiveProject | null>>;
  isActiveProject: (activeProject: TActiveProject, projectId: string) => boolean;
  updateActiveProject: (activeProject: TActiveProject, gitInfo: GitInfo) => TActiveProject;
}

export function buildRefreshGitHandler<
  TProject extends { id: string; git_info?: GitInfo | null },
  TEntry extends EntryWithProjects<TProject>,
  TActiveProject,
  TContext,
>(
  options: BuildRefreshGitHandlerOptions<TProject, TEntry, TActiveProject, TContext>,
) {
  return async (context: TContext, projectId: string, projectPath: string): Promise<void> => {
    const gitInfo = await options.refreshGitInfo(projectPath, context);
    if (!gitInfo) {
      return;
    }

    options.setEntries((prev) => (
      updateProjectInEntries(prev, projectId, (project) => ({
        ...project,
        git_info: gitInfo,
      }))
    ));

    options.setActiveProject((prev) => {
      if (!prev || !options.isActiveProject(prev, projectId)) {
        return prev;
      }
      return options.updateActiveProject(prev, gitInfo);
    });
  };
}
