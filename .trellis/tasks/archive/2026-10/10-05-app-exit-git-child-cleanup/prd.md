# 应用退出时收敛 git 子进程树（消除孤儿）

## Goal

应用退出（窗口 `Destroyed` → `shutdown_background_and_exit`）以及运行时被关停时，
把仍在跑的 **git 长操作子进程树**（`git` → pre-push hook → `pnpm` → `vitest`/`cargo`）
一起收敛，消除「Neeko 退出后 git hook 还在跑」的孤儿。

现状（见 `common/git/transport`）：git 传输层用裸 `ExecChild`（`kill_tree` 自组 spawn），
**没有生命周期守卫**；DAP 用 `ProcessGuard`，终端有 `close_all_sessions`，唯独 git 子树
在退出时无人收敛。原 `git-domain.md §13`「已知残留（有意）」即指此项。

## Requirements

- **全局子进程登记表**（`common/executor`）：git 传输层 spawn 的 `kill_tree` 子进程按 pid 登记；
  RAII 生命周期（正常完成 / 取消后注销），保证退出时只对**仍存活**的进程动手（降低 pid 复用误杀）。
- **退出收敛**：`AppStateWrapper::shutdown_background_and_exit` 增一条 `CleanupTask`，在所有后台
  服务关停前按平台 `kill_process_tree` 异步无关地（同步 fire-and-forget）树杀残留。
- **跨三端（按 `ExecTarget` 分派终止策略）**：登记表存 `ExitKill` 策略 —— Local / WSL =
  本地进程组树杀（`platform::process_spawn::kill_process_tree`，红线 10 门面）；SSH = **远端**
  新通道执行 `kill -9`（确认有界 5s）。远端 pid 与本地 pid 无关，**不得**本地按 pid 杀。
- **可测**：清理核心与真实 killer 解耦（注入 `&dyn Fn(u32)`），单测不触碰真实进程。

## Acceptance Criteria

- [x] `child_registry`：`track(pid)` 后 `kill_all_with(recorder)` 命中该 pid；`ChildLease` drop 后再
      `kill_all_with` 不再命中；空表 no-op。
- [x] git 传输层每条 spawn 路径在存活期间登记、结束后注销（不泄漏登记项）。
- [x] `shutdown_background_and_exit` 的 CleanupTask 覆盖 git 子进程（`kill_all_live`）。
- [x] `cargo clippy -- -D warnings`、`cargo fmt --check`、`pnpm lint`（全护栏）、
      `cargo test --lib`、`pnpm check` 全绿。
- [x] spec 更新：`git-domain.md §13` 的「已知残留」改述为已收敛 + `concurrency-guidelines.md` 增判据。

## Non-goals

- 不改 Tauri 命令的取消协议；不引入「前端丢弃 invoke 即取消后端 future」。
- 不做远端 kill 的**同步确认**（信号发出后确认有界 5s，超时放弃等待，不阻塞退出）。
- 不接管 DAP / 终端 / LSP 的进程生命周期（各有既有守卫）。
- 不做「应用运行期间 future 被 drop 也自动树杀」的通用机制（无取消协议下该场景不可达；
  若未来引入，另开任务）。
