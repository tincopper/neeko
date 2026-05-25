# 质量指南

> Rust 后端开发的代码质量标准。

---

## 概述

后端的质量门禁是 **`cargo check`**（在 CI 中三平台运行）。没有配置 clippy、rustfmt，也没有使用测试框架。平台特定代码使用条件编译。

---

## 代码风格

### 注释风格 —— 中文为主

分段标题使用中文：

```rust
// 项目管理命令
// 终端命令 - 使用 Tauri Events 实现双向通信
// Git 命令
// 持久化命令
```

分段分隔符使用 ASCII 框线：

```rust
// ─── WSL Git 命令 (Windows only) ──────────────────────────────────────────────
// ─── SSH Git 命令 ────────────────────────────────────────────────────────────
```

内联注释以中文为主：

```rust
// 为新项目启动文件监听
// 800ms 去抖，保存时往往触发多次写事件
```

错误消息和日志字符串使用英文：

```rust
"Project not found"
"WSL is only supported on Windows"
```

### 模块可见性

- **所有模块为私有**（`mod name;` 不带 `pub`）
- **模型结构体字段为 `pub`**（在 `state.rs` 中）
- **Manager 结构体字段为私有**
- **Manager 方法为 `pub`**（需要跨模块访问的）
- **辅助函数为私有**

### `#[allow(dead_code)]`

用于仅为 RAII drop 语义而存在的字段：

```rust
#[allow(dead_code)]
debouncer: RecommendedDebouncer,  // 保持存活以便 drop 时清理
```

---

## 平台特定代码

### 条件编译模式

```rust
#[cfg(target_os = "windows")]
#[tauri::command]
fn create_wsl_terminal_session(
    distro: String,
    path: String,
    // ...
) -> Result<TerminalSession, String> {
    // Windows 实现
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn create_wsl_terminal_session(
    distro: String,
    path: String,
    // ...
) -> Result<TerminalSession, String> {
    Err("WSL is only supported on Windows".into())
}
```

### 平台特定工具函数

```rust
// 在 Windows 上隐藏控制台窗口
#[cfg(target_os = "windows")]
fn no_window_cmd(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(target_os = "windows"))]
fn no_window_cmd(program: &str) -> Command {
    Command::new(program)
}
```

### Unix 特定的 PTY 配置

```rust
#[cfg(unix)]
{
    // 禁用回显以防止 IME 双重显示
    use libc::{tcgetattr, tcsetattr, ECHO, TCSANOW};
    // ...
}
```

---

## 禁止模式

### 1. 在 I/O 操作上使用 `.unwrap()`

```rust
// 错误
let content = fs::read_to_string(path).unwrap();

// 正确
let content = fs::read_to_string(path).context("Failed to read")?;
```

例外：`Mutex::lock()` 上的 `.unwrap()` 是可接受的。

### 2. 阻塞 tokio 运行时

```rust
// 错误 —— 异步上下文中的阻塞调用
async fn my_command() -> Result<(), String> {
    std::thread::sleep(Duration::from_secs(5));  // 阻塞运行时！
}

// 正确 —— 使用 OS 线程执行阻塞工作
std::thread::spawn(move || {
    std::thread::sleep(Duration::from_secs(5));
});
```

### 3. 公开模块

```rust
// 错误
pub mod terminal;

// 正确 —— 所有模块为私有
mod terminal;
```

### 4. Glob 导入（state 除外）

```rust
// 错误
use terminal::*;

// 正确 —— 显式导入
use terminal::TerminalManager;

// 例外 —— state 类型使用 glob 导入
use state::*;
```

---

## 必需模式

### 1. 线程必须命名

所有派生的线程必须有描述性名称：

```rust
std::thread::Builder::new()
    .name(format!("pty-reader-{}", &id[..8]))
    .spawn(move || { ... })
    .ok();
```

### 2. 子进程优雅关闭

```rust
// Unix：SIGTERM -> 等待 3 秒 -> SIGKILL
// Windows：等待 3 秒 -> TerminateProcess
fn graceful_kill(child: &mut Box<dyn Child + Send + Sync>) { ... }
```

### 3. 会话关闭时清理事件监听

销毁会话时注销 Tauri 事件监听器：

```rust
app_handle.unlisten(input_listener_id);
```

### 4. 新结构体字段添加 `#[serde(default)]`

始终为新字段添加，以确保与已有持久化数据的向后兼容。

### 5. `mod.rs` 仅保留模块声明

模块根文件 `mod.rs`（或 `name.rs`）不包含业务逻辑，只做模块声明：

```rust
// theme/mod.rs —— 正确
pub mod common;
pub mod opencode;
pub mod pi;
pub mod service;
```

业务逻辑下沉到子模块（`service.rs`、`types.rs` 等）。

### 6. 有限策略集使用 Enum 而非 Trait Object

当策略集已知且固定（≤ 5 种），使用 Enum + match 代替 `Box<dyn Trait>`：

```rust
// 正确：Enum 策略模式（零额外依赖，无虚函数调用）
pub enum ThemeStrategy {
    OpenCode,
    Pi,
}
impl ThemeStrategy {
    pub fn all() -> Vec<Self> { vec![Self::OpenCode, Self::Pi] }
    pub fn sync_local(&self, path: &str, theme: &str) -> Result<()> {
        match self {
            Self::OpenCode => opencode::write_project_tui_config(path, theme),
            Self::Pi => pi::write_project_pi_settings(path, theme),
        }
    }
}

// 优势：无需 #[async_trait]，编译期 dispatch，新增 variant 所有 match 必须处理
```

---

## 构建与 CI

### 本地开发

```bash
cargo check            # 快速类型检查
cargo build            # Debug 构建
pnpm tauri dev         # 完整开发环境（前端 + 后端）
```

### CI 流水线（`.github/workflows/ci.yml`）

在 push/PR 到 `main` 时运行：
- `cargo check`（Windows、macOS、Linux）

### 发布构建

```bash
pnpm tauri build       # 生产环境构建，包含打包
```

---

## 测试

使用 Rust 内置测试框架。详见[单元测试指南](../unit-test/index.md)。

- 单元测试放在同一文件中：`#[cfg(test)] mod tests { ... }`
- 使用 `tempfile` crate 进行文件系统/git 测试（真实临时目录，不是 mock）
- 直接测试 Manager，不测试 Tauri 命令包装层
- 集成测试放在 `src-tauri/tests/`
- 使用 `cargo test` 运行

---

## 依赖

关键依赖及其用途：

| Crate | 版本 | 用途 |
|-------|------|------|
| `tauri` | 2 | 应用框架 |
| `serde` + `serde_json` | 1.0 | 序列化 |
| `tokio` | 1（full） | 异步运行时（主要用于 SSH） |
| `anyhow` | 1.0 | 错误处理 |
| `git2` | 0.18 | Git 操作 |
| `portable-pty` | 0.8 | 跨平台 PTY |
| `russh` | 0.50.0-beta.7 | SSH 客户端 |
| `notify` | 6 | 文件系统监听 |
| `uuid` | 1.6 | ID 生成 |
| `chrono` | 0.4 | 时间戳 |
| `dirs` | 5.0 | 主目录解析 |
| `log` | 0.4 | 日志门面 |
