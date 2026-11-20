# 设计：LSP 关闭序列单一化

## 0. 边界

只动 `src-tauri/src/lsp/`：`session/instance.rs`（关闭序列）、`lsp/process.rs`（进程退出等待原语）、
`manager.rs`（三条入口归并）、`plugin/types.rs` + `plugin/builtins/java.rs`（宽限期数据）、
`session/testing.rs`（测试接缝）。协议、事件、前端契约不变。

## 1. 目标形态

```
close_session / close_session_for_restart / close_sessions_for_project
        │  ①落终态（close() / close_silently()）—— 顺序不变
        ▼
spawn_blocking ──► shutdown_and_exit(session)         ← 唯一实现
                     │
                     ├─ send_shutdown_request_bounded(grace)   Request, 等响应
                     ├─ send_notification_raw("exit", {})      Notification
                     └─ wait_exit(grace) → 仍活着才 kill_child()
```

三条入口只负责「挑哪些会话 + 宣告/静默」；关闭序列不再复制。这是 R1/AC1 的判据。

## 2. 关键契约

### 2.1 `shutdown` 必须是 Request

LSP 规范：`shutdown` 是 request，服务器响应后才允许发 `exit`。现状
`manager.rs:889` 用 `send_notification_raw("shutdown", {})` —— 服务器永远不会回，
`exit` 紧跟其后等于宣告「我不等你」。改为复用已有的 `send_shutdown_request()`
（`session/instance.rs:576`），并补上有界等待。

### 2.2 有界等待（R2）—— 复用 drain_pending，不加依赖

`send_shutdown_request()` 现在是 `rx.blocking_recv()`：服务器活着但沉默时**无界阻塞**
（`spawn_blocking` 线程被永久占用）。改为：

```rust
// instance.rs
pub(crate) fn send_shutdown_request_bounded(&self, timeout: Duration) -> Result<Message>
```

实现要点：插入 `pending` 后起一个**看门狗线程**，`timeout` 到期时把该 request id 从
`pending` 摘除；摘除即 drop `PendingSender`（oneshot sender），`blocking_recv()` 立刻返回
`Err`（无响应）。这与已有的 `drain_pending`（`instance.rs:766`）和
`await_init_response` 快速失败路径（有测试 `await_init_response_fails_fast_when_reader_dead`）
是同一机制，不引入新原语、不改 pending 生命周期。看门狗线程必须由调用方
`spawn_blocking` 上下文持有（它本身短命，`timeout` 上限毫秒级）。

> 备选方案（不采用）：把 `oneshot` 换成 `crossbeam_channel::after` 组合。
> 理由：pending 表的语义（reader 退出时统一 drain）已经被测试钉住，换类型要重写那批不变量。

### 2.3 进程退出等待（R2/AC4）—— 新增 `wait_exit`

Eclipse 的 checkpoint 发生在收到 `exit` 后的收尾阶段，此时 SIGKILL = 截断。
需要「等它自己退，超时才杀」。

`lsp/process.rs` 的 `LspProcess` 已有退出信号通路：

```rust
// bridge_exec_child，process.rs:541-556（现状）
tokio::select! { _ = kill_rx => { kill_fn().await }  _ = wait => {} }
let _ = done_tx.send(());          // done_rx 目前被 kill 闭包独占
```

改动：把 `(done_tx, done_rx)` 升级为 `Arc<(Mutex<bool>, Condvar)>` 退出门，
`kill` 与新增的等待共享它：

```rust
pub struct LspProcess {
    ...
    /// `FnOnce` → `FnMut` 之外的最小扩展：一次关闭只等一次。
    wait_exit: Option<Box<dyn FnMut(Duration) -> bool + Send>>,   // true = 已在宽限期内退出
    kill: Option<Box<dyn FnOnce() + Send>>,
}
impl LspProcess {
    /// 有界等待进程自行退出。超时返回 false（调用方据此兜底 kill）。
    pub fn wait_exit(&mut self, grace: Duration) -> bool;
}
```

真实实现 = 退出门 `Condvar::wait_timeout`（保留 `kill()` 现有的 2s drain 语义）。
测试实现 = 可注入的假闭包（见 2.5），因此**单测不 spawn 任何真实服务器进程**
（对齐 `check_unit_tests_spawn_real_binaries.py` 的判据）。

### 2.4 宽限期是插件数据（R3/AC5）

`LspServerTuning` 新增字段（与既有 `version_probe` / `java_home_from_path` 同构）：

