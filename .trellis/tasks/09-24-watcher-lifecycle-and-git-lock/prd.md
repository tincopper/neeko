# Fix watcher lifecycle leak (duplicate FS events) and read-path git side effects

> **包络原则**：两件事共享一条边界纪律 —— *资源生命周期必须由唯一所有者显式界定；只读路径不得产生写副作用*。
> 但两者不在同一段代码，**交付物必须可分别 revert**（两笔独立提交，不交错）。

## Goal

1. **watcher 生命周期**：切换项目后旧 watcher 不释放 —— 单实例实测同一变更被 emit **3 次**，同一项目被反复 watch（4 次 / 另一项目 10 次）且永不释放；每次 watch 还会多留一套后台线程（notify watcher + file-debounce + tree-debounce + throttle scheduler + git worker + heartbeat）。
2. **只读 git 调用的写副作用**：`git status` 会刷新 `.git/index`（写副作用，需 optional lock），Neeko 的读路径并未统一消除它 → 与 IDE / 用户 git 争 `.git/index.lock`（本会话实测两次导致 `git commit` 失败）。

## Problem Statement

### A. 事件成倍重复 + 资源不释放（实测，2026-09-24）

**测量条件**：只跑一个实例（`target/debug/neeko`，pid 58265，22:28 启动；已退掉 `/Applications/Neeko.app`）。

| 观测 | 结果 |
|---|---|
| 单次新建文件 | 同一秒 **3 行完全相同**的 `[FileDebounce:3122d984…] Emitting file-changed for 2 paths`（57.667 / 57.670 / 57.670） |
| 本进程内 watch 次数 | `3122d984…`（neeko）**4 次**；`ee678242…`（codeant）**10 次**；均无释放记录 |

⇒ 3× 与"双实例"无关（前一次测量时同时跑着 dev 与 `/Applications/Neeko.app`，曾被列为干扰项；本次单实例复现相同倍数，干扰项排除）。

**根因（第一性）**：**隐式退出条件（"所有发送端自然断开"）与双向强持有并存** ⇒ 永不退出。

- 维护线程：`spawn_maintenance_thread(watcher: Arc<Mutex<RecommendedWatcher>>, …)` 强持有 watcher，退出条件 = `rx.recv()` 返回 `Err`（`registration/maintenance.rs:11-21`）。
- 而 `maintenance_tx` 的一个 clone 被放进 notify 回调闭包（`manager/core.rs:157-168`），闭包活在 watcher 内部。
- 于是 handle drop 不再意味着释放：watcher 不掉 → 闭包不掉 → tx 不掉 → 维护线程不退 → 它持有的 `Arc` 也不掉。
- `unwatch()` 只做「map 移除 + `stop_signal=true`」，而 `stop_signal` **只有 heartbeat 轮询** ⇒ 旧 watcher 继续投递事件、继续驱动 git worker。项目切换越多越严重。

### B. 读路径的写副作用与锁争用（实测，2026-09-24）

**git 行为实测**（临时仓库，观察 `.git/index` mtime）：

| 实验 | 结果 | 结论 |
|---|---|---|
| `git status --porcelain` | index mtime **变化** | 读路径写 index（副作用） |
| `GIT_OPTIONAL_LOCKS=0 git status --porcelain` | index mtime **不变** | 该 env 可消除副作用 |
| `git ls-files --others --exclude-standard`（含 `core.untrackedCache=true`） | 均**不变** | 实测不是争用源 |
| `GIT_OPTIONAL_LOCKS=0 git add && git commit` | **成功** | optional locks ≠ 必需锁，写路径不受影响 |

**代码侧现状**：`READONLY_ENV = [("GIT_OPTIONAL_LOCKS","0")]` 已被多数 transport 读路径使用；缺口在 `operations/info.rs:26`、`operations/worktree.rs:54`（`run_git` 无 opts）；`status_worker` 走 CLI `--no-optional-locks`（含"老 git 不支持则回退到无标志"的分支 ⇒ 回退时争锁）。libgit2 路径默认不含 `UPDATE_INDEX` ⇒ 不写 index。

**实测影响**：本会话内两次 `git commit` 因 `Unable to create '.git/index.lock': File exists` 失败（重试成功）。

**归因未定**：IDE（RustRover）与用户手工 git 同样持锁 → 需 `lsof` 采样后写结论（AC7）。

## Requirements

### R1 — watcher 生命周期（复用既有退出语义，不新增协议）

