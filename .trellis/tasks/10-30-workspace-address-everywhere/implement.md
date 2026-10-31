# 执行计划：Workspace 地址（P0+P1）

## P0 后端
- [x] 1.1 `WorkspaceSession` 加 `Serialize`。
- [x] 1.2 `StreamRequest.workspace: WorkspaceSession`（必填）+ 契约测试（缺字段 ⇒ 反序列化失败）。
- [x] 1.3 `resolve_session_context` 转 async：root 走 `resolve_workspace_target_with_env`；
      `project_name()` 只给显示名（env 与 cwd 同一次解析产出）；删掉 `resolve_project_ctx`。
- [x] 1.4 `AgentContext.workspace: WorkspaceSession`（必填）；`ContextManifest.workspace_key: String`
      （+ `cwd`）；4 个 adapter 经 `AgentContext::workspace_key()` 唯一投影点回显；
      `agent_chat_context` 用 `WorkspaceSession::main(id)`。
- [x] 1.5 `SessionHandle.workspace` + `owns()` 比较 workspace；单测（同项目不同单元不复用）。
- [x] 1.6 `cargo test --lib agent::chat`、clippy、fmt。

## P0 前端
- [x] 2.1 `agentChatApi.StreamChatRequest.workspace: WorkspaceSession`（必填）。
- [x] 2.2 `useAgentChat` / `useAgentSessionLifecycle` / `useChatRestore` 接 `workspace`；
      `AgentChatTabView` 把已有 `session` 传下去。
- [x] 2.3 `@` 文件提及 / 附件基准改用单元工作树根（`AgentChatTabView` 里 `project.path` 那处）。
- [x] 2.4 `useSessionLevelEvents` 落 `workspace`；「会话已开始」行显示回显 root + worktree 标记。
- [x] 2.5 `pnpm check:quick`（收尾一次）。

## P1 护栏
- [x] 3.1 判据 E + `ledger/exec_context_commands.json`（当前为空 —— 全仓已无按 project 取 cwd 的命令）。
- [x] 3.2 正/反用例（未登记 → 违规；登记 → 放行；无命中 → 通过）。
- [x] 3.4 判据 **F**：后端禁写 `WorkspaceSession { .. }` 字面量（扫全部 Rust 文件 —— 逃逸口在
      `translation.rs` 这类非 commands 文件里）；`#[cfg(test)]` 豁免由共享 helper
      `core/rust_cfg.mask_cfg_test` 实现（同时消掉 `check_command_execution` /
      `check_blocking_fs_in_commands` 的两份重复实现）。
- [x] 3.3 若 `test_gates.py` 统计护栏/判据数量，同步。

## 实施记录（与计划的偏差）

**第一轮（P0+P1 初版）**

- `AgentContext.workspace` 用 `Option<WorkspaceSession>`：它是 adapter 侧上下文，非工作区会话
  （能力探针 / 翻译 harness / 项目级 manifest）真实存在。**边界仍必填** —— `StreamRequest.workspace`
  没有 `Option`，契约测试 `stream_request_without_workspace_is_rejected` 钉住。
- `translation`（翻译通道）今天按项目级发起（`TranslationRequest` 无 workspace 维度）：显式构造
  「项目主 checkout」地址走同一解析入口，并在台账登记为待收口项 —— 不用裸路径，也不再自己拼。
- 判据 E 初版把台账路径写成 `ledger/...`（`load_ledger` 内部拼 LEDGER_DIR），单测暴露后改为
  repo 相对路径 `tools/guards/ledger/...`；`get_project(...).map(|p| p.path…)` 这种「非直连
  `.path`」形态也必须命中，故改用「`get_project(` + `(p|project).path` 同时出现」判定。
- `useAgentChat` 顶到组件规模 ratchet（490 > 基线 484）：把 mock 演示接线抽成
  `useMockChatFeed`（13 行 → 9 行调用 + 新 hook），回到 483 行。

**第二轮（审核修复，2026-10-30）** —— 逐条对应审核清单

- **地址可拆分（Block）**：删 `StreamRequest.project_id`，项目身份只从 `workspace.project_id` 派生
  （`StreamRequest::project_id()` 单点定义）。原先 8 处 `req.project_id` 让 cwd 与会话 id/通知/
  持久化 cwd 取两个来源，可独立错配。
- **地址回显可拆分（Block）**：`ContextManifest.workspace: Option<{projectId, worktreePath}>` →
  `workspace_key: String`。仓内 git/file 事件本来就只带 `workspace_key`，前端经
  `WorkspaceSession.fromKeyOrId` 唯一 codec 取分量；删掉重复声明的 `WorkspaceManifest`。
  `AgentContext.workspace` 也随之变为**必填**（项目级通道用 `WorkspaceSession::main` 显式声明），
  于是「地址未回显」这个状态不存在 —— 删掉 `addressEchoMissing` 及其告警文案。
- **持久化 cwd 错配（Block）**：`build_resume_cursor(req, sid, cwd)` 写入解析后的执行根，
  不再写 `req.project_id`（原生 resume 要求 cwd == 会话 origin）。
- **只写死字段**：删 `SessionHandle.project_id`（`owns()` 已改比 workspace，全仓无读者）。
- **护栏洞**：判据 F + 扫描面扩到全部 Rust 文件（E/F 都在 `mask_cfg_test` 后的文本上判定，
  兑现 docstring 的 `#[cfg(test)]` 豁免承诺）。台账为空是结论而非待办，注释不再谎称已登记。
- **同一事实两个来源**：`project_display` → `project_name`（只给 name）；env 取
  `resolve_workspace_target_with_env` 的权威 `environment`，不再读项目记录第二遍。
- **命名**：`AgentContext.project_id`（实为 cwd 路径）→ `cwd`；`ContextManifest.project_id` → `cwd`
  （前端 `CtxInfo.projectPath` → `cwd`）。同 struct 里不再有两个 `project_id` 两种含义。
- **可测性**：`resolve_workspace_ctx` / `resolve_session_context` 收 `&AppStateWrapper`（不绑 Tauri
  运行时），补上 AC1/AC2 单测（主仓 = 项目根 / worktree = 工作树根 / 未知项目 NotFound）。
- **React**：`useAgentSessionLifecycle` / `useChatRestore` 的 `useCallback` 补 `workspace` 依赖
  （原先捕获过期地址）；`envLabelOf` 只求值一次。
- **复用**：`worktreeNameOf` 走共享 `getFileName`（不再自造 `split(/[\\/]/).pop()`）；
  key 拼装收成 `mint_key` 单一实现（`WorkspaceRef::key` 与 `WorkspaceSession::key` 共用）。

## 收尾
- [x] AC1–AC6 勾验；spec 同步（`agent-chat-transports.md` 的契约表已按第二轮改写）；
      `add_session.py`；**不主动提交**。
