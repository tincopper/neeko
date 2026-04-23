# Neeko - 需求文档

## 1. 项目概述

**项目名称**：Neeko

**项目定位**：基于 Rust + Tauri 2.0 的跨平台桌面应用，统一管理多个 AI CLI Agent 工具。支持三种项目类型：本地项目、WSL 项目（Windows）、SSH 远程项目。每种项目绑定独立的 PTY 终端会话，支持 Git 分支管理、Worktree 管理、文件 Diff 查看、副终端面板和 IDE 一键启动。

**目标用户**：使用 AI CLI Agent（如 opencode、claude-code、gemini）进行开发的程序员。

---

## 2. 核心功能

### 2.1 多项目管理

- 支持三种项目类型：本地（Local）、WSL（Windows Subsystem for Linux）、SSH 远程（Remote）
- **本地项目**：通过系统文件对话框选择目录
- **WSL 项目**：选择 WSL 发行版 → 通过带自动补全的路径选择器选择 WSL 内目录（400ms 防抖）
- **SSH 远程项目**：配置服务器（host/port/username/密码或密钥认证）→ 通过 SSH 自动补全路径选择器选择远程目录
- 项目去重检测：添加已存在路径时不重复打开
- 项目移除（不删除源文件）
- 会话持久化：重启后从 `~/.neeko/sessions.json` 自动恢复项目列表、Agent 配置、IDE 配置、WSL 条目、SSH 条目、侧边栏宽度、副终端宽度、Worktree 状态
- 快捷键切换：`Ctrl+1~9` 直接跳转到对应索引的项目（跨所有类型），`Ctrl+Q` 循环切换到下一个项目
- 添加项目时可同时选择 Agent 和 IDE
- 项目折叠/展开状态持久化（通过 `set_project_collapsed` 命令）

### 2.2 左侧边栏

- 可拖拽调整宽度（180–480px），通过 CSS 变量 `--sidebar-width` 同步标题栏分割线
- 宽度持久化到会话
- 每个项目展示：头像（哈希着色）、项目名、当前分支、本地分支列表（支持内联重命名）、Worktree 列表（支持内联重命名）、变更文件树
- 变更文件按目录树结构展示，文件带状态徽章（M/A/D/R/U）和文件类型图标
- 文件树支持"紧凑中间包"压缩（IDEA 风格）：`a/b/c/file.ts` 显示为 `a.b.c`
- 分支操作：切换分支、新建分支、重命名分支、新建 Worktree、删除 Worktree、重命名 Worktree
- Git 信息自动刷新（文件监听器 800ms 防抖 + 10s 轮询）和手动刷新
- 项目头部含"打开 IDE"按钮（外部链接图标），点击在选定 IDE 中打开当前项目
- 副终端快捷按钮

### 2.3 标题栏

单行自定义标题栏（`decorations: false`，无系统边框），分为左右两区：

| 区域 | 内容 |
|------|------|
| 左区（宽度 = `--sidebar-width`） | NEEKO 标签 + 设置图标 + 添加项目下拉（Local/WSL/Remote） |
| 右区 | 当前项目名 + 当前分支 + AgentSelector 下拉 + 窗口控制按钮（最小化/最大化/关闭） |

窗口控制使用 `lucide-react` 图标（Minus, Square, Copy, X），跟踪 `isMaximized` 状态。

### 2.4 终端视图

- 每个项目绑定独立 PTY 终端（Windows 使用 `powershell.exe -ExecutionPolicy Bypass -NoLogo`，Unix 使用默认 shell 或自定义 shell）
- 终端跨项目切换时保持会话（全局 `terminalCache` Map，不销毁 xterm 实例）
- 自动重连：切换回项目时重新附加已有终端 DOM 节点
- Agent 自动启动：终端创建后若项目已绑定 Agent，自动发送启动命令（本地即时，WSL 延迟 500ms，SSH 延迟 800ms）
- 支持手动从 AgentSelector 切换 Agent（发送 Ctrl+C 中断后重新执行）
- 实时 PTY 输入输出（Tauri 事件 `terminal-output-<id>` / `terminal-input-<id>`）
- 自适应终端尺寸（`ResizeObserver` + `requestAnimationFrame` 节流）
- xterm 主题：One Dark Pro，字体可配置（默认 JetBrains Mono / Fira Code / Cascadia Code），scrollback 10000 行
- PTY 进程退出检测：Watcher 线程监控进程状态，退出后发出 `terminal-closed` 事件，前端展示"Restarting in 3s"并自动重建终端
- Linux/macOS IME 支持：禁用 PTY echo，追踪 `compositionstart/end`，中文输入期间暂停 `onData` 回调
- Unicode11 Addon 用于正确的 CJK 字符宽度处理
- DEL (0x7f) 字符过滤
- 支持 `working_dir` 参数指定工作目录（用于 Worktree 场景）
- `Ctrl+R` 手动刷新终端（关闭 PTY 并重建）

