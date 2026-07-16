# P3: 后端 git 命令迁移 — 去除 transport 参数

## Goal

将 `git/commands.rs` 中所有 Tauri 命令的 `transport: GitTransportKind` / `transport: FileTransportKind` 参数移除，改为 `project_id: String` + `state: State<AppStateWrapper>`。命令内部通过 `state.resolve_project(project_id)` 获取执行环境和路径。同时修复当前 PR 命令因前端漏传 `transport` 导致的崩溃 bug。

## Requirements

1. 所有 git 命令函数签名删除 transport 参数，统一为 `(project_id, ..., state)` 模式
2. 删除 `GitTransportKind` enum 定义（`git/commands.rs` 顶部）
3. 删除 `FileTransportKind` enum 定义
4. 删除辅助函数 `into_transport_and_dir()` 和 `into_exec_target()`
5. 内部改为调用 `AppStateWrapper::resolve_project()` 获取 transport 信息
6. 更新 `lib.rs` 中 `neeko_invoke_handler!` 宏（命令路径不变量，但签名变更）
7. PR 命令（`list_prs_command` 等）同样迁移 — 修复当前 bug
8. 文件操作命令（`read_dir_tree`、`read_file_content`、`write_file_content`）同样迁移
9. `generate_commit_message` 命令同样迁移
10. `get_remote_home_dir` 命令不变（它不操作项目，只连接远程）

## Acceptance Criteria

- [ ] `git/commands.rs` 中无 `GitTransportKind` / `FileTransportKind` 定义
- [ ] 所有命令不再接受 transport 参数，只接受 `project_id`
- [ ] `cargo check` 通过，无未使用导入
- [ ] PR 命令可通过正确的前端调用正常工作（修复当前 bug）
- [ ] `cargo test` 通过
- [ ] 与 P5 前端适配联调通过

## Dependencies

- P1（`core::ProjectEnvironment`）
- P2（`AppStateWrapper::resolve_project()`）
