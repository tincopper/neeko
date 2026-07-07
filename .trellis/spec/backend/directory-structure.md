# 目录结构

> 后端代码在本项目中的组织方式。

---

## 概述

Rust 后端位于 `src-tauri/` 目录中，采用**按职责分层**的模块布局。模块按领域拆分，命令、模型、Manager、工具函数各有其位。

---

## 目录布局

```
src-tauri/
├── Cargo.toml                # 依赖与构建配置
├── Cargo.lock
├── build.rs                  # 极简：仅调用 tauri_build::build()
├── tauri.conf.json           # 主 Tauri 配置
├── tauri.macos.conf.json     # macOS 特定的 bundle 配置
├── tauri.linux.conf.json     # Linux 特定的 bundle 配置
├── tauri.windows.conf.json   # Windows 特定的 bundle 配置
├── capabilities/
│   └── default.json          # Tauri v2 权限配置
├── icons/                    # 应用图标
├── gen/                      # Tauri 生成的代码
├── tests/                    # 集成测试与单元测试
│   └── unit/
└── src/
    ├── main.rs               # 二进制入口（极简，调用 lib::run）
    ├── lib.rs                # 模块导出入口（仅声明和 re-export）
    ├── app.rs                # 应用启动逻辑：Tauri Builder、setup、事件监听、命令注册
    ├── app_state.rs          # AppStateWrapper —— 运行时状态组装
    ├── core/                 # 核心基础设施
    │   ├── mod.rs
    │   ├── error.rs          # AppError —— 统一可序列化错误类型
    │   ├── logger.rs         # 自定义文件日志
    │   └── db.rs             # SQLite 连接管理（open/open_in_memory，WAL + foreign keys）
    ├── agent/                # Agent 子系统（自包含）
    │   ├── mod.rs
    │   ├── commands.rs
    │   ├── commands_commit.rs
    │   ├── manager.rs        # AgentManager —— AI Agent 预设/自定义管理
    │   ├── model.rs
    │   ├── types.rs
    │   └── services/         # 子模块目录（commit 服务）
    │       ├── mod.rs
    │       └── commit.rs
    ├── browser/              # 内嵌浏览器面板
    │   ├── mod.rs
    │   ├── commands.rs
    │   └── uri_scheme.rs     # neeko:// custom URI scheme
    ├── connection/           # 连接管理层（WSL + Remote 共享）
    │   ├── mod.rs
    │   ├── commands.rs       # Tauri 命令（委派到 services 或 Manager）
    │   ├── services.rs       # WSL 函数提取：get_wsl_distros, get_wsl_directories, get_wsl_home_dir
    │   ├── model.rs
    │   └── types.rs          # AuthMethod 等共享类型
    ├── file/                 # 文件系统操作
    │   ├── mod.rs
    │   ├── commands.rs       # reveal_in_file_manager
    │   ├── services.rs       # 文件树递归读取、文件读写、二进制检测
    │   └── watcher.rs        # WatcherManager —— 文件系统监听
    ├── git/                  # Git 领域逻辑（git2-rs + CLI 回退）
    │   ├── mod.rs
    │   ├── commands.rs       # 所有 Git Tauri 命令（~40 个）
    │   ├── local.rs          # 本地 Git 操作
    │   ├── wsl.rs            # WSL Git 操作
    │   ├── remote.rs         # SSH Git 操作
    │   ├── operations.rs     # 高层 Git 操作（commit/stage/revert 等）
    │   ├── pr.rs             # PR 操作（GitHub CLI）
    │   ├── parsers.rs        # Git 输出解析
    │   ├── worker.rs         # 后台 Git worker
    │   ├── cache.rs
    │   ├── transport.rs
    │   ├── types.rs
    │   └── model.rs
    ├── project/              # 项目管理
    │   ├── mod.rs
    │   ├── commands.rs       # 项目 CRUD 命令
    │   ├── commands_ide.rs   # IDE 启动命令
    │   ├── model.rs          # 项目核心类型
    │   └── types.rs          # 共享类型（Project, GitInfo, FileNode 等）
    ├── session/              # 会话持久化
    │   ├── mod.rs
    │   ├── commands.rs       # save/load 命令
    │   ├── manager.rs        # StorageManager —— JSON 文件持久化
    │   ├── model.rs
    │   └── types.rs          # SessionStore, ProjectSession 等
    ├── lsp/                  # LSP 代码智能（Phase 1 新增）
    │   ├── mod.rs            # LspManager pub 导出
    │   ├── commands.rs       # 6 个 Tauri 命令：request/notification/open/change/close document + session list
    │   ├── manager.rs        # LspManager + LspSession: 语言发现, server spawn, JSON-RPC proxy, diagnostics push
    │   └── types.rs          # 可序列化 LSP 类型（Diagnostic/Position/Range/Hover/Completion 等）
    ├── settings/             # 应用设置
    │   ├── mod.rs
    │   └── commands.rs       # get_system_fonts
    ├── skill/                # Skill 系统（自包含子系统）
    │   ├── mod.rs
    │   ├── commands.rs       # 所有 Skill 命令（~25 个）
    │   ├── content_hash.rs
    │   ├── installer.rs
    │   ├── skill_store.rs
    │   ├── types.rs
    │   └── ...
    ├── task/                 # 任务系统
    │   ├── mod.rs
    │   ├── commands.rs       # Tauri 命令（委派到 services）
    │   └── services.rs       # 任务 I/O：TaskConfig 模型 + JSON 读写
    ├── terminal/             # 终端管理
    │   ├── mod.rs            # TerminalManager + PtyHandle + PipelineConfig
    │   ├── commands.rs       # 本地/WSL/SSH 终端命令
    │   ├── services.rs       # PTY 管线提取：spawn_pty_pipeline, create_pty, 线程管理
    │   ├── remote.rs         # RemoteTerminalManager —— SSH 终端
    │   ├── model.rs
    │   └── types.rs          # TerminalSession, TerminalStatus 等
    ├── theme/                # 主题安装与同步（OpenCode + Pi）
    │   ├── mod.rs
    │   ├── commands.rs       # sync_agent_theme
    │   ├── common.rs         # 共享工具：map_theme_name, base64_encode, shell_escape
    │   ├── opencode.rs       # OpenCode 主题安装与配置（三端）
    │   ├── pi.rs             # Pi 主题安装与配置（三端）
    │   └── service.rs        # 编排层：ThemeContext + ThemeStrategy（singular 命名）
    └── utils/                # 工具函数
        ├── mod.rs
        ├── command/          # 命令执行工具
        │   ├── local.rs
        │   ├── ssh.rs        # SSH 命令执行（一次性连接）
        │   ├── ssh_auth.rs   # SSH 认证统一：authenticate(), connect_and_authenticate()
        │   └── wsl.rs
        └── fonts.rs
```

