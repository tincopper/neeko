# 异步边界：路径解析的阻塞 I/O 落阻塞池（红线 3）

## Goal

neeko-check 审查（F1）确认：`UnitPath::resolve` 内部做 `Path::exists()` / `canonicalize()`
（同步阻塞 fs），而它经 `AppStateWrapper::resolve_repo` 出现在 **29 处异步命令调用点**，
以及 `file/commands.rs::resolve_base` 的 **8 处异步命令调用点** 上 —— 直接跑在 Tokio worker 线程上，
违反红线 3（判据与正例见 `.trellis/spec/backend/concurrency-guidelines.md`）。

物理后果不是理论值：`canonicalize` 在网络盘 / 无响应挂载点上可阻塞到秒级，而这条路径位于
**每次 git / file 命令的入口**；期间同一 worker 承载的 PTY 输出、watcher 事件与 IPC 全部停摆。
`10-01-path-identity-alphabet` 引入的「不存在路径锚定到最深已存在祖先」在 create/rename 流程还会
把 syscall 次数放大到 ≈ 路径深度（用户主动操作的一次性流程，非热路径）。

本任务**只补异步边界，行为零变化**：identity / exec 的取值、错误文案与类型、命令的等待与顺序语义
一律不动。

## Requirements

- 新增唯一异步原语 `UnitPath::resolve_async(&ExecTarget, &str) -> Result<UnitPath>`：
  `spawn_blocking` 包装同步 `resolve`；**领域错误原样穿透**，不得被 `JoinError` 覆盖
  （`JoinError` 只在「阻塞池 panic / 运行时关停」时产生）。
- `AppStateWrapper::resolve_repo` 改 async：**一次** `spawn_blocking` 包住「项目根 + worktree」
  两次解析（一次线程池 hop，而不是两次）；29 处调用点加 `.await`，参数写法零改动。
- `file/commands.rs::resolve_base` 改 async，复用 `resolve_async`；8 处调用点加 `.await`。
- 命令层直连的 6 处 `UnitPath::resolve`（`git/commands/worktree.rs` 5 + `git/commands/query.rs` 1）
  改走 `resolve_async`。
- **验证期补漏（同类，逐条 grep 发现）**：
  - `file/commands.rs::read_dir_tree` 里还有一次 `RepoRef::resolve`（取单元身份给 gitignore 过滤器）
    → 同样落阻塞池；与 `resolve_base` 各自一次 hop 而不是合并（两者空路径语义不同，合并会改行为）。
  - `common/git/operations/info.rs::get_git_branch_info_shell` 的 `parse_worktree_list` 会**逐条**
    归一（Local 每条约一次 `canonicalize`）→ 一次 `spawn_blocking` 包住整份清单，
    禁止逐条 hop（线程池往返会乘以条目数，且让清单内部来自不同时刻的 fs 视图）。
  - `common/git/local/worktree.rs::get_worktrees` 的同类调用**无需改动**：它只在
    `info.rs:110/139` 的 `spawn_blocking` 闭包内被调用（已在阻塞池内，实测核实）。
- **不**新增 `*_blocking` 变体：当前 0 个同步调用者（29 处已逐一核实位于 async fn 内）；
  将来出现同步调用者时再按需增加，并在同一 diff 写明「必须在阻塞池内调用」的纪律。
- **不**把 `RepoRef::resolve` / `UnitPath::resolve` 改成 async：它们是域内「纯 + fs」原语，
  单元测试与「已在阻塞池内」的代码需要同步入口（判据见 design §1）。
- 测试：异步入口 ≡ 同步入口（逐字同结果）+ 错误穿透各一条；既有 1385 条 lib 测试与 4483 条前端
  测试必须**逐条不变**（这是「行为零变化」的判据，任一条变动都说明改了行为）。

## Acceptance Criteria

- [ ] `rg "\.resolve_repo\(" src-tauri/src` 的每一处都在 `.await` 之后取结果
- [ ] `resolve_base` 为 `async fn`；`file/commands.rs:237-246` 的既有断言改为 `#[tokio::test]` 并 `.await`
- [ ] `rg "UnitPath::resolve\(" src-tauri/src/git/commands` 命中 0（全部改 `resolve_async`）
- [ ] `cargo clippy -- -D warnings`、`pnpm lint`（8 护栏）、`cargo test --lib`、`pnpm check` 全绿
- [ ] spec 同步：`.trellis/spec/backend/concurrency-guidelines.md` 增加「路径解析的阻塞边界」一段
      （**代码落地后**再写，避免文档领先代码）
- [ ] 独立提交 `refactor(git): isolate blocking path resolution`，不 push

## Non-goals

- 不动其它域的阻塞调用。**审计口径修正**：初版只扫了命令文件（`git/commands/*`、`file/commands.rs`、
  `lsp/commands.rs`、`session/commands.rs`），漏掉了命令间接调用的 `common/git/operations/*`；
  验证期的全仓 `UnitPath::resolve(` / `RepoRef::resolve(` 逐条核对补齐了同类点（见 Requirements
  的「验证期补漏」），结论是：命令链路上已无未隔离的路径归一。
- 不引入超时 / 取消语义（`spawn_blocking` 不可取消，这是既有语义，不在本次范围）。
- 不改命令的可见行为：不加进度、不改错误类型、不改 `wait_*_status_fresh` 的位置与顺序；
  `read_dir_tree` 的 base 与身份**各自一次 hop** 而非合并（合并会顺手 canonicalize 项目根 = 行为变更）。

## Notes

- 关联父任务：`10-01-path-identity-alphabet`（本项来自其 neeko-check 审查报告 F1）。
- 前置状态：`UnitPath::resolve_async` + `async_entry_matches_sync_entry` 已实现并本地跑绿
  （工作区未提交，等本文档确认后并入同一提交）。
