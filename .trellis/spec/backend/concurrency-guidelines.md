# 并发指南

> Rust 后端中的线程与同步模式。

---

## 概述

后端混合使用 **OS 线程**（用于 PTY I/O）和 **tokio**（用于 SSH I/O 和 Tauri 异步命令）。共享状态通过 `std::sync::Mutex` 和 `Arc<Mutex<HashMap>>` 同步。

---

## 线程模型

### 每个本地终端会话：2 个 OS 线程

| 线程 | 名称 | 用途 |
|------|------|------|
| 读取器 | `pty-reader-{id[..8]}` | 以 4KB 块读取 PTY 输出，发送 `terminal-output-{id}` 事件 |
| 监视器 | `pty-watcher-{id[..8]}` | 每 100ms 轮询 `child.try_wait()`，退出时发送 `terminal-closed-{id}` |

### 每个 SSH 终端会话：1 个 OS 线程

| 线程 | 名称 | 用途 |
|------|------|------|
| I/O | `ssh-io-{id[..8]}` | 运行独立的 `tokio::runtime::Runtime`，通过 `tokio::select!` 多路复用输入/输出/调整大小 |

### 每个项目：文件监视线程

由 `notify` crate 的 debouncer 管理 —— 1 个防抖线程 + 1 个轮询线程（10 秒间隔）。

### 线程命名约定

```rust
std::thread::Builder::new()
    .name(format!("pty-reader-{}", &session_id[..8]))
    .spawn(move || { ... })
    .ok();
```

始终为线程命名以便于调试。会话 ID 使用 `{id[..8]}` 缩写。

---

## 同步原语

### `Mutex<T>` —— 用于不频繁修改的状态

在 `AppStateWrapper` 中用于需要外部修改的 Manager：

```rust
pub struct AppStateWrapper {
    project_manager: Mutex<ProjectManager>,
    agent_manager: Mutex<AgentManager>,
    active_project_id: Mutex<Option<String>>,
    // ...
}

// 在命令中的使用（内部锁用 expect，外部状态锁用 map_err）
let sessions = self.sessions.lock().expect("infallible: sessions lock");
let mut pm = state
    .project_manager
    .lock()
    .map_err(|e| AppError::LockPoisoned(e.to_string()))?;
```

### `Arc<Mutex<HashMap<String, T>>>` —— 用于并发会话映射

在 `TerminalManager` 和 `RemoteTerminalManager` 中用于会话集合：

```rust
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    pty_handles: Arc<Mutex<HashMap<String, PtyHandle>>>,
}
```

`Arc` 允许跨线程共享。每个线程在派生前克隆 `Arc`：

```rust
let sessions = self.sessions.clone();  // Arc 克隆
let handles = self.pty_handles.clone();

std::thread::Builder::new()
    .name(format!("pty-reader-{}", &id[..8]))
    .spawn(move || {
        // 通过 Arc 访问 sessions 和 handles
        let mut map = sessions.lock().expect("infallible: pty sessions");
        // ...
    })
    .ok();
```

### `Arc<AtomicBool>` —— 用于停止信号

在 `WatcherManager` 中用于通知轮询线程停止：

```rust
let stop = Arc::new(AtomicBool::new(false));
let stop_clone = stop.clone();

std::thread::spawn(move || {
    while !stop_clone.load(Ordering::Relaxed) {
        // 轮询...
        std::thread::sleep(Duration::from_secs(10));
    }
});

// 停止时：
stop.store(true, Ordering::Relaxed);
```

### `tokio::sync::mpsc::UnboundedSender/Receiver` —— 用于 SSH I/O 通道

用于将输入和调整大小事件从 Tauri 事件处理器传递到 SSH I/O 线程：

```rust
let (input_tx, mut input_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
let (resize_tx, mut resize_rx) = tokio::sync::mpsc::unbounded_channel::<(u32, u32)>();
```

---

## tokio 的使用

尽管配置了 `tokio = { features = ["full"] }`，tokio 的使用范围有限：

1. **Tauri 的异步运行时** —— 运行异步命令（`create_remote_terminal_session` 等）
2. **SSH I/O 线程** —— 创建独立的 `tokio::runtime::Runtime` 并使用 `block_on`
3. **`tokio::select!`** —— 多路复用 SSH 通道的读/写/调整大小
4. **`tokio::io::AsyncWriteExt`** —— 写入 SSH 通道