---

## 模块组织

### `lib.rs` 的职责

`lib.rs` **仅保留模块导出入口**的单一职责，不存放业务逻辑：

```rust
pub mod agent;
mod app;
mod app_state;
pub mod browser;
pub mod connection;
pub mod core;
pub mod file;
pub mod git;
pub mod lsp;
pub mod project;
pub mod session;
pub mod settings;
pub mod skill;
pub mod task;
pub mod terminal;
pub mod theme;
pub mod utils;

pub use app::run;
pub use app_state::AppStateWrapper;
pub use core::error::AppError;
```

### `app.rs` 的职责

`app.rs` 承担应用启动的中枢职责：

- `run()` 函数
- Tauri Builder 配置
- `.setup()` 闭包（会话恢复、配置加载、Watcher 启动）
- `.on_window_event()`（窗口销毁时的清理）
- `invoke_handler`（命令注册表）

### `app_state.rs` 的职责

`app_state.rs` 定义 `AppStateWrapper`，集中组装所有 Manager：

```rust
pub struct AppStateWrapper {
    pub project_manager: Mutex<project::ProjectManager>,
    pub terminal_manager: terminal::TerminalManager,
    pub remote_terminal_manager: terminal::remote::RemoteTerminalManager,
    pub agent_manager: Mutex<agent::AgentManager>,
    pub storage_manager: session::StorageManager,
    pub active_project_id: Mutex<Option<String>>,
    pub watcher_manager: file::WatcherManager,
    pub skill_store: Arc<skill::skill_store::SkillStore>,
    pub lsp_manager: lsp::LspManager,           // Phase 1: LSP server lifecycle management
}
```

### 领域模型和类型

数据模型现在按领域拆分到各模块的 `types.rs` 或 `model.rs` 中，不再有集中的 `models/` 目录或 `state.rs`。序列化契约（`serde::Serialize + Deserialize`）定义在各自的领域模块里：

| 领域模块 | 模型文件 | 关键类型 |
|----------|----------|----------|
| `project/` | `types.rs` | `Project`、`GitInfo`、`Worktree`、`FileChange`、`FileStatus`、`ViewMode`、`FileNode`、`FileContent` |
| `session/` | `types.rs` | `SessionStore`、`ProjectSession`、`WSLEntrySession`、`RemoteEntrySession` |
| `terminal/` | `types.rs` | `TerminalSession`、`TerminalStatus` |
| `connection/` | `types.rs` | `AuthMethod` |
| `agent/` | `types.rs` + `model.rs` | `AgentConfig` |
| `git/` | `types.rs` + `model.rs` | Git 内部类型 |
| `task/` | `services.rs` | `TaskConfig`（定义在 services.rs 中） |

