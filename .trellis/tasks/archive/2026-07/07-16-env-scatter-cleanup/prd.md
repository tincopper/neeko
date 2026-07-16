# 环境散乱代码统一重构（Post-Unification 清理）

## Goal

在 Project 数据模型统一（[[07-15-project-unification]] / P1-P7）完成后，消除仍散落在**文件 I/O、会话持久化、终端管理**及**前端 `connection` feature** 中的 WSL / SSH / Local 三路并行代码。

P1-P7 已经统一了 **git 操作层**（`operations.rs` + `transport.rs` 接收 `GitTransport`，`git/commands.rs` 的 branch/worktree/diff 命令只 `resolve_project` 后委派）。但环境相关的重复仍集中在四个区域，且被同一个根因维系：

> **根因**：`sessions.json` 的持久化 schema 仍是 `wsl_entries` + `remote_entries` 分离结构。这个 schema 分裂从后端 `session/manager.rs` 一路顶到前端 `useSessionPersistence.ts` / `connection/store.ts`，强制维持了三套并行的 struct / hook / context / store。

本次重构目标：**让环境相关的 3-way 分裂只存在于 transport 层**（`common/executor/*`、`common/git/transport.rs`、`core/project.rs`、连接建立对话框），其余所有层走统一的 `Project` + `ProjectEnvironment` → `ExecTarget` 路径。

## Scope

全量范围，**包含持久化 schema 扁平化**（`sessions.json` 收敛为统一 `Project` 列表）。

### 应保留的（transport 层，本就该按环境分，不在本次消除范围）

- `common/executor/`：`local.rs` / `ssh.rs` / `ssh_auth.rs` / `wsl.rs` / `factory.rs`（`ExecTarget` 枚举 + `create_executor`）—— 正确的抽象缝，是 group A 重复代码应该路由到的目标
- `common/git/transport.rs`：`GitTransport` 枚举（Local 用 git2/直接 spawn，WSL/Remote shell out）
- `common/terminal/remote.rs`：`RemoteTerminalManager`（russh，与本地 PTY 天然不同）
- `connection/services.rs`：WSL 发行版发现 / SSH 连接测试（连接建立，天然环境特定）
- `core/project.rs`：`ProjectEnvironment` + `to_git_transport()` + `to_exec_target()`（统一 keystone）
- 前端连接建立 UI：`RemoteAuthDialog` / `RemoteDialog` / `WSLDialog` / `useRemoteAuthActions`（SSH auth 与 WSL distro 选择流程本就不同）

## Deliverables（child tasks 拆分建议）

本 task 为 parent，产出由 child tasks 分别交付。建议顺序（持久化 schema 是根因，优先）：

### C1: 持久化 schema 扁平化（根因，最高优先）
- `sessions.json` 收敛为统一 `Project` 列表（保留 `environment` 判别字段），移除 `wsl_entries` / `remote_entries` 分离数组
- 后端 `session/types.rs`：合并 `ProjectSession` / `WSLProjectSession` / `WSLEntrySession` / `RemoteProjectSession` / `RemoteEntrySession` 为单一持久化结构
- `session/manager.rs`：移除 `collect_wsl_projects` / `collect_remote_projects` / `create_session_from_projects` 的 3-way 再拆分
- **旧格式迁移**：加载旧 `sessions.json`（含 `wsl_entries`/`remote_entries`）时自动迁移为扁平列表；写 serde 往返 + 迁移单测
- 前端 `useSessionPersistence.ts` / `connection/store.ts`：`saveSessionApi` 不再分 `(wsl, remote)` 传参

### C2: 后端文件 I/O 统一 — 路由到 ExecTarget
- `git/commands.rs`：`read_dir_tree` / `read_file_content` / `read_file_content_shell` / `write_file_content` / `generate_commit_message` 去掉内联 3-way `match`，下沉到统一 file-service（接收 `ExecTarget`）
- `read_file_content_shell` 的 stat→binary-detect→cat 三步，WSL/Remote 各写三遍 → 合并为一条 `ExecTarget` 路径（最大的单块重复）
- 合并 `common/git/wsl.rs`（`wsl_read_dir_tree`+`prefix_paths`）与 `common/git/remote.rs`（`remote_read_dir_tree_fn`+`prefix_paths_remote`）为单一 `dir_tree(target: &ExecTarget, …)`；这两文件只读目录树不做 git，应移出 `common/git/`（归入 file 服务）
- `remote.rs::get_remote_git_info` 与 `operations::get_git_info_shell` 冗余，合并

