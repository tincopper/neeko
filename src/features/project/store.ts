import { create } from "zustand";
import type { FileChange, Project } from '@/shared/types';

const noop = () => {};

interface IdeProject {
  id: string;
  selected_ide: string | null;
}

interface ProjectStoreState {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  isTerminalView: boolean;
  selectProject: (id: string) => void;
  openIde: (project: IdeProject) => void;
  setProjectIde: (projectId: string, ideCommand: string | null) => void;
  patchChangedFiles: (projectId: string, diff: { added: FileChange[]; removed: string[]; modified: FileChange[] }) => void;
}

export const useProjectStore = create<ProjectStoreState>((set) => ({
  projects: [],
  activeProjectId: null,
  activeProject: null,
  isTerminalView: false,

  selectProject: noop,
  openIde: noop,
  setProjectIde: noop,

  patchChangedFiles: (projectId, diff) =>
    set((state) => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) return state;

      if (
        diff.added.length === 0 &&
        diff.removed.length === 0 &&
        diff.modified.length === 0
      ) {
        return state;
      }

      const gitInfo = project.git_info ?? {
        current_branch: "",
        branches: [] as string[],
        worktrees: [] as import("@/shared/types").Worktree[],
        changed_files: [] as import("@/shared/types").FileChange[],
        is_clean: true,
        git_provider: "",
      };

      const currentFiles = gitInfo.changed_files ?? [];
      const removedSet = new Set(diff.removed);
      let updatedFiles = currentFiles.filter((f) => !removedSet.has(f.path));

      const modifiedMap = new Map(diff.modified.map((f) => [f.path, f]));
      updatedFiles = updatedFiles.map((f) => modifiedMap.get(f.path) ?? f);
      updatedFiles = [...updatedFiles, ...diff.added];

      const updatedGitInfo = {
        ...gitInfo,
        changed_files: updatedFiles,
        is_clean: updatedFiles.length === 0,
      };

      const nextProjects = state.projects.map((p) =>
        p.id === projectId ? { ...p, git_info: updatedGitInfo } : p,
      );

      return {
        projects: nextProjects,
        activeProject:
          state.activeProjectId === projectId
            ? nextProjects.find((p) => p.id === projectId) ?? state.activeProject
            : state.activeProject,
      };
    }),
}));
