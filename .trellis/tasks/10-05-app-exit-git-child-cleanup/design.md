# 设计：退出时收敛 git 子进程树（共享单一 kill 动作）

> 需求见 `prd.md`。机制落点：`.trellis/spec/backend/git-domain.md §13`、`concurrency-guidelines.md`。

## 1. 第一性原理

- 操作系统不会因父进程退出而回收子进程 —— 它们孤儿化到 `init`，继续跑。
- 现有 git 传输层 spawn 用 `kill_tree` 自组，但 kill 只在**主动取消**时发生；退出路径没有调用点。
- 不能靠「future 的 `Drop` 里 kill」：kill 闭包作为 `FnOnce` 移进采集 future，future 被 drop 时只是被
  丢弃、不会执行；且无条件按 pid kill 有**进程组复用**误杀风险。
- 终止机制**取决于执行目标**：宿主 pid 可本地树杀；**SSH 的 pid 是远端的**，必须回远端 kill
  （按远端 pid 本地树杀会误杀本机无关进程）。
- 正解：**每个子进程只保留一个可重调 kill 动作**，取消与退出收敛**共用同一个动作**；登记表让
  动作在子进程存活期存在、结束即注销，退出时统一驱动。

## 2. 统一抽象：`KillFn`（`common/executor/types.rs`）

```rust
pub type WaitFuture = Pin<Box<dyn Future<Output = Result<i32, ExecError>> + Send>>;
pub type KillFuture = Pin<Box<dyn Future<Output = Result<(), ExecError>> + Send>>;
/// 可重复调用的强制终止动作：cancel（主动终止）与退出收敛共用同一个。
pub type KillFn = Arc<dyn Fn() -> KillFuture + Send + Sync>;

pub struct ExecChild { pub wait: WaitFuture, kill: KillFn, pub pid: Option<u32>, ... }
impl ExecChild {
    pub fn kill_action(&self) -> KillFn;                 // 取同一动作（退出登记用）
    pub async fn kill(self) -> Result<(), ExecError>;    // (self.kill)().await
    pub fn into_wait_and_kill(self) -> (WaitFuture, KillFn);
}
```

- `kill` 由**各 executor 构造**（它是唯一知道自己执行目标、并持有连接/进程句柄的地方），
  但差异全部在构造期定下 ⇒ 传输层与登记表**不分支 `ExecTarget`**。
- 关键改造：`kill_fn` 从 `FnOnce` 变为**可重调** `Fn`（闭包内 clone 捕获的 `Arc`）；
  取消与退出因此共用同一动作，不存在第二条 kill 途径。

## 3. 组件：`common/executor/child_registry.rs`

```rust
type Slots = HashMap<u64, KillFn>;
pub(crate) fn register(kill: KillFn) -> ChildLease;   // RAII，Drop 注销
pub(crate) fn kill_all_live() { kill_all_with(&drive_kill); }
fn kill_all_with(killer: &dyn Fn(&KillFn));           // 锁内快照 → 锁外驱动
fn dispatch(kills: &[KillFn], killer: &dyn Fn(&KillFn)); // 纯分派，单测用
fn drive_kill(kill: &KillFn) {                        // 退出线程同步驱动，确认有界 5s
    runtime::block_on_shutdown(async { let _ = timeout(KILL_GRACE, kill()).await; });
}
```

- **锁纪律**：短临界（`HashMap` 增删），无 `await`；中毒 tolerant（与 `main_window` 同风格）。
- **`kill_all_with`**：锁内快照 `KillFn` → 释放锁 → 锁外驱动（kill 会阻塞，不能持锁）。
- 与旧方案（`ExitKill` trait + `HostTreeKill`/`RemoteSshKill`）相比：**删掉一整套并行策略类型**，
  每个子进程只有一个 kill 动作，DRY 与一致性更强。

## 4. 集成点

### 4.1 executor 构造动作（唯一按目标分支处）

- `LocalExecutor` / `WslExecutor`：动作 = 锁住 child → `kill_process_tree(host_pid)` → `child.kill()`；
- `SshExecutor::kill_for`：动作 = 锁住 `Arc<tokio::sync::Mutex<Handle>>` → 新通道执行
  `kill -9 -<remote_pid> || kill -9 <remote_pid>`。（`Handle` 非 `Clone`/非 `Sync`，故用 async `Mutex`
  使动作 `Send + Sync` 且可重调。）

### 4.2 传输层登记（`run_shell_streaming`）

```rust
let child = executor.spawn_with(SpawnOptions::new(program, &["-c", shell_cmd]).with_kill_tree()).await?;
let _lease = Some(crate::common::executor::register(child.kill_action()));
// ... 原有 collect_child_output_streaming_cancellable（取消走同一 action）...
```

- `run_shell_streaming` 是 git 传输**唯一** `kill_tree` spawn 路径（`run_git_with_stdin_*` 是短命
  凭据 helper，无 hook 树）。

### 4.3 退出收敛（`app_state.rs::shutdown_background_and_exit`，`Destroyed` 触发）

```rust
let tasks: Vec<CleanupTask> = vec![
    ("terminal", ...), ("remote", ...), ("watcher", ...), ("lsp", ...),
    ("git-children", Box::new(crate::common::executor::kill_all_live)),
];
```

- 在所有后台服务关停前；每个 cleanup task 独立线程。此刻 git future 仍存活（runtime 未 `exit`）
  ⇒ 登记表含其动作 ⇒ 被驱动。SSH 动作借 `block_on_shutdown`（Tauri 全局 runtime）同步驱动。

## 5. 失败与边界

- **executor 契约（关键）**：`ExecChild.wait` **不得**跨 `await` 持有子进程句柄的 `Mutex` —— 退出收敛会在
  wait future 仍存活时驱动共享 kill 动作，持锁等待必死锁。Local / WSL 用短锁轮询 `try_wait`；回归测试
  `kill_action_does_not_deadlock_while_wait_is_polling`（曾复现 Red：退出 kill 抢不到锁、2s 超时）。
- **pid / 进程组复用**：登记项仅在存活期存在；正常完成 / 取消的 lease drop 注销 ⇒ 退出快照基本只含
  存活项。宿主路径仍有极窄窗口（子进程刚退出、lease 未 drop），与既有 kill 路径同风险
  （`kill_process_tree` 对已退出 pid `ESRCH` 无害）。
- **远端（SSH）**：在**远端** kill（非本地）；连接不可达时确认超时（5s）后放弃等待。**绝不**本地按
  远端 pid 杀。远端路径的端到端验证由 `10-05-wsl-ssh-remote-changes-parity` 现场承接。
- **运行期 future 被 drop（非退出）**：不主动 kill（只注销）。无取消协议时该场景不可达。

## 6. 测试策略

- `child_registry::tests`：`register` → `ChildLease` drop 注销；`dispatch` 调用每个动作
  （RecordingKill）；空分派 no-op。**不驱动 `kill_all_live`**（避免真杀其它测试登记的真实进程）。
- 取消有界：`collect::tests::await_kill_bounded_*`（kill 不收敛仍有界返回）。
- 传输/executor：由「`run_shell_streaming` 唯一 spawn 路径 + `DapSession`/clone/LSP 继续用同一
  `KillFn`」保证；check 阶段 grep 复核。

## 7. 非目标

见 `prd.md` Non-goals；核心是「不改取消协议」「不接管 DAP/终端/LSP」。
