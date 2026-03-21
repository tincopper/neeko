# Neeko - 多CLI Agent工具管理桌面应用

## 1. 项目概述

**项目名称**：Neeko

**项目定位**：基于 Rust + Tauri 的跨平台桌面应用，统一管理多个 AI CLI Agent 工具，每个项目绑定独立终端会话，支持 Git 变更查看。

**目标用户**：使用 AI CLI Agent（如 opencode、claude code）进行开发的程序员

## 2. 核心功能

### 2.1 左侧面板 - 多项目管理

| 功能 | 描述 |
|------|------|
| 多项目管理 | 支持同时打开多个项目 |
| 新增/移除 | 本地路径添加，不删除源文件 |
| 状态标识 | 🟢 空闲 / 🟡 运行中 / 🔴 失败 |
| Git 信息 | 分支、worktree 展示与基础操作 |
| 变更标记 | 显示有修改的文件 |

### 2.2 右侧面板 - 双视图

**视图切换逻辑**：
- 点击项目名 → 终端视图
- 点击修改文件 → Diff 视图

#### 终端视图

| 功能 | 描述 |
|------|------|
| 独立会话 | 每个项目绑定独立终端 |
| Agent 切换 | 每个项目可选不同 Agent |
| 会话持久化 | 重启后恢复历史和状态 |
| 多标签/分屏 | 支持多个终端实例 |
| 主题定制 | 终端颜色主题配置 |

#### Diff 视图

| 功能 | 描述 |
|------|------|
| 文件变更列表 | 显示所有 modified/staged/deleted 文件 |
| 并排 Diff | 左右对比显示修改内容 |
| 行号显示 | 显示变更行号 |
| 高亮标记 | 新增行绿色，删除行红色，修改行黄色 |
| 跳转导航 | 快速跳转到下一个变更块 |
| 返回终端 | 一键切换回终端视图 |

### 2.3 Agent 管理

| 功能 | 描述 |
|------|------|
| 预置 Agent | opencode、claude code |
| 可扩展 | 支持自定义 Agent |
| 独立选择 | 每个项目可选不同 Agent |
| 配置管理 | 命令、参数、环境变量 |

## 3. 技术架构

```
┌─────────────────────────────────────────────────┐
│                    Neeko App                    │
├────────────────────┬────────────────────────────┤
│                    │                            │
│   项目列表          │      右侧面板             │
│                    │      ┌─────────────┐       │
│  [+] 添加项目      │      │   视图切换   │       │
│                    │      │ Terminal/Diff│       │
│  🟢 my-app        │      └──────┬──────┘       │
│    ● main         │             │               │
│    📝 src/app.rs  │      ┌──────┴──────┐       │
│    📝 lib/utils.rs│      │             │       │
│                    │  Terminal View  Diff View  │
│  🟡 api-server    │  (xterm.js)   (自定义组件) │
│    ● main         │      │             │       │
│                    │      └─────────────┘       │
├────────────────────┴────────────────────────────┤
│              Tauri Backend (Rust)               │
│  - git2-rs (Git操作 + Diff)                    │
│  - portable-pty (终端)                          │
└─────────────────────────────────────────────────┘
```

## 4. 技术选型

| 层级 | 技术 |
|------|------|
| 框架 | Tauri 2.0 |
| 后端 | Rust |
| 前端 | React / Vue / Svelte |
| Git | git2-rs（含 diff 功能） |
| 终端后端 | portable-pty |
| 终端前端 | xterm.js |
| Diff 组件 | react-diff-viewer / 自定义 |
| 样式 | TailwindCSS |
| 持久化 | serde_json + 本地文件 |

## 5. 数据结构

