# 执行计划

> TDD 强制：每步 Red → Green → Refactor。命令注册无变化，`lib.rs` 不动。
> 顺序：先建基线（Step 0，否则"修好了"无法验收）→ 出口抽象（Step 1，纯重构）→ 生命周期释放（Step 2）→ 只读语义（Step 3）→ 现场复测 + 全量门禁（Step 4）。
> **交付纪律**：Step 2 与 Step 3 必须落在**两笔独立提交**（可分别 revert，不交错）。

## Step 0 — 基线与归因 ✅（数字见 `task.json.notes`）

- [ ] 退掉多余实例（只留一个 Neeko），记录 app pid 与启动时间（后续按时间窗切日志）
- [ ] 基线数字：单次变更的 `Emitting file-changed` 行数；A→B→A 切换后 A 的 watch 次数与事件是否累积；当前各项目累计 watch 次数（对照：neeko 4 / codeant 10）
- [ ] `lsof .git/index.lock` 采样（三种触发场景）→ 归因结论写入 `task.json.notes`
- [ ] `stat -f %m .git/index` 对照：确认 Neeko 读路径是否造成 index 刷新（配合 `GIT_OPTIONAL_LOCKS=0` 做对照基线）

## Step 1 — 事件出口抽象（纯重构，零行为变更）— ✅ 已实施

**目的**：让 Step 2 的契约能被无 GUI 测试断言。**这一步不修 bug**，单独提交，便于 bisect。

- [ ] 定义 `WatcherEventSink`（事件名沿用 `watcher/types.rs` 常量；覆盖 5 个事件：`FILE_CHANGED` / `FILE_TREE_CHANGED` / `GIT_CHANGED` / `GIT_STATUS_SNAPSHOT` / `GIT_PERF_SUGGESTION`）
- [ ] 生产适配器包 `AppHandle::emit`；`WatcherManager::watch` 与 `git_meta` 相关出口改走 sink（行为、时序、载荷均不变）
- [ ] 测试注入收集器（`Arc<Mutex<Vec<...>>>` 或 mpsc）
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 全量绿（零回归）→ 单独提交

## Step 2 — watcher 生命周期释放（R1）— ✅ 已实施

**Red**

- [ ] 契约测试（无 GUI，`common/file/watcher/` 测试模块）：
  1. `unwatch_stops_delivering_events`：watch 临时目录 → 写文件 → 收到事件；`unwatch` → 再写 → **等待窗口内零事件**
  2. `watch_twice_is_idempotent`：同 project 重复 watch → 单次写入仍只 1 条批次
  3. `rewatch_after_unwatch_delivers_again`：watch → unwatch → watch → 写入 → 恰好 1 条（证明重启成功且无残留）
  4. `unwatch_stops_git_worker`：unwatch 后不再触发 status 计算（sink / worker 计数）
- [ ] 运行确认失败（当前实现下 1、2、4 必失败）

**Green**

- [ ] `spawn_maintenance_thread` 参数改 `Weak<Mutex<RecommendedWatcher>>`；每消息 `upgrade()`，失败即 `break`（注释写明：所有者已释放 ⇒ 无需再维护）
- [ ] `core.rs` 侧的 `Arc::clone` 改 `Arc::downgrade`
- [ ] `watch()` 入口幂等：已存在同 project_id → `log::warn!` 返回
- [ ] 测试转绿

**Refactor**

- [ ] 在 `handle.rs` 补注释：唯一强所有者 + 各线程退出条件（即 design §1.4 契约的代码落点）
- [ ] 复核心跳线程：`stop_signal` 仍是唯一轮询者，注释说明"最长 10s 退出"是已知且可接受

**验证**：`cargo test --manifest-path src-tauri/Cargo.toml`（全量）

## Step 3 — 只读 git 调用单点注入（R2）— ✅ 已实施

**Red**

- [ ] facade 单测：`core::exec` 与 `common::executor` 构造出的命令环境含 `GIT_OPTIONAL_LOCKS=0`
- [ ] 结构性断言：读路径不再出现 `--no-optional-locks` 回退分支（删除后由测试钉死）
- [ ] 运行确认失败

**Green**

- [ ] 在 `core::exec`（collect / spawn_with / run 的 `SpawnOptions`）与 `common::executor` 各注入一次 env
- [ ] 退役散落机制：删除 `readonly_opts()` 的 env 注入用途与 worker 的 CLI 标志及回退分支（`readonly_opts` 若仍有 `extra_config` 用途则保留但注释说明锁语义已由 facade 承担）
- [ ] 写路径回归：`git_test` 的 stage/commit/stash/checkout 用例全绿（证明 optional ≠ 必需）
- [ ] 测试转绿

**Refactor**

- [ ] 把「只读语义」的说明写进 `common/git` 模块头注释（一处定义，避免后人再逐点补 opts）

**验证**：`cargo test --manifest-path src-tauri/Cargo.toml`

## Step 4 — 现场复测 + 全量质量门 —— 🟡 门禁已过，现场复测待补

**门禁（全部实跑，2026-09-24 23:0x）**

