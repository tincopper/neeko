import { create } from 'zustand';

import type { FileChange, GitStatusSnapshot, Project } from '@/shared/types';
import type { RepoKey } from '@/shared/utils/repoRef';

/** 打开 IDE 用的最小投影（项目卡片回传）。 */
interface IdeProject {
  id: string;
  selected_ide: string | null;
}

function noop(): void {
  /* overridden in useLocalProjects */
}

/**
 * 一个仓库单元（主仓或某个 linked worktree）的 git status。
 *
 * 与后端 `GitStatusSnapshot` 同形：`repo_key` 是 [`RepoKey`] 的字符串形态，
 * `version` 在该单元内单调递增。**per-project 的 `git_info` 不再持有 changed_files** ——
 * 未提交变更是 per-工作树 的事实（HEAD / index / workdir 各自独立）。
 */
export type RepoStatus = GitStatusSnapshot;

interface ProjectStoreState {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  isTerminalView: boolean;
  /**
   * 各仓库单元的权威 status，键为 `repoKeyOf(projectId, worktreePath)`。
   *
   * **缺失 = 未知**（该单元未挂载 / 刚被切走 / 非 git）—— 消费端必须渲染空态或加载态，
   * 严禁把「未知」当「无变更」或直接沿用上一个单元的数据：那正是本次根治的症状形态。
   */
  statuses: Record<string, RepoStatus>;
  /**
   * changed_files 的**唯一**写入口（内含 version gate）。
   *
   * 门控规则只有一条：`version` 必须严格大于已应用的版本（同一单元）。没有
   * 「version=0 恒放行」、「allowEqual 同版本也放行」这类分支 —— 那两条正是
   * pull 结果覆盖 push 快照（串数据）的入口。生产者一律（含 pull 计算的 WSL/SSH）
   * 都保证 version 前进。
   */
  applyStatus: (snapshot: RepoStatus) => void;
  /** 作废一个单元（离开视图 / 后端 unwatch）：槽位不得残留可被渲染的旧数据。 */
  invalidateStatus: (repoKey: RepoKey | string) => void;
  selectProject: (id: string) => void;
  openIde: (project: IdeProject) => void;
  setProjectIde: (projectId: string, ideCommand: string | null) => void;
}

export const useProjectStore = create<ProjectStoreState>((set) => ({
  projects: [],
  activeProjectId: null,
  activeProject: null,
  isTerminalView: false,

  statuses: {},

  applyStatus: (snapshot) =>
    set((state) => {
      const prev = state.statuses[snapshot.repo_key];
      if (prev && snapshot.version <= prev.version) return state;
      const next: Partial<ProjectStoreState> = {
        statuses: { ...state.statuses, [snapshot.repo_key]: snapshot },
      };
      // 主仓单元的 HEAD 投影到项目卡片（`git_info.current_branch` 的唯一写者）。
      // worktree 的分支不进这里 —— 它属于该单元的槽位，视图经 selectBranch 读取。
      if (snapshot.worktree_path === null) {
        const owner = snapshot.project_id;
        next.projects = state.projects.map((p) =>
          p.id === owner && p.git_info && p.git_info.current_branch !== snapshot.branch
            ? { ...p, git_info: { ...p.git_info, current_branch: snapshot.branch } }
            : p,
        );
        if (state.activeProjectId === owner) {
          const updated = next.projects.find((p) => p.id === owner) ?? null;
          next.activeProject = updated ?? state.activeProject;
        }
      }
      return next;
    }),

  invalidateStatus: (repoKey) =>
    set((state) => {
      if (!(repoKey in state.statuses)) return state;
      const rest = { ...state.statuses };
      delete rest[repoKey];
      return { statuses: rest };
    }),

  selectProject: noop,
  openIde: noop,
  setProjectIde: noop,
}));

// ── selectors（消费端唯一读取口；不得绕过它们直接摸 statuses）──
// 「不得绕过」已由护栏 `check_repo_unit_identity` 的判据 7 强制：生产代码里
// `projectStore.statuses` 直读（或解构 `{ statuses }`）命中即违规，白名单仅本文件。

export function selectStatus(
  state: ProjectStoreState,
  repoKey: RepoKey | string,
): RepoStatus | undefined {
  return state.statuses[String(repoKey)];
}

/** 该单元是否已有权威状态。
 *
 * 用于区分「未知」（未挂载 / 刚被切走）与「已知且干净」（`entries` 为空数组）——
 * 两者不得混同（把未知当干净正是本次根治的症状形态）。
 */
export function selectHasStatus(state: ProjectStoreState, repoKey: RepoKey | string): boolean {
  return String(repoKey) in state.statuses;
}

/** 某单元的变更条目；`undefined` = 未知（未挂载），空数组 = 确实干净。 */
export function selectEntries(
  state: ProjectStoreState,
  repoKey: RepoKey | string,
): FileChange[] | undefined {
  return selectStatus(state, repoKey)?.entries;
}

export function selectBranch(state: ProjectStoreState, repoKey: RepoKey | string): string {
  return selectStatus(state, repoKey)?.branch ?? '';
}