本地终端操作**完全同步/基于线程** —— 不涉及 tokio。

---

## 通信：前端 <-> 后端

### Tauri 事件用于流式数据

终端 I/O 使用 Tauri 事件（不是命令返回值）：

```rust
// 后端发送输出
app_handle.emit(&format!("terminal-output-{}", session_id), &output_bytes)?;

// 前端监听
listen<number[]>(`terminal-output-${sessionId}`, (event) => { ... });
```

```rust
// 前端通过事件发送输入
emit(`terminal-input-${sessionId}`, inputBytes);

// 后端监听
app_handle.listen(&format!("terminal-input-{}", session_id), move |event| { ... });
```

### 命令用于请求/响应

一次性操作使用命令：

```rust
invoke<GitInfo>("get_git_info_command", { path })
```

---

## Scenario: 本地终端关闭不阻塞 IPC

### 1. Scope / Trigger

- Trigger：关闭运行中 Agent（如 Claude/Codex/opencode）的终端 tab 时，子进程可能不响应 SIGTERM，`graceful_kill` 最多等待 3 秒。
- Scope：`close_terminal_session` 命令、`TerminalManager` 会话映射、PTY handle 清理、前端 terminal cache 销毁。

### 2. Signatures

```rust
#[tauri::command]
pub fn close_terminal_session(session_id: String, state: State<AppStateWrapper>)

impl TerminalManager {
    pub fn close_session_in_background(&self, session_id: &str);
    pub fn close_session(&self, session_id: &str);
}
```

### 3. Contracts

1. 前端 tab 关闭调用 `close_terminal_session` 时，命令必须快速返回，不等待 `graceful_kill` 完成。
2. `close_session_in_background` 先从 `sessions` 和 `pty_handles` 移除会话，再派生 `pty-close-{id[..8]}` 线程关闭 PTY。
3. 后台关闭线程负责注销 input listener、drop PTY master、执行 `graceful_kill`。
4. `close_all_sessions` 仍可使用同步 `close_session`，保证应用退出时尽量完成资源清理。
5. 禁止在持有 `pty_handles` 锁时执行 `graceful_kill` 或其他可能阻塞的进程等待。

### 4. Validation & Error Matrix

| 场景 | 预期行为 | 错误风险 |
|------|----------|----------|
| 关闭普通 shell tab | IPC 快速返回，后台线程完成关闭 | 无 |
| 关闭运行中 Agent tab | UI 不等待 3 秒；后台超时后 SIGKILL | 若同步等待会导致 tab 关闭卡顿 |
| 后台线程创建失败 | 记录错误，不阻塞命令返回 | handle 会随闭包 drop，需关注日志 |
| 应用退出 close_all_sessions | 同步遍历关闭剩余会话 | 退出路径允许等待资源清理 |

### 5. Good/Base/Bad Cases

- Good：`close_terminal_session` 调用 `close_session_in_background`，前端立即完成 tab 状态更新。
- Base：后台线程里执行 `close_pty_handle(session_id, handle)`，统一清理 listener/master/child。
- Bad：命令层直接调用同步 `close_session`，导致 Agent 不退出时 IPC 等满 `GRACEFUL_TIMEOUT_SECS`。

### 6. Tests Required

- 单元/集成可测点：关闭命令调用后，`sessions` 与 `pty_handles` 立即移除对应 id。
- 回归验证点：运行 Agent 后关闭 tab，前端 `close_terminal_session` 的 Promise 不应接近 `GRACEFUL_TIMEOUT_SECS`。
- 日志验证点：后台仍可看到 `PID ... did not exit ... SIGKILL`，但 UI 不被这段等待阻塞。

### 7. Wrong vs Correct

#### Wrong

```rust
#[tauri::command]
pub fn close_terminal_session(session_id: String, state: State<AppStateWrapper>) {
    state.terminal_manager.close_session(&session_id);
}
```

#### Correct

```rust
#[tauri::command]
pub fn close_terminal_session(session_id: String, state: State<AppStateWrapper>) {
    state
        .terminal_manager
        .close_session_in_background(&session_id);
}
```

---

## Scenario: 进程树兜底（清理脱离进程组的 Agent 残留）

### 1. Scope / Trigger

