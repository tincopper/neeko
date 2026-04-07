# 目录结构

> 后端代码在本项目中的组织方式。

---

## 概述

Rust 后端位于 `src-tauri/` 目录中，采用**扁平模块布局** —— 所有模块都是 `src/` 下的单个文件，在 `lib.rs` 中声明。`src/` 下没有子目录。

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
└── src/
    ├── main.rs               # 二进制入口（极简，调用 lib::run）
    ├── lib.rs                # 中枢：AppStateWrapper、所有 #[tauri::command] 函数、run()
    ├── state.rs              # 所有数据模型结构体和枚举
    ├── project.rs            # ProjectManager —— 项目 CRUD
    ├── terminal.rs           # TerminalManager —— 本地 PTY 生命周期
    ├── remote.rs             # RemoteTerminalManager —— SSH 终端、WSL git、远程 IDE
    ├── git.rs                # Git 操作（git2 + CLI 回退）
    ├── agent.rs              # AgentManager —— AI Agent 预设/自定义管理
    ├── storage.rs            # StorageManager —— JSON 文件持久化（~/.neeko/）
    ├── watcher.rs            # WatcherManager —— 文件系统变更检测（notify）
    └── logger.rs             # 自定义文件日志
```

---

## 模块组织

### `lib.rs` 中的模块声明

所有模块都声明为**私有**：

```rust
mod agent;
mod git;
mod logger;
mod project;
mod remote;
mod state;
mod storage;
mod terminal;
mod watcher;
```

除 `state` 使用 glob 导入外，其他模块使用显式导入：

```rust
use agent::AgentManager;
use git::get_file_diff;
use project::ProjectManager;
use remote::RemoteTerminalManager;
use state::*;     // 仅 state 使用 glob 导入
use storage::StorageManager;
use terminal::TerminalManager;
use watcher::WatcherManager;
```

### 模块职责

| 模块 | 结构体 | 职责 |
|------|--------|------|
| `lib.rs` | `AppStateWrapper` | 中枢：所有 Tauri 命令、应用初始化、状态组装 |
| `state.rs` | （仅类型） | 所有跨模块共享的数据模型结构体/枚举 |
| `project.rs` | `ProjectManager` | 内存中的项目 CRUD |
| `terminal.rs` | `TerminalManager` | 本地 PTY 创建/关闭/调整大小，reader/watcher 线程 |
| `remote.rs` | `RemoteTerminalManager` | SSH 终端会话、WSL 命令、远程 IDE 打开 |
| `git.rs` | （自由函数） | 通过 git2 的 Git 操作 + worktree 的 CLI 回退 |
| `agent.rs` | `AgentManager` | 内置 + 自定义 Agent 配置管理 |
| `storage.rs` | `StorageManager` | JSON 文件持久化到 `~/.neeko/` |
| `watcher.rs` | `WatcherManager` | 使用 notify 的文件系统监听 + 防抖 |
| `logger.rs` | （自由函数） | 文件日志记录到 `~/.neeko/neeko.log` |

### 新代码应该放在哪里

| 新代码类型 | 位置 |
|-----------|------|
| 新 Tauri 命令 | `lib.rs` 中的自由函数，添加到 `generate_handler!` |
| 新数据模型 | `state.rs` |
| 新 Manager | 新建 `src/<name>.rs`，在 `lib.rs` 中用 `mod` 声明，添加到 `AppStateWrapper` |
| Git 操作 | `git.rs` |
| 工具函数 | 放在最相关模块中的私有函数 |

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

- Manager 模式：`src-tauri/src/terminal.rs` —— 使用 `Arc<Mutex<HashMap>>` 的 `TerminalManager`，实现并发会话访问
- 类型定义：`src-tauri/src/state.rs` —— 所有共享类型集中在一个文件中
- 中枢模式：`src-tauri/src/lib.rs` —— 所有命令 + 状态组装
