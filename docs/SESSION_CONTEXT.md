# Neeko — Session Context

> Last updated: 2026-03-27 (session 2)

## Goal

Build and enhance a Tauri-based terminal manager app called **Neeko** that supports local projects, WSL terminals, and SSH remote terminals with full feature parity across all three types.

## Constraints

- Keep WSL and SSH terminal features at parity with local project features
- All terminal sessions (main + side) must survive project switching (PTY cache preserved, DOM detach/reattach)
- Side terminal width is shared (`sideTerminalWidth`) across all terminal types
- Sidebar "open side terminal" button only appears on hover when the project is **active** (same as local ProjectItem behavior)
- TypeScript type checking (`npx tsc --noEmit`) must pass after every change
- Rust compilation (`cargo build`) must pass after every change

---

## Architecture Discoveries

### Terminal Cache
All terminals use a global Map keyed by string (e.g. `wsl:{distro}:{projectId}`, `remote:{entryId}:{projectId}`, with `:side` suffix for side terminals). PTY sessions survive component unmount — DOM is detached but xterm instance + PTY process kept alive.

### WSL Terminal
Uses `wsl.exe -d <distro> --cd <path>` with `WSL_UTF8=1` env, outputs via `terminal-output-{id}` events, inputs via `terminal-input-{id}` events.

### SSH Terminal — Critical Bug (Fixed)
Reader thread held `Mutex` lock while `await`ing `channel.wait()`, blocking Writer from acquiring the same lock → keyboard input deadlocked.  
**Fix**: Use `channel.make_writer()` to split read/write ends, then use `tokio::select!` in a single runtime to concurrently handle input (mpsc → writer) and output (channel.wait → emit).

### Side Terminal (Local) — Session Loss Bug (Fixed)
Side terminal for local projects was closing on project switch because:
1. `sideTerminalOpen` was a single boolean that got `setSideTerminalOpen(false)` on project change
2. `SideTerminalView` destroyed PTY cache on unmount

**Fix**: Changed to `sideTerminalOpenMap: Record<projectId, boolean>` and only destroy cache on explicit close via `onDestroy` callback.

### Agent Auto-launch Delays
- WSL: 500ms delay after sessionId is set
- SSH: 800ms delay (slower shell init)

### SSH Directory Listing
`list_remote_directories` creates a one-shot SSH connection, runs:
```sh
ls -1p '<path>' | grep '/$' | sed 's|/$||'
```
Returns directory names.

### SSH Connection Test
`test_remote_connection` creates a one-shot SSH connection, runs `echo ok`, verifies auth works.

### AgentSelector
Has `skipBackendPersist` prop — WSL/SSH pass `true` to skip `set_project_agent` invoke (they persist via `save_wsl_entries` / `save_remote_entries` instead).

---

## Key State in App.tsx