### 命令的职责和分布

所有 `#[tauri::command]` 函数按领域拆分到各领域的 `commands.rs` 中。所有命令通过 `lib.rs` 中的 `neeko_invoke_handler!` 宏集中注册（不再使用 `app.rs` 内的 `generate_handler!`）：

| 领域模块 | 命令文件 | 职责 |
|----------|----------|------|
| `project/` | `commands.rs` | 本地项目 CRUD（add/remove/list/get 等）。另有 `commands_ide.rs` 处理 IDE 启动 |
| `project/commands_ide.rs` | `commands_ide.rs` | IDE 启动（本地/WSL/SSH） |
| `git/` | `commands.rs` | 所有 Git 操作：stage/unstage、commit、push/pull/fetch、branch、worktree、PR、commit message 生成等（~40 个命令） |
| `terminal/` | `commands.rs` | 本地终端/WSL/SSH 会话的 create/close/resize |
| `connection/` | `commands.rs` | WSL 枚举 + SSH 连接测试和目录列表；WSL 部分委派到 `services.rs`，SSH 部分委派到 `RemoteTerminalManager` |
| `agent/` | `commands.rs` + `commands_commit.rs` | Agent CRUD、commit message 生成 |
| `browser/` | `commands.rs` | 内嵌浏览器面板创建、导航、元素选择器 |
| `session/` | `commands.rs` | 会话 save/load、配置 save/load、VCS 设置 |
| `task/` | `commands.rs` | Task CRUD + run/stop（委派到 `services.rs` 和 `TerminalManager`） |
| `file/` | `commands.rs` | `reveal_in_file_manager` |
| `settings/` | `commands.rs` | `get_system_fonts` |
| `theme/` | `commands.rs` | `sync_agent_theme` |
| `skill/` | `commands.rs` | 所有 Skill 操作（~25 个命令） |
| `lsp/` | `commands.rs` | 6 个 LSP 命令：request/notification/open/change/close document + session list |

### 新代码应该放在哪里

| 新代码类型 | 位置 |
|-----------|------|
| 新 Tauri 命令 | `<domain>/commands.rs` 中实现并导出，将命令路径加入 `lib.rs` 的 `neeko_invoke_handler!` |
| 无 State 依赖的纯业务逻辑 | `<domain>/services.rs`（patterns 见下方 §services.rs） |
| 新 Manager | 新建 `<domain>/manager.rs`，在 `lib.rs` 中用 `pub mod` 声明，添加到 `AppStateWrapper` |
| Git 操作（纯逻辑） | `git/local.rs`、`git/wsl.rs` 或 `git/remote.rs` |
| SSH 认证 | `utils/command/ssh_auth.rs`（统一 `authenticate()` 和 `connect_and_authenticate()`） |
| LSP 操作 | `lsp/manager.rs`（LspManager + LspSession）、`lsp/commands.rs`（Tauri 命令） |
| 主题操作 | `theme/opencode.rs` 或 `theme/pi.rs`（共享工具在 `theme/common.rs`） |
| 工具函数 | `utils/<name>.rs` |
| 错误类型扩展 | `core/error.rs` |
| 数据模型/类型 | 按领域放在 `<domain>/types.rs` 或 `<domain>/model.rs` |

---

## services.rs 模式

Phase 2 引入了 `<domain>/services.rs` 的轻量提取模式，用于存放**不影响 State 依赖的纯业务逻辑**。

### 适用条件

一个函数如果满足以下所有条件，适合放入 `services.rs`：

1. **不需要访问 `AppStateWrapper`**（即无需 Tauri State/Manager）
2. **不调用 Tauri IPC**（无需 `AppHandle`、`Emitter`、`Listener`）
3. **纯 I/O + 数据转换**：读取文件、执行外部进程、解析输出
4. **可以被多个 `commands.rs` 函数复用**

### 三种提取场景

| 场景 | 例子 | 提取内容 |
|------|------|----------|
| 从 `commands.rs` 提取 | `connection/services.rs` | `get_wsl_distros()`、`get_wsl_directories()`、`get_wsl_home_dir()` —— 原在 `commands/wsl.rs` 中，无 State 依赖 |
| 从 `mod.rs` (Manager) 提取 | `terminal/services.rs` | `spawn_pty_pipeline()`、`create_pty()`、`graceful_kill()` —— PTY 管线逻辑，不涉及 Manager 内部状态 |
| 新建领域时直接设立 | `task/services.rs` | `TaskConfig` 模型 + JSON 读写函数 —— 新域天然无 State 依赖 |

### 命名

