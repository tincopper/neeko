/**
 * Workspace 激活态 store（`Workspace` = Project 下的能力容器，见 `docs/domain-model.md`）。
 *
 * 只回答「某项目的**当前 Workspace** 是哪个（及其 opened 清单）」；`Workspace` 的
 * `checkout` / `root` 是其属性，身份由 `WorkspaceKey` 表达。
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';

import { useProjectStore } from '@/shared/store/projectStore';
import { workspaceKeyOf, type WorkspaceKey } from '@/shared/utils/workspaceRef';

/** `opened` 清单里的一项：一个被打开过的 workspace 的 checkout 元数据（git worktree 条目）。 */
export interface CheckoutEntry {
  path: string;
  branch: string;
}

/**
 * 「一个项目当前激活的 Workspace」的完整状态（`activePath` 即其 `checkout.path`）。
 *
 * `activePath === null` = 主仓（main checkout）。路径必须是后端回传的 canonical 形态
 * （见 `src/shared/utils/workspaceRef.ts`）—— 前端不做归一化，也不接受用户手输形态，
 * 否则同一个 checkout 会有两把 key。
 */
export interface WorkspaceState {
  activePath: string | null;
  activeBranch: string;
  opened: CheckoutEntry[];
}

const EMPTY: WorkspaceState = { activePath: null, activeBranch: '', opened: [] };

interface WorkspaceStoreState {
  /**
   * **唯一**表示：按项目存。历史上这里还并行维护过 `activeWorktreePath` /
   * `activeWorktreeBranch` / `openedWorktrees` 三个「当前项目」镜像字段，只在部分写路径
   * 同步 —— 事件回调与跨项目刷新读镜像，于是读到的是别的项目/别的工作树的值
   * （changes 列表串数据、主快照被无条件丢弃都源于此）。镜像已删除，一律经下方
   * selector / hook 派生。
   */
  byProject: Record<string, WorkspaceState>;
  /** Workspace 切换的唯一 mutator（切回主仓传 null）。后端挂载等副作用由调用方负责。 */
  setActiveWorkspace: (projectId: string, path: string | null, branch?: string) => void;
  /** 打开某 workspace（进 opened 清单，不改激活态）。 */
  markWorkspaceOpened: (projectId: string, path: string, branch: string) => void;
  /**
   * 清空某项目的激活单元（项目被移除 / 切换项目类型时）。
   * **同时作废该单元的 status 槽位**（单点收口，调用方无需补刀）。
   */
  clearActiveWorkspace: (projectId: string) => void;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  byProject: {},

  setActiveWorkspace: (projectId, path, branch = '') =>
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

  markWorkspaceOpened: (projectId, path, branch) =>
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

  clearActiveWorkspace: (projectId) => {
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
    useProjectStore.getState().invalidateStatus(workspaceKeyOf(projectId, cur.activePath));
  },
}));

// ── selectors / hooks（唯一读取口）──

export function selectWorkspaceStateOf(
  state: WorkspaceStoreState,
  projectId: string | null | undefined,
): WorkspaceState {
  if (!projectId) return EMPTY;
  return state.byProject[projectId] ?? EMPTY;
}

export function selectActiveCheckoutPath(
  state: WorkspaceStoreState,
  projectId: string | null | undefined,
): string | null {
  return selectWorkspaceStateOf(state, projectId).activePath;
}

/**
 * 「某项目当前 Workspace 的 git 身份（`WorkspaceKey`）」—— **全前端唯一的派生点**。
 *
 * 以前这段派生（`workspaceKeyOf(projectId, byProject[projectId]?.activePath ?? null)`）在 6 处各自
 * 手写（事件回调、hook、组件、store 内部），任何一处漏改或加特例就会让「当前单元」出现第二种
 * 表示 —— 那正是本任务要根治的症状形态。仓储侧只能经本函数与
 * [`activeWorkspaceKeyOf`] 读取。
 */
export function selectActiveWorkspaceKey(
  state: WorkspaceStoreState,
  projectId: string | null | undefined,
): WorkspaceKey | null {
  if (!projectId) return null;
  return workspaceKeyOf(projectId, selectActiveCheckoutPath(state, projectId));
}

/** 命令式读取「当前项目的激活 Workspace 的 checkout 路径」（事件回调、命令式分支）。 */
export function getActiveCheckoutPath(): string | null {
  const projectId = useProjectStore.getState().activeProjectId;
  return selectActiveCheckoutPath(useWorkspaceStore.getState(), projectId);
}

/**
 * 命令式读取「指定项目（缺省 = 当前激活项目）的激活单元 key」。
 *
 * 与 [`selectActiveWorkspaceKey`] 同源：React 渲染用 selector 形态（可响应），
 * 事件回调 / 命令式流程用本函数。
 */
export function activeWorkspaceKeyOf(projectId?: string | null): WorkspaceKey | null {
  const pid = projectId ?? useProjectStore.getState().activeProjectId;
  return selectActiveWorkspaceKey(useWorkspaceStore.getState(), pid);
}

/** React 侧：某项目的完整 Workspace 状态。 */
export function useActiveWorkspace(projectId: string | null): WorkspaceState {
  return useWorkspaceStore(useShallow((s) => selectWorkspaceStateOf(s, projectId)));
}

/** React 侧：当前激活 Workspace 的 checkout 路径（主仓为 null）。 */
export function useActiveCheckoutPath(): string | null {
  const projectId = useProjectStore((s) => s.activeProjectId);
  return useWorkspaceStore((s) => selectActiveCheckoutPath(s, projectId));
}

/**
 * React 侧：「当前激活单元」的 key（响应式形态，供渲染期需要身份的 hook 使用）。
 *
 * 存在的理由与 [`selectActiveWorkspaceKey`] 同一个：身份只能有一个派生点。消费者若自己写
 * `workspaceKeyOf(projectId, useActiveCheckoutPath() ?? null)`，那就是第二次派生 —— 且
 * `projectId` 为空的中间态会产出 `'\u0000'` 这种「谁也匹配不上」的键（真值恒为「未知」，
 * 会被误当成「未挂载」）。取值与 [`selectActiveWorkspaceKey`] 逐字同源。
 */
export function useActiveWorkspaceKey(projectId: string | null): WorkspaceKey | null {
  return useWorkspaceStore((s) => selectActiveWorkspaceKey(s, projectId));
}

export function useActiveCheckoutBranch(): string {
  const projectId = useProjectStore((s) => s.activeProjectId);
  return useWorkspaceStore((s) => selectWorkspaceStateOf(s, projectId).activeBranch);
}