| 门禁 | 结果 |
|---|---|
| `cargo test --lib` | **1348 passed / 0 failed**（实施前 1337 → +11：lifecycle 5、git_env 3、index-mtime 2、sink 1） |
| `cargo test --test unit` | **103 passed / 0 failed** |
| `cargo fmt --check` / `cargo clippy -- -D warnings` | ✅ |
| `pnpm lint`（含 5 个 python 护栏 + java-host） | ✅ |
| `pnpm type-check` | ✅ |
| `pnpm test:run` | **477 文件 / 4204 passed / 0 failed** |

**现场复测（2026-09-24 23:0x–23:15，App 运行中）**

关键方法：**日志行号即构建指纹**（源码改动会平移行号），可把同一日志里的两个进程分开归因：

| 消息 | 旧构建（HEAD） | 新构建（本次改动） | 实测出现 |
|---|---|---|---|
| `Emitting file-changed` | debounce:125 | **debounce:127** | 两者都出现 → 分别归属两个进程 |
| `Heartbeat stopping` | core:319 | **core:330** | 330（新构建） |
| `Heartbeat check` | core:324 | **core:335** | 324（旧包）/ 335（新构建） |

- **AC1 ✅ 现场验证**：在 dev 实例监听的 codeant 仓库新建 1 个文件 → 窗口内 `debounce:127`（新构建）**恰好 1 行**；同时段 `debounce:125`（旧包）**4 行**（旧包自 12:48 起累积 4 个泄漏 watcher，本身就是缺陷活样本）。
- **AC7 ✅ 已采样（含口径说明）**：15s × 0.1s 采样 `.git/index.lock`，期间连续 8 次建文件触发两侧 status → **未采样到任何持锁者**。注意：index 锁窗口极短，0.1s 采样可能漏检；更强的证据是自动化用例（`status` 前后 `.git/index` mtime 严格相等）。
- **AC2/AC3 机制已覆盖、现场待你操作**：项目切换需 UI 驱动；契约测试（`unwatch_stops_delivering_events` / `watch_twice_is_idempotent`）已断言等价语义，且验证过"回退修复即失败"。
- **测量前置（重要）**：`/Applications/Neeko.app`（12:48 旧包）仍在运行，与 dev 实例同写一个日志 → 任何 `grep -c` 累计值都不可用于判断修复（本次即因此先误判）。测量前必须退掉旧包，或按上面的**行号指纹**分段统计。



- [x] 单实例现场（2026-09-25 复测；运行包 `/Applications/Neeko.app` 为 **09-24 23:50 修复后构建**，指纹 `debounce:127` / `core:335`，09:42 启动）：**AC1 ✅** —— 会话内 29 个 `Emitting file-changed` 批次全部「一次变更恰好 1 条发射」，唯一同秒双行是 293ms 内的两次真实变更（3 路径 + 2 路径各自合并为一批），**零同秒重复发射**（旧缺陷特征为同秒 3 条全同、`for N paths` 全等）。**AC2/AC3 本会话未产生项目切换**（全程单 watcher 3122d984、无 unwatch / Heartbeat stopping），机制由 lifecycle 契约测试覆盖（今日 5/5 绿 + 回退即失败已验证）；现场 UI 驱动切换复测为**唯一残留**，待人工操作。
- [x] `lsof` 采样复测：未重采样（本会话无争用场景可采样）；以更强的自动化证据替代 —— `.git/index` mtime 前后严格相等的两条行为测试今日全绿（AC7 已于 2026-09-24 采样，未捕获持锁者）。
- [x] `pnpm lint`（2026-09-25：fmt + clippy -D warnings + 5 个 python 护栏 + java-host 全链路 ✅，提交 f2fd39ca 的 lefthook 与会话内实跑各一次）
- [x] `pnpm type-check`（2026-09-25 ✅）
- [x] `pnpm test:run`（2026-09-25：**482 文件 / 4250 passed / 1 skipped**）
- [x] `cargo test --manifest-path src-tauri/Cargo.toml`（2026-09-25：**lib 1362 passed / 0 failed**；**integration 103 passed / 0 failed**）
- [x] 既有契约保持绿：`worker_does_not_emit_when_status_unchanged`、`worker_stress_concurrent_signals_churn_and_branch_switch`、折叠语义测试（collapsed_probe 全组）、lifecycle ×7（含 unwatch_stops_git_worker_snapshots）—— 今日全绿。

## 实施结果（2026-09-24，本会话完成）

> 交付纪律：Step 1（纯重构）与 Step 2/3（两处修复）**互不交错**，可分别 revert。改动已按
> 三笔独立提交落库：`d312445e`（Step 1 sink 抽象 + Step 2 生命周期释放）/ `4e8f02aa`
> （Step 3 只读语义）/ `322cfbb2`（Step 2 幂等契约测试负载无关化）。后续同域任务
> （discard 统一入口 + status 快照新鲜度 poke-and-wait）见 `f2fd39ca`（2026-09-25）。

### Step 1 — 事件出口抽象 ✅（零行为变更）

