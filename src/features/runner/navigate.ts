/**
 * 跳转入口（**策略层**）：决定「一次打开是用户意图还是停点跟随」。
 *
 * - **用户意图**（点断点 / 外部链接）：`openSourceAtLine` / `openVirtualSourceAtLine` ——
 *   打开并激活后写 `pendingNavigateTarget`，由编辑器消费**一次**；
 * - **停点**（自动停点 / 点栈帧）：`ensureStopSourceTab` —— 只保证源码可见；「跳到哪一行」
 *   由编辑器从停点 `location` 派生（`useDebugStopReveal`，幂等可重放）。内容加载是异步的，
 *   因此该入口需要**落地许可**（`isCurrent`）：旧停点迟到的内容不得建 tab / 抢激活。
 *
 * 分工：本文件只表达意图差异；源引用构造在 `sourceOpen.ts`（纯函数），
 * tab 生命周期在 `sourceTab.ts`（机制）。
 */
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import { resolveTabKey } from '@/shared/utils/tabKey';

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
  const activeWorktree = useWorktreeStore.getState().activeWorktreePath;
  return projectId ? resolveTabKey(projectId, activeWorktree) : projectId;
}

/** 会话快照缺失时回落到当前激活项目路径（canonical 构造的根）。同上：入口层的输入解析。 */
function resolveProjectPath(projectPath: string): string {
  return projectPath || useProjectStore.getState().activeProject?.path || '';
}

export interface OpenSourceOptions {
  /** Live debug session id — required for external / virtual sources. */
  sessionId?: string;
  /** Failure sink (e.g. Debug Console). */
  onError?: (message: string) => void;
}

/** 写用户意图跳转目标（一次性消费；停点路径不走这里）。 */
function publishNavigateTarget(
  tabKey: string,
  target: { tabId: string; line: number; col: number },
): void {
  useEditorStore.getState().setPendingNavigateTarget({
    tabKey,
    tabId: target.tabId,
    line: target.line,
    col: target.col,
  });
}

/** 用户意图：打开源文件并跳到指定行（点断点 / 终端与任务链接等）。 */
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

  const projectRoot = resolveProjectPath(projectPath);
  const target = await ensureSourceTab({
    tabKey,
    projectId,
    projectRoot,
    request: fsSourceOpen(projectRoot, projectId, sourcePath, opts?.sessionId),
    line,
    column,
    onError: opts?.onError,
  });
  if (target) publishNavigateTarget(tabKey, target);
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
    // 虚拟身份与 root 无关（`dap-source:` 不拼根），这里取当前项目根只为满足统一入参。
    projectRoot: resolveProjectPath(''),
    request,
    line,
    column,
    onError: opts?.onError,
  });
  if (target) publishNavigateTarget(tabKey, target);
}

/** 停点源码可见性请求。 */
export interface StopSourceRequest {
  projectId: string;
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

  const projectRoot = resolveProjectPath(projectPath);
  const request = frameSourceOpen(frame, projectRoot, projectId, sessionId);
  if (!request) return null;

  const target = await ensureSourceTab({
    tabKey,
    projectId,
    projectRoot,
    request,
    line: frame.line,
    column: frame.column,
    onError,
    canCommit: isCurrent,
  });
  return target?.tabId ?? null;
}