```rust
/// 收到 `exit` 后等待服务器自行退出的宽限（毫秒）。
/// 默认 2000：一般服务器立即退，2s 足够吞掉包装器收尾。
/// 重量级（Eclipse/JVM）服务器声明更大值，否则其 checkpoint 会被 SIGKILL 截断。
pub shutdown_grace_ms: u32,          // Default::default() = 2_000
```

- `java.rs`：`with_tuning(LspServerTuning { shutdown_grace_ms: 10_000, .. })`，
  并在 `java_plugin_declares_jdtls_tuning` 同组补断言。
- `non_java_builtins_keep_generic_tuning` 扩展一条：非 java 插件必须是默认值。
- 会话在**创建时**把该值落到 `LspSession::shutdown_grace: Duration` —— 关闭路径只读会话，
  不查插件注册表（关闭时插件表可能已不可用；也避免第二处数据来源）。

### 2.5 可观测性（R4/AC2、AC3）

`session/testing.rs` 现状：`stub_session` 建了 `(writer, _writer_rx)` 后**丢掉 receiver**，
测试无法观察出站报文。新增：

```rust
/// 返回 writer 的接收端，供关闭序列的时序断言。
pub(crate) fn stub_session_with_writer(...) -> (LspSession, crossbeam_channel::Receiver<Message>)
```

再新增 `LspProcess` 的测试替身（`#[cfg(test)] pub(crate) fn test_stub(...)`），
用一个调用方可控的 `Arc<AtomicBool> exited` 表达「进程已退出」，
使 AC3/AC4 不依赖真实时间（禁 sleep 真秒数堆墙钟，`backend-testing.md`）。

## 3. 时序与失败矩阵

| 场景 | shutdown 响应 | 进程退出 | 期望行为 |
| --- | --- | --- | --- |
| 正常服务器 | 收到 | 宽限内退出 | 发 `exit` → 等退出 → **不 kill** |
| 沉默但活着 | 超时 | 宽限内退出 | 看门狗摘 pending → 仍然发 `exit` → 等退出 → 不 kill |
| 死进程（reader 已退） | 快速失败（drain_pending） | 立即 | 发 `exit`（写失败容忍）→ `wait_exit` 立即 true → 不 kill |
| 卡死服务器 | 超时 | 超宽限 | 两步都有界 → 最终 `kill_child()` 收口（R2 收口义务） |
| 已关闭会话 reader 退出 | — | — | 静默（既有不变量，R6，不改） |

失败处理一律 `log::warn!` + 继续下一步，**不允许** `?` 提前返回把进程留在原地
（那正是「终态已落、进程还活着」的孤儿形态，`process.rs:468` 注释里记录的 workspace 锁持有问题）。

## 4. 权衡

| 选择 | 代价 | 为什么仍选它 |
| --- | --- | --- |
| 有界等待放在 `spawn_blocking` | 关闭会占用阻塞线程最多 `2×grace` | 关闭是低频动作；在 tokio worker 上 sleep 会饿死 I/O 泵（红线 3） |
| 宽限期进 `LspServerTuning` | 多一个字段要维护 | 与既有两项 jdtls 特判同构；写死 `language_id == "java"` 违反红线 15 |
| 看门狗线程而非新超时原语 | 短暂多一个线程 | 复用 `drain_pending` 已被测试钉住的不变量 |
| 不动 `-data` | jdtls 仍共用 brew 的 basename 哈希目录 | 归属改动需要 argv 模板管道，属于独立设计（见 prd Out of scope 1） |

## 5. 兼容与回滚

- 无 schema / wire / 事件名变化；`stopped` 语义不变。
- 回滚 = revert 单个 commit；回滚后行为回到「10ms 硬杀」（等于恢复本 bug），无数据迁移风险。
- 风险点：关闭总时长上升。单个会话最坏 `2×grace`（jdtls ≤20s），而项目停用与
  应用退出是**串行/总预算**收口：
  - 项目停用：`N × 2 × grace`（N = 语言数；java+go+ts 最坏 ~28s），发生在离开项目 30 分钟后，
    用户可见影响为「状态栏停在 stopped 更久」；
  - 应用退出：`APP_QUIT_GRACE_BUDGET = 3s` 总预算，用尽则逐会话兜底 kill（取舍已记在 spec）；
  - 重启：必须 await 序列收口（否则两个 jdtls 抢同一 `-data` 锁），最坏 `2×grace` 才建新会话。