- Trigger：关闭本地 Agent tab 后，对应 Agent 进程（或其派生子进程）仍残留不退出。
- 根因：`portable-pty` 用 `setsid()` 让 shell 成为会话/进程组 leader（PGID==PID），`graceful_kill` 发信号到 `-PGID` 只能覆盖**仍在组内**的进程。部分 CLI（Agent、语言服务器、daemon）自行 `setsid()` 脱离进程组，成为孤儿。
- Scope：`terminal::process_reaper`（枚举 + 终止）、`close_pty_handle` 的 Unix 分支。

### 2. 判定规则

进程属于某 PTY 会话（root 为 shell PID），满足任一即收编：

1. `pid == shell_pid`（shell 自身）
2. `sid == shell_pid`（同会话，未脱离）
3. 从 `ppid` 向上递归可达 `shell_pid`（脱离组但仍是后代，覆盖 daemonize 前/未完全脱离的场景）

### 3. Contracts

1. `close_pty_handle` 先 `graceful_kill`（进程组 SIGTERM→2s→SIGKILL），随后调 `reap_session_tree(shell_pid)` 兜底。
2. 兜底对命中进程 SIGTERM → 复用 `GRACEFUL_TIMEOUT_SECS` → SIGKILL；已死进程自动跳过（`kill(pid,0)` 检测）。
3. 平台枚举：
   - **macOS**：`libproc` crate（`pids_by_type(ProcFilter::All)` + `pidinfo::<BSDInfo>` 拿 `pbi_ppid` + `libc::getsid`）。
   - **Linux**：遍历 `/proc/<pid>/stat`，按 `rsplit_once(')')` 后解析 ppid（fields[1]）与 session（fields[3]）。
   - **Windows**：不参与——Job Object 已覆盖全树（`services.rs` `close_pty_handle` Windows 分支）。
4. 全流程在 `pty-close-{id}` 独立 OS 线程执行，满足阻塞 I/O 隔离红线，不接触 tokio。

### 4. Validation

| 场景 | 预期 |
|------|------|
| shell 正常退出 | 兜底无可收编进程，跳过 |
| Agent 子进程 setsid 脱离 | 通过 ppid 祖先链被收编并终止 |
| 进程已死/竞态消失 | `kill(pid,0)` 失败即跳过，SIGKILL 无害 |
| Windows | 走 Job Object，不编译 reaper 代码 |

- 单元测试：`terminal::process_reaper::tests` 用真实 `fork`+`setsid` 构造脱离进程验证收集与终止（macOS/Linux）。

## Scenario: 终端输出信用拉取与有界合流泵（08-25 内存治理）

### 1. Scope / Trigger

- Trigger：旧链路 `PTY 4KB read → emit(Vec<u8>) → JSON number[] (~6x) → listen → term.write()` 全链路无界，WebContent 8.7min 膨胀至5.2GB，microtask 68% `arrayPush+realloc`。
- Scope：`terminal/pump.rs`（合流泵）、`common/terminal/drain.rs`（有界信用队列）、`terminal/services.rs`（reader泵接入）、`terminal/manager.rs`与`terminal/remote.rs`（双后端同构）、前端`shared/utils/drainLoop.ts`/`fitScheduler.ts` + `TerminalViewBase`。

### 2. Signatures

```rust
pub(crate) struct PumpConfig { pub max_buffer: usize, pub flush_interval: Duration, pub pause_poll: Duration }
impl Default for PumpConfig { fn default() -> Self { Self { max_buffer: 256*1024, flush_interval: 16ms, pause_poll: 2ms } } }
pub(crate) fn run(reader: Box<dyn Read+Send>, cfg: &PumpConfig, flush_fn: impl FnMut(&[u8])->bool) -> PumpOutcome
#[cfg(unix)] pub(crate) fn run_polling(fd: RawFd, reader: Box<dyn Read+Send>, cfg: &PumpConfig, flush_fn: impl FnMut(&[u8])->bool) -> PumpOutcome
pub(crate) struct SessionDrain { buffer: Mutex<DrainBuffer>, wake_in_flight: AtomicBool, closed: AtomicBool }
impl SessionDrain {
    pub(crate) fn push(&self, bytes: &[u8], wake: impl FnOnce()) -> bool // 满载返回false（泵停读），closed时黑洞返回true
    pub(crate) fn take_and_rearm(&self, wake: impl FnOnce()) -> Vec<u8> // 取空并补发竞态wake，closed时永不重臂
    pub(crate) fn close(&self)
}
pub(crate) type SessionDrainMap = Arc<Mutex<HashMap<String, Arc<SessionDrain>>>>;
#[tauri::command] pub async fn terminal_drain(session_id: String, state: State<'_, AppStateWrapper>) -> Result<tauri::ipc::Response, AppError>
```

