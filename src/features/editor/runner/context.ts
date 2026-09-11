/**
 * Run/Debug 动作上下文与运行期工具（runner 层共享输入）。
 */
import { useWorktreeStore } from '@/shared/store/worktreeStore';

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

/** 运行当前生效的工作目录：激活 worktree 优先，否则项目根。 */
export function resolveRunCwd(ctx: TestActionContext): string {
  return useWorktreeStore.getState().activeWorktreePath ?? ctx.projectPath ?? '';
}