### 2.5 副终端（SideTerminalView）

- `Ctrl+Alt+T` 在 Agent 终端右侧打开副终端面板，`Ctrl+W` 或面板内关闭按钮关闭
- 副终端与主终端共享相同的 PTY 管理机制，同项目多终端并存
- 面板宽度默认 480px，可通过 5px 分隔线拖拽调整（200–1200px 范围）
- 分隔线鼠标悬停时显示蓝色高亮
- 宽度持久化到会话
- 缓存键格式：`projectId:side` 或 `projectId:side:worktreePath`

### 2.6 Worktree 终端（WorktreeTerminalView）

- 点击 Worktree 时打开专用终端视图，替换主终端（主终端 `display: none`）
- 缓存键格式：`projectId:wt:worktreePath`
- 自动启动绑定的 Agent
- `Ctrl+N` 循环切换已打开的 Worktree

### 2.7 Diff 视图

- 点击侧边栏变更文件 → 切换到 Diff 视图
- 支持**统一模式**（4列：旧行号 / 新行号 / +- 标记 / 内容）和**并排模式**（旧/新双列）
- 变更块（Change Block）导航：切换上/下变更区域
- 词级别 Diff 高亮（LCS 算法，GitHub 风格行内差异）
- 语法高亮（`highlight.js`，22 种语言）
- 文件类型图标展示
- Back 按钮返回终端视图
- 支持本地、WSL、SSH 三种 Diff 源

### 2.8 Agent 管理

- 预置 7 个 Agent（见下表），支持运行时通过 `add_agent` 命令注册自定义 Agent
- 每个项目独立绑定 Agent，可从 AgentSelector 自定义下拉框切换
- 切换后立即在终端执行对应命令
- 设置面板支持管理自定义 Agent（添加/删除/编辑命令参数）
- 内置 Agent 命令可被覆盖（双击编辑），通过 `agentCommandOverrides` 持久化

**预置 Agent：**

| ID | 名称 | 命令 | 图标 |
|----|------|------|------|
| `opencode` | opencode | `opencode` | `opencode.svg` |
| `claude-code` | claude-code | `claude` | `claude-code.svg` |
| `gemini` | gemini | `gemini` | `gemini.svg` |
| `codex` | codex | `codex` | `codex.svg` |
| `qoder` | qoder | `qoder` | `qoder.svg` |
| `codebuddy` | codebuddy | `codebuddy` | `codebuddy.svg` |

### 2.9 IDE 集成

- 每个项目可绑定一个 IDE，在 `add_project` 时或后续通过 `set_project_ide` 命令设置
- 点击项目头部外部链接图标或按 `Ctrl+O` 在选定 IDE 中打开当前项目目录
- 支持路径含空格的 IDE 可执行文件（优先检测完整字符串是否为有效路径，再按 shell 分词）
- IDE 操作结果通过 Toast 通知反馈（成功 / 失败）
- WSL 项目通过 `open_wsl_ide` 打开 IDE
- SSH 远程项目通过 `open_remote_ide` 打开 IDE（智能检测 VSCode/Cursor/Zed SSH 协议）

**预置 IDE（`idePresets.ts`）：**

| ID | 名称 | 平台命令示例 |
|----|------|-------------|
| `vscode` | VS Code | `code` |
| `cursor` | Cursor | `cursor` |
| `zed` | Zed | `zed` (macOS/Linux) |
| `idea` | IntelliJ IDEA | `idea` / `idea64.exe` / `idea.sh` |
| `goland` | GoLand | `goland` / `goland64.exe` |
| `rustrover` | RustRover | `rustrover` / `rustrover64.exe` |
| `pycharm` | PyCharm | `pycharm` / `pycharm64.exe` |

