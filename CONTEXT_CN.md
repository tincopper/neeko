# Neeko — 统一领域模型

> 生成日期：2026-05-20（会话：domain-model-grill）
> 最后更新：2026-05-26（领域模块重组）
> 共识来自 Rust 后端 + Tauri IPC + TypeScript 前端的跨层架构审查。

---

## 1. 三域分层

```
┌──────────────────────────────────────────────────────┐
│  前端域（React / TypeScript）                         │
│  src/types/ + src/store/ + src/components/           │
│  ── UI 状态、视图模型、瞬态选择                        │
├────────────────── Tauri IPC (JSON serde) ────────────┤
│  桥接层                                              │
│  ── 命令注册表、DTO 契约、事件通道                     │
├──────────────────────────────────────────────────────┤
│  后端域（Rust）                                       │
│  src-tauri/src/                                      │
│  ── 核心记录、持久化、业务逻辑                         │
└──────────────────────────────────────────────────────┘
```

各个域拥有独立的生命周期与约束规则。三者之间仅通过桥接层的 DTO 契约连接——不跨域共享类型。

---

## 2. 后端域（Rust）

### 2.0 领域模块结构

后端按领域组织为顶层模块，遵循「按域组织，不按类型组织」原则。每个领域模块内聚自身类型（`types.rs`）、业务逻辑（`mod.rs`）与 Tauri 命令（`commands.rs`）：

```
src-tauri/src/
├── project/             # 项目管理：ProjectManager + 类型 (Project, GitInfo...) + 命令
│   ├── mod.rs, types.rs, commands.rs, commands_ide.rs
├── terminal/            # 终端管理：TerminalManager + RemoteTerminalManager + 类型 + 命令
│   ├── mod.rs, remote.rs, types.rs, commands.rs
├── agent/               # Agent 配置：AgentManager + 类型 (AgentConfig) + 命令
│   ├── mod.rs, types.rs, commands.rs
├── git/                 # Git 操作：模块 + worker + 类型 (DiffResult) + 命令 (local/wsl/remote/unified)
│   ├── mod.rs, worker.rs, types.rs, commands.rs, ...
├── connection/          # 连接管理：WSL 发现 + SSH 连接测试 + 类型 (AuthMethod) + 命令
│   ├── mod.rs, types.rs, commands.rs
├── task/                # Task Runner：TaskConfig + 命令
│   ├── mod.rs, commands.rs
├── browser/             # 内嵌浏览器：uri_scheme + webview 命令
│   ├── mod.rs, uri_scheme.rs, commands.rs
├── workspace/           # 应用持久化 + 基础设施：StorageManager + WatcherManager + 类型 + 命令
│   ├── mod.rs, session.rs, watcher.rs, types.rs, commands.rs, ...
├── skill/               # Skill 管理（不变）
├── theme/               # 主题管理（不变）
├── commands/            # 兼容层：聚集所有域命令函数的 re-export
│   └── mod.rs
├── models/              # 兼容层：聚集所有域类型的 re-export
│   └── mod.rs
└── lib.rs               # 模块声明 + neeko_invoke_handler! 宏
```

> `commands/mod.rs` 和 `models/mod.rs` 为向后兼容层，聚集所有域的命令函数和类型，使 `neeko_invoke_handler!` 宏中 `$crate::commands::*` 路径保持可用。

### 2.1 项目（Project）

```rust
// project/types.rs
pub struct Project {                          // 内存对象，由 ProjectManager 管理
    pub id: String,                           // UUID v4
    pub name: String,                         // 从路径文件名推导
    pub path: PathBuf,
    pub git_info: Option<GitInfo>,
    pub terminal: TerminalSession,            // add_project 时创建，1:1 关系
    pub selected_agent: Option<String>,
    pub selected_ide: Option<String>,
    pub active_view: ViewMode,                // Terminal | Diff { file_path }
    pub collapsed: bool,
    pub avatar_color: Option<String>,
}

// workspace/types.rs — 持久化投影（无 git_info、无 active_view）
pub struct ProjectSession {
    pub id: String, pub name: String, pub path: PathBuf,
    pub selected_agent: Option<String>, pub selected_ide: Option<String>,
    pub terminal_history: Vec<String>,        // 仅文本，不含 PID
    pub last_status: TerminalStatus,
    pub collapsed: bool, pub avatar_color: Option<String>,
}

pub struct WSLProjectSession {
    pub id: String, pub name: String, pub path: String,  // Linux 路径
    pub distro: String, pub entry_id: String,
    pub selected_agent: Option<String>, pub selected_ide: Option<String>,
    pub avatar_color: Option<String>,
    // 无 terminal 数据 — WSL 终端是临时的，1:N 通过 Tab 管理
}

pub struct RemoteProjectSession {
    pub id: String, pub name: String, pub path: String,  // 远端路径
    pub entry_id: String,
    pub selected_agent: Option<String>, pub selected_ide: Option<String>,
    pub avatar_color: Option<String>,
    // 无 terminal 数据 — 远程终端是临时的，1:N 通过 Tab 管理
}

pub struct WSLEntrySession {
    pub id: String, pub distro: String, pub projects: Vec<WSLProjectSession>,
}

pub struct RemoteEntrySession {
    pub id: String, pub host: String, pub port: u16,
    pub username: String, pub projects: Vec<RemoteProjectSession>,
    pub saved_auth: Option<String>,
}

pub struct SessionStore {
    pub projects: Vec<ProjectSession>,
    pub wsl_entries: Vec<WSLEntrySession>,
    pub remote_entries: Vec<RemoteEntrySession>,
    pub active_project_id: Option<String>,
    pub active_wsl_key: Option<WslKey>,
    pub active_remote_key: Option<RemoteKey>,
    pub window_state: Option<WindowState>,
}
```