- **所有权单向化**：`WatcherHandle` 为 watcher 的唯一强所有者；辅助线程不得强持有 `RecommendedWatcher`（维护线程改持 `Weak`，`upgrade()` 失败即退出）。
- **入口不变量**：`watch(project_id)` 幂等 —— 同一项目已存在即 warn 返回，不新建第二套资源。
- **事件不重复**：同一时刻只应有一套 watcher 生效；单实例下单次变更恰好 1 条 debounce 批次。
- `unwatch` 后真正停止：不再投递 `file-changed` / `file-tree-changed`，不再驱动 git worker。
- **可测性**：事件出口收敛为单一抽象（`WatcherEventSink`，事件名沿用 `watcher/types.rs` 既有常量），使生命周期契约能在**无 GUI** 的 `cargo test` 中断言 —— 否则该缺陷必然再回归。

### R2 — 只读调用零副作用（单一注入点）

- **在 exec facade 层统一注入 `GIT_OPTIONAL_LOCKS=0`**（`core::exec` 与 `common::executor` 各一处），业务代码无感；新增调用自动获得该语义。
- **退役散落机制**：`readonly_opts()` 的 env 注入与 worker 的 CLI 标志（含回退分支）收敛到该注入点，避免多套机制并存。
- **明确不采用进程级 `std::env::set_var`**：会污染终端 / agent 子进程（用户可见环境），爆炸半径不可控。
- 写路径（`checkout` / `branch` / `stash apply|pop` / `commit` / `fetch` / `merge`…）行为不变，且需回归证明。
- libgit2 路径无需处理（默认不写 index，已实测/查证）。

## Acceptance Criteria

- [ ] AC1：**单实例**且同项目只有一套 watcher 时，单次文件变更恰好产生 **1** 条 `file-changed` 批次（日志证据）。
- [ ] AC2：项目 A→B→A 切换后，A 的 watcher 只有一套；事件不随切换次数累积（对照测量：当前 codeant 达 10 次）。
- [ ] AC3：`unwatch` 之后对已移除项目的路径做文件变更 → 日志中该 project **零事件**。
- [ ] AC4：重复 `watch()` 同一项目不产生第二套资源（含 warn 日志）。
- [ ] AC5：生命周期契约测试**无 GUI** 可跑（`cargo test`），覆盖 unwatch 停止投递 / 重新 watch 单实例 / 重复 watch 幂等。
- [ ] AC6：**自动化**证明只读语义收敛：① facade 两处入口的单测断言注入 `GIT_OPTIONAL_LOCKS=0`；② 读路径不再存在 `--no-optional-locks` 回退分支；③ 写路径回归（stage/commit/stash/checkout 既有用例全绿，证明 optional ≠ 必需）。
- [ ] AC7：`lsof .git/index.lock` 采样结果与结论写入任务 notes；若主因确为外部进程，说明 Neeko 侧已不再主动争锁。
- [ ] AC8：门禁全绿 —— `cargo test --manifest-path src-tauri/Cargo.toml`、`pnpm lint`、`pnpm test:run`、`pnpm type-check`。

## Constraints

- 不改事件协议：`file-changed` / `file-tree-changed` / `git-status-snapshot` / `git-changed` 的载荷与语义不变；事件名沿用 `watcher/types.rs` 常量（红线 5）。
- 不新增定时轮询（沿用 30s 心跳）；不为平台差异新增分支。
- 生命周期契约（写在 design §1.4）必须可被行为测试守护，不靠人工记忆。
- 写路径的锁行为与既有行为不得改变。

## Non-Goals

- 不改 `git status` 的折叠语义与快照契约（属已归档任务 `09-24-git-unversioned-expansion-cache`）。
- 不重构 `registration.rs` 的目录注册算法（AddDir / RemoveDir / ReloadAll 逻辑）——只修所有权与释放。
- 不引入 `WatcherResources` 之类的资源聚合重构（YAGNI；除非实现中发现 drop 顺序需显式约束）。
- 不采用进程级 env 注入方案。

## Notes

**取证口径（复现同一现象时照用）**

- 事件计数：`grep -a "Emitting file-changed" ~/.neeko/neeko.log`（Debug 级）
- watch 次数：`grep -a "Started watching project" ~/.neeko/neeko.log`（按 app pid 的启动时间切窗）
- 持锁方：`while :; do lsof <repo>/.git/index.lock; sleep 0.2; done` + 分别触发（仅文件变更 / 面板刷新 / IDE 打开仓库）
- 索引副作用：`stat -f %m .git/index` 前后对比，配合 `GIT_OPTIONAL_LOCKS=0` 对照

**历史与关联**

- `09-24-git-unversioned-expansion-cache`（已归档）的 D1 段记录了本缺陷的现场证据，及其 3× 放大对 AC7 现场计数的干扰。
- 测量前必须退掉多余实例：双实例会写同一日志，污染事件计数归因。