### 2.10 WSL 支持（Windows 专属）

- WSL 发行版枚举（`get_wsl_distros`）
- WSL 目录浏览与自动补全（`get_wsl_directories`，400ms 防抖）
- WSL 家目录解析（`get_wsl_home_dir`）
- WSL 终端会话（`create_wsl_terminal_session`，在 WSL 内运行 PTY）
- WSL Git 操作：刷新信息、Diff、切换分支、创建分支、重命名分支、创建/删除/重命名 Worktree
- WSL IDE 打开（`open_wsl_ide`）
- 使用 `wsl.exe` + `WSL_UTF8=1` 环境变量
- 会话持久化到 `sessions.json` 的 `wsl_entries` 字段

### 2.11 SSH 远程支持

- SSH 连接配置：host、port、username、认证方式（密码 / 密钥文件 / 密钥文件+密码）
- SSH 连接测试（`test_remote_connection`）
- SSH 远程目录浏览与自动补全（`list_remote_directories`，400ms 防抖）
- SSH 终端会话（`create_remote_terminal_session`，基于 `russh`）
- SSH Git 操作：刷新信息、Diff、切换分支、创建/重命名分支、创建/删除/重命名 Worktree
- SSH IDE 打开（`open_remote_ide`，支持 VSCode/Cursor/Zed SSH 远程协议）
- 凭据保存（Base64 混淆存储，可选）
- 会话持久化到 `sessions.json` 的 `remote_entries` 字段
- 缺少缓存凭据时自动弹出认证对话框

### 2.12 设置面板

固定尺寸模态对话框（720x480px），左侧导航（Editor / Terminal / Agents / IDE / Git），右侧内容区：

- **Editor**：字体大小步进器（10–24px），默认 Diff 模式（统一/并排）
- **Terminal**：字体族选择（系统字体发现 + 可搜索下拉 + 实时预览），Shell 预设按钮（平台相关）+ 自定义路径输入
- **Agents**：内置 + 自定义 Agent 列表，支持添加/删除/编辑命令参数
- **IDE**：预置 IDE 列表（双击编辑命令覆盖），自定义 IDE 添加/删除，`ideCommandOverrides` 持久化
- **Git**：（预留，显示 "No Git settings yet"）

配置持久化到 `~/.neeko/config.json`，启动时自动加载。`Escape` 键关闭设置面板。

### 2.13 Toast 通知系统

- 底部居中展示，info（蓝色）/ error（红色）两种类型
- 3 秒后自动消失
- 用于 IDE 打开成功/失败等操作反馈

### 2.14 文件日志系统

- 自定义 `FileLogger` 实现，日志写入 `~/.neeko/neeko.log`
- 实现 `log::Log` trait

### 2.15 键盘快捷键汇总

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+1` ~ `Ctrl+9` | 直接跳转到第 N 个项目（跨所有类型） |
| `Ctrl+Q` | 循环切换到下一个项目 |
| `Ctrl+Alt+T` | 打开副终端面板 |
| `Ctrl+W` | 关闭副终端面板 |
| `Ctrl+O` | 在当前项目绑定的 IDE 中打开项目 |
| `Ctrl+N` | 循环切换已打开的 Worktree |
| `Ctrl+R` | 手动刷新终端 |
| `Escape` | 关闭设置面板 |

---

## 3. 技术架构

```
┌──────────────────────────────────────────────────────────────────┐
│                            Neeko App                             │
├──────────────────────┬───────────────────────────────────────────┤
│   左侧边栏           │   右侧主区域                              │
│                      │                                           │
│  ┌────────────────┐  │  ┌─────────────┬───────────┬───────────┐ │
│  │  ProjectItem   │  │  │  Terminal   │SideTerm   │Worktree   │ │
│  │  - 项目名      │  │  │  View       │View       │Terminal   │ │
│  │  - 分支列表    │  │  │ (xterm+PTY) │(可选)     │View       │ │
│  │  - Worktree    │  │  └─────────────┴───────────┴───────────┘ │
│  │  - 变更文件    │  │             或                            │
│  │  - 打开IDE按钮 │  │  ┌─────────────────────────────────┐    │
│  └────────────────┘  │  │      DiffView                   │    │
│         │            │  │  (统一/并排, 词级diff, 语法高亮) │    │
│  ProjectSidebar      │  └─────────────────────────────────┘    │
│  (可拖拽宽度)        │                                           │
│                      │  WSL / SSH 终端视图（独立缓存）           │
├──────────────────────┴───────────────────────────────────────────┤
│              Tauri 2.0 Backend (Rust)                            │
│  - git2-rs（本地 Git 操作 + Diff）                               │
│  - portable-pty（跨平台终端）                                    │
│  - russh（SSH 远程终端 + Git 操作）                              │
│  - serde_json（配置/会话持久化）                                 │
│  - notify / notify-debouncer-mini（文件监听）                    │
│  - libc（Unix PTY echo 禁用）                                    │
│  - FileLogger（日志写入 ~/.neeko/neeko.log）                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. 技术选型