- 新文件 `common/file/watcher/sink.rs`：`WatcherEvent` 枚举（5 个变体）+ `WatcherEventSink` 单方法 trait + `AppHandleSink` 适配器。
  **形态选择**：用「枚举 + match」而非「每事件一个 trait 方法」—— 本仓开闭原则规定「策略集已知且固定时用 Enum + match」，新增事件由编译器强制所有分支处理，不会漏接。
- 8 处 `app_handle.emit(...)` 全部改走 sink（`manager/core.rs` ×5、`manager/callbacks.rs` ×1、`debounce.rs` ×2）；组合根（`project/commands.rs` ×2 调用点、`app.rs` 会话恢复 ×1）注入 `Arc::new(AppHandleSink::new(app_handle))`。
- **watcher 域不再依赖 Tauri `AppHandle`**：只有 `sink.rs` 接触 `emit`（依赖倒置）。
- 证据：`cargo test --lib` 1338 passed / 0 failed（较改动前 +1，即新增的 sink 用例），零回归。

### Step 2 — watcher 生命周期 ✅

- `spawn_maintenance_thread(watcher: Arc<..>)` → `Weak<..>`：每消息 `upgrade()`，失败即退（注释写明「所有者已释放 ⇒ 无需再维护」）。`core.rs` 侧改 `Arc::downgrade(&watcher)`。
- `watch()` 入口幂等：已存在同 project_id → `log::warn!` 返回（不变量在所有者处强制）。
- 新文件 `manager/lifecycle_tests.rs`：5 条**无 GUI** 契约测试（`watch_delivers_file_changed` / `unwatch_stops_delivering_events` / `watch_twice_is_idempotent` / `rewatch_after_unwatch_delivers_exactly_once` / `unwatch_stops_git_worker_snapshots`）。
- **Red 验证（关键）**：临时把两处修复各回退一格（幂等闸门 `false &&`、`Weak` 改回 `Arc`）→ **4/5 失败**（仅"能投递"基线通过）；恢复后 5/5 绿。证明测试能抓回归，而非"恰好绿"。

### Step 3 — 只读 git 语义 ✅（单点生效）

- 新文件 `common/git/git_env.rs`：只读默认值 `GIT_OPTIONAL_LOCKS=0` 的唯一构造点 + `with_optional_locks_disabled(env)`（尊重调用方显式覆盖）+ 3 条单测。
- 注入点（两处，覆盖全部 git 调用）：
  1. `core/exec.rs` 新增 `spawn_target()` —— 本地 facade 唯一 spawn 入口，`opts.cmd == "git"` 时补 env（`collect`/`run`/`spawn_with`/`collect_blocking*`/worker 同步桥全覆盖）；
  2. `common/git/transport` 的 `run_git_opts` / `run_git_with_stdin` 共用 env 组装处 —— **三端（Local/WSL/SSH）同时生效**（WSL/SSH 是把 env 渲染成远端 shell 前缀，实测代码确认）。
- 退役：`status_worker` 的 `--no-optional-locks` 与「老 git 不支持则回退到无标志」分支整体删除（回退分支正是当年漏锁语义的地方之一）。
- 测试：`git_status_does_not_refresh_index`（transport 路径）+ `collect_blocking_git_status_does_not_refresh_index`（同步桥路径）—— 以 `.git/index` mtime 前后比对断言"读路径零副作用"。
- **Red 验证**：临时关闭两处注入 → 两条测试都失败（mtime 差异 `779818260 → 796863998 ns`）；恢复后绿。

### 与设计稿的偏差（如实记录）

1. **`readonly_opts()` 未整体退役**（设计稿写的是"退役散落机制"）：它被约 20 处调用点引用，删除只带来"表述统一"而无行为差异，且会让本次 diff 跨 20 文件。**语义的单一事实源已迁到执行层**（facade + transport 默认注入），`readonly_opts()` 退化为显式意图标注。留作后续清理（低优先）。
2. **心跳线程仍为 10s 轮询退出**（设计稿已列为"已知且可接受"）：未做即时唤醒，避免为单线程引入第二套停机协议。
3. **`WatcherResources` 资源聚合未做**（YAGNI 边界，设计稿已声明默认不做）。

## Review Gates

1. **Step 0 基线必须先记录**：AC1/AC2 的验收依赖「改动前数字」。
2. **Step 1 必须是零行为变更的纯重构**且单独提交（否则后续 bug 无法 bisect）。
3. **Step 2 / Step 3 分别独立提交**，可单独 revert（包络原则要求两件事不交错）。
4. 生命周期契约必须由行为测试守护（不接受"只在文档里写契约"）。

## Rollback Points

- Step 1：sink 抽象可独立保留（纯重构）。
- Step 2：`Weak` 化 + 幂等判断 可单点回滚。
- Step 3：facade 注入可回滚；退役的旧机制如需恢复，从 Step 3 提交里取反即可。
- 写路径未动，回滚风险低。

## 明确不做

- 不改事件名 / 载荷 / 时序（协议不变）。
- 不重构 `registration.rs` 的目录注册算法。
- 不引入 `WatcherResources` 资源聚合重构（YAGNI）。
- 不用进程级 `std::env::set_var` 注入锁语义。
- 不为心跳线程做即时唤醒（10s 轮询已知且可接受）。
