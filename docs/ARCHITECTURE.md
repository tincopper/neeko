# Neeko — Architecture Reference

> Generated: 2026-06-01 (session: architecture-refactor)
> Full architecture reference: module layout, type definitions, IPC contracts, data flows, and design decisions.
> For domain terminology, see [`CONTEXT.md`](../CONTEXT.md).

---

## 1. Three-Domain Layering

```
┌──────────────────────────────────────────────────────┐
│  Frontend Domain (React / TypeScript)                │
│  src/shared/ + src/features/ + src/app/              │
│  ── UI state, view models, transient selection       │
├────────────────── Tauri IPC (JSON serde) ────────────┤
│  Bridge Layer                                        │
│  ── Command registry, DTO schemas, event channels    │
├──────────────────────────────────────────────────────┤
│  Backend Domain (Rust)                               │
│  src-tauri/src/                                      │
│  ── Core records, persistence, business logic        │
└──────────────────────────────────────────────────────┘
```

Each domain has independent lifecycle and constraints. The three are connected only through the Bridge Layer's thin DTO contracts — no shared types across domains.

---

## 2. Backend Domain (Rust)

### 2.1 Module Layout

```
src-tauri/src/
├── main.rs                  # Tauri app entry
├── lib.rs                   # Module declarations + neeko_invoke_handler! macro
├── app.rs                   # Tauri Builder assembly (run())
├── app_state.rs             # AppStateWrapper — manager composition root
│
├── common/                  # 🔧 Infrastructure layer (no Tauri commands)
│   ├── mod.rs               # Module declarations
│   ├── types.rs             # Shared types (FileNode, GitInfo, CommitEntry…)
│   ├── error.rs             # AppError enum + conversions
│   ├── logger.rs            # Custom log::Log → ~/.neeko/neeko.log
│   ├── db.rs                # SQLite connection management
│   ├── git/                 # Git operations (operations, transport, parsers…)
│   ├── agent/               # LLM/Agent calling (types, services/commit)
│   ├── terminal/            # PTY emulation (types, remote)
│   ├── connection/          # SSH/WSL transport layer (types, model)
│   ├── file/                # File system operations + watcher
│   └── utils/               # Utility modules (command exec, fonts, path…)
│
├── project/                 # Business domain: project management
│   ├── mod.rs               # ProjectManager + type exports
│   ├── commands.rs          # Tauri command glue
│   ├── commands_ide.rs      # IDE launch commands
│   ├── types.rs             # Project, ViewMode (re-exports common::types)
│   └── context.rs           # ProjectActions React context
├── session/                 # Business domain: session persistence
├── skill/                   # Business domain: skill management (14 files)
├── theme/                   # Business domain: theme management
├── settings/                # Business domain: settings commands
├── task/                    # Business domain: task runner
├── browser/                 # Business domain: embedded webview
│
├── git/                     # [glue] Git commands only (delegates to common/git/)
├── agent/                   # [glue] Agent commands + manager
├── terminal/                # [glue] Terminal commands + TerminalManager + services
├── connection/              # [glue] Connection commands + services
├── file/                    # [glue] File commands only
│
├── core/                    # [reserved] Cross-domain orchestration (empty)
```

### 2.2 Core Models

#### Project

