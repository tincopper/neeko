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
    ├── error.rs              # AppError —— 统一可序列化错误类型
    ├── models/               # 数据模型结构体和枚举（原 state/）
    │   ├── mod.rs
    │   ├── agent.rs
    │   ├── auth.rs
    │   ├── diff.rs
    │   ├── project.rs
    │   ├── session.rs
    │   └── terminal.rs
    ├── commands/             # Tauri IPC 命令（按域拆分）
    │   ├── mod.rs
    │   ├── agent.rs
    │   ├── config.rs
    │   ├── file.rs
    │   ├── git.rs
    │   ├── ide.rs
    │   ├── project.rs
    │   ├── remote.rs
    │   ├── remote_git.rs
    │   ├── terminal.rs
    │   ├── wsl.rs
| `browser.rs` | 内嵌浏览器面板、元素选择器 |
    │   └── wsl_git.rs
    ├── git/                  # Git 领域逻辑（git2-rs + CLI 回退）
    │   ├── local.rs
    │   ├── remote.rs
    │   └── wsl.rs
    ├── theme/                # 主题安装与同步（OpenCode + Pi）
    │   ├── mod.rs
    │   ├── common.rs         # 共享工具：map_theme_name, base64_encode, shell_escape, read_neeko_theme
    │   ├── opencode.rs       # OpenCode 主题：本地/WSL/SSH 安装与配置
    │   └── pi.rs             # Pi 主题：本地/WSL/SSH 安装与配置
    ├── skill/                # Skill 系统（自包含子系统）
    │   ├── commands.rs
    │   ├── content_hash.rs
    │   ├── installer.rs
    │   ├── skill_store.rs
    │   ├── types.rs
    │   └── ...
    ├── utils/                # 工具函数
    │   ├── command/          # 命令执行工具
    │   │   ├── local.rs
    │   │   ├── ssh.rs        # SSH 命令执行（一次性连接）
    │   │   ├── ssh_auth.rs   # SSH 认证统一：authenticate(), connect_and_authenticate()
    │   │   └── wsl.rs
    │   └── fonts.rs
    ├── project.rs            # ProjectManager —— 项目 CRUD
    ├── terminal.rs           # TerminalManager —— 本地 PTY 生命周期
    ├── remote.rs             # RemoteTerminalManager —— SSH 终端
    ├── agent.rs              # AgentManager —— AI Agent 预设/自定义管理
    ├── storage.rs            # StorageManager —— JSON 文件持久化
    ├── uri_scheme.rs          # neeko:// custom URI scheme protocol handler
    ├── watcher.rs            # WatcherManager —— 文件系统监听
    └── logger.rs             # 自定义文件日志
```

---

## 模块组织

### `lib.rs` 的职责

`lib.rs` **仅保留模块导出入口**的单一职责，不存放业务逻辑：

```rust
pub mod agent;
pub mod commands;
pub mod error;
pub mod git;
pub mod models;
pub mod opencode_theme;    // re-export wrapper → theme::opencode
pub mod pi_theme;          // re-export wrapper → theme::pi
pub mod project;
pub mod remote;
pub mod skill;
pub mod storage;
pub mod terminal;
pub mod theme;             // 主题模块：common + opencode + pi
pub mod utils;
pub mod uri_scheme;
pub mod watcher;

mod app;
mod app_state;
mod logger;

pub use app::run;
pub use app_state::AppStateWrapper;
pub use error::AppError;
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
    pub remote_terminal_manager: remote::RemoteTerminalManager,
    pub agent_manager: Mutex<agent::AgentManager>,
    pub storage_manager: storage::StorageManager,
    pub active_project_id: Mutex<Option<String>>,
    pub watcher_manager: watcher::WatcherManager,
    pub skill_store: Arc<skill::skill_store::SkillStore>,
}
```

### `models/` 的职责

`models/`（原 `state/`）存放**纯数据模型**——结构体、枚举、serde 序列化定义。这些是前后端共享的契约层：

| 文件 | 内容 |
|------|------|
| `agent.rs` | `AgentConfig` |
| `auth.rs` | `AuthMethod` |
| `diff.rs` | `DiffResult`、`DiffHunk`、`DiffLine` |
| `project.rs` | `Project`、`GitInfo`、`Worktree`、`FileChange`、`FileStatus`、`ViewMode`、`FileNode`、`FileContent` |
| `session.rs` | `SessionStore`、`ProjectSession`、`WSLEntrySession`、`RemoteEntrySession` |
| `terminal.rs` | `TerminalSession`、`TerminalStatus` |

### `commands/` 的职责

所有 `#[tauri::command]` 函数按领域拆分到 `commands/` 下的独立模块：

| 模块 | 领域 |
|------|------|
| `project.rs` | 本地项目 CRUD |
| `git.rs` | 本地 Git 操作 |
| `terminal.rs` | 本地终端会话 |
| `browser.rs` | 内嵌浏览器面板、元素选择器 |
| `wsl.rs` / `wsl_git.rs` | WSL 终端和 Git |
| `remote.rs` / `remote_git.rs` | SSH 远程终端和 Git |
| `agent.rs` | Agent 管理 |
| `ide.rs` | IDE 启动 |
| `config.rs` | 配置和会话持久化 |
| `file.rs` | 文件树和文件内容 |

### 新代码应该放在哪里

| 新代码类型 | 位置 |
|-----------|------|
| 新 Tauri 命令 | `commands/<domain>.rs` 中实现并导出，再加入对应注册宏；`app.rs` 仅保留 `generate_handler!` 的宏聚合调用 |
| 新数据模型 | `models/<domain>.rs`，在 `models/mod.rs` 中导出 |
| 新 Manager | 新建 `src/<name>.rs`，在 `lib.rs` 中用 `mod` 声明，添加到 `AppStateWrapper` |
| Git 操作 | `git/local.rs`、`git/wsl.rs` 或 `git/remote.rs` |
| SSH 认证 | `utils/command/ssh_auth.rs`（统一 `authenticate()` 和 `connect_and_authenticate()`） |
| 主题操作 | `theme/opencode.rs` 或 `theme/pi.rs`（共享工具在 `theme/common.rs`） |
| 工具函数 | `utils/<name>.rs` |
| 错误类型扩展 | `error.rs` |

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

- Manager 模式：`src-tauri/src/terminal.rs` —— 使用 `Arc<Mutex<HashMap>>` 的 `TerminalManager`
- 类型定义：`src-tauri/src/models/project.rs` —— 共享数据模型
- 命令拆分：`src-tauri/src/commands/project.rs` —— 领域命令独立模块
- 中枢模式：`src-tauri/src/app.rs` —— Tauri Builder + 命令注册表
- 状态组装：`src-tauri/src/app_state.rs` —— `AppStateWrapper` 定义
- SSH 认证统一：`src-tauri/src/utils/command/ssh_auth.rs` —— `connect_and_authenticate()` 函数
- 主题模块化：`src-tauri/src/theme/` —— `common.rs` 共享工具 + `opencode.rs`/`pi.rs` 域逻辑
- Re-export wrapper：`src-tauri/src/opencode_theme.rs` 和 `pi_theme.rs` 为薄包装层，指向 `theme::` 子模块
