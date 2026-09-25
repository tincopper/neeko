# 技术设计：watcher 生命周期释放 + 只读 git 调用零副作用

> 本文按两条原则组织：**问题分析走第一性原理**（先确立事实与不变量，再谈改动）、
> **实现追求高内聚 / 低耦合 / 可扩展 / 最大复用**（能收敛到单一机制的，不并列第二套）。

## 0. 包络原则（为什么两件事放一个任务）

两者都是「**边界纪律**」缺陷，共享同一条不变量：

> **资源的生命周期必须由唯一所有者显式界定（watcher）；只读路径不得产生写副作用（git 调用）。**

它们不在同一段代码里，因此**交付物必须可分别 revert**（两笔独立提交，不交错）。若实施中任一项变大，允许拆出独立任务。

## 1. watcher 生命周期

### 1.1 第一性事实（实测 + 静态核实，2026-09-24）

| 事实 | 证据 |
|---|---|
| 单实例下同一变更被 emit **3 次** | 只跑 `target/debug/neeko`（pid 58265）：单次新建 `tmp-dup-probe/a.txt` → 同一秒 3 行完全相同 `Emitting file-changed for 2 paths`（57.667 / 57.670 / 57.670） |
| 同一项目被反复 watch，且**无释放** | 本进程内 `Started watching project 3122d984…` **4 次**、`ee678242…`（codeant）**10 次**，期间无任何释放日志 |
| 线程退出条件是隐式的 | `registration/maintenance.rs:11-21`：`spawn_maintenance_thread(watcher: Arc<Mutex<RecommendedWatcher>>, …)` + `while let Ok(msg) = rx.recv()` —— 维护线程**强持有** watcher，退出条件 = 所有 `maintenance_tx` 被 drop |
| 而 tx 被 watcher 内的闭包持有 | `manager/core.rs:157-168` 把 `maintenance_tx_for_closure` 交给 `build_notify_callback(...)`，闭包活在 watcher 内部 |
| 其余线程同样只靠"断开即退出" | debounce / tree-debounce（tx 亦在闭包内）、throttle scheduler（tx 在句柄）、git worker（`signal_tx` 在句柄）、heartbeat（轮询 `stop_signal`，10s tick） |

### 1.2 根因（第一性表述）

**隐式退出条件（"所有发送端自然断开"）与双向强持有同时存在 ⇒ 永不退出。**

```
handle._watcher ──Arc──> RecommendedWatcher ──闭包──> maintenance_tx
                                  ▲                        │
                                  └──── Arc ──── 维护线程 ◄──┘（等 tx 断开才退出）
```

`unwatch()`（`core.rs:391-398`）只做「map 移除 + `stop_signal=true`」，而 `stop_signal` **只有 heartbeat 读** ⇒ 旧 watcher 继续投递事件、继续驱动 git worker。项目切换次数越多越严重（codeant 10 次即证）。

### 1.3 修法（复用既有语义，不新增协议）

**主修：所有权单向化 —— 维护线程改持 `Weak<Mutex<RecommendedWatcher>>`。**

- 逐消息 `upgrade()`；`upgrade()` 失败即 `break`（等价于"所有者已释放"）。加/删/重载都需要 `&mut`，`upgrade` 的代价可忽略。
- 于是**删掉** `WatcherHandle` 时：`_watcher` 是唯一强引用 → `RecommendedWatcher` drop → 其闭包 drop → 闭包内各 tx drop → maintenance / debounce / tree-debounce / scheduler / worker 的**既有退出条件全部自然生效**（它们本来就是 "recv Err → break"）。
- 关键点：这正是**最大化复用**——退出机制是现成的，缺的只是所有权；相比之下"为每个线程再加一条停机消息"要新增协议并让两个机制并存（心跳看 flag、其余看消息），内聚性更差。
- 心跳线程是唯一例外（轮询 `stop_signal`，最长 10s 才退），可接受；若将来要求即时，同样给它接一个唤醒通道即可（不在本次）。

**配套（入口不变量）：`watch(project_id)` 幂等。** 同一 project_id 已存在即 `log::warn!` 后返回，不再新建第二套资源。
第一性理由：*"同一项目只允许一套 watcher" 是所有者侧的不变量，应在入口强制，而不是依赖上游不重复调用* —— 现有唯一调用点 `set_active_project` 只在切换时 watch，配置变更走 `WatchMaintenance::ReloadAll`（不需重建 watch），故幂等忽略安全。