### 2.2 终端（Terminal）

```rust
// terminal/types.rs
pub struct TerminalSession {
    pub id: String,
    pub pid: Option<u32>,                     // 远程始终为 None（SSH 无本地 PID）
    pub status: TerminalStatus,               // Idle | Running | Failed
    pub history: Vec<String>,
    pub agent: Option<AgentConfig>,
}
// 不嵌入 WSL/Remote 项目结构体。
// 由 TerminalManager（本地+WSL）或 RemoteTerminalManager（SSH）管理。
```

### 2.3 技能（Skill）

```rust
// skill/types.rs
pub struct SkillRecord {                      // SQLite 行
    pub id: String, pub name: String, pub description: Option<String>,
    pub source_type: String,                  // "local" | "git" | "skillssh"
    pub source_ref: Option<String>,
    pub source_ref_resolved: Option<String>,
    pub source_subpath: Option<String>,
    pub source_branch: Option<String>,
    pub source_revision: Option<String>, pub remote_revision: Option<String>,
    pub central_path: String,                 // ~/.neeko/skills/<name>/
    pub content_hash: Option<String>,
    pub enabled: bool, pub status: String,    // "ok" | ...
    pub update_status: String,                // "unknown" | "up_to_date" | ...
    pub last_checked_at: Option<i64>,
    pub last_check_error: Option<String>,
    pub created_at: i64, pub updated_at: i64,
}

pub struct TagGroupRecord {
    pub id: String, pub name: String,
    pub description: Option<String>, pub icon: Option<String>,
    pub sort_order: i32, pub created_at: i64, pub updated_at: i64,
}

pub struct ToolToggleRecord {
    pub tag_group_id: String, pub skill_id: String,
    pub tool: String, pub enabled: bool, pub updated_at: i64,
}

pub struct SkillTargetRecord {
    pub id: String, pub skill_id: String, pub tool: String,
    pub target_path: String, pub mode: String,  // "symlink" | "copy"
    pub status: String, pub synced_at: Option<i64>, pub last_error: Option<String>,
}
```

### 2.4 实体关系

```
┌───────────────────┐     多对多            ┌──────────────┐
│   ManagedSkill    │ ◄──────────────────► │   TagGroup   │
│  (SkillRecord)    │  tag_group_skills     │              │
└────────┬──────────┘                       └──────┬───────┘
         │ 1:N                                    │ 1:N
         ▼                                        ▼
┌───────────────────┐                    ┌──────────────┐
│   SkillTarget     │                    │  ToolToggle  │
│  (部署记录)       │                    │  (工具开关)  │
└───────────────────┘                    └──────────────┘
```

---

## 3. 桥接 / IPC 层

### 3.1 命令注册表

Tauri 命令分散在各领域模块的 `commands.rs` 中，由 `lib.rs` 中的 `neeko_invoke_handler!()` 宏以平坦列表聚合注册。

命令函数本身按域归属：

| 域 | 命令文件 | 示例 |
|---|---------|------|
| `project/commands.rs` | 项目管理 + 本地 Git 操作 | `add_project`, `checkout_branch` |
| `project/commands_ide.rs` | IDE 启动 | `open_ide`, `open_wsl_ide` |
| `terminal/commands.rs` | 终端会话 (本地/WSL/远程) | `create_terminal_session`, `create_wsl_terminal_session` |
| `agent/commands.rs` | Agent 管理 | `list_agents`, `add_agent` |
| `git/commands.rs` + `commands_wsl.rs` + `commands_remote.rs` + `commands_unified.rs` | Git 操作 | `commit_command`, `wsl_push`, `remote_fetch` |
| `connection/commands.rs` | WSL 发现 + SSH 测试 | `get_wsl_distros`, `test_remote_connection` |
| `task/commands.rs` | Task Runner | `run_task`, `stop_task` |
| `browser/commands.rs` | 内嵌浏览器 | `browser_navigate`, `create_browser_webview` |
| `workspace/commands.rs` + 子文件 | 持久化 + 文件 + 颜色设置 | `save_session`, `read_file_content`, `wsl_set_project_color` |
| `skill/commands.rs` | Skill 管理 | `get_managed_skills`, `install_local_skill` |