| State | Type | Purpose |
|---|---|---|
| `wslSideTerminalOpen` | `Set<string>` | projectIds with open WSL side terminals |
| `remoteSideTerminalOpen` | `Set<string>` | projectIds with open SSH side terminals |
| `sideTerminalOpenMap` | `Record<string, boolean>` | Per-project local side terminal state |
| `remoteAuthStore` | `Map<entryId, AuthMethod>` | In-memory SSH auth (not persisted to disk) |
| `pendingAuthEntry` | `RemoteEntrySession \| null` | Entry waiting for re-login (triggers `RemoteAuthDialog`) |
| `activeWslProject` | `{ distro, project }` | Full info for rendering WSL terminal |
| `activeRemoteProject` | `{ entry, project }` | Full info for rendering SSH terminal |

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Q` | Cycles through all items (local → WSL → SSH) |
| `Ctrl+1~9` | Switches to nth item in unified list |
| `Ctrl+Alt+T` | Opens side terminal for currently active project type |
| `Ctrl+W` | Closes side terminal for currently active project type |

---

## Completed Work

1. **WSL terminal support** — distro browsing, path autocomplete, session caching, Ctrl+Q/number switching
2. **SSH terminal support** — connection dialog, session caching, switching
3. **Agent CLI integration** for WSL and SSH:
   - `selected_agent` field added to `WSLProject`, `RemoteProject` (frontend + backend)
   - Auto-launch on terminal connect (500ms/800ms delay)
   - Title bar `AgentSelector` rendered for WSL/SSH active projects
   - Agent selection in WSLDialog and RemoteDialog add-project steps
4. **Side terminal for WSL and SSH**:
   - `cacheKeySuffix=":side"` for separate PTY instances
   - `sideMode` prop for close button + fixed width layout
   - Ctrl+Alt+T and Ctrl+W support
   - Sidebar button (hover, active-only) in WSLItem/RemoteItem
5. **Local side terminal session persistence** — no longer closes on project switch
6. **SSH path autocomplete** — `list_remote_directories` backend command, debounced input with WSL-identical UX
7. **SSH connection validation** — `test_remote_connection` backend command, async `handleConnect` with loading/error state
8. **SSH keyboard input fix** — rewrote `create_session` IO using `make_writer()` split + `tokio::select!` + `mpsc` channel
9. **WSL/SSH top bar removed** — terminals render full-screen without header
10. **RemoteDialog** uses `wsl-modal` class and `wsl-suggestions` z-index raised to 1100 for dropdown visibility
11. **SSH re-authentication dialog** (`RemoteAuthDialog`) — when a SSH project is selected but `remoteAuthStore` has no cached auth (e.g. after app restart), a login popup automatically appears instead of a static error page:
    - Component lives in `WSLDialog.tsx`, exported as `RemoteAuthDialog`
    - Supports password and key-file auth types; calls `test_remote_connection` to validate before accepting
    - Enter key submits; `autoFocus` on credential field
    - On success: writes auth into `remoteAuthStore` → terminal renders immediately
    - On cancel: clears `activeRemoteProject` / `activeRemoteKey` so view returns to blank
    - Trigger: SSH terminal render block sets `pendingAuthEntry` via `setTimeout` when `!auth`
12. **RemoteDialog** — added "Save credentials" checkbox (`saveCredentials` state); lays groundwork for future Base64-persisted auth in `RemoteEntrySession.saved_auth`
13. **`RemoteEntrySession`** (backend `state.rs`) — new optional field `saved_auth: Option<String>` with `#[serde(default, skip_serializing_if = "Option::is_none")]` for future credential persistence

---

## Known Issues / Still Needs Work

- SSH path autocomplete dropdown may still have click-selection issues (z-index fix applied, needs verification)
- `resize_remote_terminal` is not implemented (stub that logs but does nothing)
- "Save credentials" checkbox exists in RemoteDialog UI but the Base64 encode/decode + auto-fill flow is not yet wired up in App.tsx

---

## Relevant Files

### Frontend (`src/`)

| File | Purpose |
|---|---|
| `src/App.tsx` | Main component, all state, keyboard shortcuts, rendering |
| `src/types.ts` | `WSLProject`, `RemoteProject` (both have `selected_agent: string \| null`) |
| `src/styles.css` | `.wsl-modal`, `.wsl-suggestions` (z-index: 1100), `.modal` (overflow: visible) |
| `src/components/WSLTerminalView.tsx` | WSL terminal, `cacheKeySuffix`, `sideMode`, `selectedAgentId`, `launchAgentInWslTerminal` |
| `src/components/RemoteTerminalView.tsx` | SSH terminal, same props as WSL |
| `src/components/SideTerminalView.tsx` | Local side terminal, `onDestroy` prop, no PTY destroy on unmount |
| `src/components/AgentSelector.tsx` | `skipBackendPersist` prop |
| `src/components/WSLDialog.tsx` | `WSLDialog` + `RemoteDialog` + `RemoteAuthDialog` (re-login popup for cached-auth-missing case) |
| `src/components/project/RemoteItems.tsx` | `WSLItem`, `RemoteItem` with `onOpenSideTerminal` prop |
| `src/components/project/ProjectSidebar.tsx` | `onOpenWslSideTerminal`, `onOpenRemoteSideTerminal` props |

### Backend (`src-tauri/src/`)

| File | Purpose |
|---|---|
| `src-tauri/src/remote.rs` | Full SSH session management; `create_session` (fixed with `make_writer` + `select!`), `test_connection`, `list_directories`, `close_session`, `close_all_sessions` |
| `src-tauri/src/lib.rs` | Tauri command registrations: `test_remote_connection`, `list_remote_directories`, `create_remote_terminal_session`, etc. |
| `src-tauri/src/state.rs` | `WSLProjectSession`, `RemoteProjectSession` with `#[serde(default)] selected_agent: Option<String>`; `RemoteEntrySession` with `saved_auth: Option<String>` |
| `src-tauri/src/terminal.rs` | Local/WSL terminal session management |
