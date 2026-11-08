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
├── .cargo/
│   └── config.toml           # cargo target runner（仅 macOS）：cwd=src-tauri 的 `cargo run`
│                             # 命中 scripts/macos-dev-bundle.sh，把产物包成 dev .app 再执行
├── scripts/
│   └── macos-dev-bundle.sh   # dev .app 包装（UNUserNotificationCenter 要求 bundle 身份）
├── tauri.conf.json           # 主 Tauri 配置
├── tauri.macos.conf.json     # macOS 特定的 bundle + 窗口外观配置（会整体替换 app.windows，见 window-lifecycle.md）
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
    ├── app/                  # 组合根：Tauri Builder 组装（boot）· 关闭协议（close）· 生命周期命令（commands）
    ├── app_state.rs          # AppStateWrapper —— 运行时状态组装
    ├── core/                 # 核心基础设施
    │   ├── mod.rs
    │   ├── error.rs          # AppError —— 统一可序列化错误类型（Io、Git、Storage、Wsl、Unsupported 等）
    │   └── logger.rs         # 自定义文件日志
    ├── common/               # 跨域共享基础设施（runtime / db / cache ...）
    │   ├── db/               # `neeko.db` 连接池 + **唯一**迁移链（详见 persistence-and-cache.md）
    │   │   ├── mod.rs        # open / open_in_memory / open_pool / open_memory_pool
    │   │   ├── pool.rs       # DbPool = Pool<SqliteConnectionManager>，PRAGMA 在 with_init
    │   │   └── migrations.rs # LATEST_VERSION + run_migrations 分派器（按版本区间委派到各域）
    │   └── cache/            # 通用 KV 缓存（cache_entries），value 对后端不透明
    │       ├── migrations.rs # v12_to_v13 建表（SQL 归 cache 域）
    │       ├── store.rs      # CacheStore: get_many / list_keys / put_many / delete_many / evict / clear
    │       └── commands.rs   # 薄命令（红线 6）+ namespace/载荷校验
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
    │   ├── services.rs       # WSL 枚举 + 目录列表（get_wsl_distros, get_wsl_directories, get_wsl_home_dir）
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
    │   ├── lookup.rs         # 项目路径 → 执行环境匹配（组合根只负责读取项目列表）
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
    │   ├── commands.rs       # Skill 命令（~20 个）
    │   ├── content_hash.rs
    │   ├── installer.rs
    │   ├── skill_store.rs
    │   ├── types.rs
    │   └── ...
    ├── mcp/                  # MCP 系统（自包含子系统，从 skill/ 拆分）
    │   ├── mod.rs
    │   ├── commands.rs       # MCP 命令（~25 个）
    │   ├── mcp_registry_api.rs
    │   ├── mcp_probe.rs
    │   ├── store.rs
    │   ├── repository.rs
    │   ├── migrations.rs
    │   └── types.rs
    ├── task/                 # 任务系统
    │   ├── mod.rs
    │   ├── commands.rs       # Tauri 命令（委派到 services）
    │   └── services.rs       # 任务 I/O：TaskConfig 模型 + JSON 读写
    ├── terminal/             # 终端管理
    │   ├── mod.rs            # 仅声明与 re-export（无业务实现）
    │   ├── commands.rs       # 本地/WSL/SSH 终端命令（委派给 TerminalRouter）
    │   ├── router.rs         # TerminalRouter —— 会话归属路由表 + 后端分派（Pty / SSH）
    │   ├── manager.rs        # TerminalManager —— 本地/WSL PTY 后端
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
pub mod mcp;
pub mod task;
pub mod terminal;
pub mod theme;
pub mod utils;