`commands/mod.rs` 为兼容层，通过 `pub use crate::*::commands::*;` 聚集所有命令函数，使 `neeko_invoke_handler!` 的 `$crate::commands::*` 路径保持可用。

命名规范：`动词-名词`（而非 `动词_名词_从_名词`）。例如：`install_local_skill` ✅，~~`install_skill_from_local`~~ ❌

### 3.2 DTO 契约对齐

| Rust DTO | TS 接口 | 对齐状态 |
|----------|---------|----------|
| `Project` | `Project` (project.ts) | 1:1 ✅ |
| `ManagedSkillDtoOut` | `ManagedSkillDto` (skill.ts) | 1:1 ✅ |
| `TagGroupDtoOut` | `TagGroup` (skill.ts) | 1:1 ✅ |
| `TerminalSession` | 内联于 `Project.terminal` | 1:1 ✅ |
| `GitInfo` + 子类型 | `GitInfo` 等 (git.ts) | 1:1 ✅ |
| `SkillTargetRecord` | `SkillTargetRecord` (skill.ts) | 1:1 ✅ |
| `DiscoveredSkillDto` | `DiscoveredSkillDto` (skill.ts) | 1:1 ✅ |
| `AuthMethod` | `AuthMethod` (connection.ts) | 1:1 ✅ — `connection/types.rs` |
| — | `WSLProject` (connection.ts) | 仅 TS（来自 session） |
| — | `RemoteProject` (connection.ts) | 仅 TS（来自 session） |

### 3.3 事件契约

| 事件 | 方向 | 载荷 | 用途 |
|------|------|------|------|
| `terminal-output-{id}` | Rust → 前端 | `string` (base64) | PTY/SSH 输出 |
| `terminal-input-{id}` | 前端 → Rust | `string` (base64) | 用户输入 |
| `install-progress` | Rust → 前端 | `{ skill_id, phase, error? }` | 市场安装进度 |

---

## 4. 前端域（TypeScript / React）

### 4.1 项目（三态联合——前端表示）

```typescript
// src/types/project.ts + src/types/connection.ts
// 本地项目 — 与 Rust Project 结构体 1:1，含内嵌终端
interface Project {
  id: string; name: string; path: string;
  git_info: GitInfo | null;
  terminal: {
    id: string; pid: number | null;
    status: "Idle" | "Running" | "Failed";
    history: string[]; agent: AgentConfig | null;
  };
  selected_agent: string | null; selected_ide: string | null;
  active_view: "Terminal" | { Diff: { file_path: string } };
  collapsed: boolean; avatar_color?: string | null;
}

// WSL 项目 — 仅前端，从 session 数据 + 懒加载 git 构建
interface WSLProject {
  id: string; name: string; path: string;
  distro: string; entry_id: string;
  selected_agent: string | null; selected_ide: string | null;
  git_info?: GitInfo | null;
  avatar_color?: string | null;
  // 无 terminal — 通过 wslTerminalCache 管理（1:N，Tab 范围）
}

// 远程项目 — 仅前端，从 session 数据 + 懒加载 git 构建
interface RemoteProject {
  id: string; name: string; path: string;
  entry_id: string;
  selected_agent: string | null; selected_ide: string | null;
  git_info?: GitInfo | null;
  avatar_color?: string | null;
  // 无 terminal — 通过 remoteTerminalCache 管理（1:N，Tab 范围）
}
```

### 4.2 标签页 / 编辑器

```typescript
// src/types/tab.ts
interface TabGroup {
  tabKey: string;                    // "{projectId}" 或 "{projectId}:{worktreePath}"
  projectRef: { type: "local"|"wsl"|"remote"; id: string };
  tabs: Tab[];
  activeTabId: string | null;
}

interface Tab {
  id: string; title: string; order: number;
  data: TabData;
}

type TabData =
  | { kind: "terminal"; agentId: string | null; status: string }
  | { kind: "file";      filePath: string; language?: string }
  | { kind: "gitLog" }
  | { kind: "diff";      filePath: string; leftRef?: string; rightRef?: string }
  | { kind: "agent";     agentId: string; conversationId?: string }
  | { kind: "worktree" };
```

### 4.3 技能

