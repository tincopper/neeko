/**
 * Workspace 激活态 store（`Workspace` = Project 下的能力容器，见 `docs/domain-model.md`）。
 *
 * 只回答「某项目的**当前 Workspace** 是哪个（及其 opened 清单）」；`Workspace` 的
 * `checkout` / `root` 是其属性，身份由 `WorkspaceKey` 表达。
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';

import { useProjectStore } from '@/shared/store/projectStore';
import {
  ProjectId,
  WorkspaceSession,
  workspaceRootOf,
  type WorkspaceKey,
} from '@/shared/utils/workspaceRef';

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
  setActiveWorkspace: (projectId: ProjectId, path: string | null, branch?: string) => void;
  /** 打开某 workspace（进 opened 清单，不改激活态）。 */
  markWorkspaceOpened: (projectId: ProjectId, path: string, branch: string) => void;
  /**
   * 清空某项目的激活单元（项目被移除 / 切换项目类型时）。
   * **同时作废该单元的 status 槽位**（单点收口，调用方无需补刀）。
   */
  clearActiveWorkspace: (projectId: ProjectId) => void;
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
    useProjectStore
      .getState()
      .invalidateStatus(WorkspaceSession.of(projectId, cur.activePath ?? null).key);
  },
}));

/**
 * 清单读取后的**一次性**收口：激活的 worktree 已不在清单里 ⇒ 回落主仓。
 *
 * **它不是 render-time 判据**（C4 / prd R2.2）：判死的触发者只有两类 ——
 * ① **用户动作**（删 worktree → `useWorktreeListActions` 的 `clearActiveWorkspace`、切项目 →
 *    `useProjectStore.selectProject`）；② **清单读取**（session 恢复、手动刷新 git 信息）。
 * 旧实现在 `useAppShellData` 里拿 `project.git_info.worktrees` 与激活态逐渲染比较，等于给
 * 「谁在看」加了一个由 render 驱动的第二判死点（与挂载/恢复两条路径互相打架）。
 *
 * 清单是后端 `git worktree list` 的权威结果（只含 linked worktree，主仓恒不在其中），
 * 路径已经是后端 identity 形态 ⇒ 等值比较即身份比较（前端不做字符串归一，红线 12）。
 * 「清单为空」= 没有任何 linked worktree ⇒ 激活 worktree 必已消失（不是「尚未加载」：
 * 本函数只在读取**成功**后调用）。
 *
 * @returns 是否发生了回落（调用方只需记日志）。
 */
export function fallbackToMainIfWorkspaceGone(
  projectId: ProjectId,
  worktreePaths: readonly string[],
): boolean {
  const activePath = selectActiveCheckoutPath(useWorkspaceStore.getState(), projectId);
  if (activePath === null) return false;
  if (worktreePaths.includes(activePath)) return false;
  // clearActiveWorkspace 单点完成「回落主仓 + 作废该单元槽位」（I1-b：未知 ≠ 旧数据）。
  useWorkspaceStore.getState().clearActiveWorkspace(projectId);
  return true;
}

// ── selectors / hooks（唯一读取口）──

export function selectWorkspaceStateOf(
  state: WorkspaceStoreState,
  projectId: ProjectId | null | undefined,
): WorkspaceState {
  if (!projectId) return EMPTY;
  return state.byProject[projectId] ?? EMPTY;
}

export function selectActiveCheckoutPath(
  state: WorkspaceStoreState,
  projectId: ProjectId | null | undefined,
): string | null {
  return selectWorkspaceStateOf(state, projectId).activePath;
}

/**
 * 「某项目当前 Workspace 的 git 身份（`WorkspaceKey`）」—— **全前端唯一的派生点**。
 *
 * 以前这段派生（`WorkspaceSession.of(projectId, byProject[projectId]?.activePath ?? null).key`）在 6 处各自
 * 手写（事件回调、hook、组件、store 内部），任何一处漏改或加特例就会让「当前单元」出现第二种
 * 表示 —— 那正是本任务要根治的症状形态。仓储侧只能经本函数与
 * [`activeWorkspaceKeyOf`] 读取。
 */