- 统一使用 **`services.rs`**（复数）—— `theme/service.rs`（单数）是 Phase 1 的遗留命名，新代码都应使用 `services.rs`
- `agent/services/` 是目录模块（`mod.rs` + `commit.rs`）—— 这是 `services` 作为目录的例外，仅 agent 域使用

### 委派模式

`commands.rs` → `services.rs` 的委派保持极薄包装层：

```rust
// connection/commands.rs
#[tauri::command]
pub fn get_wsl_distros() -> Result<Vec<String>, AppError> {
    services::get_wsl_distros()
}
```

```rust
// task/commands.rs —— services 函数通过 re-export 直接调用
#[tauri::command]
pub fn get_task_configs(...) -> Result<Vec<TaskConfig>, AppError> {
    let configs = crate::task::get_all_task_configs(project_path.as_deref());
    Ok(configs)
}
```

### 已使用 services.rs 的领域

| 领域 | 文件 | 内容 | 阶段 |
|------|------|------|------|
| `task/services.rs` | 新建 | `TaskConfig` 模型 + JSON I/O | Phase 2 |
| `connection/services.rs` | 新建 | WSL 枚举函数（从旧 `commands/wsl.rs` 提取） | Phase 2 |
| `terminal/services.rs` | 新建 | PTY 管线（~553 行，从 `terminal/mod.rs` 提取） | Phase 2 |
| `file/services.rs` | 已有 | 文件树递归读取、文件读写、二进制检测 | Phase 1 |
| `theme/service.rs` | 已有 | 主题编排层（singular 命名，Phase 1 遗留） | Phase 1 |
| `agent/services/` | 已有 | 目录模块（commit 服务，与 flat `services.rs` 不同） | Phase 1 |

### 什么情况下 *不* 用 services.rs

- **需要 Manager 内部状态** → 放在 `Manager` 的方法中（如 `TerminalManager::create_session`）
- **需要访问 `AppStateWrapper`** → 放在 `commands.rs` 中通过 `State` 参数访问
- **需要 Tauri IPC**（emit/listen）→ 要么放在 `commands.rs`，要么将 `AppHandle` 作为参数传入

---

## 命名约定

| 项目 | 约定 | 示例 |
|------|------|------|
| 模块文件 | snake_case | `terminal.rs`、`remote.rs` |
| 结构体/枚举 | PascalCase | `AppStateWrapper`、`TerminalManager`、`GitInfo` |
| 函数/方法 | snake_case | `create_session`、`get_git_info` |
| 常量 | SCREAMING_SNAKE_CASE | `GRACEFUL_TIMEOUT_SECS`、`CREATE_NO_WINDOW` |
| Tauri 命令名 | snake_case（与函数名一致） | `add_project`、`create_terminal_session` |
| Tauri 事件名 | kebab-case 带会话 ID 后缀 | `terminal-output-{id}`、`git-changed` |
| 线程名 | kebab-case 带缩写 ID | `pty-reader-{id[..8]}` |

---

## 示例

- **Manager 模式**：`src-tauri/src/terminal/mod.rs` —— `TerminalManager` 使用 `Arc<Mutex<HashMap>>` 管理会话，方法在 `impl TerminalManager` 中
- **services.rs 提取**：`src-tauri/src/terminal/services.rs` —— `spawn_pty_pipeline()`、`graceful_kill()`、`create_pty()` 等纯 PTY 逻辑从 `mod.rs` 提取到独立文件
- **命令委派 services**：`src-tauri/src/connection/commands.rs` —— `get_wsl_distros` 命令直接委派给 `connection/services.rs`，无需访问 State
- **类型定义**：`src-tauri/src/project/types.rs` —— 共享数据模型按领域拆分到 `types.rs` 或 `model.rs`
- **命令分布**：`src-tauri/src/git/commands.rs` —— 约 40 个 Git 命令集中在一个 `commands.rs` 中
- **中枢模式**：`src-tauri/src/app.rs` —— Tauri Builder + 命令注册表 + setup 闭包
- **状态组装**：`src-tauri/src/app_state.rs` —— `AppStateWrapper` 定义，组装所有 Manager
- **命令注册**：`src-tauri/src/lib.rs` —— `neeko_invoke_handler!` 宏维护完整命令清单
- **SSH 认证统一**：`src-tauri/src/utils/command/ssh_auth.rs` —— `connect_and_authenticate()` 函数
- **主题模块化**：`src-tauri/src/theme/` —— `common.rs` 共享工具 + `opencode.rs`/`pi.rs` 域逻辑 + `service.rs` 编排层
- **领域自治**：`src-tauri/src/git/` —— 自包含 Git 模块：`commands.rs` 调用 `local.rs`/`remote.rs`/`wsl.rs`/`operations.rs`/`pr.rs`