```typescript
// src/types/skill.ts
interface ManagedSkillDto {
  id: string; name: string; description: string | null;
  source_type: string; source_ref: string | null;
  central_path: string;
  enabled: boolean; status: string; update_status: string;
  tags: string[];
  created_at: number; updated_at: number;
}

interface TagGroup {
  id: string; name: string;
  description: string | null; icon: string | null;
  sort_order: number; skill_count: number;
}

interface SkillTargetRecord {
  id: string; skill_id: string; tool: string;
  target_path: string; mode: "symlink" | "copy";
  status: string; synced_at: number | null;
}

interface DiscoveredSkillDto {
  id: string; tool: string; found_path: string; name_guess: string | null;
}
```

### 4.4 状态仓库架构

```
appStore（Zustand + localStorage 持久化）
  ├── projects: Project[]              // 本地项目（来自 IPC）
  ├── activeProject: Project | null
  ├── wslEntries: WSLEntrySession[]    // WSL（来自 session.json）
  ├── activeWslProject: { distro, project } | null
  ├── remoteEntries: RemoteEntrySession[]
  ├── activeRemoteProject: { entry, project } | null
  ├── tabs: Record<string, TabGroup>   // 标签页管理
  └── leftPanelWidth: number

skillStore（Zustand，不持久化）
  ├── skills: ManagedSkillDto[]
  ├── tagGroups: TagGroup[]
  ├── loading: boolean
  ├── activeSkillView: SkillView       // "local" | "marketplace" | "project"
  └── searchQuery / selectedSkillId / activeTagGroupId

dockStore（Zustand + localStorage 持久化）
  ├── zones: Record<string, DockZoneState>
  ├── barItems: DockBarItem[]
  ├── rightPanelSizes: Record<string, number>
  └── leftPanelSize: number

appViewStore（Zustand）
  └── appView: "default" | "settings"
```

---

## 5. 跨域数据流

### 5.1 本地项目——完整生命周期

```
前端                          桥接层                      后端
───                          ─────                       ────
invoke("add_project",        add_project                 ProjectManager::add_project()
  { path, agent_id?, ide? })     │                          │
      │                          │                     创建 Project {
      │                          │                         id, name, path,
      │                          │                         terminal: TerminalSession,
      │                          │                         git_info, ...
      ▼                          ▼                     }
Project (TS) ◄─────── JSON 序列化 ──────── Project (Rust)
      │
      │
appStore.activeProject = project
      │
  ┌───┴─────────────────────────────────┐
  │    TabGroup (tabs[tabKey])          │
  │      └── Tab.kind === "terminal"    │
  │            └── TerminalView         │
  │                  └── terminalCache  │
  │                        └── TerminalSession (按 sessionId)
  └────────────────────────────────────┘
```

### 5.2 WSL/远程项目——终端生命周期

```
前端                          桥接层                      后端
───                          ─────                       ────
用户点击终端标签页
      │
Tab.kind === "terminal"
      │
WSLTerminalView / RemoteTerminalView
      │
invoke("create_wsl_terminal_session",   create_wsl_terminal_session
  { distro, projectPath })                     │
                                         TerminalManager::create_wsl_session()
      │                                         │
      ▼                                     spawn wsl.exe in PTY
TerminalSession ◄─────── JSON 序列化 ──────── pid, status, sessionId
      │
wslTerminalCache.set(key, { term, sessionId })
TerminalSession 不存储在 WSLProject 上——仅由缓存管理。
缓存键： "wsl:{distro}:{projectId}:{tabId}:{pane}"
```

---

## 6. 关键架构决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 三域分层（不共享类型） | 各域有独立生命周期，IPC DTO 是唯一契约 |
| 2 | Project 三态联合，不统一为单一结构体 | 本地有 terminal/activeView/collapsed；WSL/Remote 无。强行统一会泄漏不同语义 |
| 3 | 终端不嵌入 WSL/Remote 项目 | WSL/Remote 终端是 1:N（多标签页、多面板）、临时、按需创建。本地终端是 1:1。两种模式都合理——模型反映现实 |
| 4 | TabGroup 作为终端范围容器 | 所有项目类型（本地、WSL、远程）共享同一个 TabGroup 模型。终端视图按项目类型在内部区分 |
| 5 | Dock 布局存入 localStorage（而非 session.json） | Dock 布局是 UI 状态，不是领域数据。各自的持久化生命周期相互独立 |
| 6 | IPC 命令使用 `动词-名词` 命名 | 所有 50+ 命令采用单一规范。Rust 命令名是事实源 |
| 7 | skillStore 初始状态 `loading: true` | 防止 SkillContent 挂载后、`refreshSkills()` 完成前出现空白内容闪烁 |
| 8 | SkillContent 始终挂载，通过 CSS hidden 切换 | 消除 mount/unmount 间隔，该间隔在 ResizablePanel 布局重算时引发了黑闪问题 |
