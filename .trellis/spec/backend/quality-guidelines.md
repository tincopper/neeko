# 质量指南

> Rust 后端开发的代码质量标准。

---

## 概述

后端的质量门禁是 **`cargo check`**（在 CI 中三平台运行）与 **`cargo clippy`** + **`cargo fmt --check`**（通过 `pnpm lint` 在本地执行）。

质量门禁配置：
- Clippy lint 级别在 `src-tauri/Cargo.toml` 的 `[lints.clippy]` 和 `[lints.rust]` 段定义
- Strict deny lints 在 `src-tauri/src/lib.rs` 的 `#![deny(...)]` 属性中声明
- Rust 代码格式通过 `src-tauri/.rustfmt.toml` 控制（如存在）或使用默认配置

平台特定代码使用条件编译。

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

**Phase B 合规状态**：以下 4 个域已将 `pub mod services` 改为 `mod services`，满足"所有模块为私有"规则：

| 域 | `mod.rs` 可见性 | 外部访问方式 |
|----|----------------|-------------|
| `agent/` | `mod services` | `pub use manager::AgentManager` 间接暴露 |
| `connection/` | `mod services` | `pub use commands::*; pub use types::*` 间接暴露 |
| `terminal/` | `mod services` | `pub mod commands; pub mod remote` 间接暴露 |
| `task/` | `mod services` | `pub use services::*` 显式 re-export |

如果 services 函数需要对外可见，使用 `pub use services::*` 显式 re-export（如 `task/mod.rs`），而非直接公开子模块。

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

例外：

**A. 内部锁 (`Mutex`) 上的 `.unwrap()` 已逐步迁移**

Phase 4 已将大部分 production `.lock().unwrap()` 替换为以下两种模式：

```rust
// 模式一：锁中毒视为不可恢复（推荐用于内部锁，逻辑不可达）
let sessions = self.sessions.lock().expect("infallible: sessions lock");

// 模式二：优雅处理（用于命令边界，返回 AppError）
let sessions = state
    .project_manager
    .lock()
    .map_err(|e| anyhow::anyhow!("Lock poisoned: {}", e))?;
```

**B. 测试代码中的 `.unwrap()` 可接受**

测试中 `.unwrap()` 保持原样，不做替换。

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

// task/mod.rs —— 正确
pub mod commands;
pub mod services;

pub use services::*;  // 可选：方便 commands.rs 直接调用 services 函数
```

业务逻辑下沉到子模块（`services.rs`、`types.rs`、`manager.rs` 等）。
新代码统一使用 **`services.rs`**（复数），`service.rs`（单数）是遗留命名方式，仅 `theme/` 域保留。

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

### 7. 文件监听器必须忽略构建产物目录

`common/file/watcher.rs` 的 `should_ignore_path` 是项目级约定，新增多端通用产物目录时必须同步扩展。已在 ignore 列表：`.git`、`node_modules`、`target`、`.DS_Store`（原有）；`dist`、`build`、`.next`、`out`、`coverage`（2026-08-07 因 build 风暴新增）。

**为什么**：`pnpm tauri build` / `pnpm run build` 期间这些目录在秒级产生数千个 Create/Modify 事件，notify watcher 全量转发会**放大**（不导致）`git-changed` 监听侧的竞态——陈旧 store 覆盖的概率与事件风暴成正比。ignore 是减载，不是治本；治本在调用方的 generation 守卫（见 `frontend/state-management.md` 场景 2026-08-07）。

**新增约定**：每加一个项目根或 monorepo 包的构建产物目录名，先查 `should_ignore_path`，再加；不要让 watcher 转发构建产物事件。

---

## 构建与 CI

### 本地开发

```bash
cargo check            # 快速类型检查
cargo clippy           # Clippy lint 检查
cargo fmt --check      # 格式检查
cargo build            # Debug 构建
pnpm tauri dev         # 完整开发环境（前端 + 后端）
```

### 质量门禁脚本

```bash
pnpm lint              # 运行所有质量检查（cargo fmt + clippy + eslint + tsc）
```

### `[lints.clippy]` 配置说明

`Cargo.toml` 中的 lint 分三级：

| 级别 | 含义 | 示例 |
|------|------|------|
| `"deny"` | 编译错误，必须修复 | `cast_possible_truncation = "deny"` |
| `"warn"` | 警告，建议修复 | `missing_docs = "warn"` |
| 未设置 | 使用 clippy 默认 | - |

部分 deny 级别的 lint（如 `cast_possible_truncation`、`wildcard_imports`）在现有代码中存在大量违反，当前使用 `#[allow(...)]` 逐处豁免。新代码应避免引入新违规。