| 层级 | 技术 |
|------|------|
| 应用框架 | Tauri 2.0 |
| 后端语言 | Rust |
| 前端框架 | React 18 + TypeScript + Vite |
| 终端后端 | portable-pty |
| 终端前端 | @xterm/xterm 6 + @xterm/addon-fit + @xterm/addon-unicode11 |
| Git 操作 | git2-rs（含 diff） |
| SSH | russh 0.50 + russh-keys 0.50 |
| 文件监听 | notify 6 + notify-debouncer-mini 0.4 |
| 对话框 | tauri-plugin-dialog |
| 序列化 | serde + serde_json |
| 异步运行时 | tokio |
| 系统调用 | libc（Unix，PTY echo 控制） |
| 工具库 | uuid, chrono, dirs, anyhow, futures, log |
| 图标 | lucide-react（UI 操作按钮），SVG（文件/文件夹/Agent/IDE 图标） |
| 样式 | 纯 CSS（One Dark Pro 主题） |
| 持久化 | `~/.neeko/sessions.json` + `~/.neeko/config.json` |
| 日志 | `~/.neeko/neeko.log`（自定义 FileLogger） |

---

## 5. 数据结构

### 5.1 核心类型（Rust `state.rs`）

```rust
struct Project {
    id: String,                        // UUID v4
    name: String,                      // 目录名
    path: PathBuf,
    git_info: Option<GitInfo>,
    terminal: TerminalSession,
    selected_agent: Option<String>,    // Agent ID
    selected_ide: Option<String>,      // IDE ID 或自定义命令
    active_view: ViewMode,
    collapsed: bool,                   // 折叠状态
}

enum ViewMode {
    Terminal,
    Diff { file_path: PathBuf },
}

struct GitInfo {
    current_branch: String,
    branches: Vec<String>,             // 仅本地分支
    worktrees: Vec<Worktree>,
    changed_files: Vec<FileChange>,
    is_clean: bool,
}

struct Worktree { path: PathBuf, branch: String, head: String }

struct FileChange { path: PathBuf, status: FileStatus, additions: usize, deletions: usize }

enum FileStatus { Modified, Added, Deleted, Renamed, Untracked }

struct TerminalSession {
    id: String,
    pid: Option<u32>,
    status: TerminalStatus,
    history: Vec<String>,
    agent: Option<AgentConfig>,
}

enum TerminalStatus { Idle, Running, Failed }

struct AgentConfig {
    id: String, name: String, command: String,
    args: Vec<String>, env: HashMap<String, String>,
    icon: Option<String>, enabled: bool,
}

struct DiffResult { hunks: Vec<DiffHunk> }

struct DiffHunk {
    old_start: u32, old_lines: u32,
    new_start: u32, new_lines: u32,
    lines: Vec<DiffLine>,
}

enum DiffLine { Context(String), Added(String), Removed(String) }

enum AuthMethod {
    Password(String),
    KeyFile(String),
    KeyFileWithPassphrase { key_path: String, passphrase: String },
}
```

### 5.2 持久化类型（`storage.rs`）

