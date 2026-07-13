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