### C3: 前端 hook 合并 — project 生命周期归位
- `useWslActions.ts`(240) + `useRemoteActions.ts`(214) → 单一 environment-参数化 action hook
- `useWslProjects.ts`(135) + `useRemoteProjects.ts`(184) → 单一 project CRUD hook（Remote 的 auth 处理作为可选注入）
- `WslContext.tsx`(40) + `RemoteContext.tsx`(50) → 收敛
- worktree store 并行字段 `wslActiveWtBranch`/`remoteActiveWtBranch`、`wslOpenedWt`/`remoteOpenedWt` → 统一（P7 已标注延后，本次完成）
- `ProjectsPanel.tsx` 移除把统一列表手动拆回 `wslGroups`/`remoteGroups`/`localProjects` 的逻辑（并修复 Remote 被同时 push 到 `remoteMap` 和 `local` 的分组 bug）
- **feature 边界归位**：`connection` feature 收缩为仅"连接建立"（dialogs / auth / distro-host 发现），项目生命周期交还 `project` feature

### C4: 前端终端策略与缓存合并
- `strategies/{wsl,remote,local}.ts` 已共享 `TerminalStrategy` 接口，差异仅在 `createSession` API、`agentDelayMs`（500 WSL / 800 remote）、`connectingMessage` → 收敛为配置驱动
- `terminalCache.ts` 并行后端 `terminalCache`/`wslTerminalCache`/`remoteTerminalCache` 及 `refresh*`/`launchAgentIn*`/`get*OpenProjectIds` → 统一
- `WSLTerminalView.tsx`(27) + `RemoteTerminalView.tsx`(68) → 统一薄封装；`EditorGroupPane.tsx` 移除 inline IIFE 环境判断

### C5: 命名与边界规整
- 消除两套并行类型系统：枚举 `ProjectEnvironment::{Local,Wsl,Remote}` vs 小写 `ProjectType = "local"|"wsl"|"remote"` / `ConnectionContext.type`（统一到单一 taxonomy，移除 `ENV_TYPE_TO_VIEW_TYPE` 之类转换）
- `RemoteItems.tsx` 里的 `WSLItem` 拆分到合适命名的文件
- `AppError::Wsl` 被当作通用"平台不支持"错误滥用 → 引入语义正确的 error variant
- 后端 `project/mod.rs` 三个 `add_*_from_session` 方法 → 单一 environment-参数化方法
- `resolve_agent_config` vs `resolve_agent_for_remote` 命名/逻辑 smell 收敛
- `common/connection/`（model.rs 12 / types.rs 12，近乎空，仅 `AuthMethod`）重新归置

## Constraints

1. **持久化向后兼容**：加载旧 `sessions.json`（`wsl_entries`/`remote_entries` 格式）必须自动迁移，不丢数据、不 panic；所有持久化字段 `#[serde(default)]`。
2. **平台门控**：WSL 相关代码仅在 `cfg(target_os = "windows")` 下生效；macOS 下 `ProjectEnvironment::Wsl` 不可用。
3. **transport 层不动**：C1-C5 只消除重复与散乱，不改 `common/executor/*` 与 `transport.rs` 的按环境分派本身。
4. **API 兼容**：Tauri 命令签名变更需前后端同步；schema 变更（C1）与前端 store 变更需同一发布上线。
5. **TDD**：每个 child 先写测试（serde 往返 / 迁移 / hook 行为），红→绿→重构。

## Acceptance Criteria

- [ ] C1: `sessions.json` 为扁平统一 `Project` 列表；旧格式加载自动迁移，往返 + 迁移单测通过；前端不再分 `(wsl, remote)` 传参
- [ ] C2: `git/commands.rs` 无内联环境 3-way `match`；`common/git/{wsl,remote}.rs` 合并且移出 git 模块；file I/O 走统一 `ExecTarget` 路径
- [ ] C3: WSL/Remote 的 actions/projects hook 与 context 合并为参数化单实现；`ProjectsPanel` 不再手动重拆分组（分组 bug 修复）；`connection` feature 仅剩连接建立职责
- [ ] C4: 终端策略/缓存/视图收敛为配置驱动的单路径
- [ ] C5: 单一 environment taxonomy；`AppError` 语义修正；无错位命名文件
- [ ] 全量验证：`cargo check` + `cargo test` + `npx tsc --noEmit` + `pnpm test:run` + `pnpm lint` 全绿
- [ ] 更新受影响的 spec 文档（`.trellis/spec/backend/directory-structure.md`、`frontend/directory-structure.md`、`frontend/state-management.md` 已陈旧，需与新结构对齐）

## Notes

- 分析来源：本次会话对 [[07-15-project-unification]] 完成后的结构审计。
- 相关 spec：`.trellis/spec/guides/code-reuse-thinking-guide.md`（模式4：跨域几乎相同的实现并行）直接描述了本次要消除的反模式。
- **最省力的杠杆**：先做 C1（持久化 schema 扁平化），它是维系整条栈 3-type 心智模型的锚点；扁平化后 C2-C5 的并行 struct/hook/context/store 大多自然失去存在理由。
