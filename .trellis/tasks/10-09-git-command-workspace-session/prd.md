# git 命令按 WorkspaceSession 对象寻址（对象化收敛）

## 依赖（硬前置）

- **必须在本任务开工前完成**：`.trellis/tasks/10-09-file-io-workspace-scope`
  —— 该任务引入 `WorkspaceSession` 值对象（`{ projectId, worktreePath }`）、后端
  `AppStateWrapper::resolve_workspace_target` 与前端单点派生 helper（`workspaceSessionOfKey` /
  `workspaceSessionOfTabKey` / `activeWorkspaceSession`），并建立 `check_file_io_scope` 护栏。
  **本任务复用其类型与解析入口**；若并行开工，会出现两个 `WorkspaceSession` 定义（第二表示）。

## Goal

把 git 域命令的 `(projectId, worktreePath)` **散参**统一为 `WorkspaceSession`（一个地址对象），
使 git 域与文件域**共用同一寻址对象与同一解析入口**，消除「两套寻址外观」。

> 形态等价（`projectId` + `worktreePath` ↔ `WorkspaceSession`），属 DRY / 一致性收敛，**不改 git 语义**。

## Scope（草案，开工时细化）

- 后端 `src-tauri/src/git/commands/**`（~40 命令）与 `src-tauri/src/agent/commands_commit.rs` 等：
  `(project_id, worktree_path: Option<String>)` → `(session: WorkspaceSession)`；
  `state.resolve_workspace(&s.project_id, s.worktree_path.as_deref())` 收口为
  `resolve_workspace_session`（或直接调既有 `resolve_workspace_target`）。
- 前端：`ProjectCommands` 的 git 方法 `worktreePath` 散参收口到绑定的 `WorkspaceSession`
  （`createProjectCommands(workspace: WorkspaceSession)` 已在前置任务改收对象）。
- 测试与护栏：扩展 `check_file_io_scope` 或新增 `check_workspace_session_addressing` ——
  禁止 git 命令调用点再出现裸 `worktreePath` 散参。

## Out of Scope

- 不改 git 语义 / 行为（`resolve_workspace` 的校验与归一不变）。
- 不动持久化字段名与 wire 事件载荷（`workspace_key` 保持不变）。

## Notes

- 权威术语：`docs/domain-model.md`；`WorkspaceSession` 的语义界定见前置任务 `design.md §3`。
