import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';

import { useProjectStore } from '@/shared/store/projectStore';
import { repoKeyOf, type RepoKey } from '@/shared/utils/repoRef';

/** 一个项目下某个工作树的展示条目。 */
export interface WorktreeSnapshotItem {
  path: string;
  branch: string;
}

/**
 * 「一个项目当前在看哪个仓库单元」的完整状态。
 *
 * `activePath === null` = 主仓单元。路径必须是后端回传的 canonical 形态
 * （见 `src/shared/utils/repoRef.ts` 的说明）—— 前端不做归一化，也不接受用户手输形态，
 * 否则同一个工作树会有两把 key。
 */
export interface WorktreeUnitState {
  activePath: string | null;
  activeBranch: string;
  opened: WorktreeSnapshotItem[];
}

const EMPTY: WorktreeUnitState = { activePath: null, activeBranch: '', opened: [] };

interface WorktreeStoreState {
  /**
   * **唯一**表示：按项目存。历史上这里还并行维护过 `activeWorktreePath` /
   * `activeWorktreeBranch` / `openedWorktrees` 三个「当前项目」镜像字段，只在部分写路径
   * 同步 —— 事件回调与跨项目刷新读镜像，于是读到的是别的项目/别的工作树的值
   * （changes 列表串数据、主快照被无条件丢弃都源于此）。镜像已删除，一律经下方
   * selector / hook 派生。
   */
  byProject: Record<string, WorktreeUnitState>;
  /** 单元切换的唯一 mutator（切回主仓传 null）。后端挂载等副作用由调用方负责。 */
  setActiveWorktree: (projectId: string, path: string | null, branch?: string) => void;
  /** 打开某工作树（进 opened 清单，不改激活态）。 */
  markWorktreeOpened: (projectId: string, path: string, branch: string) => void;
  /**
   * 清空某项目的激活单元（项目被移除 / 切换项目类型时）。
   * **同时作废该单元的 status 槽位**（单点收口，调用方无需补刀）。
   */
  clearActiveWorktree: (projectId: string) => void;
}

export const useWorktreeStore = create<WorktreeStoreState>((set, get) => ({
  byProject: {},

  setActiveWorktree: (projectId, path, branch = '') =>
    set((state) => {
      const cur = state.byProject[projectId] ?? EMPTY;
      if (cur.activePath === path && (branch === '' || cur.activeBranch === branch)) return state;
      return {
        byProject: {
          ...state.byProject,
          [projectId]: { ...cur, activePath: path, activeBranch: branch || cur.activeBranch },
        },
      };
    }),

  markWorktreeOpened: (projectId, path, branch) =>
    set((state) => {
      const cur = state.byProject[projectId] ?? EMPTY;
      if (cur.opened.some((item) => item.path === path)) return state;
      return {
        byProject: {
          ...state.byProject,
          [projectId]: { ...cur, opened: [...cur.opened, { path, branch }] },
        },
      };
    }),

  clearActiveWorktree: (projectId) => {
    const cur = get().byProject[projectId];
    if (!cur || cur.activePath === null) return;
    set((state) => {
      const entry = state.byProject[projectId];
      if (!entry) return state;
      return {
        byProject: {
          ...state.byProject,
          [projectId]: { ...entry, activePath: null, activeBranch: '' },
        },
      };
    });
    // 被清掉的单元从此没有生产者，残留快照不得继续被渲染（I1-b：未知 ≠ 旧数据）。
    // 作废随本 mutator 单点发生：调用方（切项目 / 删 worktree / 项目移除 / 跨类型切换）
    // 不必各自记得补一刀 —— 漏补的调用点正是旧数据藏身处（本次审核实测 4 处全漏）。
    useProjectStore.getState().invalidateStatus(repoKeyOf(projectId, cur.activePath));
  },
}));

// ── selectors / hooks（唯一读取口）──

export function selectWorktreeStateOf(
  state: WorktreeStoreState,
  projectId: string | null | undefined,
): WorktreeUnitState {
  if (!projectId) return EMPTY;
  return state.byProject[projectId] ?? EMPTY;
}

export function selectActiveWorktreePath(
  state: WorktreeStoreState,
  projectId: string | null | undefined,
): string | null {
  return selectWorktreeStateOf(state, projectId).activePath;
}

/**
 * 「某项目当前视图所在仓库单元」的 key —— **全前端唯一的派生点**。
 *
 * 以前这段派生（`repoKeyOf(projectId, byProject[projectId]?.activePath ?? null)`）在 6 处各自
 * 手写（事件回调、hook、组件、store 内部），任何一处漏改或加特例就会让「当前单元」出现第二种
 * 表示 —— 那正是本任务要根治的症状形态。仓储侧只能经本函数与
 * [`activeRepoKeyOf`] 读取。
 */
export function selectActiveRepoKey(
  state: WorktreeStoreState,
  projectId: string | null | undefined,
): RepoKey | null {
  if (!projectId) return null;
  return repoKeyOf(projectId, selectActiveWorktreePath(state, projectId));
}

/** 命令式读取「当前项目的激活单元」（事件回调、命令式分支）。 */
export function getActiveWorktreePath(): string | null {
  const projectId = useProjectStore.getState().activeProjectId;
  return selectActiveWorktreePath(useWorktreeStore.getState(), projectId);
}

/**
 * 命令式读取「指定项目（缺省 = 当前激活项目）的激活单元 key」。
 *
 * 与 [`selectActiveRepoKey`] 同源：React 渲染用 selector 形态（可响应），
 * 事件回调 / 命令式流程用本函数。
 */
export function activeRepoKeyOf(projectId?: string | null): RepoKey | null {
  const pid = projectId ?? useProjectStore.getState().activeProjectId;
  return selectActiveRepoKey(useWorktreeStore.getState(), pid);
}

/** React 侧：某项目的完整工作树状态。 */
export function useActiveWorktree(projectId: string | null): WorktreeUnitState {
  return useWorktreeStore(useShallow((s) => selectWorktreeStateOf(s, projectId)));
}

/** React 侧：当前激活项目的单元路径（主仓为 null）。 */
export function useActiveWorktreePath(): string | null {
  const projectId = useProjectStore((s) => s.activeProjectId);
  return useWorktreeStore((s) => selectActiveWorktreePath(s, projectId));
}

/**
 * React 侧：「当前激活单元」的 key（响应式形态，供渲染期需要身份的 hook 使用）。
 *
 * 存在的理由与 [`selectActiveRepoKey`] 同一个：身份只能有一个派生点。消费者若自己写
 * `repoKeyOf(projectId, useActiveWorktreePath() ?? null)`，那就是第二次派生 —— 且
 * `projectId` 为空的中间态会产出 `'\u0000'` 这种「谁也匹配不上」的键（真值恒为「未知」，
 * 会被误当成「未挂载」）。取值与 [`selectActiveRepoKey`] 逐字同源。
 */
export function useActiveRepoKey(projectId: string | null): RepoKey | null {
  return useWorktreeStore((s) => selectActiveRepoKey(s, projectId));
}

export function useActiveWorktreeBranch(): string {
  const projectId = useProjectStore((s) => s.activeProjectId);
  return useWorktreeStore((s) => selectWorktreeStateOf(s, projectId).activeBranch);
}