#### `unwrap_used` 治理状态

`clippy::unwrap_used` 已纳入 `src-tauri/src/lib.rs` 的 `#![deny(...)]` 属性，在 crate 级强制执行。`Cargo.toml` 保留 `unwrap_used = "warn"` 作为默认级别，`lib.rs` 的 `deny` 属性覆盖之。

| 来源 | 级别 | 说明 |
|------|------|------|
| `Cargo.toml` 默认 | `warn` | 作为 fallback 级别 |
| `lib.rs #![deny(...)]` | `deny` | 覆盖 Cargo.toml，在 crate 范围内强制执行 |
| 状态 | ✅ drift 已解决 | 新代码不得引入新的 `.unwrap()`；使用 `.expect("infallible: ...")` 或 `?` 传播 |

注意：`missing_docs` 是 rustc lint，必须放在 `[lints.rust]` 而非 `[lints.clippy]` 段。

### `#![deny(...)]` 属性

在 `src-tauri/src/lib.rs` 顶部声明的 deny 属性覆盖 Cargo.toml 的 warn 级别，强制执行关键 lints：

```rust
#![deny(
    clippy::dbg_macro,
    clippy::todo,
    clippy::print_stdout,
    clippy::wildcard_imports,
    clippy::unwrap_used,
    unused_must_use
)]
```

未能纳入 deny 的 lints（当前保留为 `warn`）：
- `missing_docs`：代码库中大量公开项缺少文档，需要一次专门的文档冲刺才能升为 deny。
- `rust_2018_idioms`：`elided_lifetimes_in_paths` 子 lint 在当前代码库中触发约 46 次，需要单独清理。

### 惯用法：宏内的 `#[allow]` 必须放在函数级别

```rust
// 错误 —— #[allow] 在 params! 宏内不生效
tx.execute(query,
    #[allow(clippy::cast_possible_truncation)]
    params![i as i32, id],
)?;

// 正确 —— 放在函数上
#[allow(clippy::cast_possible_truncation)]
pub fn reorder(&self, ids: &[String]) -> Result<()> {
    tx.execute(query, params![i as i32, id])?;
}
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

---

## 架构原则（后端）

### 模块设计

1. **单一职责**：一个 Manager 只负责一个领域（Project / Agent / Terminal）。超过 500 行的 Manager 考虑拆分。
2. **模块私有**：所有子模块默认 `mod name;`（私有），通过 `pub use` 选择性暴露接口。
3. **接口隔离**：外部只看到需要的方法，内部实现细节完全隐藏。
4. **策略模式**：策略集已知且固定（≤5种），使用 `Enum + match` 代替 `Box<dyn Trait>`。

### 错误处理

1. **统一错误类型**：所有命令返回 `Result<T, AppError>`，禁止 `unwrap()` 和 `expect()`（测试除外）。
2. **错误链**：使用 `anyhow::Context` 添加上下文信息，便于排查。
3. **错误转换**：`.map_err(AppError::from)` 统一转换。

### 依赖方向

1. **单向依赖**：`commands.rs` → `services.rs` → `manager.rs` → `state.rs`，禁止反向依赖。
2. **跨域访问**：通过 `pub use` re-export 暴露的类型，禁止直接引用其他域的内部模块。
3. **共享基础设施**：`common/` 提供错误、日志、运行时工具，所有域依赖 `common/`。

---

## TDD 要求（后端）

### 开发流程

1. **定义接口**：先写 `pub` 方法签名和返回类型。
2. **编写测试**：覆盖正常路径 + 边界情况 + 错误处理。
3. **确认失败**：`cargo test` 确认红色。
4. **实现功能**：写最少代码让测试通过。
5. **重构优化**：消除重复，保持测试绿色。

### 测试规范

- 测试模块：`#[cfg(test)] mod tests { ... }`，与源文件同目录
- 纯函数：直接调用 + 断言
- Manager 逻辑：使用 `tempfile` 创建真实临时目录
- 每个测试只验证一个行为
- 测试命名：`test_<行为>_<条件>_<预期结果>`

### 覆盖率要求

| 类型 | 最低要求 |
|------|---------|
| 纯函数（parse / format / validate） | 100% |
| Manager 核心逻辑 | 核心路径 100% |
| 错误处理 | 所有错误分支 |
| 序列化（serde） | 往返测试 |
