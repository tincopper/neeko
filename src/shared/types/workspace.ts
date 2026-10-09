/**
 * `WorkspaceSession` —— 命令寻址用的 **Workspace 地址值对象**。
 *
 * **语义**：一次地址上下文 —— 「要在哪个 Workspace 上执行这次操作」。它是**值**，不含状态、
 * 不含生命周期，与 terminal/agent session、`SessionStore` 无关。
 *
 * **身份分量**：`projectId` + `worktreePath`。`worktreePath === null` ⟺ **主 checkout**
 * （local 分支）—— 这是**唯一**判别，不设独立 `kind` / `isWorktree` 字段（那会是同一事实的
 * 第二表示）。判别走单一谓词 `isMainCheckout`（`@/shared/utils/workspaceRef`）。
 *
 * **只携带身份**，不带解析后的根：根的权威在后端受信状态（`AppStateWrapper::resolve_workspace`），
 * 调用方无法伪造。字符串 key（`WorkspaceKey`）只是它的**派生索引**，用于 map/存储边界。
 */
export interface WorkspaceSession {
  projectId: string;
  /** 后端回传的 canonical worktree 身份串；`null` = 主 checkout */
  worktreePath: string | null;
}