pub use app::run;
pub use app_state::AppStateWrapper;
pub use core::error::AppError;
```

### `app/` 的职责

`app/` 是**组合根**：只回答「按什么顺序调用谁」与「失败怎么办」，不持有任何业务规则。

| 文件 | 职责 |
|------|------|
| `app/mod.rs` | 门面：`mod` 声明 + `pub use`（红线 9，极薄） |
| `app/boot.rs` | `run()`：进程前置 → Builder 组装 → `setup` 启动序列（各域 `boot` 的顺序） |
| `app/close.rs` | 关闭协议：`CloseRequested` 决策（纯函数）+ 窗口事件处理 + `Destroyed` 清理 |
| `app/commands.rs` | 生命周期命令（`confirm_app_exit`）—— 与其它域同款「命令住 `commands.rs`」 |

**边界（硬性）**：判据与 `app_state.rs` 相同 —— 写进来的是「**组装**」还是「**规则**」？
规则一律下沉到拥有它的领域模块，且**每个域在启动期只暴露一个 `boot` 入口**
（组合根只负责顺序与失败策略；新域照此加一行）：

| 启动期规则 | 归属 |
|------------|------|
| 会话 → 工作区恢复（激活 id 校验、单体失败跳过、损坏会话不阻断启动） | `session/boot.rs` |
| 运行时句柄注入 + 持久化设置应用（顺序不可交换） | `lsp/boot.rs` |
| 自定义 agent 装载 + 历史 `agentSkillPathOverrides` 迁移 | `agent/boot.rs` |
| 默认 Tag Group 存在性（幂等） | `library/boot.rs` |
| 关闭标签页 vs 关闭窗口的判别（macOS Cmd+W 双通道） | `platform/close_tab/`（红线 10） |

新增启动步骤的扩展点：在对应领域加一个 `boot.rs` 函数（自带单测），在
`app/boot.rs::on_setup` 按顺序加一行调用 —— 不引入第二套机制（YAGNI）。

### `app_state.rs` 的职责

`app_state.rs` 定义 `AppStateWrapper`，集中组装所有 Manager。

**边界（硬性）**：本文件只允许三类内容 —— ① 字段声明；② 构造（`new*` / `Default`）；
③ **共享状态的只读访问器**（如 `project_context` / `resolve_project` / `main_window`）。
**域内策略一律不留在这里**：会话分派在 `terminal/router.rs`，退出清理机制在
`common/shutdown.rs`，路径匹配在 `project/lookup.rs`，主题产物准备在
`theme/service.rs::prepare_project_theme`。判据很简单：写进去的是"**组装**"还是"**规则**"？规则一律下沉到拥有它的领域模块。

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
    pub mcp_store: Arc<mcp::store::McpStore>,   // MCP: server/tag group/target management
    pub lsp_manager: lsp::LspManager,           // Phase 1: LSP server lifecycle management
}
```

### 领域模型和类型

数据模型现在按领域拆分到各模块的 `types.rs` 或 `model.rs` 中，不再有集中的 `models/` 目录或 `state.rs`。序列化契约（`serde::Serialize + Deserialize`）定义在各自的领域模块里：

| 领域模块 | 模型文件 | 关键类型 |
|----------|----------|----------|
| `project/` | `types.rs` | `Project`、`GitInfo`、`Worktree`、`FileChange`、`FileStatus`、`ViewMode`、`FileNode`、`FileContent` |
| `session/` | `types.rs` | `SessionStore`、`ProjectSession` |
| `terminal/` | `types.rs` | `TerminalSession`、`TerminalStatus` |
| `connection/` | `types.rs` | `AuthMethod` |
| `agent/` | `types.rs` + `model.rs` | `AgentConfig` |
| `git/` | `types.rs` + `model.rs` | Git 内部类型 |
| `task/` | `services.rs` | `TaskConfig`（定义在 services.rs 中） |

### 命令的职责和分布

所有 `#[tauri::command]` 函数按领域拆分到各领域的 `commands.rs` 中。所有命令通过 `lib.rs` 中的 `neeko_invoke_handler!` 宏集中注册（不再使用各模块内的 `generate_handler!`）：

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
| `skill/` | `commands.rs` | Skill 操作（~20 个命令） |
| `mcp/` | `commands.rs` | MCP 操作（~25 个命令）：server CRUD、tag group CRUD、project bindings、deployment targets、registry search/fetch、test connection、slash resource resolve |
| `lsp/` | `commands.rs` | 6 个 LSP 命令：request/notification/open/change/close document + session list |
| `server/` | 无（**基础设施层，不开 Tauri 命令**） | 进程内 HTTP 网关引擎：`engine.rs`（bind/分层/挂载路由组/优雅停机）、`gate.rs`（统一鉴权门）、`group.rs`（`RouteGroup` + `FailurePolicy`）。**零业务分支、零 `tauri::`**（护栏 `check_server_no_business_dep`）；业务路由组由组合根注入（如 `agent/hooks/ingest/handlers.rs::route_group`）。新增客户端形态 = 加一个路由组 + 一行注册，引擎与门零改动 |