```rust
// models/project.rs
pub enum FileStatus { Modified, Added, Deleted, Renamed, Untracked }

pub struct FileChange {
    pub path: PathBuf,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
}

pub struct GitInfo {
    pub current_branch: String,
    pub branches: Vec<String>,
    pub worktrees: Vec<Worktree>,
    pub changed_files: Vec<FileChange>,
    pub is_clean: bool,
}

pub struct Worktree {
    pub path: PathBuf,
    pub branch: String,
    pub head: String,
}

pub struct GitBranchInfo {
    pub current_branch: String,
    pub branches: Vec<String>,
    pub worktrees: Vec<Worktree>,
}

pub enum ViewMode { Terminal, Diff { file_path: PathBuf } }

pub struct Project {
    pub id: String,                     // UUID v4
    pub name: String,                   // Derived from path
    pub path: PathBuf,
    pub git_info: Option<GitInfo>,
    pub terminal: TerminalSession,
    pub selected_agent: Option<String>,
    pub selected_ide: Option<String>,
    pub active_view: ViewMode,
    pub collapsed: bool,
    pub avatar_color: Option<String>,
}

pub struct FileNode {
    pub name: String, pub path: String,
    pub is_dir: bool, pub children: Vec<FileNode>,
}

pub struct FileContent {
    pub path: String, pub content: String,
    pub size: u64, pub is_binary: bool,
}

pub struct CommitEntry {
    pub hash: String, pub short_hash: String,
    pub author: String, pub timestamp: String,
    pub message: String, pub refs: String,
    pub parents: Vec<String>,
}

pub struct CommitDetail {
    pub hash: String, pub short_hash: String,
    pub author: String, pub email: String,
    pub timestamp: String, pub message: String,
    pub parents: Vec<String>, pub refs: String,
}

pub struct CommitFileChange {
    pub path: String, pub status: String,
    pub additions: usize, pub deletions: usize,
}

pub struct CommitResult { pub success: bool, pub hash: String, pub message: String }

pub struct AheadBehind { pub ahead: usize, pub behind: usize }
```

Note: `Project` is defined in `project/types.rs` (business domain). Supporting types (`FileStatus`, `FileChange`, `GitInfo`, `Worktree`, `ViewMode`, `GitBranchInfo`, `FileDiffStats`) are defined in `common/git/types.rs` and `common/types.rs` (infrastructure layer).`

#### Session

```rust
// models/session.rs
pub struct ProjectSession {
    pub id: String, pub name: String, pub path: PathBuf,
    pub selected_agent: Option<String>, pub selected_ide: Option<String>,
    pub terminal_history: Vec<String>,
    pub last_status: TerminalStatus,
    pub collapsed: bool, pub avatar_color: Option<String>,
}

pub struct WSLEntrySession {
    pub id: String, pub distro: String,
    pub projects: Vec<WSLProjectSession>,
}

pub struct WSLProjectSession {
    pub id: String, pub name: String, pub path: String,
    pub distro: String, pub entry_id: String,
    pub selected_agent: Option<String>, pub selected_ide: Option<String>,
    pub avatar_color: Option<String>,
}

pub struct RemoteEntrySession {
    pub id: String, pub host: String, pub port: u16,
    pub username: String, pub projects: Vec<RemoteProjectSession>,
    pub saved_auth: Option<String>,
}

pub struct RemoteProjectSession {
    pub id: String, pub name: String, pub path: String,
    pub entry_id: String,
    pub selected_agent: Option<String>, pub selected_ide: Option<String>,
    pub avatar_color: Option<String>,
}

pub struct SessionStore {
    pub projects: Vec<ProjectSession>,
    pub active_project_id: Option<String>,
    pub last_updated: String,
    pub wsl_entries: Vec<WSLEntrySession>,
    pub remote_entries: Vec<RemoteEntrySession>,
    pub sidebar_width: Option<u32>,
    pub worktree_state: HashMap<String, String>,
}
```

#### Terminal

```rust
// models/terminal.rs
pub enum TerminalStatus { Idle, Running, Failed }

pub struct TerminalSession {
    pub id: String,
    pub pid: Option<u32>,               // Remote is always None (SSH)
    pub status: TerminalStatus,
    pub history: Vec<String>,
    pub agent: Option<AgentConfig>,
}
```

#### Auth

```rust
// models/auth.rs
pub enum AuthMethod {
    Password(String),
    KeyFile(String),
    KeyFileWithPassphrase { key_path: String, passphrase: String },
}
```

#### Diff

```rust
// models/diff.rs
pub enum DiffLine {
    Context(String), Added(String), Removed(String), Collapsed(String),
}

