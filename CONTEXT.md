# Neeko — Unified Domain Model

> Generated: 2026-05-20 (session: domain-model-grill)
> Consensus from cross-layer architecture review between Rust backend + Tauri IPC + TypeScript frontend.

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
│  src-tauri/src/ + neeko_lib/                         │
│  ── Core records, persistence, business logic        │
└──────────────────────────────────────────────────────┘
```

Each domain has independent lifecycle and constraints. The three are connected only through the Bridge Layer's thin DTO contracts — no shared types across domains.

---

## 2. Backend Domain (Rust)

### 2.1 Project

```rust
// models/project.rs
pub struct Project {                          // In-memory, managed by ProjectManager
    pub id: String,                           // UUID v4
    pub name: String,                         // Derived from path
    pub path: PathBuf,
    pub git_info: Option<GitInfo>,
    pub terminal: TerminalSession,            // Created at add_project, 1:1
    pub selected_agent: Option<String>,
    pub selected_ide: Option<String>,
    pub active_view: ViewMode,                // Terminal | Diff { file_path }
    pub collapsed: bool,
    pub avatar_color: Option<String>,
}

// models/session.rs — persistence projections (no git_info, no active_view)
pub struct ProjectSession {
    pub id: String, pub name: String, pub path: PathBuf,
    pub selected_agent: Option<String>, pub selected_ide: Option<String>,
    pub terminal_history: Vec<String>,        // Text only, no PID
    pub last_status: TerminalStatus,
    pub collapsed: bool, pub avatar_color: Option<String>,
}

pub struct WSLProjectSession {
    pub id: String, pub name: String, pub path: String,
    pub distro: String, pub entry_id: String,
    pub selected_agent: Option<String>, pub selected_ide: Option<String>,
    pub avatar_color: Option<String>,
    // No terminal data — WSL terminal is ephemeral, 1:N via tabs
}

