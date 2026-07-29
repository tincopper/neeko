# LSP Status Menu Redesign — Design & Technical Plan

## 1. UX Prototype

### 1.1 Status Bar (idle)

**Single server**
```
┌─────────────────────────────────────────────────────────────────┐
│  ⑂ main  ● rust-analyzer  ▾   │          ... right side ...    │
└─────────────────────────────────────────────────────────────────┘
```

**Multiple servers**
```
┌─────────────────────────────────────────────────────────────────┐
│  ⑂ main  ● 🗄  ▾   │          ... right side ...               │
└─────────────────────────────────────────────────────────────────┘
  hover tooltip: "2 LSPs"
```

- `⑂` = branch icon
- `●` = aggregate status dot (green=ready, pulsing yellow=indexing/starting, red=error, grey=detected)
- Single: server name; Multi: **LSP icon only** (tooltip `N LSPs`)
- `▾` = dropdown chevron

### 1.2 Main Dropdown

```
┌────────────────────────┐
│ neeko                  │  ← project name (muted, non-clickable header)
├────────────────────────┤
│ ● rust-analyzer    ▶   │  ← hover/click opens submenu
│ ● ts-server        ▶   │
├────────────────────────┤
│ Restart All Servers    │
│ Stop All Servers       │
└────────────────────────┘
```

### 1.3 Per-Server Submenu

```
┌──────────────────────────────────────────────────┐
│ View Logs                                        │
│ Restart Server                                   │
│ Stop Server                                      │
├──────────────────────────────────────────────────┤
│ ● Running — v1.97.1 (8bab26f4 2026-07-14) — 19.2 MB │
└──────────────────────────────────────────────────┘
```

- Footer is read-only, shows aggregated runtime info.
- Status text mirrors the session `status` field plus backend-provided metadata.

## 2. Component Structure

```
StatusBar
└── leftContent()
    └── LspStatusSection
        ├── LspStatusButton        (dot + label + chevron)
        └── LspStatusDropdown      (portal)
            ├── LspStatusHeader    (project name)
            ├── LspServerRow[]     (each opens LspServerSubmenu)
            ├── LspSubmenu         (portal, positioned to the right)
            │   ├── View Logs
            │   ├── Restart Server
            │   ├── Stop Server
            │   └── LspServerInfoFooter
            └── LspGlobalActions   (Restart All / Stop All)
```

## 3. State & Interactions

| State | Owner | Notes |
|-------|-------|-------|
| `dropdownOpen` | `StatusBar` | Main menu visibility |
| `dropdownStyle` | `StatusBar` | Portal position from button rect |
| `hoveredServerId` / `activeSubmenuServerId` | `LspStatusDropdown` | Which server row is showing submenu |
| `submenuStyle` | `LspStatusDropdown` | Portal position from hovered row rect |
| `serverInfoMap` | `useLspStore` | Cache version/commit/date per project+language; memory may be stale until next submenu open |
| Console sessions | `useTaskStore` (extended) | LSP log tabs live in Console alongside task runs |

Interaction flow:
1. Click status button → open main dropdown.
2. Hover/click a server row → open submenu to the right; fetch server info (memory fresh; version from cache).
3. Click `Restart Server` / `Stop Server` → invoke existing API, close submenu.
4. Click `Restart All Servers` / `Stop All Servers` → invoke new batch API or loop existing API.
5. Click `View Logs` → close menus, open Console panel, focus/create LSP log tab, load logs + poll while active.
6. Click outside any menu → close all.

## 4. Backend Plan

### 4.1 New Types

```rust
// src-tauri/src/lsp/types.rs (or module)
#[derive(Debug, Clone, Serialize)]
pub struct LspServerInfo {
    pub version: String,
    pub commit: String,
    pub build_date: String,
    pub memory_mb: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LspServerLogEntry {
    pub timestamp: String, // ISO 8601
    pub level: String,     // debug | info | warn | error
    pub message: String,
}
```

### 4.2 New Commands

| Command | Input | Output | Purpose |
|---------|-------|--------|---------|
| `lsp_get_server_info` | `{ projectPath, languageId }` | `LspServerInfo` | Metadata for submenu footer |
| `lsp_get_server_logs` | `{ projectPath, languageId, limit? }` | `LspServerLogEntry[]` | Initial log history |
| `lsp_restart_all_sessions` | `{ projectPath }` | `()` | Restart all sessions for project |
| `lsp_stop_all_sessions` | `{ projectPath }` | `()` | Stop all sessions for project |

### 4.3 Logs (v1)

- Session captures stderr into a ring buffer (e.g. last 500–1000 lines).
- `lsp_get_server_logs` returns current buffer.
- Frontend polls every 2s while the corresponding Console tab is active.
- Optional v2: push events `lsp-log-{projectPath}-{languageId}`.

### 4.4 Where to Store Server Info

Each LSP session manager already tracks the child process. Add:
- `server_info: Option<LspServerInfo>` on the session (version/commit/date filled at spawn via `--version` parse; memory filled on demand).
- Memory: read process RSS through `sysinfo` (or platform equivalent) when `lsp_get_server_info` is called.