pub struct DiffHunk {
    pub old_start: u32, pub old_lines: u32,
    pub new_start: u32, pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

pub struct DiffResult {
    pub hunks: Vec<DiffHunk>,
    pub truncated: bool,
}
```

#### Agent

```rust
// models/agent.rs
pub struct AgentConfig {
    pub id: String, pub name: String, pub command: String,
    pub args: Vec<String>, pub env: HashMap<String, String>,
    pub icon: Option<String>, pub enabled: bool,
    pub prompt_args: Option<Vec<String>>,
    pub post_prompt_args: Option<Vec<String>>,
    pub is_builtin: bool,
    pub default_skill_path: Option<String>,
}
```

### 2.3 Skill

```rust
// skill/types.rs
pub struct SkillRecord {                // SQLite row
    pub id: String, pub name: String, pub description: Option<String>,
    pub source_type: String,            // "local" | "git" | "skillssh"
    pub source_ref: Option<String>,
    pub source_ref_resolved: Option<String>,
    pub source_subpath: Option<String>,
    pub source_branch: Option<String>,
    pub source_revision: Option<String>, pub remote_revision: Option<String>,
    pub central_path: String,           // ~/.neeko/skills/<name>/
    pub content_hash: Option<String>,
    pub enabled: bool, pub status: String,
    pub update_status: String,
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
    pub target_path: String, pub mode: String,    // "symlink" | "copy"
    pub status: String, pub synced_at: Option<i64>, pub last_error: Option<String>,
}

pub struct SkillMetadata {
    pub name: Option<String>,
    pub description: Option<String>,
}

pub struct ManagedSkillDto {
    pub id: String, pub name: String, pub description: Option<String>,
    pub source_type: String, pub source_ref: Option<String>,
    pub central_path: String,
    pub enabled: bool, pub status: String, pub update_status: String,
    pub tags: Vec<String>,
    pub created_at: i64, pub updated_at: i64,
}

pub struct TagGroupDto {
    pub id: String, pub name: String,
    pub description: Option<String>, pub icon: Option<String>,
    pub sort_order: i32, pub skill_count: i64,
    pub created_at: i64, pub updated_at: i64,
}

pub struct SkillDocumentDto { pub content: String }

pub enum UpdateStatus { UpToDate, UpdateAvailable { remote_revision: String }, Unsupported, Unknown }
```

### 2.4 Entity Relationships

```
                    many-to-many
┌───────────────┐  tag_group_skills  ┌──────────────┐
│  SkillRecord  │ ◄────────────────► │  TagGroup    │
│               │                    │  (TagGroup)  │
└───────┬───────┘                    └──────┬───────┘
        │ 1:N                              │ 1:N
        ▼                                   ▼
┌───────────────┐                   ┌──────────────┐
│  SkillTarget  │                   │  ToolToggle  │
│  (deploy)     │                   │  (per-tool)  │
└───────────────┘                   └──────────────┘
```

## 3. Bridge / IPC Layer

### 3.1 Command Registry

Single source of truth: `src-tauri/src/lib.rs` → `neeko_invoke_handler!()` macro (defined inline).

~200 commands organized into domains:

| Domain | Prefix | Count | Examples |
|--------|--------|-------|---------|
| Core | `add_project`, `remove_project`, ... | ~20 | `greet`, `list_projects`, `save_session`, `load_config`, `read_dir_tree` |
| Git | `stage_files`, `fetch`, `push`, `checkout_branch`, ... | ~40 | Implemented in `common/git/`, commands in `git/commands.rs` |
| Terminal | `create_terminal_session`, `resize_terminal`, ... | 7 | PTY logic in `common/terminal/`, manager in `terminal/services.rs` |
| Agent | `list_agents`, `get_agent`, `check_agents_installed`, ... | 6 | Manager in `agent/manager.rs`, LLM calls in `common/agent/` |
| Connection | `get_wsl_distros`, `test_remote_connection`, ... | 5 | SSH/WSL transport in `common/connection/` |
| File | `reveal_in_file_manager` | 1 | Watcher + file ops in `common/file/` |
| Task Runner | `get_task_configs`, `run_task`, `stop_task`, ... | 5 | Task state machine in `task/services.rs` |
| Browser | `create_browser_webview`, `browser_navigate`, ... | ~10 | URI scheme handling in `browser/uri_scheme.rs` |
| Skill | `get_managed_skills`, `install_local_skill`, ... | ~35 | Full domain in `skill/`, no common/ split needed |

Naming convention: `verb-noun` (e.g. `install_local_skill`).

### 3.2 DTO Schema Alignment

| Rust DTO | TS Interface | File | Alignment |
|----------|-------------|------|-----------|
| `Project` | `Project` | `shared/types/project.ts` | 1:1 ✅ |
| `ManagedSkillDto` | `ManagedSkillDto` | `shared/types/skill.ts` | 1:1 ✅ |
| `TagGroupDto` | `TagGroup` | `shared/types/skill.ts` | 1:1 ✅ |
| `TerminalSession` | inline in `Project.terminal` | `shared/types/project.ts` | 1:1 ✅ |
| `GitInfo` | `GitInfo` | `shared/types/git.ts` | 1:1 ✅ |
| `FileChange` | `FileChange` | `shared/types/git.ts` | 1:1 ✅ |
| `Worktree` | `Worktree` | `shared/types/git.ts` | 1:1 ✅ |
| `DiffResult` | `DiffResult` | `shared/types/git.ts` | 1:1 ✅ |
| `SkillTargetRecord` | `SkillTargetRecord` | `shared/types/skill.ts` | 1:1 ✅ |
| `SkillDocumentDto` | — (fetched as string) | — | ✅ |
| `DiscoveredSkillDto` | `DiscoveredSkillDto` | `shared/types/skill.ts` | 1:1 ✅ |
| `TaskConfig` | `TaskConfig` | `shared/types/task.ts` | 1:1 ✅ |
| `AuthMethod` | `AuthMethod` | `shared/types/connection.ts` | 1:1 ✅ |
| — | `WSLProject` | `shared/types/connection.ts` | TS-only (from session) |
| — | `RemoteProject` | `shared/types/connection.ts` | TS-only (from session) |
| — | `ProjectData` | `shared/types/project.ts` | TS-only (adapter for cross-type operations) |
| — | `ActiveProjectAdapter` | `shared/types/adapter.ts` | TS-only (discriminated union) |
| — | `ProjectCommands` | `shared/types/activeProject.ts` | TS-only (command interface) |

### 3.3 Event Schema

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `terminal-output-{id}` | Rust → Frontend | `string` (base64) | PTY/SSH stdout |
| `terminal-input-{id}` | Frontend → Rust | `string` (base64) | User input |
| `install-progress` | Rust → Frontend | `{ skill_id, phase, error? }` | Marketplace install progress |
| `file-changed` | Rust → Frontend | `{ project_id, paths: string[] }` | Watcher detected file content changes |
| `file-tree-changed` | Rust → Frontend | `{ project_id }` | Watcher detected file add/delete/rename |
| `git-status-diff` | Rust → Frontend | `{ project_id, added: GitStatusFile[], removed: string[], modified: GitStatusFile[] }` | Incremental git status update |

---

## 4. Frontend Domain (TypeScript / React)

### 4.1 Project Types (tri-state + unified)

```typescript
// src/shared/types/project.ts — Local project, 1:1 with Rust Project struct
interface Project {
  id: string; name: string; path: string;
  git_info: GitInfo | null;
  terminal: { id: string; pid: number | null;
    status: "Idle" | "Running" | "Failed";
    history: string[]; agent: AgentConfig | null; };
  selected_agent: string | null; selected_ide: string | null;
  active_view: "Terminal" | { Diff: { file_path: string } };
  collapsed: boolean; avatar_color?: string | null;
}

// src/shared/types/project.ts — Cross-type project view (local/wsl/remote)
interface ProjectData {
  type: ProjectType;      // "local" | "wsl" | "remote"
  id: string; name: string; path: string;
  gitInfo?: GitInfo | null;
  selectedAgent?: string | null; selectedIde?: string | null;
  activeView: "Terminal" | { Diff: { file_path: string } };
  collapsed: boolean;
}

// src/shared/types/connection.ts — WSL project (TS-only, from session data)
interface WSLProject {
  id: string; name: string; path: string;
  distro: string; entry_id: string;
  selected_agent: string | null; selected_ide: string | null;
  git_info?: GitInfo | null; avatar_color?: string | null;
}

// src/shared/types/connection.ts — Remote project (TS-only, from session data)
interface RemoteProject {
  id: string; name: string; path: string;
  entry_id: string;
  selected_agent: string | null; selected_ide: string | null;
  git_info?: GitInfo | null; avatar_color?: string | null;
}

// src/shared/types/adapter.ts — Discriminated union for active project
type ActiveProjectAdapter =
  | { type: "local"; project: ProjectData }
  | { type: "wsl"; distro: string; project: ProjectData }
  | { type: "remote"; entry: RemoteEntrySession; project: ProjectData };

// src/shared/types/activeProject.ts — ProjectCommands interface (24 methods)
interface ProjectCommands {
  refreshGitInfo(): Promise<GitInfo>;
  stageFiles(filePaths: string[]): Promise<void>;
  unstageFiles(filePaths: string[]): Promise<void>;
  discardFile(filePath: string): Promise<void>;
  commitFiles(filePaths: string[], message: string): Promise<CommitResult>;
  fetch(): Promise<void>; pull(): Promise<void>; push(setUpstream?: boolean): Promise<void>;
  checkoutBranch(branchName: string): Promise<void>;
  createBranch(branchName: string, startPoint?: string): Promise<void>;
  deleteBranch(branchName: string): Promise<void>;
  getCommitLog(count: number, skip?: number): Promise<CommitEntry[]>;
  getCommitDetail(commitHash: string): Promise<CommitDetail>;
  getCommitFiles(commitHash: string): Promise<CommitFileChange[]>;
  getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult>;
  cherryPick(commitHash: string): Promise<void>;
  revert(commitHash: string): Promise<void>;
  createTag(tagName: string, message?: string): Promise<void>;
  readDirTree(rootPath?: string, subPath?: string, maxDepth?: number): Promise<FileNode[]>;
  readFileContent(filePath: string, rootPath?: string): Promise<FileContent>;
  writeFileContent(filePath: string, content: string, rootPath?: string): Promise<void>;
  generateCommitMessage(agentId: string, filePaths: string[], ...): Promise<string>;
}
```

### 4.2 Tab / Editor

```typescript
// src/shared/types/tab.ts
type TabKind = "terminal" | "file" | "diff" | "gitLog" | "html-preview";

interface TerminalTabData {
  kind: "terminal"; agentId: string | null;
  status: "Idle" | "Running" | "Failed";
  taskCommand?: string;     // Task Runner: spawn this command directly
  taskConfigId?: string;    // Task Runner: config ID for lifecycle tracking
  rebuildKey?: number;      // Incremented on task tab reuse for clean slate
}

interface FileTabData {
  kind: "file"; filePath: string; fileName: string;
  content: FileContent; isDirty: boolean;
  externallyModified?: boolean;     // Watcher detected external change
}

interface DiffTabData {
  kind: "diff"; filePath: string; fileName: string;
  diffSource: DiffSource; initialMode?: ViewMode;
}

interface GitLogTabData { kind: "gitLog"; }

interface HtmlPreviewTabData {
  kind: "html-preview"; filePath: string; fileName: string;
}

type TabData = TerminalTabData | FileTabData | DiffTabData
             | GitLogTabData | HtmlPreviewTabData;

interface Tab { id: string; projectId: string; title: string;
  order: number; data: TabData; }
```

### 4.3 Skill

```typescript
// src/shared/types/skill.ts
interface ManagedSkillDto {
  id: string; name: string; description: string | null;
  source_type: string; source_ref: string | null;
  central_path: string;
  enabled: boolean; status: string; update_status: string;
  tags: string[]; created_at: number; updated_at: number;
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

type SkillView = "local" | "marketplace" | "project";  // in app.ts
```

### 4.4 Store Architecture

```
projectStore (Zustand + persist: localStorage)
  ├── projects: Project[]                   // Local projects
  ├── activeProjectId: string | null
  ├── activeProject: Project | null
  ├── activeWorktreePath / activeWorktreeBranch
  ├── openedWorktrees: WorktreeSnapshotItem[]
  ├── worktreeStateMap: Record<string, WorktreeState>
  └── leftPanelWidth: number

connectionStore (Zustand)
  ├── wslEntries: WSLEntrySession[]
  ├── activeWslKey / activeWslProject
  ├── remoteEntries: RemoteEntrySession[]
  ├── activeRemoteKey / activeRemoteProject
  ├── remoteAuthStore: Map<string, AuthMethod>
  └── pendingAuthEntry: RemoteEntrySession | null

editorStore (Zustand) — in shared/store/editorStore.ts
  ├── tabs: Record<string, ProjectTabs>     // Tab management (all project types)
  ├── activeTabId: string | null
  └── editorLayout: Record<string, EditorSplitLayout>

skillStore (Zustand, no persist)
  ├── skills: ManagedSkillDto[]
  ├── tagGroups: TagGroup[]
  ├── loading: boolean (initial: true — prevents flash)
  ├── activeSkillView: SkillView
  └── searchQuery / selectedSkillId / activeTagGroupId

dockStore (Zustand + persist: localStorage)
  ├── zones: Record<string, DockZoneState>
  ├── barItems: DockBarItem[]
  ├── rightPanelSizes: Record<string, number>
  └── leftPanelSize: number

appViewStore (Zustand)
  └── appView: "normal" | "skills" | "settings"

browserStore (Zustand, no persist)
  ├── label: string | null
  ├── url: string
  ├── isCreated: boolean
  └── isLoading: boolean

taskStore (Zustand, no persist)
  ├── configs: TaskConfig[]
  ├── taskStates: Record<string, TaskState>  // keyed by project ID
  ├── selectedConfigId: string | null
  └── actions: loadConfigs, addConfig, runTask, stopTask, ...
```

---

## 5. Cross-Domain Mapping

### 5.1 Project — Full Lifecycle

```
Frontend                         Bridge                      Backend
─────────                        ──────                      ────────
invoke("add_project",            add_project                 ProjectManager::add_project()
  { path, agent_id?, ide? })         │                          │
      │                               │                     creates Project {
      │                               │                         id, name, path,
      │                               │                         terminal: TerminalSession,
      │                               │                         git_info, ...
      ▼                               ▼                     }
Project (TS) ◄─────── JSON serde ──────── Project (Rust)
      │
appStore.activeProject = project
      │
  ┌───┴─────────────────────────────────┐
  │    TabGroup (tabs[tabKey])          │
  │      └── Tab.kind === "terminal"    │
  │            └── TerminalView         │
  │                  └── terminalCache  │
  │                        └── TerminalSession (by sessionId)
  └────────────────────────────────────┘
```

### 5.2 WSL/Remote Project — Terminal Lifecycle

```
Frontend                         Bridge                      Backend
─────────                        ──────                      ────────
user taps terminal tab
      │
Tab.kind === "terminal"
      │
WSLTerminalView / RemoteTerminalView
      │
invoke("create_wsl_terminal_session",    create_wsl_terminal_session
  { distro, projectPath })                      │
                                           TerminalManager::create_wsl_session()
      │                                           │
      ▼                                       spawn wsl.exe in PTY
TerminalSession ◄─────── JSON serde ──────── pid, status, sessionId
      │
wslTerminalCache.set(key, { term, sessionId })
TerminalSession is NOT stored on WSLProject — managed in cache only.
Cache key: "wsl:{distro}:{projectId}:{tabId}:{pane}"
```

### 5.3 Task Runner — Lifecycle

```
Frontend                         Bridge                      Backend
─────────                        ──────                      ────────
taskStore.runTask(command, configId)
      │
  ├─ Guard 1: same task already Running → activate tab, skip
  ├─ Guard 2: same task finished → destroy stale cache, reset
  └─ Normal: create Tab with taskCommand, add to TabGroup
      │
TerminalView detects taskCommand
      │
terminalFactory.createSession(command=taskCommand)
      │
invoke("create_terminal_session")  ──────  TerminalManager creates PTY
      │                                        spawns command instead of shell
      ▼
taskStore.setPtySessionId(projectId, sessionId)
      │
  ┌── process exits ────────────────── terminate by user ──┐
  ▼                                                         ▼
taskStore.markIdle(projectId)                   invoke("close_terminal_session")
Tab status → "Idle"                             taskStore → idle
```

### 5.4 Browser — Lifecycle

```
Frontend                         Bridge                      Backend
─────────                        ──────                      ────────
BrowserPanel (dock panel)
      │
invoke("create_browser_webview",        create_browser_webview
  { url, label?, bounds? })                   │
      │                                   tauri::webview::WebviewBuilder
      ▼                                       creates child webview window
browserStore → isCreated: true
      │
navigation flow:
  invoke("browser_navigate", { url })  ──────  webview.navigate(url)
  invoke("browser_set_bounds", ...)   ──────  webview.set_bounds(...)
  invoke("browser_set_visible", ...)  ──────  webview.set_visible(...)
  invoke("browser_close")            ──────  webview.close()
      │
element picker flow:
  invoke("browser_start_picker")  ──────  injects JS → neeko:// callback
  invoke("browser_stop_picker")   ──────  removes injection
  neeko://element-picked?html=...  ──────  uri_scheme.rs copies to clipboard
```

### 5.5 Cross-Type Git — Command Factory Pattern

```
Frontend                              Bridge                      Backend
─────────                              ──────                      ────────
useActiveProject() hook
      │
  determines ConnectionContext
    (LocalConnectionContext |
     WslConnectionContext |
     RemoteConnectionContext)
      │
  creates ProjectCommands
    (command factory)
      │                        ┌──────────────────────────┐
      │                        │ Based on ConnectionContext│
      │                        │  local → invoke("stage_files", ...)    │
      │                        │  wsl   → invoke("wsl_stage_files", ...)│
      ▼                        │  remote→ invoke("remote_stage_files", )│
commands.<method>()  ────────► └──────────────────────────┘
                                    │
                                    ▼
                              Backend dispatches to appropriate
                              git module: local.rs / wsl.rs / remote.rs
```

---

## 6. Key Architectural Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Three-domain layering (no shared types) | Each domain has independent lifecycle. IPC DTOs are the only contract. |
| 2 | Project tri-state union, not unified struct on Rust side | Local has terminal/activeView/collapsed; WSL/Remote do not. Unified struct would leak different semantics. |
| 3 | Terminal NOT embedded in WSL/Remote Project | WSL/Remote terminals are 1:N (multi-tab, multi-pane), ephemeral, created on-demand. Local terminal is 1:1. |
| 4 | TabGroup as the terminal-scoping container | All project types share the same TabGroup model. Terminal views discriminated by project type internally. |
| 5 | Dock layout persisted in localStorage (not session.json) | Dock layout is UI state, not domain data. Each has independent persistence lifecycle. |
| 6 | IPC commands use `verb-noun` naming | Single convention across all 200+ commands. Rust command names are the source of truth. |
| 7 | `loading: true` is initial skill store state | Prevents flash of empty content before `refreshSkills()` completes on mount. |
| 8 | SkillContent always-mounted with CSS hidden toggle | Eliminates mount/unmount gap that caused flash-black during ResizablePanel layout recalculation. |
| 9 | Cross-type Git via command factory | Panels consume `ProjectCommands` interface — never switch on `ProjectType`. Backend dispatches to `common/git/local.rs` / `common/git/remote.rs` / `common/git/wsl.rs`. |
| 10 | Task Runner reuses terminal tabs with stale-cache destruction | Avoids creating infinite tabs. Guard logic in runTask() reuses Running/Idle tabs and rebuilds clean terminal state. |
| 11 | Browser uses Tauri Webview (child window) | Native webview embed avoids iframe quirks. `neeko://` URI scheme provides element-picker callback bridge. |
| 12 | Theme sync: Pi .theme.css → OpenCode theme.json → Tauri theme | Two-directional: Pi's theme CSS is extracted into Tauri color vars. OpenCode theme format cached locally for runtime theme switching. |
| 13 | Git infrastructure split: `common/git/` (operations) + `git/` (commands) | Operations, transport, parsers live in infrastructure layer. Command glue stays at root level. |
| 14 | Session store: window_state removed, sidebar_width + worktree_state added | Session evolved to persist sidebar and worktree state alongside project list. Same JSON file, backward-compatible via `#[serde(default)]`. |
