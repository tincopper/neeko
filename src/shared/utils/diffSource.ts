/**
 * diffSource.ts — ConnectionContext → DiffSource 的纯映射
 *
 * 纯函数，无副作用，无 React / store 依赖。
 * 单一职责：将统一连接上下文映射到 diff 所需的数据源描述。
 */

import type { DiffSource } from "@/features/git/components/diff/types";
import type { ConnectionContext } from "../../types/activeProject";

/**
 * buildDiffSource — 根据 ConnectionContext 构造 DiffSource
 *
 * @param ctx           连接上下文（local / wsl / remote）
 * @param worktreePath  当前活跃 worktree 路径，仅 local 项目有效
 */
export function buildDiffSource(
  ctx: ConnectionContext | null,
  worktreePath?: string | null,
): DiffSource {
  if (!ctx) {
    return { type: "local", projectId: "" };
  }

  if (ctx.type === "local" && worktreePath) {
    return { type: "worktree", projectId: ctx.projectId, worktreePath };
  }

  switch (ctx.type) {
    case "local":
      return { type: "local", projectId: ctx.projectId };
    case "wsl":
      return { type: "wsl", distro: ctx.distro, projectPath: ctx.projectPath };
    case "remote":
      return {
        type: "remote",
        entryId: "",
        host: ctx.host,
        port: ctx.port,
        username: ctx.username,
        auth: ctx.auth,
        projectPath: ctx.projectPath,
      };
  }
}
