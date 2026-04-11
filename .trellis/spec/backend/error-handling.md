# 错误处理

> Rust 后端中的错误处理模式。

---

## 概述

项目使用 **`anyhow`** 进行内部错误处理，在 Tauri 命令边界将所有错误转换为 `String`。没有自定义错误类型，也没有使用 `thiserror`。

---

## 错误策略

### 内部代码：`anyhow::Result<T>`

```rust
use anyhow::{Result, bail, Context};

pub fn get_git_info(path: &str) -> Result<GitInfo> {
    let repo = Repository::open(path)
        .context("Failed to open repository")?;

    if some_condition {
        bail!("Branch not found: {}", name);
    }

    Ok(info)
}
```

### 命令边界：`Result<T, String>`

```rust
#[tauri::command]
fn get_git_info_command(path: String, state: State<AppStateWrapper>) -> Result<GitInfo, String> {
    get_git_info(&path).map_err(|e| e.to_string())
}
```

这是**统一模式** —— 所有可能失败的命令都返回 `Result<T, String>`。

---

## 错误创建模式

### `bail!` 用于提前返回

```rust
if projects.iter().any(|p| p.path == path) {
    bail!("Project already exists at this path");
}
```

### `.context()` 为错误添加上下文

```rust
let repo = Repository::open(path)
    .context("Failed to open repository")?;
```

### `.with_context()` 用于动态上下文

```rust
fs::read_to_string(&path)
    .with_context(|| format!("Failed to read file: {}", path))?;
```

### `.map_err(|e| e.to_string())` 用于命令边界

```rust
state.terminal_manager
    .create_session(...)
    .map_err(|e| e.to_string())?;
```

---

## Mutex 锁处理

Mutex 锁使用 `.unwrap()` —— 锁中毒视为致命错误（panic）：

```rust
let mut pm = state.project_manager.lock().unwrap();
```

这是有意为之的。如果一个线程在持有锁时 panic，应用状态被视为已损坏，崩溃是正确的行为。

---

## 日志模式

错误日志使用带模块前缀的自定义日志器：

```rust
// 内部日志宏
log_info!("Session created: {}", id);
log_error!("Failed to save session: {}", e);

// 在命令中，使用控制台风格的日志
console_error!("[App] Failed to save config: {}", e);
```

前端可见的错误通过 `Result::Err(String)` 返回，不会被吞掉。

---

## 平台特定的错误存根

Windows 专用命令需要非 Windows 的存根：

```rust
#[cfg(target_os = "windows")]
#[tauri::command]
fn create_wsl_terminal_session(...) -> Result<TerminalSession, String> {
    // 实际的 WSL 实现
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn create_wsl_terminal_session(...) -> Result<TerminalSession, String> {
    Err("WSL is only supported on Windows".into())
}
```

---

## 常见错误

### 1. 静默吞掉错误

```rust
// 错误 —— 错误丢失
let _ = invoke("save_config", &config);

// 正确 —— 至少记录日志
if let Err(e) = save_config(&config) {
    log_error!("Failed to save config: {}", e);
}
```

### 2. 在可能失败的 I/O 上使用 `.unwrap()`

```rust
// 错误 —— 失败时 panic
let content = fs::read_to_string(path).unwrap();

// 正确 —— 带上下文传播错误
let content = fs::read_to_string(path)
    .context("Failed to read file")?;
```

例外：Mutex 锁上的 `.unwrap()` 是可接受的（见上文）。

### 3. 从命令返回 anyhow::Error

```rust
// 错误 —— 无法编译，Tauri 需要 String
#[tauri::command]
fn my_command() -> Result<(), anyhow::Error> { ... }

// 正确
#[tauri::command]
fn my_command() -> Result<(), String> {
    do_something().map_err(|e| e.to_string())
}
```