**可选（仅在改动已足够小的前提下考虑，YAGNI 边界）**：把 `watch()` 里的 6 类资源收进 `WatcherResources`（单一构造点 + 明确 drop 顺序）。收益是可读性与"新线程有落点"，代价是本次 diff 变大 ⇒ **默认不做**，只在实现时若发现 drop 顺序需要显式约束才引入。

### 1.4 生命周期契约（写进文档，供后续扩展遵守）

> 新增 watcher 线程/资源时必须满足：
> 1. **强所有者唯一**：`WatcherHandle`；辅助线程只许持 `Weak` 或纯数据克隆。
> 2. **退出条件显式**：要么自带唤醒通道（`rx` 断开即退），要么轮询 `stop_signal`，二者必居其一，且在代码注释里写清。
> 3. **不得持有 watcher 的强引用**（否则回到本次的环）。

由行为测试守护（§1.5），不靠人工记忆。

### 1.5 可测性（硬前提：不能被 CI 断言的契约等于没有契约）

现状所有事件出口是闭包里的 `app_handle.emit(...)`（5 个事件名：`FILE_CHANGED`、`FILE_TREE_CHANGED`、`GIT_CHANGED`、`GIT_STATUS_SNAPSHOT`、`GIT_PERF_SUGGESTION`）⇒ 无法无 GUI 测试。

- **收敛为一个出口抽象**：`trait WatcherEventSink { fn emit(&self, event: WatcherEvent<'_>); }`（或事件名常量 + `serde_json::Value` 载荷），生产注入 `AppHandle` 适配器，测试注入收集器。
  - 内聚：所有事件走同一出口；耦合：watcher 不再直接依赖 Tauri `AppHandle`（依赖倒置，也便于将来换 transport）。
  - 复用：事件名常量已在 `watcher/types.rs`（红线 5），此处直接引用，不新造字符串。
- 契约测试（无 GUI）：
  1. `unwatch_stops_delivering_events`：watch → 写文件 → 有事件；unwatch → 写文件 → **等待窗口内零事件**
  2. `watch_twice_is_idempotent`：重复 watch 同 project → 单次写入仍只 1 条批次
  3. `rewatch_after_unwatch_delivers_again`：watch → unwatch → watch → 写入 → 恰好 1 条
  4. `unwatch_stops_git_worker`：unwatch 后不再触发 status 计算（sink 或 worker 计数断言）

## 2. 只读 git 调用：消除读路径的写副作用

### 2.1 第一性事实（本机实测，2026-09-24）

| 实验 | 结果 |
|---|---|
| `git status --porcelain`（无 env） | `.git/index` mtime **变化** ⇒ 读路径**刷新 index**（写副作用，需 optional lock） |
| `GIT_OPTIONAL_LOCKS=0 git status --porcelain` | index mtime **不变** ⇒ 副作用被消除 |
| `git ls-files --others --exclude-standard`（无 env / 有 env / `core.untrackedCache=true`） | index mtime **均不变** ⇒ 实测**不是**争用源（保持一致性无成本，但不是缺陷） |
| `GIT_OPTIONAL_LOCKS=0 git add && git commit` | **正常成功** ⇒ optional locks ≠ 必需锁，写路径不受影响 |

代码侧事实：`READONLY_ENV = [("GIT_OPTIONAL_LOCKS","0")]` 已被多数 transport 读路径使用；缺口是 `operations/info.rs:26`、`operations/worktree.rs:54`（`run_git` 无 opts）；`status_worker` 用 CLI `--no-optional-locks`（含"老 git 不支持则回退到无标志"的分支 ⇒ 回退时会争锁）。libgit2 路径默认不含 `UPDATE_INDEX` ⇒ 不写 index，无需处理。

### 2.2 修法：单一注入点（而不是逐调用点补丁）

**在 exec facade 层统一注入 `GIT_OPTIONAL_LOCKS=0`** —— `core::exec`（`collect`/`spawn_with`/`run` 的 `SpawnOptions.env`）与 `common::executor`（`ExecTarget` 各实现构造命令处），业务代码无感。

