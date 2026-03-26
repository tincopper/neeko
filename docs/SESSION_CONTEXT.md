# Neeko — Session Context

> Last updated: 2026-03-27 (session 3)

## Goal

Build and enhance a Tauri-based terminal manager app called **Neeko** that supports local projects, WSL terminals, and SSH remote terminals with full feature parity across all three types.

## Constraints

- Keep WSL and SSH terminal features at parity with local project features
- All terminal sessions (main + side) must survive project switching (PTY cache preserved, DOM detach/reattach)
- Side terminal width is shared (`sideTerminalWidth`) across all terminal types
- Sidebar "open side terminal" button only appears on hover when the project is **active** (same as local ProjectItem behavior)
- TypeScript type checking (`npx tsc --noEmit`) must pass after every change
- Rust compilation (`cargo build`) must pass after every change
- Follow Vercel React Best Practices: `rerender-use-ref-transient-values`, `rerender-split-combined-hooks`, `rerender-derived-state-no-effect`, `rerender-move-effect-to-event`, etc.

---

## Architecture Discoveries

### Terminal Cache
All terminals use a global Map keyed by string (e.g. `wsl:{distro}:{projectId}`, `remote:{entryId}:{projectId}`, with `:side` suffix for side terminals). PTY sessions survive component unmount — DOM is detached but xterm instance + PTY process kept alive.

### WSL Terminal
Uses `wsl.exe -d <distro> --cd <path>` with `WSL_UTF8=1` env, outputs via `terminal-output-{id}` events, inputs via `terminal-input-{id}` events.

### SSH Terminal — IO Architecture
Uses `channel.make_writer()` to split read/write ends, then `tokio::select!` in a single runtime to concurrently handle three branches:
1. **Input**: `input_rx` mpsc → `channel.make_writer()`
2. **Resize**: `resize_rx` mpsc → `channel.window_change(cols, rows, 0, 0)`
3. **Output**: `channel.wait()` → `emit terminal-output-{id}`

Previously the reader thread held `Mutex` lock while `await`ing `channel.wait()`, blocking Writer → deadlock. Fixed by splitting with `make_writer()`.

### SSH Resize (Fixed)
`resize_tx: mpsc::UnboundedSender<(u32, u32)>` added to `SSHHandle`. IO task's `select!` has a third branch that calls `channel.window_change()` when resize message received. `resize_session` now sends to channel instead of being a stub.

### ResizeObserver (Added to WSL/SSH)
`TerminalView` (local) uses `ResizeObserver` on wrapper div — auto-refits when side terminal is dragged. WSL (`WSLTerminalView`) and SSH (`RemoteTerminalView`) now also use `ResizeObserver`. Without it, terminals only respond to `window.resize` events, not flex layout changes (caused "can shrink but not grow" bug).

### Side Terminal Width Effect
`SideTerminalView` has `useEffect([width])` that calls `fitAddon.fit()` after 50ms debounce. WSL and SSH terminals now also have this effect, matching local behavior.

### Side Terminal (Local) — Session Loss Bug (Fixed)
Side terminal for local projects was closing on project switch because:
1. `sideTerminalOpen` was a single boolean that got `setSideTerminalOpen(false)` on project change
2. `SideTerminalView` destroyed PTY cache on unmount

**Fix**: Changed to `sideTerminalOpenMap: Record<projectId, boolean>` and only destroy cache on explicit close via `onDestroy` callback.

### SSH Re-auth Flow
`remoteAuthStore: Map<entryId, AuthMethod>` is in-memory only (lost on app restart). When a SSH project is selected without cached auth, `pendingAuthEntry` state is set via `useEffect` (not `setTimeout` in render — anti-pattern), triggering `RemoteAuthDialog`.

### App.tsx Refactor (Session 3)
Hooks extracted: `useToast`, `useSideTerminalResize`, `useWorktreeState`, `useKeyboardShortcuts`.  
Components extracted: `TitleBar`, `AddProjectModal`.  
- `activeProjectIdRef` must be declared before `useWorktreeState()` call — ordering matters
- Inline `keydown` useEffect replaced with `useKeyboardShortcuts` hook
- SSH auth trigger moved from `setTimeout`-in-render to proper `useEffect`
- Removed stale `selectedNewAgentId`/`selectedNewIdeId` state
- Fixed duplicate `activeProjectRef` declaration

### TitleBar
Does NOT take `agents`/`wslEntries`/`remoteEntries` props — `AgentSelector` fetches agents internally via `invoke`.

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
| `Ctrl+N` | Cycles worktree terminals |
| `Ctrl+O` | Opens IDE |

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
10. **RemoteDialog** uses `wsl-modal` class; `wsl-suggestions` z-index raised to 1100 for dropdown visibility
11. **SSH re-authentication dialog** (`RemoteAuthDialog`) — when a SSH project is selected but `remoteAuthStore` has no cached auth (e.g. after app restart), a login popup automatically appears:
    - Component lives in `WSLDialog.tsx`, exported as `RemoteAuthDialog`
    - Supports password and key-file auth types; calls `test_remote_connection` to validate before accepting
    - Enter key submits; `autoFocus` on credential field
    - On success: writes auth into `remoteAuthStore` → terminal renders immediately
    - On cancel: clears `activeRemoteProject` / `activeRemoteKey` so view returns to blank
    - Trigger: `pendingAuthEntry` set via `useEffect` (not `setTimeout`-in-render)
