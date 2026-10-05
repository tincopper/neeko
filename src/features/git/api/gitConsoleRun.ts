/**
 * 前端长 git 操作（push / fetch / pull / commit）的 Console 编排单点。
 *
 * 为何放 `api/` 而不是 `utils/`：这是**跨 feature 共享**的编排（`features/project` 的
 * `ProjectsPanel` 也要用），而导入防火墙只放行跨 feature 直导 `store/`、`types/`、`api/`；
 * 放 `utils/` 会被拦。它不触碰 IPC 封装（那是 `gitApi.ts`），只是把「打开仓库级 Console tab
 * → 成功/认证/失败收尾」与仓库级 busy 去重收在一处。
 */
import { gitConsoleSessionId, useTaskStore } from '@/shared/store/taskStore';

/** 该仓库已有长 git 操作在跑时的提示（与后端 `GitSyncSlots::begin` 文案一致）。 */
export const GIT_BUSY_MESSAGE = 'Another git operation is already in progress for this repository';

/** `runGitConsoleOp` 的结果：成功 / 用户取消 / 该仓库已有操作在跑。 */
export type GitConsoleOpResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'stopped' }
  | { status: 'busy' };

/** 一次仓库级 Console run 的收尾句柄（供需要跨多个命令共享同一 run 的调用方手动编排）。 */
export interface GitConsoleRunHandle {
  /** 透传给后端命令的 Console run id。 */
  runId: string;
  /** 非失败结束（成功 / auth 之外的正常收尾）。 */
  finishOk(): void;
  /** AuthRequired：等待认证收尾（凭据对话接管），不计失败。 */
  awaitAuth(): void;
  /** 失败收尾（错误行落进 Console）；返回 true = 用户取消（已按 `[Stopped]` 收尾）。 */
  fail(error: unknown): boolean;
}

/** 该仓库的 Console tab 是否已有操作在飞（决定能否开启新 run）。
 *
 * `stopping` 也算在飞：用户已请求取消、后端进程树可能尚未收回；此时若允许新 run 接管
 * 同一个 tab，旧 run 的 reject 回调会把新 run 误标 failed（tab id 是仓库级、共享的）。
 */
function gitConsoleBusy(projectPath: string): boolean {
  const store = useTaskStore.getState();
  const id = gitConsoleSessionId(projectPath);
  return store.consoleSessions.some(
    (s) => s.id === id && (s.status === 'running' || s.status === 'stopping'),
  );
}

/**
 * 打开/复用仓库 Console tab 并返回收尾句柄；该仓库已有操作在跑时返回 `null`。
 *
 * busy 前置拒绝是关键：多个入口（Git 面板 / 项目面板 / 提交对话框）共用**同一个**仓库级
 * tab，若第二个入口照常 open + 失败收尾，会把正在跑的第一个 run 的 tab 误标 failed。
 */
export function beginGitConsoleRun(
  projectId: string,
  projectPath: string,
  header: string,
): GitConsoleRunHandle | null {
  if (gitConsoleBusy(projectPath)) return null;
  const store = useTaskStore.getState();
  const runId = store.openGitConsole({ projectId, projectPath, header });
  return {
    runId,
    finishOk: () => store.finishGitConsole(runId, true),
    awaitAuth: () => store.awaitAuthGitConsole(runId),
    fail: (error) => store.failGitConsole(runId, error),
  };
}

interface RunGitConsoleOpArgs<T> {
  /** Console tab 上写入的命令头（`$ …` 行）。 */
  header: string;
  projectId: string;
  /** 仓库显示路径（Console tab 按它稳定去重）。 */
  projectPath: string;
  /** 真正的操作；`runId` 透传给后端命令以路由输出与取消。 */
  run: (runId: string) => Promise<T>;
  /** 命中表示需要认证（凭据对话接管）：按「等待认证」收尾而非成功/失败。 */
  isAuthRequired?: (result: T) => boolean;
}

/**
 * 跑一次 git 操作并接入仓库级 Console 生命周期（打开/复用 tab → 成功 | 认证 | 失败收尾）。
 *
 * - `ok`：操作结果，调用方据此 toast / 刷新；
 * - `stopped`：用户取消（已按 `[Stopped]` 收尾），调用方静默返回、不得再弹错误；
 * - `busy`：该仓库已有操作在跑（**未触碰 tab、未发命令**），调用方提示后返回；
 * - 真实错误：先落进 Console 再 `throw`，调用方只需 toast / 展示。
 *
 * 这是前端长操作 Console 编排的**单点**：`useGitActions`、`ProjectsPanel`、`CommitDialog`
 * 共用它，避免各自复制 begin/finish/fail 顺序（漏一处就会留下悬挂的 `running` tab）。
 */
export async function runGitConsoleOp<T>({
  header,
  projectId,
  projectPath,
  run,
  isAuthRequired,
}: RunGitConsoleOpArgs<T>): Promise<GitConsoleOpResult<T>> {
  const handle = beginGitConsoleRun(projectId, projectPath, header);
  if (!handle) return { status: 'busy' };
  try {
    const result = await run(handle.runId);
    if (isAuthRequired?.(result)) handle.awaitAuth();
    else handle.finishOk();
    return { status: 'ok', value: result };
  } catch (e) {
    if (handle.fail(e)) return { status: 'stopped' }; // 用户取消
    throw e;
  }
}
