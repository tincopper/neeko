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

// 在命令中的使用
let mut pm = state.project_manager.lock().unwrap();
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
        let mut map = sessions.lock().unwrap();
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

## 常见错误

### 1. 跨 thread::spawn 或 await 持有 Mutex 锁

```rust
// 错误 —— 派生线程时持有锁
let mut pm = state.project_manager.lock().unwrap();
std::thread::spawn(move || { /* pm 被捕获 */ });

// 正确 —— 提取数据，释放锁，然后派生
let data = {
    let pm = state.project_manager.lock().unwrap();
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