```rust
struct SessionStore {
    projects: Vec<ProjectSession>,
    active_project_id: Option<String>,
    last_updated: String,              // RFC 3339
    wsl_entries: Vec<WSLEntrySession>,
    remote_entries: Vec<RemoteEntrySession>,
    sidebar_width: Option<u32>,
    side_terminal_width: Option<u32>,
    worktree_state: HashMap<String, String>,
}

struct ProjectSession {
    id: String, name: String, path: PathBuf,
    selected_agent: Option<String>,
    selected_ide: Option<String>,
    terminal_history: Vec<String>,
    last_status: TerminalStatus,
    collapsed: bool,                   // 默认 true
}

struct WSLEntrySession {
    id: String, distro: String,
    projects: Vec<WSLProjectSession>,
}

struct WSLProjectSession {
    id: String, name: String, path: String,
    distro: String, entry_id: String,
    selected_agent: Option<String>,
    selected_ide: Option<String>,
}

struct RemoteEntrySession {
    id: String, host: String, port: u16, username: String,
    projects: Vec<RemoteProjectSession>,
    saved_auth: Option<String>,        // Base64 混淆的认证信息
}

struct RemoteProjectSession {
    id: String, name: String, path: String,
    entry_id: String,
    selected_agent: Option<String>,
    selected_ide: Option<String>,
}
```

`config.json` 格式：
```json
{
  "fontSize": 14,
  "diffMode": "unified",
  "shell": "",
  "fontFamily": "",
  "customIdes": [],
  "ideCommandOverrides": {},
  "agentCommandOverrides": {},
  "customAgents": []
}
```

---

## 6. Tauri 命令接口

### 项目管理
| 命令 | 参数 | 返回 |
|------|------|------|
| `add_project` | `path: String, agent_id: Option<String>, ide: Option<String>` | `Project` |
| `remove_project` | `project_id: String` | `()` |
| `list_projects` | — | `Vec<Project>` |
| `get_project` | `project_id: String` | `Project` |
| `refresh_git_info` | `project_id: String` | `()` |
| `set_active_project` | `project_id: String` | `()` |
| `get_active_project` | — | `Option<String>` |
| `set_view_terminal` | `project_id: String` | `()` |
| `set_view_diff` | `project_id: String, file_path: String` | `()` |
| `set_project_ide` | `project_id: String, ide: Option<String>` | `()` |
| `set_project_collapsed` | `project_id: String, collapsed: bool` | `()` |
| `open_ide` | `ide_command: String, project_path: String` | `Result<(), String>` |

### Git 操作（本地）
| 命令 | 参数 | 返回 |
|------|------|------|
| `checkout_branch` | `project_id, branch_name` | `Result<(), String>` |
| `create_branch` | `project_id, branch_name` | `Result<(), String>` |
| `rename_branch` | `project_id, old_name, new_name` | `Result<(), String>` |
| `get_file_diff_command` | `project_id, file_path` | `Result<DiffResult, String>` |
| `create_worktree` | `project_id, worktree_path, branch_name, new_branch: bool` | `Result<(), String>` |
| `remove_worktree` | `project_id, worktree_path` | `Result<(), String>` |
| `rename_worktree` | `project_id, worktree_path, new_name` | `Result<String, String>` |

### 终端管理（本地）
| 命令 | 参数 | 返回 |
|------|------|------|
| `create_terminal_session` | `project_id: String, cols: u16, rows: u16, shell: Option<String>, working_dir: Option<String>` | `TerminalSession` |
| `close_terminal_session` | `session_id: String` | `()` |
| `resize_terminal` | `session_id, cols: u16, rows: u16` | `Result<(), String>` |

### WSL 终端（Windows 专属）
| 命令 | 参数 | 返回 |
|------|------|------|
| `get_wsl_distros` | — | `Result<Vec<String>, String>` |
| `get_wsl_directories` | `distro: String, path: Option<String>` | `Result<Vec<String>, String>` |
| `get_wsl_home_dir` | `distro: String` | `Result<String, String>` |
| `create_wsl_terminal_session` | `distro: String, project_path: String, cols: u16, rows: u16` | `TerminalSession` |
| `refresh_wsl_git_info` | `distro, project_path` | `Result<GitInfo, String>` |
| `get_wsl_file_diff_command` | `distro, project_path, file_path` | `Result<DiffResult, String>` |
| `wsl_checkout_branch` | `distro, project_path, branch_name` | `Result<(), String>` |
| `wsl_create_branch` | `distro, project_path, branch_name` | `Result<(), String>` |
| `wsl_rename_branch` | `distro, project_path, old_name, new_name` | `Result<(), String>` |
| `wsl_create_worktree` | `distro, project_path, worktree_path, branch_name, new_branch` | `Result<(), String>` |
| `wsl_remove_worktree` | `distro, project_path, worktree_path` | `Result<(), String>` |
| `wsl_rename_worktree` | `distro, project_path, worktree_path, new_name` | `Result<String, String>` |
| `open_wsl_ide` | `distro, project_path, ide: String` | `Result<(), String>` |