- 高内聚：一个地方定义"Neeko 自己的 git 调用一律不取 optional lock"。
- 低耦合：`operations/*` 不需要知道锁语义；`readonly_opts()` 与 worker 的 CLI 标志都可**退役**（避免三套机制并存）。
- 可扩展：将来新增任何 git 调用自动获得该语义（这正是逐调用点补丁做不到的）。
- 复用：复用既有 facade（AGENTS.md 红线 1 的唯一命令执行入口）。

**明确否决"进程级 `std::env::set_var`"**：Tauri 拉起的终端 / agent 子进程会继承它 —— 改变的不是我们自己的调用，而是**用户可见环境**（用户终端里的 `git status` 也会不刷新 index）。第一性上：变更的爆炸半径必须最小，故不收这条路。

**改动的可证伪性（AC6 自动化化）**：
- facade 单测：断言 `SpawnOptions` 注入后的命令环境含 `GIT_OPTIONAL_LOCKS=0`（两处入口各一条）。
- 结构性断言：`worker` 不再出现 `--no-optional-locks` 回退分支（删除 + 测试钉死读路径走 env）。
- 写路径回归：`git_test` 既有写用例（stage/commit/stash/checkout）在注入后仍全绿 ⇒ 证明"optional ≠ 必需"在真实路径上成立。

### 2.3 归因仍先于结论（AC7）

Neeko 侧修完"不再主动争锁"后，仍需记录一次 `lsof .git/index.lock` 采样（触发点：仅文件变更 / 面板刷新 / IDE 打开仓库），把"外部进程（IDE / 用户手工 git）是否仍持锁"写进 notes —— 若不采样，无法判断残留的 `index.lock` 冲突是否已有定论。

## 3. 风险 / 回滚

| 风险 | 缓解 |
|---|---|
| `Weak` 化后维护线程在某时序下拿不到 watcher（例如 shutdown 与 AddDir 并发） | `upgrade` 失败即 `break`，语义为"所有者已释放 → 无需再维护"，与 drop 顺序天然一致 |
| 幂等 watch 掩盖"配置变更需重建"的真实需求 | 入口 warn 日志 + 既有 `ReloadAll` 覆盖规则变更；若将来确有重建需求，改为显式 `rewatch()` 接口而非放松幂等 |
| facade 注入影响既有测试对 env 的断言 | 先跑一次全量 `cargo test` 建基线；注入点单测覆盖 env 形状 |
| 契约测试因真实 FS watcher 抖动 flaky | 断言用宽松窗口 + 明确重试；CI 不稳定则退化为"注入回调直驱"的契约层测试（不依赖真实 FSEvents） |
| 出口抽象引入事件名/载荷漂移 | 只换出口不改名字与结构；引用 `types.rs` 既有常量（红线 5） |

**回滚**：§1 与 §2 完全独立，各自 revert；§1 内部再分「sink 抽象（纯重构，可独立保留）/ Weak 化 / 幂等」三步，可分别回滚。

## 4. 权衡记录

| 决策 | 选择 | 备选 | 理由（第一性） |
|---|---|---|---|
| 生命周期修法 | **所有权单向化（Weak）**，复用"断开即退出" | 维护线程加 `Shutdown` 消息 | Shutdown 是"再加一套机制"：心跳看 flag、其余看消息，两套并存；Weak 让**既有**退出条件生效，改动更小且不新增协议 |
| 重复 watch | 入口幂等（已存在即 warn 返回） | 先 unwatch 再重建 | 唯一调用点只在切换时 watch，配置变更走 ReloadAll；不变量应在所有者处强制 |
| 出口抽象 | 单一 `WatcherEventSink`（事件名沿用既有常量） | 逐处替换 `AppHandle::emit` | 内聚 + 依赖倒置；也才可能有无 GUI 契约测试 |
| 锁语义注入点 | **exec facade 统一注入 env** | 逐调用点 `readonly_opts()` | 逐点是纪律型修复：易漏、且新调用点默认没有；facade 是既有唯一入口（复用） |
| 是否进程级 env | **否**（facade 注入） | `std::env::set_var` 全局 | 会污染用户终端/agent 子进程，爆炸半径不可控 |
| CLI 标志 vs env | env（`GIT_OPTIONAL_LOCKS`） | `--no-optional-locks` | env 自 git 2.15、标志需 2.18；且能删掉 worker 的回退分支（三套机制 → 一套） |
| 资源聚合重构 | 默认不做（YAGNI） | 引入 `WatcherResources` | 只为修 bug 时最小 diff 更优；若实现中发现 drop 顺序需显式约束再引入 |