pub struct RemoteProjectSession {
    pub id: String, pub name: String, pub path: String,
    pub entry_id: String,
    pub selected_agent: Option<String>, pub selected_ide: Option<String>,
    pub avatar_color: Option<String>,
    // No terminal data — remote terminal is ephemeral, 1:N via tabs
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

### 2.2 Terminal

```rust
// models/terminal.rs
pub struct TerminalSession {
    pub id: String,
    pub pid: Option<u32>,                     // Remote is always None (SSH)
    pub status: TerminalStatus,               // Idle | Running | Failed
    pub history: Vec<String>,
    pub agent: Option<AgentConfig>,
}
// Not embedded in WSL/Remote project structs.
// Managed via TerminalManager (Local+WSL) or RemoteTerminalManager (SSH).
```

### 2.3 Skill

```rust
// skill/types.rs
pub struct SkillRecord {                      // SQLite row
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

### 2.4 Entity Relationships

```
┌───────────────────┐     many-to-many     ┌──────────────┐
│   ManagedSkill    │ ◄──────────────────► │   TagGroup   │
│  (SkillRecord)    │  tag_group_skills     │              │
└────────┬──────────┘                       └──────┬───────┘
         │ 1:N                                    │ 1:N
         ▼                                        ▼
┌───────────────────┐                    ┌──────────────┐
│   SkillTarget     │                    │  ToolToggle  │
│  (deploy record)  │                    │  (per-tool)  │
└───────────────────┘                    └──────────────┘
```

---

## 3. Bridge / IPC Layer

### 3.1 Command Registry

Single source of truth: `src-tauri/src/commands/mod.rs` → `neeko_invoke_handler!()` macro.

Naming convention: `verb-noun` (not `verb_noun_from_noun`). Example: `install_local_skill` ✅, ~~`install_skill_from_local`~~ ❌

### 3.2 DTO Schema Alignment

| Rust DTO | TS Interface | Alignment |
|----------|-------------|-----------|
| `Project` | `Project` (project.ts) | 1:1 ✅ |
| `ManagedSkillDtoOut` | `ManagedSkillDto` (skill.ts) | 1:1 ✅ |
| `TagGroupDtoOut` | `TagGroup` (skill.ts) | 1:1 ✅ |
| `TerminalSession` | inline in `Project.terminal` | 1:1 ✅ |
| `GitInfo` + subtypes | `GitInfo` etc. (git.ts) | 1:1 ✅ |
| `SkillTargetRecord` | `SkillTargetRecord` (skill.ts) | 1:1 ✅ |
| `DiscoveredSkillDto` | `DiscoveredSkillDto` (skill.ts) | 1:1 ✅ |
| — | `WSLProject` (connection.ts) | TS-only (from session) |
| — | `RemoteProject` (connection.ts) | TS-only (from session) |

### 3.3 Event Schema

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `terminal-output-{id}` | Rust → Frontend | `string` (base64) | PTY/SSH stdout |
| `terminal-input-{id}` | Frontend → Rust | `string` (base64) | User input |
| `install-progress` | Rust → Frontend | `{ skill_id, phase, error? }` | Marketplace install |

---

## 4. Frontend Domain (TypeScript / React)

### 4.1 Project (tri-state union — frontend representation)

```typescript
// src/types/project.ts + src/types/connection.ts
// Local — 1:1 with Rust Project struct, includes embedded terminal
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

// WSL — TS-only, built from session data + lazy git
interface WSLProject {
  id: string; name: string; path: string;
  distro: string; entry_id: string;
  selected_agent: string | null; selected_ide: string | null;
  git_info?: GitInfo | null;
  avatar_color?: string | null;
  // No terminal — managed via wslTerminalCache (1:N, tab-scoped)
}

// Remote — TS-only, built from session data + lazy git
interface RemoteProject {
  id: string; name: string; path: string;
  entry_id: string;
  selected_agent: string | null; selected_ide: string | null;
  git_info?: GitInfo | null;
  avatar_color?: string | null;
  // No terminal — managed via remoteTerminalCache (1:N, tab-scoped)
}
```

### 4.2 Tab / Editor

```typescript
// src/types/tab.ts
interface TabGroup {
  tabKey: string;                    // "{projectId}" or "{projectId}:{worktreePath}"
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

### 4.3 Skill

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

### 4.4 Store Architecture

```
appStore (Zustand + persist: localStorage)
  ├── projects: Project[]              // Local projects (from IPC)
  ├── activeProject: Project | null
  ├── wslEntries: WSLEntrySession[]    // WSL (from session.json)
  ├── activeWslProject: { distro, project } | null
  ├── remoteEntries: RemoteEntrySession[]
  ├── activeRemoteProject: { entry, project } | null
  ├── tabs: Record<string, TabGroup>   // Tab management
  └── leftPanelWidth: number

skillStore (Zustand, no persist)
  ├── skills: ManagedSkillDto[]
  ├── tagGroups: TagGroup[]
  ├── loading: boolean
  ├── activeSkillView: SkillView       // "local" | "marketplace" | "project"
  └── searchQuery / selectedSkillId / activeTagGroupId

dockStore (Zustand + persist: localStorage)
  ├── zones: Record<string, DockZoneState>
  ├── barItems: DockBarItem[]
  ├── rightPanelSizes: Record<string, number>
  └── leftPanelSize: number

appViewStore (Zustand)
  └── appView: "default" | "settings"
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

---

## 6. Key Architectural Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Three-domain layering (no shared types) | Each domain has independent lifecycle. IPC DTOs are the only contract. |
| 2 | Project tri-state union, not unified struct | Local has terminal/activeView/collapsed; WSL/Remote do not. Unified struct would leak different semantics. |
| 3 | Terminal NOT embedded in WSL/Remote Project | WSL/Remote terminals are 1:N (multi-tab, multi-pane), ephemeral, created on-demand. Local terminal is 1:1. Both patterns are valid — model reflects reality. |
| 4 | TabGroup as the terminal-scoping container | All project types (local, WSL, remote) share the same TabGroup model. Terminal views discriminated by project type internally. |
| 5 | Dock layout persisted in localStorage (not session.json) | Dock layout is UI state, not domain data. Each has independent persistence lifecycle. |
| 6 | IPC commands use `verb-noun` naming | Single convention across all 50+ commands. Rust command names are the source of truth. |
| 7 | `loading: true` is initial skill store state | Prevents flash of empty content before `refreshSkills()` completes on mount. |
| 8 | SkillContent always-mounted with CSS hidden toggle | Eliminates mount/unmount gap that caused flash-black during ResizablePanel layout recalculation. |
