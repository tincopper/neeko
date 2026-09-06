import { create } from 'zustand';

import type { FileChange, Project } from '@/shared/types';

const noop = () => {};

interface IdeProject {
  id: string;
  selected_ide: string | null;
}

/**
 * G2 D4 version gate：changed_files 唯一写入通道按单调递增 version 门控。
 *
 * - `version > 0`（watcher 快照 / 快照读接口）：旧版本（乱序/回退）一律拒绝 ——
 *   增量 patch 与全量覆盖的跨源竞态（P1）从结构上消灭。
 * - `allowEqual=true`（显式主路径刷新）：`version == applied` 也放行 —— 用于
 *   worktree 激活期间主快照被跳过、切回主视图时幂等恢复主数据（死区解除）。
 * - `version <= 0`（WSL/SSH / worktree 兜底，无 versioned 快照语义）恒放行，
 *   与旧行为一致（这些路径不存在 watcher 快照竞争）。
 */
const appliedStatusVersion = new Map<string, number>();

function versionGateAccepts(projectId: string, version: number, allowEqual = false): boolean {
  if (version <= 0) return true;
  const prev = appliedStatusVersion.get(projectId) ?? 0;
  if (version < prev || (version === prev && !allowEqual)) return false;
  appliedStatusVersion.set(projectId, version);
  return true;
}

interface ProjectStoreState {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  isTerminalView: boolean;
  selectProject: (id: string) => void;
  openIde: (project: IdeProject) => void;
  setProjectIde: (projectId: string, ideCommand: string | null) => void;
  /**
   * G2 单一权威写入口：整体替换 changed_files（+可选分支名）。
   * 调用方必须先用 `versionGateAccepts` 判定（version<=0 恒放行）再调用。
   */
  applyGitStatus: (projectId: string, files: FileChange[], branch?: string) => void;
}

export const useProjectStore = create<ProjectStoreState>((set) => ({
  projects: [],
  activeProjectId: null,
  activeProject: null,
  isTerminalView: false,

  selectProject: noop,
  openIde: noop,
  setProjectIde: noop,

  applyGitStatus: (projectId, files, branch) =>
    set((state) => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) return state;

      const gitInfo = project.git_info ?? {
        current_branch: '',
        branches: [] as string[],
        worktrees: [] as import('@/shared/types').Worktree[],
        changed_files: [] as import('@/shared/types').FileChange[],
        is_clean: true,
        git_provider: '',
      };

      const updatedGitInfo = {
        ...gitInfo,
        changed_files: files,
        is_clean: files.length === 0,
        // 快照携带分支时更新分支名（空串不覆盖 —— 空仓库/非 repo 语义）
        current_branch: branch ? branch : gitInfo.current_branch,
      };

      const nextProjects = state.projects.map((p) =>
        p.id === projectId ? { ...p, git_info: updatedGitInfo } : p,
      );

      return {
        projects: nextProjects,
        activeProject:
          state.activeProjectId === projectId
            ? (nextProjects.find((p) => p.id === projectId) ?? state.activeProject)
            : state.activeProject,
      };
    }),
}));

// 仅供同模块内部使用（避免与 action 语义混淆时直接裸引用）；对外唯一判定入口是
// useGitStatusEventsSync / refreshGitFileStates（version<=0 放行规则一致）。
export { versionGateAccepts };
