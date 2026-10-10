/**
 * Run/Debug 动作上下文与运行期工具（runner 层共享输入）。
 */
import { selectActiveCheckoutPath, useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';

/** Run/Debug 动作上下文（editor tab + 项目根）。 */
export interface TestActionContext {
  projectId: ProjectId;
  /** Editor tab file path（项目/worktree 根的相对路径）。 */
  filePath: string;
  /** 项目根绝对路径（worktree 未激活时的 cwd 兜底）。 */
  projectPath: string | null;
}

/** 运行输出累计上限（libtest JSON 行与 vitest 报告体量有限，防极端无界拼接）。 */
export const MAX_CAPTURED_OUTPUT_CHARS = 2_000_000;

/**
 * 指定项目的**当前 Workspace 根**（激活工作树根；`null` = 主仓单元）。
 *
 * 术语：`Workspace` = Project 下的能力容器（承载 IDE/Agent/editor/debug/LSP/terminal），
 * 本节返回它的 `workspace.root`。领域分层见 `docs/domain-model.md`。
 *
 * 命令式上下文（store 动作 / 事件回调）用它：后端把 `null` 收敛成项目根，
 * 因此调用方无需自己拼「项目根 vs workspace 根」的二选一。
 * React 渲染路径用 [`runCwdOf`]（它多一个 `projectPath` 兜底）。
 */
export function activeWorkspaceRoot(projectId: ProjectId): string | null {
  return selectActiveCheckoutPath(useWorkspaceStore.getState(), projectId);
}

/** 运行当前生效的工作目录：该项目的当前 Workspace 根优先，否则项目根。 */
export function runCwdOf(ctx: TestActionContext): string {
  return activeWorkspaceRoot(ctx.projectId) ?? ctx.projectPath ?? '';
}