export function selectActiveWorkspaceKey(
  state: WorkspaceStoreState,
  projectId: ProjectId | null | undefined,
): WorkspaceKey | null {
  if (!projectId) return null;
  return WorkspaceSession.of(projectId, selectActiveCheckoutPath(state, projectId) ?? null).key;
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
export function activeWorkspaceKeyOf(projectId?: ProjectId | null): WorkspaceKey | null {
  const pid = projectId ?? useProjectStore.getState().activeProjectId;
  return selectActiveWorkspaceKey(useWorkspaceStore.getState(), pid);
}

/**
 * 当前视图的 **Workspace 地址**（命令寻址用）。与 [`activeWorkspaceKeyOf`] 同源：
 * `worktreePath === null` ⟺ 主 checkout。这是「当前视图单元」的**唯一构造点**之一
 * （另两个来源是 tab / 事件），消费者不得自造。
 */
export function activeWorkspaceSession(projectId: ProjectId): WorkspaceSession {
  const raw = selectActiveCheckoutPath(useWorkspaceStore.getState(), projectId);
  // '' / 空白必须与 codec（WorkspaceSession.of / session.key）同一归一规则回落主仓 —— 否则 key 判主仓而
  // isMainCheckout(session) 判 worktree，同一事实出现两种结论（不变量 4）。
  return WorkspaceSession.of(projectId, raw && raw.trim() !== '' ? raw : null);
}

/**
 * React 侧：某项目「当前单元」的**地址值**（响应式形态）。
 *
 * 与 [`activeWorkspaceSession`]（命令式）、[`useActiveWorkspaceKey`]（key 形态）同源 ——
 * 渲染期需要身份值的消费者用本 hook，**不得**再各自 `useMemo({ projectId, worktreePath })`
 * （手写会漏掉空串→主仓的归一）。
 */
export function useActiveWorkspaceSession(projectId: ProjectId | null): WorkspaceSession | null {
  return useWorkspaceStore(
    useShallow((s) => {
      if (!projectId) return null;
      const raw = selectActiveCheckoutPath(s, projectId);
      return WorkspaceSession.of(projectId, raw && raw.trim() !== '' ? raw : null);
    }),
  );
}

/** React 侧：某项目的完整 Workspace 状态。 */
export function useActiveWorkspace(projectId: ProjectId | null): WorkspaceState {
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
 * `WorkspaceSession.of(projectId, useActiveCheckoutPath() ?? null).key`，那就是第二次派生 —— 且
 * `projectId` 为空的中间态会产出 `'\u0000'` 这种「谁也匹配不上」的键（真值恒为「未知」，
 * 会被误当成「未挂载」）。取值与 [`selectActiveWorkspaceKey`] 逐字同源。
 */
export function useActiveWorkspaceKey(projectId: ProjectId | null): WorkspaceKey | null {
  return useWorkspaceStore((s) => selectActiveWorkspaceKey(s, projectId));
}

/**
 * 命令式读取「指定项目的当前 Workspace 根」（= 工作树根，主仓回落 `projectPath`）——
 * 运行根 / 相对路径基准的**唯一派生点**（≡ Rust `WorkspaceRef::root()`）。
 *
 * 与 [`activeWorkspaceKeyOf`] 同源：先取当前单元 key，再经 [`workspaceRootOf`] 投影为宿主路径。
 * 只有 `projectId` 的调用方（事件回调 / store 动作）用本函数；**不得**各自
 * `activeWorkspaceSession(...).key` + `workspaceRootOf(...)` 手拼（那是第二次派生）。
 */
export function activeWorkspaceRootOf(
  projectId: ProjectId | null | undefined,
  projectPath: string,
): string | null {
  const key = selectActiveWorkspaceKey(useWorkspaceStore.getState(), projectId);
  if (!key) return null;
  return workspaceRootOf(key, projectPath);
}

/**
 * React 侧：某项目当前 Workspace 的根（响应式形态）。与 [`activeWorkspaceRootOf`] 同源 ——
 * 渲染期需要运行根（任务发现 / 相对路径基准）的消费者用本 hook，**禁止**再手拼。
 */
export function useActiveWorkspaceRoot(
  projectId: ProjectId | null | undefined,
  projectPath: string | null | undefined,
): string | null {
  const key = useActiveWorkspaceKey(projectId ?? null);
  if (!key) return null;
  return workspaceRootOf(key, projectPath ?? '');
}

export function useActiveCheckoutBranch(): string {
  const projectId = useProjectStore((s) => s.activeProjectId);
  return useWorkspaceStore((s) => selectWorkspaceStateOf(s, projectId).activeBranch);
}
