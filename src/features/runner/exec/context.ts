/**
 * Run/Debug 动作上下文与运行期工具（runner 层共享输入）。
 */
import { selectActiveWorktreePath, useWorktreeStore } from '@/shared/store/worktreeStore';

/** Run/Debug 动作上下文（editor tab + 项目根）。 */
export interface TestActionContext {
  projectId: string;
  /** Editor tab file path（项目/worktree 根的相对路径）。 */
  filePath: string;
  /** 项目根绝对路径（worktree 未激活时的 cwd 兜底）。 */
  projectPath: string | null;
}

/** 运行输出累计上限（libtest JSON 行与 vitest 报告体量有限，防极端无界拼接）。 */
export const MAX_CAPTURED_OUTPUT_CHARS = 2_000_000;

/**
 * 指定项目的**执行单元根**（激活 worktree 根；`null` = 主仓单元）。
 *
 * 命令式上下文（store 动作 / 事件回调）用它：后端把 `null` 收敛成项目根，
 * 因此调用方无需自己拼「项目根 vs worktree」的二选一。
 * React 渲染路径用 [`resolveRunCwd`]（它多一个 `projectPath` 兜底）。
 */
export function unitRootForProject(projectId: string): string | null {
  return selectActiveWorktreePath(useWorktreeStore.getState(), projectId);
}

/** 运行当前生效的工作目录：该项目的激活 worktree 优先，否则项目根。 */
export function resolveRunCwd(ctx: TestActionContext): string {
  return unitRootForProject(ctx.projectId) ?? ctx.projectPath ?? '';
}
