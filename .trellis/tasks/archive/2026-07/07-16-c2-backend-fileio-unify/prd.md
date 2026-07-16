# C2: 后端文件 I/O 统一到 ExecTarget

> Parent: [07-16-env-scatter-cleanup](../07-16-env-scatter-cleanup/prd.md)

## Goal

消除后端文件 I/O 与目录树读取中散落的 WSL/SSH/Local 三路内联分支，全部路由到已存在的 `ExecTarget` / `CommandExecutor` 抽象。git 操作层（`operations.rs` + `transport.rs`）在 P1-P7 已完成此收敛；文件 I/O 是最后未收敛的重复热点。

## Background

`git/commands.rs`（1485 行）中的文件命令仍手写 `match &t { Local => … Wsl => … Remote => … }`：

- `read_file_content_shell`（约 L607-743）：137 行，stat→binary-detect→cat 三步，WSL 和 Remote 路径**各写了三遍**（每步一次），是后端单块最大重复
- `read_dir_tree`（L553-603）：分派到 `file::services` / `git::wsl_read_dir_tree` / `git::remote::remote_read_dir_tree_fn`
- `read_file_content`（L746-795）、`write_file_content`（L795+）：同样 3-way
- `generate_commit_message`（L1007+）：Local/Remote/Wsl 三臂

`common/git/wsl.rs`（62 行）与 `common/git/remote.rs`（199 行）：`wsl_read_dir_tree` + `prefix_paths` 与 `remote_read_dir_tree_fn` + `prefix_paths_remote` 是**同一个函数**，仅 `ExecTarget` 不同。`remote.rs::get_remote_git_info` 与 `operations::get_git_info_shell` 重复。

## Requirements

- 新建统一文件服务（如 `common/file/service.rs` 或 `file/services.rs` 扩展），签名接收 `target: &ExecTarget`：
  - `read_dir_tree(target, path)` — 合并 wsl.rs/remote.rs 的两份实现为一份，Local 走 `ExecTarget::Local`
  - `read_file_content_shell(target, path)` — stat / binary-detect / cat 只写一次，通过 executor 分派
  - `read_file_content(target, path)` / `write_file_content(target, path, content)`
- `git/commands.rs` 中对应命令改为：`resolve_project()` → 得到 `ExecTarget` → 调统一服务，删除内联 `match`
- 删除 `common/git/wsl.rs`、`common/git/remote.rs` 中的 dir-tree 函数（这些不是 git，应移出 `common/git/`，见 C5 的模块归位）
- `resolve_agent_config` / `resolve_agent_for_remote`：合并为单个函数（remote 变体只是多一个文件名 fallback）
- `AppError::Wsl` 滥用修正：`read_file_content_shell` 等非 WSL 语义的路径改用合适的 error 变体（如 `AppError::Unsupported`）

## Constraints

1. **依赖 C1**：project → ExecTarget 的解析依赖统一后的 `resolve_project`；建议 C1 完成后开始
2. **行为等价**：binary 检测阈值、路径 prefix 逻辑、错误消息对前端可见的部分保持等价
3. **Local 特殊路径**：Local 目前部分走 git2/直接文件系统（非 shell），合并时不要强制 Local 走 shell 而损失性能——`ExecTarget::Local` 的 executor 应仍是本地进程/直接 IO

## Acceptance Criteria

- [ ] `read_file_content_shell` 的 stat/binary/cat 逻辑只存在一处
- [ ] `read_dir_tree` 合并为单个接收 `ExecTarget` 的函数，`common/git/{wsl,remote}.rs` 的 dir-tree 函数删除
- [ ] `git/commands.rs` 文件命令无内联 `match environment` 三臂
- [ ] `resolve_agent_*` 收敛为单函数
- [ ] `AppError::Wsl` 不再用于非 WSL 语义
- [ ] `cargo test` + `cargo check` 全绿，文件读写/目录树读取行为回归测试通过

## Dependencies

- 依赖 C1（统一 resolve_project / 扁平项目）。可与 C3/C4 并行。