12. **RemoteDialog** — added "Save credentials" checkbox (`saveCredentials` state); lays groundwork for future Base64-persisted auth in `RemoteEntrySession.saved_auth`
13. **`RemoteEntrySession`** (backend `state.rs`) — new optional field `saved_auth: Option<String>` with `#[serde(default, skip_serializing_if = "Option::is_none")]` for future credential persistence
14. **SSH terminal resize implemented** (`remote.rs`) — `resize_tx` mpsc channel added to `SSHHandle`; IO task `select!` has third branch calling `channel.window_change()`; `resize_session` now sends to channel
15. **ResizeObserver added to WSL and SSH terminals** — both `WSLTerminalView` and `RemoteTerminalView` now observe wrapper div for size changes; fixes "can shrink but not grow" issue after flex layout changes
16. **`useEffect([width])` added to WSL/SSH terminals** — refits terminal 50ms after width prop changes (parity with local)
17. **App.tsx full refactor** — 4 hooks extracted (`useToast`, `useSideTerminalResize`, `useWorktreeState`, `useKeyboardShortcuts`), 2 components extracted (`TitleBar`, `AddProjectModal`); fixed hook ordering; removed anti-patterns
18. **TitleBar.tsx** — removed unused `agents`/`wslEntries`/`remoteEntries` props
19. **`useKeyboardShortcuts` hook** — null guards with `?? []` / `?? new Set()` / `?.()` optional calls; `Ctrl+N` and `Ctrl+O` support
20. **All session 3 changes committed** as `744c365`

---

## Known Issues / Still Needs Work

- "Save credentials" checkbox exists in `RemoteDialog` UI but Base64 encode/decode + auto-fill into `remoteAuthStore` on load is **not yet wired up** in App.tsx
- SSH path autocomplete dropdown click-selection may still have issues (z-index fix applied, needs verification)
- `input_tx` field on `SSHHandle` generates a `dead_code` warning (used indirectly via event listener closure)

---

## Relevant Files

### Frontend (`src/`)

| File | Purpose |
|---|---|
| `src/App.tsx` | Main component; fully refactored in session 3 |
| `src/types.ts` | `WSLProject`, `RemoteProject` (both have `selected_agent: string \| null`); `AuthMethod` type |
| `src/styles.css` | `.wsl-modal`, `.wsl-suggestions` (z-index: 1100), `.modal` (overflow: visible) |
| `src/components/WSLTerminalView.tsx` | WSL terminal; `ResizeObserver` + `useEffect([width])` added session 3 |
| `src/components/RemoteTerminalView.tsx` | SSH terminal; same props as WSL; `ResizeObserver` + `useEffect([width])` |
| `src/components/SideTerminalView.tsx` | Local side terminal; `onDestroy` prop; no PTY destroy on unmount |
| `src/components/AgentSelector.tsx` | `skipBackendPersist` prop |
| `src/components/WSLDialog.tsx` | `WSLDialog` + `RemoteDialog` + `RemoteAuthDialog`; `saveCredentials` checkbox |
| `src/components/TitleBar.tsx` | Extracted from App.tsx; no unused props |
| `src/components/AddProjectModal.tsx` | Extracted from App.tsx; agent + IDE selection modal |
| `src/components/project/RemoteItems.tsx` | `WSLItem`, `RemoteItem` with `onOpenSideTerminal` prop |
| `src/components/project/ProjectSidebar.tsx` | `onOpenWslSideTerminal`, `onOpenRemoteSideTerminal` props |
| `src/hooks/useToast.ts` | Toast notification hook |
| `src/hooks/useSideTerminalResize.ts` | Side terminal drag-resize hook |
| `src/hooks/useWorktreeState.ts` | Per-project worktree state management |
| `src/hooks/useKeyboardShortcuts.ts` | All keyboard shortcut logic |

### Backend (`src-tauri/src/`)

| File | Purpose |
|---|---|
| `src-tauri/src/remote.rs` | Full SSH session management; `SSHHandle` with `resize_tx`; IO task `select!` (3 branches); `test_connection`; `list_directories` |
| `src-tauri/src/lib.rs` | Tauri command registrations: `test_remote_connection`, `list_remote_directories`, `create_remote_terminal_session`, `resize_remote_terminal`, etc. |
| `src-tauri/src/state.rs` | `WSLProjectSession`, `RemoteProjectSession` with `selected_agent: Option<String>`; `RemoteEntrySession` with `saved_auth: Option<String>` |
| `src-tauri/src/terminal.rs` | Local/WSL terminal session management |
