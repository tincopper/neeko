# 执行计划

> 顺序即依赖：Step 1 已红→绿（工作区未提交）；Step 2-4 是一个原子提交；Step 5 的 spec 同步与提交分列。

## Step 0 · 前置

- [x] `task.py create`（子任务挂在 `10-01-path-identity-alphabet` 下）
- [ ] 本文档（prd / design / implement）经确认后 `task.py add-context` + `task.py start`

## Step 1 · 异步原语（已做，未提交）

- [x] `common/git/unit_path.rs`：`UnitPath::resolve_async`（`spawn_blocking` + 两级错误穿透）
- [x] 同步 `resolve` 的文档补一句调用纪律（只允许同步上下文 / 已在阻塞池内）
- [x] `#[tokio::test] async_entry_matches_sync_entry` → 本地 `cargo test --lib unit_path` 12 passed

## Step 2 · git 域入口

- [x] `app_state.rs::resolve_repo` → `pub async fn`（一次 hop；doc 写明阻塞语义与调用纪律）
- [x] 29 处调用点加 `.await`（编译器驱动）：
      `git/commands/query.rs 7`、`index.rs 5`、`history.rs 6`、`sync.rs 6`、`worktree.rs 2`、
      `commit.rs 1`；`agent/commands_commit.rs 1`；`git/services/status.rs::wait_main_status_fresh 1`

## Step 3 · file 域入口

- [x] `file/commands.rs::resolve_base` → `async fn`，内部 `UnitPath::resolve_async(...).await`
- [x] 8 处调用点加 `.await`：`read_dir_tree` / `read_file_content` / `write_file_content` /
      `create_new_file` / `save_new_file` / `create_directory` / `delete_path` / `rename_path`
- [x] `file/commands.rs` 的断言改 `#[tokio::test]` + `.await`（断言语义不变）

## Step 4 · 命令层直连点

- [x] `git/commands/worktree.rs` 5 处（create / remove / rename ×2 / is_dirty）
      + `git/commands/query.rs` 1 处（`canonical_worktree_path`）→ `UnitPath::resolve_async(...).await`

## Step 4b · 验证期补漏（同类，grep 逐条核对发现）

- [x] `file/commands.rs::read_dir_tree`：单元身份那次 `RepoRef::resolve` 落阻塞池
      （与 `resolve_base` 各自一次 hop：两者空路径语义不同，合并 = 行为变更，已注释说明）
- [x] `common/git/operations/info.rs::get_git_branch_info_shell`：`parse_worktree_list` 整份清单
      一次 hop（逐条归一 ⇒ 禁止逐条 hop）
- [x] 核实无需改动：`common/git/local/worktree.rs::get_worktrees` 只在 `info.rs` 的阻塞池闭包内被调用

## Step 5 · 验证

- [x] `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- [x] `pnpm lint`（8 护栏全过；`check_repo_unit_identity` 0 违规）
- [x] `cargo test --lib`（1386 = 1385 基线 + 1 条新用例；无既有用例改动）
- [ ] `pnpm check`（含 `test:fe` / `test:host`）
- [x] 复核：`rg "UnitPath::resolve\(" src-tauri/src/git/commands` 命中 0；
      全仓 `UnitPath::resolve(` / `RepoRef::resolve(` 剩余调用点逐条核对（测试 / 阻塞池内 / `resolve_async` 内部）

## Step 6 · 文档与提交

- [x] `.trellis/spec/backend/concurrency-guidelines.md` 增 Scenario「命令入口的路径解析不阻塞 worker」
      （同步原语 / `resolve_async` / 命令层纪律 + Good/Base/Bad + Wrong/Correct）
- [ ] 提交 `refactor(git): isolate blocking path resolution`（独立提交，不 push）
- [ ] `python3 ./.trellis/scripts/add_session.py`（收尾记录）