```rust
struct AppState {
    projects: Vec<Project>,
    active_project_id: Option<String>,
    recent_projects: Vec<String>,
}

struct Project {
    id: String,
    name: String,
    path: PathBuf,
    git_info: Option<GitInfo>,
    terminal: TerminalSession,
    selected_agent: Option<String>,
    active_view: ViewMode,
}

enum ViewMode {
    Terminal,
    Diff { file_path: PathBuf },
}

struct GitInfo {
    current_branch: String,
    branches: Vec<String>,
    worktrees: Vec<Worktree>,
    changed_files: Vec<FileChange>,
}

struct FileChange {
    path: PathBuf,
    status: FileStatus,
    additions: usize,
    deletions: usize,
}

struct DiffResult {
    hunks: Vec<DiffHunk>,
}

struct DiffHunk {
    old_start: u32,
    old_lines: u32,
    new_start: u32,
    new_lines: u32,
    lines: Vec<DiffLine>,
}

enum DiffLine {
    Context(String),
    Added(String),
    Removed(String),
}

struct TerminalSession {
    id: String,
    pid: Option<u32>,
    status: TerminalStatus,
    history: Vec<String>,
    agent: Option<AgentConfig>,
}

enum TerminalStatus {
    Idle,      // 🟢
    Running,   // 🟡
    Failed,    // 🔴
}

struct AgentConfig {
    id: String,
    name: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
}

// 持久化会话
struct SessionStore {
    projects: Vec<ProjectSession>,
    active_project_id: Option<String>,
    last_updated: DateTime,
}
```

## 6. UI 布局

**点击项目 → 终端视图**
```
┌──────────────┬────────────────────────────────┐
│ [+] 添加项目 │                                │
├──────────────┼────────────────────────────────┤
│              │                                │
│ 🟢 my-app    │  ┌──────────────────────────┐  │
│   ● main     │  │ $ opencode src/main.rs   │  │
│   📝 src/    │  │ Analyzing code...        │  │
│   📝 test/   │  │ >                        │  │
│              │  └──────────────────────────┘  │
│ 🟡 api-server│                                │
│   ● main     │  Agent: [opencode ▼]          │
│   📝 lib/    │                                │
├──────────────┴────────────────────────────────┤
│ 🟢 my-app │ main │ opencode │ PID: 12345     │
└───────────────────────────────────────────────┘
```

**点击修改文件 → Diff 视图**
```
┌──────────────┬────────────────────────────────┐
│ [+] 添加项目 │  src/main.rs    12 处变更      │
├──────────────┼────────────────────────────────┤
│              │  ◀ ▶  跳转变更    [ESC] 终端   │
│ 🟢 my-app    ├────────────────┬───────────────┤
│   ● main     │  - 旧代码      │  + 新代码     │
│   📝 src/    │  10  fn main() │  10  fn main()│
│   📝 test/   │  11    let x=1 │  11    let x=2│
│              │  12    ...     │  12    let y=3│
│ 🟡 api-server│  13    run()   │  13    ...    │
│   ● main     │  14  }         │  14    run()  │
│   📝 lib/    │                │  15  }       │
├──────────────┴────────────────┴───────────────┤
│ 🟢 my-app │ main │ Viewing: src/main.rs       │
└───────────────────────────────────────────────┘
```

## 7. 交互流程

```
添加项目
    │
    ├─ 点击项目名 ──→ 进入终端视图
    │                     │
    │                     ├─ 运行 Agent → 🟡
    │                     ├─ 完成 → 🟢 / 🔴
    │                     │
    │                     └─ 点击变更文件 ──→ 进入 Diff 视图
    │
    └─ 点击变更文件 ──→ 进入 Diff 视图
                          │
                          ├─ 上/下一个变更块
                          └─ ESC → 返回终端视图
```

## 8. 开发计划

| 阶段 | 内容 | 预估时间 |
|------|------|----------|
| P1 | 项目初始化、基础 UI | 3天 |
| P2 | 多项目管理、状态标识 | 3天 |
| P3 | 终端集成 | 5天 |
| P4 | 项目-终端绑定、切换 | 3天 |
| P5 | Agent 管理 | 3天 |
| P6 | Git 变更检测、文件列表 | 3天 |
| P7 | Diff 视图实现 | 4天 |
| P8 | 视图切换逻辑 | 2天 |
| P9 | 会话持久化 | 3天 |
| P10 | 主题、快捷键、搜索 | 3天 |
| P11 | 测试 + 打包 | 3天 |

**总计：约 35 天**

## 9. 非功能需求

- **性能**：启动 < 2s，终端响应 < 50ms，Diff 渲染 < 200ms
- **跨平台**：macOS、Windows、Linux
- **内存**：空闲 < 100MB，每终端 < 50MB
- **配置**：`~/.neeko/` 目录存储
