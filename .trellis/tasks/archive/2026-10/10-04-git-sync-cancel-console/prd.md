# Git 长操作取消通道 + Console 可见性（红线 3 / 4 / 5）

## Goal

把 git 长操作（`push` / `fetch` / `pull` / `commit`）从「30s 墙钟一超就判失败、且进程没被杀」的旧模型，
改为「**无墙钟 + 可取消 + 输出实时可见**」：

- 无墙钟：长操作耗时由 hook 与网络决定、没有上界，墙钟只会把「正常慢」误判成失败
  （2026-10-01 push 事故：pre-push 跑两套测试约 3 分钟，30s 上限先弹失败，git 进程仍在跑、远端状态未知）。
- 可取消：单飞槽持有 `GitSyncHandle`（watch 通道），`cancel_git_sync` 触发 → `select!` 杀**进程树**
  （git → pre-push hook → pnpm → vitest/cargo）。
- 可见：stdout/stderr 按 UTF-8 边界成块经 `git-operation-output` 事件实时进 Console（按仓库聚一个 tab）。

本任务同时收口 neeko-check 第三轮审查发现的架构问题：命令层 hooks 装配重复、三 transport 流式块重复、
取消目标未限定、事件无合流、前端事件常量/payload 落点。

## Requirements

**领域/传输层**

- `GitTransport::run_git_opts_streaming`：流式 + 可取消变体（默认实现退化为聚合调用，仅供测试假实现）。
- `GitRunHooks { on_output, cancel }`：一次运行的 Console 出口与取消句柄；`GitRunHooks::none()` 为常规路径。
- `GitSyncHandle`（`transport/cancel.rs`）：watch 通道 + keep-alive 接收端，支持「取消先于等待」。
- `common/executor::collect_child_output_streaming[_cancellable]`：双流并发抽干 + UTF-8 边界成块 + 取消杀进程。
- `git_command_timeout(args)`：长操作返回 `None`，读类命令保留 `LOCAL_GIT_TIMEOUT`。

**命令层**

- 仓库单元单飞槽 `GitSyncSlots`（键 = `RepoRef::key()`）：同单元串行、异单元并行；
  RAII `GitSyncGuard` 保证任何返回路径释放。
- `cancel_git_sync(console_run_id)` 幂等；同仓库单元并发冲突显式拒绝。
- 长操作命令透传 `console_run_id` 与 `AppHandle`，装配 `GitRunHooks`。

**前端**

- `git-operation-output` 事件路由进 `taskStore` 的仓库级 Console tab（app 级订阅，面板关闭也收流）。
- `ConsoleSessionSource` 增 `'git'`；git tab 只读、`Cancel` 按钮 → `cancelGitConsole`。
- `useGitActions` 对四个长操作**不包 `withTimeout`**（去墙钟），stage/discard 保留 30s。
- **所有入口**（Git 面板 / `ProjectsPanel` / `CommitDialog`）统一经 `runGitConsoleOp` 编排，
  并接入同一个仓库级 Console tab；该仓已有 run 在飞（`running`/`stopping`）⇒ 返回 `busy`
  且不触碰 tab。

**审查修复（第三轮 neeko-check）**

- 命令层 hooks 装配抽单点（≥3 次重复 ⇒ 必须抽象）；三 transport 流式块抽共享核心。
- 单飞按 `RepoRef::key()` 分槽（同仓单元互斥、异仓并行），消除「全局槽 + 仓库级 runId」的
  隐性误拒；`cancel_git_sync` 带目标标识（避免陈旧 run id 误取消别的仓库）。
- `output_sink` 合流（事件频率上界），避免重演 macOS 事件 eval 内存事故。
- 前端事件名归 `shared/events.ts`、payload 归 `shared/types/git.ts`。
- spec 对账：`git-domain.md §13` + `concurrency-guidelines.md` 超时策略。

## Acceptance Criteria

- [x] `git_command_timeout`：push/fetch/pull/commit → `None`；status/空 → `Some(LOCAL_GIT_TIMEOUT)`
      （`git_command_timeout_leaves_long_ops_unbounded`）。
- [x] 取消端到端：`push_cancel_aborts_pre_push_hook_and_returns_promptly` 绿（hook `sleep 30` 被树杀）。
- [x] 流式块拼接 == 聚合返回；跨读边界多字节字符无 `U+FFFD`；无效字节后可继续交付；
      **合流**：`drain_stream_coalesces_small_reads_and_flushes_tail_at_eof` +
      `drain_stream_flushes_pending_after_interval`。
- [x] 前端：一仓一 tab（稳定去重）、`stopping → [Stopped]` 不计失败、AuthRequired 收尾、悬挂 200s 不判失败。
- [x] 审查修复：`begin_git_run` 单点（占槽 + 产 hooks）、transport 共享核心
      （`run_shell_streaming` / `finish_git_output`）、后端按 `RepoRef::key()` 分槽
      （`GitSyncSlots`，同单元互斥 / 异单元并行）、cancel 按 run id 匹配（`GitSyncEntry::matches`）、
      事件合流有测试、事件常量归 `shared/events.ts`、payload 归 `shared/types/git.ts`。
- [x] 全入口去墙钟：`ProjectsPanel` / `CommitDialog` 不再包 `withTimeout`，统一经
      `runGitConsoleOp` 接入 Console；同仓在飞时返回 `busy` 不接管 tab；
      护栏 `check_long_git_op_wall_clock` 防止回潮。
- [x] `pnpm guards run --stage local` 全绿（9/9）；`cargo check --all-targets` 0 error；
      `pnpm lint` EXIT=0；`pnpm check` 全绿（2026-10-04）。
- [x] P3 优化：并发占用 `AppError::Conflict` + `BUSY_MESSAGE`；`GitSyncEntry.correlation_id`
      中立命名；取消 kill 确认有界（5s）；长操作墙钟护栏 + 跨语言文案 pin；`api/` 落点说明。

## Non-goals

- 不改 `core::exec` 同步桥语义；不引入运行时超时/取消（`spawn_blocking` 同族不做）。
- SSH 交互式凭据/指纹提示仍会挂起（未设 `BatchMode`，与 VS Code askpass 是已知差距）。
- 不做跨入口的并发编排 UI：同仓库单元互斥、异单元并行由后端 `GitSyncSlots` 保证；
  不同 worktree 的同 project 并行输出仍汇入同一个仓库级 tab（当前有意）。
