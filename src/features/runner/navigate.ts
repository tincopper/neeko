/**
 * 跳转入口（**策略层**）：决定「一次打开是用户意图还是停点跟随」。
 *
 * - **用户意图**（点断点 / 外部链接）：`openSourceAtLine` / `openVirtualSourceAtLine` ——
 *   打开并激活后写 `navigateGoal`（目标状态模型，由 useNavigateGoal 绑定视图就绪兑现）；
 * - **停点**（自动停点 / 点栈帧）：`ensureStopSourceTab` —— 只保证源码可见；「跳到哪一行」
 *   由编辑器从停点 `location` 派生（`useDebugStopReveal`，幂等可重放）。内容加载是异步的，
 *   因此该入口需要**落地许可**（`isCurrent`）：旧停点迟到的内容不得建 tab / 抢激活。
 *
 * 分工：本文件只表达意图差异；源引用构造在 `sourceOpen.ts`（纯函数），
 * tab 生命周期在 `sourceTab.ts`（机制）。
 */
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import {
  activeWorkspaceSession,
  selectActiveCheckoutPath,
  useWorkspaceStore,
} from '@/shared/store/workspaceStore';
import { workspaceKeyOf } from '@/shared/utils/workspaceRef';

import { frameSourceOpen, fsSourceOpen, virtualSourceOpen } from './sourceOpen';
import { ensureSourceTab } from './sourceTab';
import type { StackFrameDto } from './types';

/**
 * Tab space key for the current project / worktree; empty when unavailable.
 *
 * 三个入口的共同输入解析（都要先知道「这次打开落在哪个 tab 空间」）——故与入口同层。
 * 若将来出现第二个消费者（非跳转场景也需要该键），再抽成独立模块。
 */
function targetTabKey(projectId: string): string {
  const activeWorktree = selectActiveCheckoutPath(useWorkspaceStore.getState(), projectId);
  return projectId ? workspaceKeyOf(projectId, activeWorktree) : projectId;
}

/**
 * 指定项目的登记根路径（主仓单元根）；项目不在表里 → 空串。
 */
function projectRegisteredRoot(projectId: string): string {
  return useProjectStore.getState().projects.find((p) => p.id === projectId)?.path ?? '';
}

/**
 * 本次打开的 **Workspace 根**（`workspace.root`；**与 tab 空间、编辑器读/写根同源**；红线 12）。
 * 术语见 `docs/domain-model.md`。
 *
 * 第一性原理：源内容读取的 `InProject` scope 必须等于该 tab 所属的**当前执行单元**，
 * 因为编辑器对 tab 的保存/重读根取自 tab 携带的唯一值
 * （`FileTabData.workspace`）。若这里返回另一个单元，就会产出「能读不能写」的假可编辑 tab。
 * 因此规则恒为：激活 worktree → 该项目的登记根（主仓）；`fallbackPath` 仅当项目表
 * 缺失时兜底（**不得**先用调用方传入的会话单元根：会话可能属于另一个 worktree）。
 *
 * 推论（有意为之）：会话存活期间切到另一个单元时，旧单元的栈帧落在当前单元根之外，
 * 会回落**只读外部通道** —— 这是与 tab 空间/保存根一致的安全降级，不是缺陷。
 */
function workspaceRootFor(projectId: string, fallbackPath: string): string {
  const activeWorktree = selectActiveCheckoutPath(useWorkspaceStore.getState(), projectId);
  return activeWorktree || projectRegisteredRoot(projectId) || fallbackPath;
}

export interface OpenSourceOptions {
  /** Live debug session id — required for external / virtual sources. */
  sessionId?: string;
  /** Failure sink (e.g. Debug Console). */
  onError?: (message: string) => void;
}

/** 写用户意图导航目标（兑现绑定「视图就绪」；停点路径不走这里）。 */
function publishNavigateGoal(
  tabKey: string,
  target: { tabId: string; line: number; col: number },
): void {
  useEditorStore.getState().setNavigateGoal({
    tabKey,
    tabId: target.tabId,
    line: target.line,
    col: target.col,
  });
}

/** 用户意图：打开源文件并跳到指定行（点断点 / 终端与任务链接等）。
 *
 * `projectPath` 仅作项目表缺失时的兜底 —— 实际读取 scope 恒取**当前执行单元**
 *（激活 worktree / 该项目的登记根），见 `workspaceRootFor`。 */
export async function openSourceAtLine(
  projectId: string,
  projectPath: string,
  sourcePath: string,
  line: number,
  column = 0,
  opts?: OpenSourceOptions,
): Promise<void> {
  const tabKey = targetTabKey(projectId);
  if (!tabKey) return;

  const projectRoot = workspaceRootFor(projectId, projectPath);
  const target = await ensureSourceTab({
    tabKey,
    projectId,
    workspace: activeWorkspaceSession(projectId),
    projectRoot,
    request: fsSourceOpen(
      projectRoot,
      sourcePath,
      activeWorkspaceSession(projectId),
      opts?.sessionId,
    ),
    line,
    column,
    onError: opts?.onError,
  });
  if (target) publishNavigateGoal(tabKey, target);
}

/** 用户意图：打开适配器虚拟源码（DAP `sourceReference`）并跳到指定行。 */
export async function openVirtualSourceAtLine(
  projectId: string,
  sourceName: string | null | undefined,
  reference: number,
  line: number,
  column = 0,
  opts?: OpenSourceOptions,
): Promise<void> {
  const tabKey = targetTabKey(projectId);
  if (!tabKey) return;

  const request = virtualSourceOpen(sourceName, reference, opts?.sessionId);
  if (!request) return;

  const target = await ensureSourceTab({
    tabKey,
    projectId,
    workspace: activeWorkspaceSession(projectId),
    // 虚拟身份与 root 无关（`dap-source:` 不拼根），这里取当前单元根只为满足统一入参。
    projectRoot: workspaceRootFor(projectId, ''),
    request,
    line,
    column,
    onError: opts?.onError,
  });
  if (target) publishNavigateGoal(tabKey, target);
}

/** 停点源码可见性请求。 */
export interface StopSourceRequest {
  projectId: string;
  /** 项目表缺失时的兜底根；实际读取 scope 恒取**当前执行单元**（见 `workspaceRootFor`）。 */
  projectPath: string;
  frame: StackFrameDto;
  sessionId?: string;
  /**
   * 落地许可（`await` 之后校验）。由调用方按「这次停点/这一帧是否仍是当前」给出：
   * - 自动停点 → 代际守卫（新停点使其失效）；
   * - 点栈帧 → `selectedFrameId` 仍是该帧。
   */
  isCurrent: () => boolean;
}

/**
 * 停点路径：**只确保帧的源码 tab 存在并激活**（不写跳转目标）。
 *
 * @returns 已激活的 tabId；被落地许可拦下 / 加载失败 / 帧无源码时返回 null
 */
export async function ensureStopSourceTab(
  req: StopSourceRequest,
  onError?: (message: string) => void,
): Promise<string | null> {
  const { projectId, projectPath, frame, sessionId, isCurrent } = req;
  const tabKey = targetTabKey(projectId);
  if (!tabKey) return null;

  const projectRoot = workspaceRootFor(projectId, projectPath);
  const request = frameSourceOpen(frame, projectRoot, activeWorkspaceSession(projectId), sessionId);
  if (!request) return null;

  const target = await ensureSourceTab({
    tabKey,
    projectId,
    workspace: activeWorkspaceSession(projectId),
    projectRoot,
    request,
    line: frame.line,
    column: frame.column,
    onError,
    canCommit: isCurrent,
  });
  return target?.tabId ?? null;
}
