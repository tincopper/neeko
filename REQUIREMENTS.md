# Neeko - 需求文档

## 1. 项目概述

**项目名称**：Neeko

**项目定位**：基于 Rust + Tauri 2.0 的跨平台桌面应用，统一管理多个 AI CLI Agent 工具。每个项目绑定独立的 PTY 终端会话，支持 Git 分支管理、Worktree 管理与文件 Diff 查看。

**目标用户**：使用 AI CLI Agent（如 opencode、claude-code、aider）进行开发的程序员。

---

## 2. 核心功能

### 2.1 多项目管理

- 同时打开多个本地项目，通过系统文件对话框选择目录
- 项目去重检测：添加已存在路径时不重复打开
- 项目移除（不删除源文件）
- 会话持久化：重启后从 `~/.neeko/sessions.json` 自动恢复项目列表与 Agent 配置
- 快捷键切换：`Ctrl+1~9` 直接跳转到对应索引的项目，`Ctrl+Q` 循环切换到下一个项目

### 2.2 左侧边栏

- 可拖拽调整宽度（180–480px），通过 CSS 变量 `--sidebar-width` 同步标题栏分割线
- 每个项目展示：项目名、当前分支、本地分支列表、Worktree 列表、变更文件树
- 变更文件按目录树结构展示，文件带状态徽章（M/A/D/R/U）和文件类型图标
- 分支操作：切换分支、新建分支、新建 Worktree、删除 Worktree
- Git 信息手动刷新

### 2.3 标题栏

单行自定义标题栏（`decorations: false`，无系统边框），分为左右两区：

| 区域 | 内容 |
|------|------|
| 左区（宽度 = `--sidebar-width`） | NEEKO 标签 + 设置图标 + 添加项目按钮 |
| 右区 | 当前项目名 + 当前分支 + AgentSelector 下拉 + 窗口控制按钮（最小化/最大化/关闭） |

### 2.4 终端视图

- 每个项目绑定独立 PTY 终端（Windows 使用 `powershell.exe`，Unix 使用默认 shell）
- 终端跨项目切换时保持会话（全局 `terminalCache` Map，不销毁 xterm 实例）
- 自动重连：切换回项目时重新附加已有终端 DOM 节点
- Agent 自动启动：终端创建后若项目已绑定 Agent，自动发送启动命令
- 支持手动从 AgentSelector 切换 Agent（发送 Ctrl+C 中断后重新执行）
- 实时 PTY 输入输出（Tauri 事件 `terminal-output-<id>` / `terminal-input-<id>`）
- 自适应终端尺寸（窗口 resize 时触发 `resize_terminal`）
- xterm 主题：One Dark Pro，字体栈 JetBrains Mono / Fira Code / Cascadia Code，scrollback 10000 行

### 2.5 Diff 视图

- 点击侧边栏变更文件 → 切换到 Diff 视图
- 支持**统一模式**（4列：旧行号 / 新行号 / +- 标记 / 内容）和**并排模式**（旧/新双列）
- 变更块（Hunk）导航：◀ / ▶ 跳转
- 文件类型图标展示（使用 `fileIconSrc`）
- Back 按钮返回终端视图

### 2.6 Agent 管理

- 预置 6 个 Agent（见下表），支持运行时通过 `add_agent` 命令注册自定义 Agent
- 每个项目独立绑定 Agent，可从 AgentSelector 下拉框切换
- 切换后立即在终端执行对应命令

**预置 Agent：**

| ID | 名称 | 命令 | 图标 |
|----|------|------|------|
| `opencode` | opencode | `opencode` | 🤖 |
| `claude-code` | claude-code | `claude` | 🧠 |
| `aider` | aider | `aider` | 💡 |
| `qwen` | qwen | `qwen` | 🌟 |
| `gemini` | gemini | `gemini` | ♊ |
| `codex` | codex | `codex` | ⚡ |

### 2.7 设置面板

- 点击标题栏左区齿轮图标打开浮动设置面板（标题栏正下方，点击外部关闭）
- 全局字体大小：10–24px，通过 CSS 变量 `--font-size` 应用到全局（含终端）
- 默认 Diff 模式：统一 / 并排
- 配置持久化到 `~/.neeko/config.json`，启动时自动加载

---

## 3. 技术架构

```
┌──────────────────────────────────────────────────────┐
│                     Neeko App                        │
├──────────────────────┬───────────────────────────────┤
│   左侧边栏           │   右侧主区域                  │
│                      │                               │
│  ┌────────────────┐  │  ┌────────────────────────┐  │
│  │  ProjectItem   │  │  │     TerminalView        │  │
│  │  - 项目名      │  │  │   (xterm.js + PTY)      │  │
│  │  - 分支列表    │  │  └────────────────────────┘  │
│  │  - Worktree    │  │             或               │
│  │  - 变更文件    │  │  ┌────────────────────────┐  │
│  └────────────────┘  │  │      DiffView           │  │
│         │            │  │  (统一/并排模式)         │  │
│  ProjectSidebar      │  └────────────────────────┘  │
│  (可拖拽宽度)        │                               │
├──────────────────────┴───────────────────────────────┤
│              Tauri 2.0 Backend (Rust)                │
│  - git2-rs（Git 操作 + Diff）                        │
│  - portable-pty（跨平台终端）                        │
│  - serde_json（配置/会话持久化）                     │
└──────────────────────────────────────────────────────┘
```

---

## 4. 技术选型