### 新代码应该放在哪里

| 新代码类型 | 位置 |
|-----------|------|
| 新 Tauri 命令 | `<domain>/commands.rs` 中实现并导出，将命令路径加入 `lib.rs` 的 `neeko_invoke_handler!` |
| 无 State 依赖的纯业务逻辑 | `<domain>/services.rs`（patterns 见下方 §services.rs） |
| 新 Manager | 新建 `<domain>/manager.rs`，在 `lib.rs` 中用 `pub mod` 声明，添加到 `AppStateWrapper` |
| Git 操作（纯逻辑） | `git/local.rs`、`git/wsl.rs` 或 `git/remote.rs` |
| SSH 认证 | `utils/command/ssh_auth.rs`（统一 `authenticate()` 和 `connect_and_authenticate()`） |
| LSP 操作 | `lsp/manager.rs`（LspManager + LspSession）、`lsp/commands.rs`（Tauri 命令） |
| 新 HTTP 客户端形态（路由组） | 业务域内建 `route_group()`（返回 `crate::server::RouteGroup`，声明自己的 `FailurePolicy`），在组合根注册；**不改 `server/`** |
| HTTP 引擎/鉴权能力 | `server/`（引擎与门属进程级基础设施，业务域不得持有） |
| 主题操作 | `theme/opencode.rs` 或 `theme/pi.rs`（共享工具在 `theme/common.rs`） |
| 工具函数 | `utils/<name>.rs` |
| 错误类型扩展 | `core/error.rs` |
| 数据模型/类型 | 按领域放在 `<domain>/types.rs` 或 `<domain>/model.rs` |
| 新的 `neeko.db` 表 | 建表 SQL 放**拥有该表的域**（如 `common/cache/migrations.rs`），版本链在 `common/db/migrations.rs` 加一行分派；两份必须同一次提交 —— 见 [persistence-and-cache.md](./persistence-and-cache.md) |
| 新的 KV 缓存消费者 | 前端在 `src/shared/cache/` 用 `PersistentKeyValueStore<T>` + 一个 Port（namespace 归 Port）；后端不需改 schema，`value` 对后端不透明 |
| 数据库访问 | 从共享 `DbPool` 取连接；**不要新开第二个池**（同文件两个池 = 两个所有者） |

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
- **命令分布**：`src-tauri/src/git/commands/` —— 按主题分文件（`branch` / `commit` / `index` / `query` / `sync` / `history` / `worktree` / `pr`），`mod.rs` 只做 `mod` + `pub use`
- **组合根**：`src-tauri/src/app/` —— `boot.rs`（Tauri Builder 组装 + 启动序列）+ `close.rs`（关闭协议）+ `commands.rs`（生命周期命令）
- **状态组装**：`src-tauri/src/app_state.rs` —— `AppStateWrapper` 定义，组装所有 Manager
- **命令注册**：`src-tauri/src/lib.rs` —— `neeko_invoke_handler!` 宏维护完整命令清单
- **SSH 认证统一**：`src-tauri/src/common/executor/ssh_auth.rs` —— `connect_and_authenticate()` 函数
- **主题模块化**：`src-tauri/src/theme/` —— `common.rs` 共享工具 + `opencode.rs`/`pi.rs` 域逻辑 + `service.rs` 编排层
- **领域自治**：`src-tauri/src/git/` —— 命令层（`commands/`）+ 服务层（`services/`）；纯实现落在 `src-tauri/src/common/git/`（`local/` / `operations/` / `parsers/` / `status_worker/` / `pr/` / `wsl.rs` / `transport/`）
