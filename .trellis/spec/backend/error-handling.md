# 错误处理

> Rust 后端中的错误处理模式。

---

## 概述

项目使用 **`anyhow`** 进行内部错误处理，在 Tauri 命令边界将所有错误转换为统一的 **`AppError`**。

`AppError` 是一个使用 `thiserror` 定义的枚举，实现了 `serde::Serialize`，可被 Tauri 自动序列化传递到前端。

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

### 命令边界：`Result<T, AppError>`

```rust
#[tauri::command]
fn get_git_info_command(path: String, state: State<AppStateWrapper>) -> Result<GitInfo, AppError> {
    get_git_info(&path).map_err(AppError::from)
}
```

这是**统一模式** —— 所有可能失败的命令都返回 `Result<T, AppError>`，不再使用 `Result<T, String>`。

---

## AppError 类型

```rust
#[derive(Error, Debug, Serialize, Clone)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(String),
    #[error("Git error: {0}")]
    Git(String),
    #[error("Storage error: {0}")]
    Storage(String),
    #[error("Skill error: {0}")]
    Skill(String),
    #[error("Project error: {0}")]
    Project(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Invalid input: {0}")]
    InvalidInput(String),
    #[error("Remote error: {0}")]
    Remote(String),
    #[error("WSL error: {0}")]
    Wsl(String),
    #[error("Terminal error: {0}")]
    Terminal(String),
    #[error("Agent error: {0}")]
    Agent(String),
    #[error("IDE error: {0}")]
    Ide(String),
    #[error("File error: {0}")]
    File(String),
    #[error("Lock poisoned: {0}")]
    LockPoisoned(String),
    #[error("Unknown error: {0}")]
    Unknown(String),
}
```

`AppError` 为常见错误类型提供了 `From` 实现：

```rust
impl From<std::io::Error> for AppError { ... }
impl From<anyhow::Error> for AppError { ... }
impl From<serde_json::Error> for AppError { ... }
impl From<rusqlite::Error> for AppError { ... }
impl From<tauri::Error> for AppError { ... }
impl From<String> for AppError { ... }
impl From<&str> for AppError { ... }
// 以及 Mutex PoisonError 的专用实现
```

---

## 错误创建模式

### `bail!` 用于提前返回（内部代码）

```rust
if projects.iter().any(|p| p.path == path) {
    bail!("Project already exists at this path");
}
```

### `.context()` 为错误添加上下文（内部代码）

```rust
let repo = Repository::open(path)
    .context("Failed to open repository")?;
```

### `.map_err(AppError::from)` 用于命令边界

```rust
state.terminal_manager
    .create_session(...)
    .map_err(AppError::from)?;
```

### 显式 `AppError` 变体用于业务错误

```rust
.ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?
```

### `.expect("infallible: ...")` 用于逻辑不可达的锁中毒

Mutex 锁上使用，表示锁中毒在逻辑上不可达（如自含的 LRU 缓存、全局静态）：

```rust
let mut cache = self.cache.lock().expect("infallible: LRU cache lock");
```

---

## Mutex 锁处理

Mutex 锁有三种处理模式（Phase 4 已统一）：

### 模式一：`.expect("infallible: ...")` —— 内部自含锁

用于自含结构体内部的锁（如 LRU 缓存、线程安全集合），锁中毒在逻辑上不可达：

```rust
let mut cache = self.cache.lock().expect("infallible: LRU cache lock");
let mut handles = self.pty_handles.lock().expect("infallible: pty handles");
```

### 模式二：`.map_err(...)?` —— 外部状态锁（命令边界）

用于 `AppStateWrapper` 中由外部注入的 Manager 锁：

```rust
let mut pm = state
    .project_manager
    .lock()
    .map_err(|e| AppError::LockPoisoned(e.to_string()))?;
```

### 模式三（旧）：`.unwrap()` —— 仅 `anyhow::Result` 函数

遗留模式，仅存在于 `anyhow::Result` 且无法轻易迁移的内部函数中：

```rust
let conn = self.conn.lock().unwrap();
```

**原则**：
- 如果锁是结构体内部的纯数据保护 → `.expect("infallible: ...")`
- 如果锁来自外部注入的 `State` → `.map_err(...)?`（返回 AppError）
- 测试代码中的 `.unwrap()` 保持原样

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

前端可见的错误通过 `Result::Err(AppError)` 返回，不会被吞掉。

---

## 平台特定的错误存根

Windows 专用命令需要非 Windows 的存根：

```rust
#[cfg(target_os = "windows")]
#[tauri::command]
fn create_wsl_terminal_session(...) -> Result<TerminalSession, AppError> {
    // 实际的 WSL 实现
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn create_wsl_terminal_session(...) -> Result<TerminalSession, AppError> {
    Err(AppError::Wsl("WSL is only supported on Windows".to_string()))
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

### 3. 从命令返回 `anyhow::Error`

```rust
// 错误 —— 无法编译，Tauri 需要可序列化错误
#[tauri::command]
fn my_command() -> Result<(), anyhow::Error> { ... }

// 正确
#[tauri::command]
fn my_command() -> Result<(), AppError> {
    do_something().map_err(AppError::from)
}
```

### 4. 使用 `Result<T, String>` 而非 `Result<T, AppError>`

```rust
// 错误 —— 丢失错误分类
#[tauri::command]
fn my_command() -> Result<T, String> { ... }

// 正确 —— 使用统一错误类型
#[tauri::command]
fn my_command() -> Result<T, AppError> { ... }
```
