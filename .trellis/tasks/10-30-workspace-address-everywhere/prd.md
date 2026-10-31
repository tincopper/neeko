# agent-chat 以 Workspace 地址寻址（P0+P1）

## Goal

worktree 单元里打开 Agent Chat 时，agent 进程的 cwd 与界面显示的工作目录必须**跟随该单元**，
而不是静默跑在主仓。做法是把「执行地址」从可选的 `project_id` 变成**必填的 `WorkspaceSession`**，
并加护栏防止同类缺口在下一个域复发。

## Background（现场事实）

- 现象：worktree 单元里 chat 显示 `已注入上下文：neeko（local） · /Users/tomgs/RustroverProjects/neeko`（主仓路径）。
- 前端**已经握着**地址：`AgentChatTabView` 的 `session: WorkspaceSession`（`{projectId, worktreePath}`），
  但 `useAgentChat → agentChatApi` 只传 `projectId`，维度在边界丢失。
- 后端 `resolve_project_ctx()` 用 `pm.get_project(id).path` 当 cwd ⇒ 永远主仓。
- 同一推理在仓内早已存在：`resolve_workspace_target_with_env` 的注释写着「禁止退化成按 project 解析
  （worktree 视图静默按主仓执行）」；护栏 `check_workspace_session_addressing` 判据 D 正是这个形态，
  但它的前提是「签名里已经有 `workspace`」—— chat 从来没有这个参数，静态规则看不见「该有没有」。
- 后果不只是显示错：agent 实际读写主仓文件；且 pi/opencode 的原生 resume 要求 cwd == 会话 origin
  （本仓实测：跨目录会 `Session found in different project`），错配的会话会在更晚的地方炸。

## Requirements

### R1 地址必填（chat 三个入口）
- R1.1 `StreamRequest.workspace: WorkspaceSession`（必填）。`agent_stream` / `agent_chat_open` /
  `agent_chat_resume` 共用 `resolve_session_context`，一处改穿。
- R1.2 cwd 由 `AppStateWrapper::resolve_workspace_target_with_env(&workspace)` 解析出的 root 决定
  （唯一入口）；`resolve_project_ctx` 不再承担 cwd，只保留 name/env（改名为 `project_display`）。
- R1.3 缺 workspace ⇒ 反序列化即失败（Tauri 命令入参错误），**不提供 `Option` 回退**：兼容分支会把
  「必定 cwd 错配的会话」变成正常路径。

### R2 会话身份带维度
- R2.1 `SessionHandle` 存 `workspace`；`owns()` 比较 `(agent_id, workspace)`。
  （今天只比 `project_id`：同一项目的主仓与 worktree 会互相 attach 到 cwd 不同的会话。）

### R3 事件回显地址（显示与执行同源）
- R3.1 `ContextManifest` 增加 `workspace: Option<WorkspaceSession>`；`ContextInit` 由各 adapter 从
  `AgentContext.workspace` 投影（`agent_chat_context` 这条项目级命令留 `None`）。
- R3.2 前端「会话已开始」行显示后端回显的 root + worktree 标记，不再自己拼路径。

### R4 防复发护栏（P1）
- R4.1 `check_workspace_session_addressing` 增判据 **E（执行上下文台账）**：命令体内以
  `get_project(...).path` / `resolve_project_ctx(...)` 取 cwd/根，必须在
  `tools/guards/ledger/exec_context_commands.json` 登记理由，否则 CI 红。
- R4.2 台账首版登记合法项目级用例（`agent_chat_context` 等），每条给理由。

## Constraints

- 红线 3/6/8/12 照旧；`WorkspaceSession` 仍是唯一地址铸造点（前端 `activeWorkspaceSession`）。
- 不改 adapter 生命周期契约（`ContextInit` 仍由 adapter 发），只扩展载荷。
- TDD：先写契约测试（缺 workspace 反序列化失败、`owns` 带 workspace、事件回显）。

## Acceptance Criteria

- [x] AC1 worktree 单元里启动 chat：`context_init.workspace_key` 尾段非空，`cwd` 等于该 worktree 根；
      界面显示该根。（单测 `workspace_ctx_cwd_follows_the_unit_not_the_project` + `unitDisplayName` 用例）
- [x] AC2 主仓单元行为不变（key 尾段为空，cwd = 项目根）。
- [x] AC3 `owns()`：同 project 不同 workspace 的 session id 不得被复用续写（单测）。
- [x] AC4 `StreamRequest` 缺 `workspace` ⇒ 反序列化失败（单测，钉住「必填」）；顶层残留 `projectId`
      被忽略，不能覆盖地址分量（`project_identity_comes_from_address_only`）。
- [x] AC5 判据 E 有正/反用例；判据 F 有正/反用例；台账为空是结论（全仓无按 project 取 cwd 的命令）。
- [x] AC6 `cargo test --lib` / clippy / fmt / `pnpm check:quick` 绿。

> **AC 修订（2026-10-30 审核后）**：R3.1 原写「`ContextManifest` 增加 `workspace: Option<WorkspaceSession>`」，
> 实现改为 `workspace_key: String` —— 分量化 wire 形态正是本任务要消灭的「可拆分」失真，且与仓内
> git/file 事件的 `workspace_key` 约定不一致。R1.1 的「必填」相应强化为：请求体不再有独立
> `projectId`（项目身份是地址的分量）。

## Out of Scope

- LSP / conversation 扫描 / task hub 的同源收口（进台账，后续逐个处理）。
- 旧 chat 会话数据迁移（`agent_sessions.db` 无 workspace 维度者归主仓）。
