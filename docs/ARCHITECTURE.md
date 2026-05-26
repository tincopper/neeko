# Neeko — Architecture Reference

> Generated: 2026-05-26 (session: context-md-sync)
> Full architecture reference: module layout, type definitions, IPC contracts, data flows, and design decisions.
> For domain terminology, see [`CONTEXT.md`](../CONTEXT.md).

---

## 1. Three-Domain Layering

```
┌──────────────────────────────────────────────────────┐
│  Frontend Domain (React / TypeScript)                │
│  src/types/ + src/store/ + src/components/           │
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
├── lib.rs                   # Module declarations + pub use run/AppStateWrapper
├── app.rs                   # Tauri Builder assembly (run())
├── app_state.rs             # AppStateWrapper — manager assembly
├── error.rs                 # AppError enum + conversions
├── logger.rs                # Custom log::Log → ~/.neeko/neeko.log
│
├── commands/                # IPC command functions (17 files)
│   ├── mod.rs               # neeko_invoke_handler! macro (flat list)
│   ├── agent.rs, config.rs, file.rs, ide.rs, opener.rs
│   ├── project.rs, terminal.rs
│   ├── git.rs, git_unified.rs, ai_commit.rs
│   ├── remote.rs, remote_git.rs, wsl.rs, wsl_git.rs
│   ├── browser.rs, task.rs
│
├── models/                  # Core data structures (7 files)
│   ├── mod.rs, agent.rs, auth.rs, diff.rs
│   ├── project.rs, session.rs, terminal.rs
│
├── skill/                   # Skill management (14 files)
│   ├── mod.rs, types.rs, commands.rs
│   ├── skill_store.rs, scanner.rs, installer.rs
│   ├── git_fetcher.rs, central_repo.rs, content_hash.rs
│   ├── skill_metadata.rs, skillssh_api.rs
│   ├── sync_engine.rs, tool_adapters.rs, migrations.rs
│
├── git/                     # Modular Git operations (9 files)
│   ├── mod.rs, local.rs, remote.rs, wsl.rs
│   ├── operations.rs, parsers.rs, transport.rs
│   ├── cache.rs, pr.rs
│
├── theme/                   # Theme management (5 files)
│   ├── mod.rs, common.rs, opencode.rs, pi.rs, service.rs
│
├── utils/                   # Utility modules
│   ├── mod.rs, fonts.rs, job_object.rs
│   └── command/             # Command builder helpers
│
├── project.rs               # ProjectManager (legacy root-level)
├── terminal.rs              # TerminalManager (local + WSL PTY)
├── remote.rs                # RemoteTerminalManager (SSH via russh)
├── task_runner.rs           # TaskConfig persistence + run/stop
├── uri_scheme.rs            # neeko:// protocol handler (element picker)
├── git_worker.rs            # Background git refresh worker
├── agent.rs                 # AgentManager (7 built-in + custom)
├── storage.rs               # Persistence (sessions.json + config.json)
└── watcher.rs               # File watcher (notify + debounce)
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

Note: `Project` is defined in `project.rs` at root level (legacy), not in `models/project.rs`. `models/project.rs` contains the supporting types (`FileStatus`, `FileChange`, `GitInfo`, `Worktree`, `ViewMode`, `GitBranchInfo`, `FileDiffStats`).

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

Single source of truth: `src-tauri/src/commands/mod.rs` → `neeko_invoke_handler!()` macro.

~200 commands organized into domains:

| Domain | Prefix | Count | Examples |
|--------|--------|-------|---------|
| Core | `add_project`, `remove_project`, ... | ~20 | `greet`, `list_projects`, `save_session`, `load_config`, `read_dir_tree` |
| Git | `checkout_branch`, `create_branch`, ... | ~40 | `stage_files`, `commit_command`, `fetch`, `pull`, `push`, `cherry_pick`, `revert`, `create_tag`, `list_prs` |
| Terminal | `create_terminal_session`, `close_terminal_session`, ... | 3 | `resize_terminal` |
| Agent | `list_agents`, `get_agent`, ... | ~7 | `add_agent`, `remove_agent`, `set_project_agent` |
| IDE | `set_project_ide`, `open_ide` | 2 | |
| WSL | `get_wsl_distros`, `create_wsl_terminal_session`, ... | ~30 | `wsl_checkout_branch`, `wsl_push`, `wsl_commit_files` |
| Remote | `create_remote_terminal_session`, `test_remote_connection`, ... | ~30 | `remote_checkout_branch`, `remote_push` |
| Task Runner | `get_task_configs`, `save_task_config`, ... | 4 | `run_task`, `stop_task` |
| Browser | `create_browser_webview`, `browser_navigate`, ... | ~10 | `browser_set_bounds`, `browser_set_visible`, `reveal_in_file_manager` |
| Skill | `get_managed_skills`, `install_local_skill`, ... | ~35 | `scan_local_skills`, `sync_tag_group`, `fetch_leaderboard` |
| Unified Git | `unified_stage_files`, `unified_fetch`, ... | ~15 | `unified_push`, `unified_cherry_pick`, `unified_checkout_branch` |

Naming convention: `verb-noun` (e.g. `install_local_skill`).

### 3.2 DTO Schema Alignment

| Rust DTO | TS Interface | File | Alignment |
|----------|-------------|------|-----------|
| `Project` | `Project` | `project.ts` | 1:1 ✅ |
| `ManagedSkillDto` | `ManagedSkillDto` | `skill.ts` | 1:1 ✅ |
| `TagGroupDto` | `TagGroup` | `skill.ts` | 1:1 ✅ |
| `TerminalSession` | inline in `Project.terminal` | `project.ts` | 1:1 ✅ |
| `GitInfo` | `GitInfo` | `git.ts` | 1:1 ✅ |
| `FileChange` | `FileChange` | `git.ts` | 1:1 ✅ |
| `Worktree` | `Worktree` | `git.ts` | 1:1 ✅ |
| `DiffResult` | `DiffResult` | `git.ts` | 1:1 ✅ |
| `SkillTargetRecord` | `SkillTargetRecord` | `skill.ts` | 1:1 ✅ |
| `SkillDocumentDto` | — (fetched as string) | — | ✅ |
| `DiscoveredSkillDto` | `DiscoveredSkillDto` | `skill.ts` | 1:1 ✅ |
| `TaskConfig` | `TaskConfig` | `task.ts` | 1:1 ✅ |
| `AuthMethod` | `AuthMethod` | `connection.ts` | 1:1 ✅ |
| — | `WSLProject` | `connection.ts` | TS-only (from session) |
| — | `RemoteProject` | `connection.ts` | TS-only (from session) |
| — | `UnifiedProject` | `project.ts` | TS-only (adapter for cross-type operations) |
| — | `ActiveProjectAdapter` | `adapter.ts` | TS-only (discriminated union) |
| — | `ProjectCommands` | `activeProject.ts` | TS-only (command interface) |

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
// src/types/project.ts — Local project, 1:1 with Rust Project struct
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

// src/types/project.ts — Unified across local/wsl/remote for cross-type operations
interface UnifiedProject {
  type: ProjectType;      // "local" | "wsl" | "remote"
  id: string; name: string; path: string;
  gitInfo?: GitInfo | null;
  selectedAgent?: string | null; selectedIde?: string | null;
  activeView: "Terminal" | { Diff: { file_path: string } };
  collapsed: boolean;
}

// src/types/connection.ts — WSL project (TS-only, from session data)
interface WSLProject {
  id: string; name: string; path: string;
  distro: string; entry_id: string;
  selected_agent: string | null; selected_ide: string | null;
  git_info?: GitInfo | null; avatar_color?: string | null;
}

// src/types/connection.ts — Remote project (TS-only, from session data)
interface RemoteProject {
  id: string; name: string; path: string;
  entry_id: string;
  selected_agent: string | null; selected_ide: string | null;
  git_info?: GitInfo | null; avatar_color?: string | null;
}

// src/types/adapter.ts — Discriminated union for active project
type ActiveProjectAdapter =
  | { type: "local"; project: UnifiedProject }
  | { type: "wsl"; distro: string; project: UnifiedProject }
  | { type: "remote"; entry: RemoteEntrySession; project: UnifiedProject };

// src/types/activeProject.ts — ProjectCommands interface (24 methods)
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
// src/types/tab.ts
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
// src/types/skill.ts
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
appStore (Zustand + persist: localStorage, ~841 lines)
  ├── projects: Project[]                   // Local projects
  ├── activeProjectId: string | null
  ├── activeProject: Project | null
  ├── isTerminalView: boolean
  ├── wslEntries: WSLEntrySession[]
  ├── activeWslKey / activeWslProject
  ├── remoteEntries: RemoteEntrySession[]
  ├── activeRemoteKey / activeRemoteProject
  ├── remoteAuthStore: Map<string, AuthMethod>
  ├── pendingAuthEntry: RemoteEntrySession | null
  ├── activeWorktreePath / activeWorktreeBranch
  ├── openedWorktrees: WorktreeSnapshotItem[]
  ├── worktreeStateMap: Record<string, WorktreeState>
  ├── tabs: Record<string, TabGroup>        // Tab management
  └── leftPanelWidth: number

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

### 5.5 Unified Git — Command Factory Pattern

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
| 9 | Unified Git abstraction via command factory | Panels consume `ProjectCommands` interface — never switch on `ProjectType`. Backend dispatches to `local.rs` / `wsl.rs` / `remote.rs`. |
| 10 | Task Runner reuses terminal tabs with stale-cache destruction | Avoids creating infinite tabs. Guard logic in runTask() reuses Running/Idle tabs and rebuilds clean terminal state. |
| 11 | Browser uses Tauri Webview (child window) | Native webview embed avoids iframe quirks. `neeko://` URI scheme provides element-picker callback bridge. |
| 12 | Theme sync: Pi .theme.css → OpenCode theme.json → Tauri theme | Two-directional: Pi's theme CSS is extracted into Tauri color vars. OpenCode theme format cached locally for runtime theme switching. |
| 13 | Git module split into 9 files by operation domain | Local, Remote, WSL git operations share parsers and transport. Operations file avoids monolithic git.rs. |
| 14 | Session store: window_state removed, sidebar_width + worktree_state added | Session evolved to persist sidebar and worktree state alongside project list. Same JSON file, backward-compatible via `#[serde(default)]`. |