## 5. Frontend API Additions

```ts
// src/features/lsp/api/lspApi.ts
export interface LspServerInfo {
  version: string;
  commit: string;
  buildDate: string;
  memoryMb: number;
}

export interface LspServerLogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export function lspGetServerInfo(
  projectPath: string,
  languageId: string,
): Promise<LspServerInfo> { ... }

export function lspGetServerLogs(
  projectPath: string,
  languageId: string,
  limit?: number,
): Promise<LspServerLogEntry[]> { ... }

export function lspRestartAllSessions(projectPath: string): Promise<void> { ... }

export function lspStopAllSessions(projectPath: string): Promise<void> { ... }
```

## 6. UI Details

- **Header**: use `activeProject?.name ?? 'Project'`; style with `text-text-muted px-3 py-1 text-[11px]`.
- **Server row**: `flex items-center justify-between px-3 py-1.5 hover:bg-hover cursor-pointer`.
- **Submenu**: same `bg-popover border border-border rounded-md shadow-lg` theme as main dropdown; width ~260px.
- **Footer**: `px-3 py-1.5 border-t border-border text-text-muted text-[11px]` with status dot.
- **Chevron**: reuse inline SVG already added to status button.
- **Multi-server chip icon**: reuse shared `ServerIcon` (or equivalent) at ~12px; tooltip `N LSPs`.

## 7. View Logs → Console Integration

Console today (`TaskConsolePanel` + `useTaskStore.consoleSessions`) is a tabbed, read-only bottom panel over `TaskRun` buffers. Task process lifecycle is independent of panel mount — good for LSP logs too.

### 7.1 Approach (preferred)

Extend Console session model lightly so non-task sources can share the same panel:

```ts
// Conceptual extension of TaskRun / console session
type ConsoleSessionSource = 'task' | 'lsp';

interface ConsoleSession {
  id: string;                 // task: run id; lsp: `lsp:{projectPath}:{languageId}`
  source: ConsoleSessionSource;
  name: string;               // tab label: `rust-analyzer` or `LSP: rust-analyzer`
  projectId: string;
  projectPath: string;
  status: 'running' | 'idle' | 'failed';
  output: string;
  // task-only fields remain optional for lsp sessions
  processId?: string | null;
  configId?: string;
  command?: string;
  // lsp-only
  languageId?: string;
}
```

API surface (store helpers):

| Helper | Behavior |
|--------|----------|
| `openLspLogConsole({ projectId, projectPath, languageId, serverName })` | Ensure Console open; upsert session by stable id; set active tab; kick initial `lspGetServerLogs` |
| Poll while active | If active tab is `source==='lsp'`, poll logs every 2s and replace/append output |
| Close tab | Drop buffer; stop poll; no process stop for LSP (server keeps running) |

Stop button in Console for LSP tabs: hide or no-op (server lifecycle stays in LSP menu). Prefer **hide Stop** for `source==='lsp'`.

### 7.2 Fallback if model extension is too wide

Keep `TaskRun` untouched and inject a synthetic session only via a narrow adapter — still worse long-term because `closeConsoleSession` stops processes. Prefer 7.1.

### 7.3 UX

- Tab name: server name (e.g. `rust-analyzer`)
- Opening View Logs while a tab already exists: focus + refresh, do not duplicate
- Exclusive bottom-panel behavior already used by Console vs Debug stays intact

## 8. Current Code Anchors

| Area | Location | Notes |
|------|----------|-------|
| All statusbar LSP UI | `src/features/status-bar/StatusBar.tsx` | monolithic `leftContent()`; no `LspStatus*` components yet |
| API | `src/features/lsp/api/lspApi.ts` | has list/restart/stop; missing info/logs/batch |
| Store | `src/shared/store/lspStore.ts` | sessions/profiles/conflicts only |
| Console panel | `src/features/task/components/TaskConsolePanel.tsx` | reuse for View Logs |
| Console store | `src/shared/store/taskStore.ts` | extend for LSP log sessions |
| Backend commands | `src-tauri/src/lsp/commands.rs` | no info/logs/all-session commands |
| Session stderr | `src-tauri/src/lsp/session/mod.rs` | `log::warn!` only — no FE buffer |
| Status tokens | `src/styles/theme.css` + `index.css` | `status-idle/running/failed`; StatusBar currently uses `status-error` (likely broken) |
| Multi-server icon | `src/shared/components/icons` (`ServerIcon`) | candidate for chip |

## 9. Locked Decisions

| # | Topic | Decision |
|---|-------|----------|
| 1 | View Logs destination | Reuse Console panel; extend session model for `source: 'lsp'` tabs |
| 2 | Version / commit / date | Parse `--version` at spawn; cache on session |
| 3 | Memory | Fetch once on submenu open via `lsp_get_server_info` |
| 4 | Multi-server chip | Status dot + LSP icon; hover tooltip `N LSPs` |
| 5 | Detected-only chip | Non-interactive in v1 |

No open product decisions remaining for MVP.