| 层级 | 技术 |
|------|------|
| 应用框架 | Tauri 2.0 |
| 后端语言 | Rust |
| 前端框架 | React 18 + TypeScript + Vite |
| 终端后端 | portable-pty |
| 终端前端 | xterm.js 5 + xterm-addon-fit |
| Git 操作 | git2-rs（含 diff） |
| 对话框 | tauri-plugin-dialog |
| 序列化 | serde + serde_json |
| 异步运行时 | tokio |
| 图标 | Charmed Icons SVG（jsDelivr CDN 下载到 `public/icons/`） |
| 样式 | 纯 CSS（One Dark Pro 主题） |
| 持久化 | `~/.neeko/sessions.json` + `~/.neeko/config.json` |

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
    active_view: ViewMode,
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
```

### 5.2 持久化类型（`storage.rs`）

```rust
struct SessionStore {
    projects: Vec<ProjectSession>,
    active_project_id: Option<String>,
    last_updated: String,              // RFC 3339
}

struct ProjectSession {
    id: String, name: String, path: PathBuf,
    selected_agent: Option<String>,
    terminal_history: Vec<String>,
    last_status: TerminalStatus,
}
```

`config.json` 格式：
```json
{ "fontSize": 14, "diffMode": "unified" }
```

---

## 6. Tauri 命令接口（29个）

### 项目管理
| 命令 | 参数 | 返回 |
|------|------|------|
| `add_project` | `path: String, agent_id: Option<String>` | `Project` |
| `remove_project` | `project_id: String` | `()` |
| `list_projects` | — | `Vec<Project>` |
| `get_project` | `project_id: String` | `Project` |
| `refresh_git_info` | `project_id: String` | `()` |
| `set_active_project` | `project_id: String` | `()` |
| `get_active_project` | — | `Option<String>` |
| `set_view_terminal` | `project_id: String` | `()` |
| `set_view_diff` | `project_id: String, file_path: String` | `()` |
| `open_directory_dialog` | — | `Option<String>` |

### Git 操作
| 命令 | 参数 | 返回 |
|------|------|------|
| `checkout_branch` | `project_id, branch_name` | `()` |
| `create_branch` | `project_id, branch_name` | `()` |
| `get_file_diff_command` | `project_id, file_path` | `DiffResult` |
| `create_worktree` | `project_id, worktree_path, branch_name, new_branch: bool` | `()` |
| `remove_worktree` | `project_id, worktree_path` | `()` |

### 终端管理
| 命令 | 参数 | 返回 |
|------|------|------|
| `create_terminal_session` | `project_id: String` | `TerminalSession` |
| `close_terminal_session` | `session_id: String` | `()` |
| `list_terminal_sessions` | — | `Vec<TerminalSession>` |
| `resize_terminal` | `session_id, cols: u16, rows: u16` | `()` |

### Agent 管理
| 命令 | 参数 | 返回 |
|------|------|------|
| `list_agents` | — | `Vec<AgentConfig>` |
| `get_agent` | `agent_id: String` | `AgentConfig` |
| `add_agent` | `agent: AgentConfig` | `()` |
| `remove_agent` | `agent_id: String` | `()` |
| `set_project_agent` | `project_id, agent_id: Option<String>` | `()` |

### 持久化
| 命令 | 参数 | 返回 |
|------|------|------|
| `save_session` | — | `()` |
| `load_session` | — | `SessionStore` |
| `get_config_dir` | — | `String` |
| `save_config` | `config: Value` | `()` |
| `load_config` | — | `Value` |

---

## 7. 事件系统（PTY 通信）

| 方向 | 事件名 | Payload | 说明 |
|------|--------|---------|------|
| 后端 → 前端 | `terminal-output-<sessionId>` | `Vec<u8>` | PTY 输出 → xterm.js |
| 前端 → 后端 | `terminal-input-<sessionId>` | `Vec<u8>` JSON | xterm.js 按键 → PTY |

---

## 8. UI 布局

### 终端视图
```
┌──────────────────┬─────────────────────────────────────────┐
│ NEEKO  ⚙  [+]   │  my-app  ·  main  │ [opencode ▼]  □ □ ✕│
├──────────────────┼─────────────────────────────────────────┤
│                  │                                         │
│  my-app          │  $ opencode                             │
│  ├ main ←        │  Analyzing code...                      │
│  ├ feature/x     │  >                                      │
│  │  📝 src/app.rs│                                         │
│  │  📝 lib.rs    │                                         │
│                  │                                         │
│  api-server      │                                         │
│  ├ main ←        │                                         │
└──────────────────┴─────────────────────────────────────────┘
```

### Diff 视图
```
┌──────────────────┬─────────────────────────────────────────┐
│ NEEKO  ⚙  [+]   │  my-app  ·  main  │ [opencode ▼]  □ □ ✕│
├──────────────────┼─────────────────────────────────────────┤
│                  │  📄 src/main.rs     ◀ Hunk 1/3 ▶  Back │
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
| `--border-color` | `#181a1f` | 边框色 |
| `--accent-blue` | `#61afef` | 蓝色强调 |
| `--accent-green` | `#98c379` | 绿色强调 |
| `--accent-yellow` | `#e5c07b` | 黄色强调 |
| `--accent-red` | `#e06c75` | 红色强调 |
| `--diff-added` | `#98c37920` | Diff 新增行背景 |
| `--diff-removed` | `#e06c7520` | Diff 删除行背景 |

---

## 10. 非功能需求

- **主题**：One Dark Pro 配色，字体栈 JetBrains Mono / Fira Code / Cascadia Code
- **图标**：Charmed Icons SVG，存放在 `public/icons/`
- **窗口**：自定义装饰（`decorations: false`），支持拖拽移动（`data-tauri-drag-region`）
- **跨平台**：macOS、Windows（PTY 使用 `powershell.exe`）、Linux
- **配置目录**：`~/.neeko/`（sessions.json + config.json）
- **键盘事件捕获**：使用 `capture: true` 模式绕过 xterm.js 事件拦截