### 3. Contracts

1. **合流**：`flush_interval 16ms`内多段read合并为一次`flush_fn`，事件频率≤60Hz；`max_buffer 256KB`达阈立即flush。
2. **有界**：`DrainBuffer 512KB`（> pump 256KB，数学上排除单批死锁）；`push`在非空且`len+bytes>512KB`时返回`false`，泵`sleep(pause_poll)`重试，不丢字节。
3. **背压**：`false`时泵停读，内核PTY缓冲承压→前台`write`阻塞（终端正确语义）；前端`MAX_IN_FLIGHT_WRITES=8`门闸，`pendingWrites>=8`时`runDrainLoop`提前退出，余量由下次wake续拉。
4. **二进制**：`terminal_drain`返回`Response::new(Vec<u8>)`，前端`invoke<ArrayBuffer>`零JSON，`terminal-drain-{id}`仅零载荷hint。
5. **竞态闭合**：`push`以`swap(true)`确保至多一wake在飞；`take_and_rearm`取空后`store(false)`，若期间又有`push`立即`swap(true)`补发，永不丢wake。
6. **Unix及时性**：`run_polling`用`poll(fd, timeout=flush_interval剩余)`，超时回到循环顶部评估flush，消除阻塞读的“静默期不flush”折衷；Windows回退`run`阻塞读。
7. **生命周期**：`SessionDrain`随`TerminalManager`/`RemoteTerminalManager`的`take_session_handle`与`watcher`退出路径同步清理；`close()`使孤儿泵的push黑洞化，避免永久背压。

### 4. Validation & Error Matrix

| 场景 | 预期 | 风险 |
|---|---|---|
| agent CLI全速输出 | 合流后`flushes`≈`bytes/avgBatch`，`backpressure_pauses`可观测增长，footprint稳态<800MB | 无 |
| 前端慢消费(xterm未消化) | `push`返回`false`→泵停读→PTY缓冲→前端`pendingWrites>=8`暂停拉取，下次wake续拉不丢 | 若阈值过低会误限流 |
| 512KB满载 | 新`push`拒收，`wake_in_flight`仍保证单wake，消费端`take_and_rearm`后补发 | 单批>512KB时空缓冲特例直接接收（最坏512KB+256KB） |
| 会话关闭后孤儿push | `close()`后`push`黑洞`true`不缓冲不唤醒，`take_and_rearm`空且不重臂 | 若未close会永久停泊 |
| SSH backpressure期间输入/resize | `remote.rs`专用`tokio::time::sleep.await`非`std::thread::sleep`，select不饿死 | 误用`thread::sleep`会饿死2ms*N |

### 5. Good/Base/Bad Cases

- Good：10段4KB burst在16ms窗口内→1次flush，byte序完整，`stats.bytes`准确。
- Base：`DRAIN 512KB`满载时`push` 300KB→`false`→泵等待`pause_poll 2ms`→`take`后恢复。
- Bad：在`async` SSH select内用`std::thread::sleep`→输入/resize分支饿死；或单次`emit(Vec<u8>)` JSON导致6x膨胀。

### 6. Tests Required

- `pump::tests::coalesces_burst_into_single_flush_in_order` / `backpressure_pauses_then_delivers_everything` / `run_polling`超时flush
- `drain::tests::closed_drain_*` 黑洞与永不重臂 / `concurrent_push_take` 50KB乱序不丢
- `fitScheduler.test` RAF合帧+trailing+失败重试 / `drainLoop.test` latch/maybePending/digest 闭环
- 集成：`terminal_drain`往返`Vec<u8>`与`ArrayBuffer`一致性

### 7. Wrong vs Correct

#### Wrong

```rust
let mut buf=[0u8;4096]; loop{ let n=reader.read(&mut buf)?; app.emit("terminal-output-{id}", &buf[..n])?; }
// 前端 listen<number[]>: term.write() 无界积压，IPC JSON 6x
// SSH: std::thread::sleep(2ms) 在 tokio select 内
```