### SSH 远程终端
| 命令 | 参数 | 返回 |
|------|------|------|
| `create_remote_terminal_session` | `host, port, username, auth: AuthMethod, project_path, cols, rows` | `TerminalSession` |
| `close_remote_terminal_session` | `session_id: String` | `()` |
| `resize_remote_terminal` | `session_id, cols: u16, rows: u16` | `Result<(), String>` |
| `test_remote_connection` | `host, port, username, auth: AuthMethod` | `Result<(), String>` |
| `list_remote_directories` | `host, port, username, auth, path: String` | `Result<Vec<String>, String>` |
| `refresh_remote_git_info` | `host, port, username, auth, project_path` | `Result<GitInfo, String>` |
| `get_remote_file_diff_command` | `host, port, username, auth, project_path, file_path` | `Result<DiffResult, String>` |
| `remote_checkout_branch` | `host, port, username, auth, project_path, branch_name` | `Result<(), String>` |
| `remote_create_branch` | `host, port, username, auth, project_path, branch_name` | `Result<(), String>` |
| `remote_rename_branch` | `host, port, username, auth, project_path, old_name, new_name` | `Result<(), String>` |
| `remote_create_worktree` | `host, port, username, auth, project_path, worktree_path, branch_name, new_branch` | `Result<(), String>` |
| `remote_remove_worktree` | `host, port, username, auth, project_path, worktree_path` | `Result<(), String>` |
| `remote_rename_worktree` | `host, port, username, auth, project_path, worktree_path, new_name` | `Result<String, String>` |
| `open_remote_ide` | `host, port, username, project_path, ide: String` | `Result<(), String>` |

### Agent 管理
| 命令 | 参数 | 返回 |
|------|------|------|
| `list_agents` | — | `Vec<AgentConfig>` |
| `get_agent` | `agent_id: String` | `Result<AgentConfig, String>` |
| `add_agent` | `agent: AgentConfig` | `Result<(), String>` |
| `remove_agent` | `agent_id: String` | `Result<(), String>` |
| `set_project_agent` | `project_id, agent_id: Option<String>` | `()` |

### 系统工具
| 命令 | 参数 | 返回 |
|------|------|------|
| `get_system_fonts` | — | `Vec<String>` |

### 持久化
| 命令 | 参数 | 返回 |
|------|------|------|
| `save_session` | `wsl_entries, remote_entries, sidebar_width, side_terminal_width, worktree_state` | `Result<(), String>` |
| `load_session` | — | `Result<SessionStore, String>` |
| `get_config_dir` | — | `String` |
| `save_config` | `config: Value` | `Result<(), String>` |
| `load_config` | — | `Result<Value, String>` |

---

## 7. 事件系统

### PTY 通信
| 方向 | 事件名 | Payload | 说明 |
|------|--------|---------|------|
| 后端 → 前端 | `terminal-output-<sessionId>` | `Vec<u8>` | PTY 输出 → xterm.js |
| 前端 → 后端 | `terminal-input-<sessionId>` | `Vec<u8>` JSON | xterm.js 按键 → PTY |
| 后端 → 前端 | `terminal-closed-<sessionId>` | — | PTY 进程退出通知 |

### 文件监听
| 方向 | 事件名 | Payload | 说明 |
|------|--------|---------|------|
| 后端 → 前端 | `git-changed` | `String` (project_id) | 文件变更检测（800ms 防抖 + 10s 轮询） |

---

## 8. UI 布局

### 终端视图（含副终端）
```
┌──────────────────┬──────────────────────────────┬───────────┐
│ NEEKO  ⚙  [v]   │  my-app · main │[opencode]  □ □ ✕        │
├──────────────────┼──────────────────────────────┼───────────┤
│                  │                              │           │
│  my-app          │  $ opencode                  │ $         │
│  ├ main ←        │  Analyzing code...           │           │
│  ├ feature/x     │  >                           │  副终端   │
│  │  📝 src/app.rs│                              │           │
│  │  📝 lib.rs    │                              │           │
│                  │◄────── 5px 拖拽分隔线 ───────►│           │
└──────────────────┴──────────────────────────────┴───────────┘
```