#### Correct

```rust
let drain: Arc<SessionDrain>=...;
run_polling(fd, reader, &PumpConfig::default(), |batch| drain.push(batch, || app.emit("terminal-drain-{id}",())?));
// 前端: listen("terminal-drain")→ while { chunk=await invoke<ArrayBuffer>("terminal_drain"); if empty break; term.write(chunk, ()=>pending--) }
// SSH backpressure: tokio::time::sleep(2ms).await
```


## 常见错误

### 1. 跨 thread::spawn 或 await 持有 Mutex 锁

```rust
// 错误 —— 派生线程时持有锁
let mut pm = state.project_manager.lock().map_err(...)?;
std::thread::spawn(move || { /* pm 被捕获 */ });

// 正确 —— 提取数据，释放锁，然后派生
let data = {
    let pm = state.project_manager.lock().map_err(...)?;
    pm.get_data().clone()
};
std::thread::spawn(move || { /* 使用 data */ });
```

### 2. 关闭会话时忘记清理线程

关闭终端会话时，确保：
- 注销输入事件监听器
- 释放 PTY master（向子进程发送 HUP）
- 带超时的优雅终止（SIGTERM -> 等待 -> SIGKILL）

### 3. 对 PTY 操作使用 `tokio::spawn`

本地 PTY 操作使用阻塞 I/O。使用 `std::thread::spawn` 而非 `tokio::spawn`，以避免阻塞异步运行时。

### 5. 在异步上下文中使用 `std::process::Command::output()`

`std::process::Command::output()` 是同步阻塞调用。在 `async fn`（Tauri 命令）中直接调用会**阻塞整个 tokio 工作线程**，导致所有并发请求排队等待。

如果 git push 等待 stdin（鉴权场景），进程永不退出，Tauri IPC 永久挂死。

```rust
// 错误 —— 阻塞 tokio 线程
let output = std::process::Command::new("git")
    .args(args)
    .output()?;  // 阻塞！不释放线程
```

**修正方案**：使用 `tokio::process::Command` + `tokio::time::timeout`

```rust
use tokio::process::Command as TokioCommand;

let output = tokio::time::timeout(
    Duration::from_secs(timeout_secs),
    TokioCommand::new("git")
        .args(args)
        .current_dir(work_dir)
        .output(),
)
.await
.map_err(|_| anyhow::anyhow!("git command timed out after {}s", timeout_secs))?
.map_err(|e| anyhow::anyhow!("git command failed: {}", e))?;
```

**默认超时**：本地操作 30s，网络操作（push/fetch/pull/clone）180s。定义在 `transport.rs`：

```rust
const LOCAL_GIT_TIMEOUT: Duration = Duration::from_secs(30);
const NETWORK_GIT_TIMEOUT: Duration = Duration::from_secs(180);
```

网络操作检测：
```rust
let is_network_op = args
    .first()
    .map(|a| matches!(*a, "push" | "fetch" | "pull" | "clone"))
    .unwrap_or(false);
```

### 6. Git 鉴权错误检测

在所有 git 命令执行后，扫描 stderr 匹配鉴权错误模式，返回带 `[AuthRequired]` 前缀的明确错误：

```rust
const AUTH_FAILURE_PATTERNS: &[&str] = &[
    "Authentication failed",
    "Could not read from remote repository",
    "Permission denied (publickey)",
    "could not read Username",
    "HTTP Basic: Access denied",
    "fatal: unable to access",
    "fatal: could not read",
    "request failed with status 401",
    "Repository not found",
];

fn check_auth_failure(stderr: &str) -> Option<&'static str> {
    AUTH_FAILURE_PATTERNS
        .iter()
        .find(|pat| stderr.contains(*pat))
        .copied()
}
```

搭配前端 `withTimeout` 和 `isAuthError` 检测，确保用户不会遇到永久挂死。

### 4. 移入线程前没有克隆 Arc

```rust
// 错误 —— 移走了 Arc，之后无法再使用
std::thread::spawn(move || {
    let map = self.sessions.lock().unwrap();  // self 被移走了！
});

// 正确 —— 先克隆 Arc
let sessions = self.sessions.clone();
std::thread::spawn(move || {
    let map = sessions.lock().unwrap();
});
```