### Diff 视图
```
┌──────────────────┬─────────────────────────────────────────┐
│ NEEKO  ⚙  [v]   │  my-app  ·  main  │ [opencode]  □ □ ✕  │
├──────────────────┼─────────────────────────────────────────┤
│                  │  📄 src/main.rs     < 变更 1/3 >  Back  │
│  my-app          ├──────────────────┬──────────────────────┤
│  ├ main ←        │  旧代码           │  新代码              │
│  │  📝 src/main  │  10  fn main() { │  10  fn main() {    │
│  │  📝 lib.rs    │  11    let x = 1 │  11    let x = 2    │
│                  │                  │  12    let y = 3     │
│  api-server      │  13    run();    │  13    run();        │
│  ├ main ←        │  14  }           │  14  }               │
└──────────────────┴──────────────────┴──────────────────────┘
```

---

## 9. CSS 变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `--sidebar-width` | `280px` | 边栏宽度，拖拽时动态更新（180–480px） |
| `--font-size` | `14px` | 全局字体大小，设置面板修改后动态更新 |
| `--bg-primary` | `#282c34` | 主背景 |
| `--bg-secondary` | `#21252b` | 边栏/标题栏背景 |
| `--bg-tertiary` | `#2c313a` | 输入框/次级面板背景 |
| `--bg-hover` | `#323842` | Hover 状态背景 |
| `--text-primary` | `#abb2bf` | 主文字色 |
| `--text-secondary` | `#5c6370` | 次级文字色 |
| `--text-muted` | `#4b5263` | 弱化文字色 |
| `--border-color` | `#181a1f` | 边框色 |
| `--accent-blue` | `#61afef` | 蓝色强调 |
| `--accent-green` | `#98c379` | 绿色强调 |
| `--accent-yellow` | `#e5c07b` | 黄色强调 |
| `--accent-red` | `#e06c75` | 红色强调 |
| `--status-idle` | `#98c379` | 空闲状态色 |
| `--status-running` | `#e5c07b` | 运行状态色 |
| `--status-failed` | `#e06c75` | 失败状态色 |
| `--diff-added` | `#98c37920` | Diff 新增行背景 |
| `--diff-removed` | `#e06c7520` | Diff 删除行背景 |
| `--diff-added-text` | `#98c379` | Diff 新增文字色 |
| `--diff-removed-text` | `#e06c75` | Diff 删除文字色 |

---

## 10. 非功能需求

- **主题**：One Dark Pro 配色，字体栈可配置（默认 JetBrains Mono / Fira Code / Cascadia Code）
- **图标**：UI 操作按钮使用 `lucide-react`；文件/文件夹图标使用 SVG（存放于 `public/icons/`）；Agent/IDE 图标使用模块资源（`src/assets/`）
- **窗口**：自定义装饰（`decorations: false`），启动时最大化，支持拖拽移动（`data-tauri-drag-region`），透明背景关闭
- **跨平台**：macOS、Windows（PTY 使用 `powershell.exe -ExecutionPolicy Bypass -NoLogo`）、Linux；WSL 功能仅 Windows
- **配置目录**：`~/.neeko/`（sessions.json + config.json + neeko.log）
- **键盘事件捕获**：使用 `capture: true` 模式绕过 xterm.js 事件拦截
- **进程清理**：Unix 发送 SIGTERM → 等待 3s → SIGKILL；Windows 等待 3s → TerminateProcess；窗口关闭时调用 `close_all_sessions`
- **IME 支持**：禁用 PTY echo（tcsetattr），追踪 composition 事件，Unix/macOS/Windows 平台分支输入处理（Unix 50ms 延迟，macOS 150ms 延迟）
- **前端优化**：大量使用 `React.memo` 优化渲染；`ResizeObserver` + `requestAnimationFrame` 节流；跨域 Ref 模式避免 prop-drilling
- **会话迁移**：支持从旧版 `wsl_entries.json` / `remote_entries.json` 迁移到统一 `sessions.json`
