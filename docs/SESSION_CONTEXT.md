# Neeko — Session Context

> Last updated: 2026-03-29 (session 7)

## Goal

Build and enhance a Tauri-based terminal manager app called **Neeko** that supports local projects, WSL terminals, and SSH remote terminals. This session focused on WSL/SSH feature parity with local projects: collapse/expand behavior, IDE icons from assets, unified branch badges, worktree cycling for WSL/SSH, SSH credential persistence, DiffView flicker fix, and CREATE_NO_WINDOW for Windows.

## Constraints

- WSL is **Windows-only**: UI conditionally shown via `IS_WINDOWS` (`navigator.platform`); backend commands gated with `cfg!(target_os = "windows")`
- Keep WSL and SSH terminal features at parity with local project features
- All terminal sessions (main + side) must survive project switching (PTY cache preserved, DOM detach/reattach)
- Side terminal width is shared (`sideTerminalWidth`) across all terminal types
- Sidebar "open side terminal" button only appears on hover when the project is **active** (same as local ProjectItem behavior)
- TypeScript type checking (`npx tsc --noEmit`) must pass after every change
- Rust compilation (`cargo build`) must pass after every change
- Follow Vercel React Best Practices: `rerender-use-ref-transient-values`, `rerender-split-combined-hooks`, `rerender-derived-state-no-effect`, `rerender-move-effect-to-event`, etc.
- `AgentIcon` (`layout/AgentIcon.tsx`) supports custom agent icons via `AgentConfig.icon` filename resolved via `getAgentIconSrc()` in `utils/agents.ts`; includes `cli.svg` for custom agents.
- IDE icons rendered from `assets/ides/` SVG/PNG files via `getIdeIconSrc()` and `getIdeIconByCommand()` in `utils/idePresets.ts`; includes `default.svg` fallback
- IDE button in sidebar only visible on hover when project is `.active` (same as local ProjectItem)
- `CREATE_NO_WINDOW` (0x08000000) flag applied to all `Command::new` on Windows — `remote.rs` and `git.rs` now use `no_window_cmd()` helper
- WSL/SSH `changed_files` rendered via `buildTree()` + `FileTree` component (parity with local), not as a flat list

---

## Frontend Development Conventions

### Project Structure

```
src/
├── components/
│   ├── terminal/          ← 终端相关组件（TerminalView, SideTerminalView, WorktreeTerminalView, WSLTerminalView, RemoteTerminalView）
│   ├── connections/       ← WSL + SSH 连接管理（WSLDialog, RemoteDialog, RemoteAuthDialog, RemoteItems）
│   ├── project/           ← 本地项目管理（ProjectSidebar, ProjectItem, FileTree, GitDialog, AddProjectModal）
│   ├── layout/            ← 窗口布局（TitleBar, WindowControls, AgentSelector, AgentIcon）
│   ├── MainContent.tsx    ← 跨域编排组件（保留根目录）
│   ├── DiffView.tsx       ← Git diff 独立模块（保留根目录）
│   └── SettingsPanel.tsx  ← 设置面板（保留根目录）
├── hooks/                 ← 自定义 hooks
├── utils/                 ← 工具函数（terminal.ts, agents.ts, distros.ts, platform.ts, fileIcons.ts, idePresets.ts）
├── types.ts               ← 全局类型定义（单一源）
├── assets/
│   ├── agents/            ← Agent logo（PNG/SVG：claude-code, opencode, qwen, gemini, codex, qoder, codebuddy）
│   ├── distros/           ← WSL 发行版 logo（SVG：ubuntu, debian, fedora, opensuse, archlinux, ...）
│   ├── linux.svg          ← WSL 通用图标
│   ├── server.svg         ← SSH 图标
│   ├── folder.svg         ← 文件夹图标
│   └── cli.svg            ← 自定义 Agent 图标
└── App.tsx                ← 组合层（~446 行）
```

每个子目录有 `index.ts` barrel export，consumer 统一从目录导入：
```typescript
import { TerminalView, destroyTerminalCache } from "./components/terminal";
import { TitleBar, AgentIcon } from "./components/layout";
import { WSLDialog } from "./components/connections";
import ProjectSidebar, { AddProjectModal } from "./components/project";
```

### Types 集中管理

- 所有接口定义在 `src/types.ts`（Project, AgentConfig, AppConfig, WSLEntrySession, RemoteEntrySession, AuthMethod 等）
- 组件内不重复定义已有类型；如需本地类型用 `interface` 但不导出
- `SettingsPanel.tsx` re-export `AppConfig`/`DiffMode` 保持向后兼容
- `AgentConfig.icon` 类型：PNG/SVG 文件名（如 `"claude-code.png"`, `"qoder.svg"`），由 `AgentIcon` 组件渲染

### Hook 设计原则

1. **按领域划分**：`useLocalProjects`、`useWslProjects`、`useRemoteProjects`、`useAppConfig`
2. **返回稳定引用**：所有返回的函数用 `useCallback` 包装，依赖项精确声明
3. **跨域协调在 App.tsx**：hook 管理自己的状态和 CRUD，跨域 select/clear 逻辑在 App 层组合
4. **Ref 同步集中**：所有 refs 在 App.tsx 的单个 `useEffect` 中同步（`rerender-use-ref-transient-values`）

### React 性能优化规范

| 模式 | 规则 |
|------|------|
| `React.memo` | 列表项组件（ProjectItem, WSLItem, RemoteItem）、大型布局组件（MainContent, TitleBar）、复用组件（AgentSelector, FileTree） |
| `useMemo` | 昂贵计算（`buildTree`、字体列表合并排序、分支过滤） |
| `useCallback` | 跨组件传递的回调、hooks 返回的函数（`showToast`、`handleSideDividerMouseDown`） |
| 内联对象 | 避免 JSX 中的 `style={{...}}` 常量对象；提取到模块级变量 |
| 条件渲染 | 用三元而非 `&&`（避免 falsy 值渲染问题） |
| Ref 模式 | 频繁变化的值用 ref 跟踪，在 effect 中同步（`activeProjectIdRef`、`sideTerminalOpenRef`） |

### 共享工具

- `src/utils/terminal.ts`：`DEFAULT_FONT_FAMILY`、`buildFontFamily(fontFamily)` — 所有终端组件共用
- `src/utils/agents.ts`：`getAgentIconSrc(icon)` — AgentConfig.icon → 可导入的图片 URL
- `src/utils/distros.ts`：`getDistroIcon(name)` — WSL 发行版名称 → 模糊匹配 logo（支持版本号后缀如 `Ubuntu-22.04`）
- `src/utils/platform.ts`：`IS_WINDOWS` — 平台检测，控制 WSL UI 显隐
- 不在多个文件中重复常量定义

### 组件提取标准

当 App.tsx 超过 400 行时考虑：
1. 提取领域 hook（状态 + CRUD 操作）
2. 提取视图组件（渲染树独立的部分）
3. 保留 App.tsx 作为纯组合层（hook 调用 + JSX 编排）

---

## Architecture Discoveries

### Terminal Cache
All terminals use a global Map keyed by string (e.g. `wsl:{distro}:{projectId}`, `remote:{entryId}:{projectId}`, with `:side` suffix for side terminals). PTY sessions survive component unmount — DOM is detached but xterm instance + PTY process kept alive.

### Terminal Refresh (Ctrl+R)
`refreshTerminal()` destroys the xterm instance and DOM, then calls `createTerminalForProject` to rebuild from cached PTY. `TerminalCache` stores `unlistenClosed` callback — called during refresh to unregister the `terminal-closed-{sid}` listener before cleanup, preventing double rebuild race condition. WSL/Remote use `wslRebuildCallbacks`/`remoteRebuildCallbacks` Maps to trigger `setRebuildCount` increment.

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

### Platform Gating (WSL)
WSL is Windows-only. Frontend uses `IS_WINDOWS` (`src/utils/platform.ts`) to conditionally render WSL UI elements. Backend uses `cfg!(target_os = "windows")` to gate WSL Tauri commands — empty fallback on non-Windows.

### Persistence (Unified sessions.json)
All state persisted in single `sessions.json` (unified `SessionStore`):
- Local projects, WSL entries, remote entries — `#[serde(default)]` for backward compatibility
- `sidebar_width`, `side_terminal_width` — saved on drag end via callbacks
- Old `wsl_entries.json`/`remote_entries.json` auto-migrated and deleted on load

### SSH Re-auth Flow
`remoteAuthStore: Map<entryId, AuthMethod>` is in-memory only (lost on app restart). When a SSH project is selected without cached auth, `pendingAuthEntry` state is set via `useEffect` (not `setTimeout` in render — anti-pattern), triggering `RemoteAuthDialog`.

### App.tsx Architecture (Session 3 + 4 + 6)

Session 3: Hooks extracted: `useToast`, `useSideTerminalResize`, `useWorktreeState`, `useKeyboardShortcuts`.
Components extracted: `TitleBar`, `AddProjectModal`.

Session 4 (full refactor):
- Domain hooks extracted: `useAppConfig`, `useLocalProjects`, `useWslProjects`, `useRemoteProjects`
- `MainContent` component extracted for view rendering
- Types consolidated: `AppConfig` moved to `types.ts`, duplicate `Project`/`AgentConfig` removed
- App.tsx reduced from 1036 → 432 lines (pure composition layer)

Session 6:
- `suppressTerminalResizeRef` added to prevent `fitAddon.fit()` during sidebar/side-terminal drag
- `saveSession` ref-based pattern to avoid stale closure on project change
- Width callbacks (`onSidebarWidthChange`, `onSideTerminalWidthChange`) wired through for persistence
- `IS_WINDOWS` used for conditional WSL entry loading and UI rendering
- `agentCommandOverrides` (single string) passed to `TerminalView` for agent command customization

Design principles:
- `activeProjectIdRef` must be declared before `useWorktreeState()` call — ordering matters
- Cross-domain select handlers (e.g. selecting WSL clears local/remote) composed in App.tsx
- All refs synced in single `useEffect`

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
Agent selection for WSL/SSH projects is persisted via unified `save_session` command (not `set_project_agent`). Agent command overrides (`agentCommandOverrides`) and custom agents (`customAgents`) are persisted in `config.json` via `useAppConfig`.

### Agent Icon System
`AgentIcon` component (`layout/AgentIcon.tsx`) renders agent logos. `AgentConfig.icon` is a filename (e.g. `"claude-code.png"`, `"qoder.svg"`), resolved via `getAgentIconSrc()` in `utils/agents.ts`. Uses Vite static imports (auto-inline ≤4KB). Fallback: `🤖` emoji if no icon matches. `cli.svg` is used for custom agents.

### SVG Icon System
- **WSL/SSH sidebar icons**: `linux.svg` (penguin, Simple Icons) and `server.svg` (Charm Icons) replace emoji (🐧/🖥️)
- **Folder icon**: `folder.svg` (Charm Icons) — used in suggestions and empty states
- **Color inheritance**: CSS `fill: currentColor; stroke: currentColor; color: var(--text-secondary)` on `<img>` elements — SVGs inherit theme colors
- **Simple Icons SVGs** have hardcoded `fill="#000"` inside SVG; CSS overrides from parent element
- **Charm Icons SVGs** use `stroke="currentColor"` — work with CSS color inheritance out of the box
- **Build behavior**: Vite inlines small SVGs (<4KB) as base64 data URLs; larger ones become separate files

### WSL Distro Icons
`getDistroIcon(name)` in `utils/distros.ts` fuzzy-matches WSL distro names to logos:
- Strips version suffixes: `"ubuntu-22.04"` → `"ubuntu"`, `"opensuse-leap-15.6"` → `"opensuse-leap"`
- Maps via `NAME_MAP`: 13 entries → 9 SVG icons
- Fallback: generic `linux.svg` (penguin logo)
- 9 distro SVGs: ubuntu, debian, fedora, opensuse, archlinux, kalilinux, alpine, centos, oracle

---

## Key State Distribution

State is distributed across domain hooks, App.tsx only holds cross-domain coordination:

| State | Location | Purpose |
|---|---|---|
| `projects`, `activeProjectId`, `activeProject` | `useLocalProjects` | Local project state |
| `wslEntries`, `activeWslKey`, `activeWslProject` | `useWslProjects` | WSL project state |
| `remoteEntries`, `activeRemoteKey`, `activeRemoteProject` | `useRemoteProjects` | SSH project state |
| `remoteAuthStore` | `useRemoteProjects` | In-memory SSH auth (not persisted) |
| `pendingAuthEntry` | `useRemoteProjects` | Entry waiting for re-login |
| `config` | `useAppConfig` | App configuration (persisted) |
| `sideTerminalOpenMap` | `useLocalProjects` | Per-project local side terminal state |
| `wslSideTerminalOpen`, `remoteSideTerminalOpen` | respective hooks | Side terminal open sets |
| `activeWorktreePath`, `openedWorktrees` | `useWorktreeState` | Per-project worktree state |

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Q` | Cycles through all items (local → WSL → SSH) |
| `Ctrl+1~9` | Switches to nth item in unified list |
| `Ctrl+Alt+T` | Opens side terminal for currently active project type |
| `Ctrl+W` | Closes side terminal for currently active project type |
| `Ctrl+R` | Refresh/rebuild current terminal DOM from cached PTY |
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

### Session 4 — Refactoring & Optimization

21. **App.tsx full modular refactor** (`820cc6e`):
    - Extracted 4 domain hooks: `useAppConfig`, `useLocalProjects`, `useWslProjects`, `useRemoteProjects`
    - Extracted `MainContent` component for view rendering
    - Consolidated types: `AppConfig`/`DiffMode` moved to `types.ts`
    - App.tsx: 1036 → 432 lines
22. **Component directory restructuring** (`157c2de`):
    - Created `terminal/`, `connections/`, `layout/` directories with barrel exports
    - Split `WSLDialog.tsx` (973 lines) into 3 focused files
    - Moved `RemoteItems` from `project/` to `connections/`
    - Moved `AddProjectModal` into `project/`
23. **Shared utility extraction**: `src/utils/terminal.ts` — `DEFAULT_FONT_FAMILY` deduplicated from 5 files
24. **React.memo applied** to 7 components: MainContent, TitleBar, ProjectItem, FileTree, AgentSelector, WSLItem, RemoteItem
25. **useMemo optimizations**: `buildTree(changedFiles)`, font list merge/sort, worktree branch filtering
26. **useCallback stabilizations**: `useToast.showToast`, `useSideTerminalResize.handleSideDividerMouseDown`, all agent selection callbacks in App.tsx
27. **Inline callback extraction**: App.tsx TitleBar/ProjectSidebar props converted to named `useCallback` functions

### Session 5 — Agent Icons & SVG Icon System

28. **Agent icons** (`794b61d`):
    - Downloaded 7 agent logos (5 PNG + 2 SVG): claude-code, opencode, qwen, gemini, codex, qoder, codebuddy
    - Created `AgentIcon` component (`layout/AgentIcon.tsx`) — resolves `AgentConfig.icon` filename → Vite-imported URL
    - Created `src/utils/agents.ts` mapping; `AgentConfig.icon` changed from emoji to filename string
    - Removed aider agent, added qoder and codebuddy
    - Replaced `<span className="agent-icon">` with `<AgentIcon>` in 4 components: TitleBar, AddProjectModal, WSLItem, RemoteItem
    - Added `AgentIcon` to `layout/index.ts` barrel export
29. **SVG icon system** (`81f6167`):
    - Replaced emoji icons (🐧/🖥️) with SVGs: `linux.svg` (WSL), `server.svg` (SSH)
    - Added CSS `fill: currentColor; stroke: currentColor; color: var(--text-secondary)` for theme color inheritance
    - Removed expand/collapse chevrons from all sidebar items
    - Kept 📁 folder emoji in suggestion items and empty state (no SVG replacement)
30. **WSL distro logos** (`81f6167`):
    - Added 9 distro-specific SVGs to `src/assets/distros/`
    - Created `src/utils/distros.ts` with `getDistroIcon()` — fuzzy matching strips version suffixes
    - `WSLDialog` suggestions now show distro logo instead of 📁
    - `WSLItem` sidebar card shows distro logo (uses `getDistroIcon(wslEntry.distro_name)`)
31. **Project avatar revamp** (`81f6167`):
    - Replaced generic repo icon with colored first-letter avatar in `ProjectItem`
    - Hash-based color: `name.charCodeAt(0) % HUE_COUNT` → HSL color
    - CSS class: `.project-avatar { width: 20px; height: 20px; border-radius: 4px; }`
32. **Add menu dropdown positioning** (`81f6167`):
    - Fixed dropdown to be right-aligned (`right: 0; left: auto`) below the + button
33. **Vite env declarations** — added `declare module "*.png"` and `declare module "*.svg"` to `vite-env.d.ts`

### Session 6 — Platform Gating, Persistence, Custom Agents, Terminal Refresh

34. **WSL platform gating** (`0bd083b`):
    - Added `IS_WINDOWS` constant in `src/utils/platform.ts` using `navigator.platform`
    - Frontend: WSL entries loading, sidebar sections, and add-WSL button conditionally rendered via `IS_WINDOWS`
    - Backend: all WSL commands gated with `cfg!(target_os = "windows")` (empty fallback on non-Windows)
35. **Persistence unification** (`ed43799`):
    - Merged `wsl_entries.json` and `remote_entries.json` into single `sessions.json`
    - Added `wsl_entries: Vec<WSLEntrySession>` and `remote_entries: Vec<RemoteEntrySession>` fields to `SessionStore` with `#[serde(default)]`
    - Auto-migration logic in `storage.rs::load_session()` — reads old files, adds to store, removes old files
    - Removed `save_wsl_entries`/`load_wsl_entries`/`save_remote_entries`/`load_remote_entries` Tauri commands
    - `useWslProjects` and `useRemoteProjects` hooks load from `invoke("load_session")` instead of dedicated commands
36. **Sidebar/side terminal width persistence** (`0033ece`, `728de4a`):
    - Added `sidebar_width: Option<f64>` and `side_terminal_width: Option<f64>` to `SessionStore` (backend) and `save_session` command
    - Sidebar width saved on `mouseup` event via `onSidebarWidthChange` callback
    - Side terminal width saved via `onSideTerminalWidthChange` callback
    - `ProjectSidebar` loads initial width from session store; CSS variable updated via `useEffect([initialSidebarWidth])`
    - `useSideTerminalResize` accepts `initialWidth` prop to restore on startup
37. **Terminal flicker fix** (`3cfad5c`, `c9cc5f6`):
    - **Font loading**: `get_system_fonts` PowerShell command spawns `CREATE_NO_WINDOW` flag to avoid visible console window flash
    - **Blocking call**: `get_system_fonts` changed from sync to `async fn` to not block main thread
    - **Re-render bypass**: `useAppConfig.saveConfig` uses shallow comparison (`shallowEqual`) before `setConfig`; `React.memo` added to `TerminalView` with custom comparator
    - **Resize during drag**: `suppressTerminalResizeRef` pattern in `App.tsx` — sidebar/side-terminal drag suppresses `fitAddon.fit()` to prevent flicker
38. **Custom Agent CLI support** (`29cddc8`):
    - New "Agents" tab in `SettingsPanel` — shows built-in agents (read-only command with double-click editing) and custom agents (add/remove)
    - Custom agents stored in `config.json` via `customAgents: AgentConfig[]` field on `AppConfig`
    - `agentCommandOverrides: Record<string, string>` for built-in agent command customization
    - `add_agent`/`remove_agent` backend commands enhanced to sync with `config.json` on disk
    - `cli.svg` icon added for custom agents in `src/utils/agents.ts`
39. **Terminal refresh (Ctrl+R)** (`7943a1b`):
    - Added `refreshTerminal()`, `refreshWslTerminal()`, `refreshRemoteTerminal()`, `refreshSideTerminal()` functions in terminal components
    - `Ctrl+R` shortcut in `useKeyboardShortcuts.ts` — destroys and rebuilds the xterm DOM from cached PTY without losing session state
    - WSL/Remote terminals wired with `wslRebuildCallbacks`/`remoteRebuildCallbacks` Maps (previously `_setRebuildCount` unused)
    - `TerminalCache` now stores `unlistenClosed` — called during refresh to prevent double rebuild race condition from `terminal-closed-{sid}` listener
40. **Dead code cleanup** (`f8e0bff`):
    - Removed unused structs: `WSLProject`, `WSLEntry`, `RemoteProject`, `RemoteEntry` in `state.rs` (replaced by `WSLEntrySession`/`RemoteEntrySession`)
    - Removed `RemoteTerminalManager::close_all_sessions()` (never called)
    - Added `#[allow(dead_code)]` on `input_tx` in `remote.rs` (used indirectly via closure)
    - Zero Rust compiler warnings

### Session 7 — WSL/SSH Parity, IDE Icons, DiffView, Credentials

41. **Project collapse/expand** — clicking project header selects the project, clicking the avatar/icon toggles collapse. Applied to `ProjectItem`, `ProjectItemCard`, `WSLItem`, `RemoteItem`.
42. **FileTree double-click fix** — changed expanded state from `useState<Record<string, boolean>>` to `useState<Set<string>>` with `useCallback` toggle handler.
43. **WSL/SSH button consistency** — Git menu moved inside `.gh-project-actions` div (visible on hover only); IDE button placed outside actions; branch/worktree indentation unified to `14px`.
44. **WSL/SSH IDE button** — always visible when `onOpenIde` callback exists (not gated by `selected_ide`); uses `getIdeIconByCommand()` for icon resolution.
45. **Branch badge unification** — worktree and project branch badges both use `.gh-branch-inline` CSS class with `title` attribute for hover tooltip.
46. **WSL/SSH worktree support** — 8 requirements implemented:
    - Filter current branch's worktree from available list
    - Worktree path persistence via `worktree_state` in `sessions.json` (`save_session` with `worktree_state` param)
    - Ctrl+N cycling for WSL and SSH worktrees via `useKeyboardShortcuts` (`wslOpenedWtRef`/`remoteOpenedWtRef`)
    - Side terminal uses active worktree path (`activeWslWorktreePath`/`activeRemoteWorktreePath`)
    - Title bar branch syncs with active worktree branch (`activeWslWorktreeBranch`/`activeRemoteWorktreeBranch`)
47. **SSH credential persistence** — `saved_auth: Option<String>` Base64 field on `RemoteEntrySession`; auto-restore via `restoreAuthFromEntries()` on load; "记住密码" checkbox in `RemoteAuthDialog` with `saved_auth` returned on success.
48. **Custom radio/checkbox styles** — `.custom-radio` and `.custom-checkbox` CSS classes matching dark theme; used for SSH auth type selector.
49. **WSL/SSH changed files as FileTree** — replaced flat file list in `ProjectBody` (RemoteItems) with `buildTree()` + `FileTree` component; `onSelectFile` adapter: `onSelectFile={(_, fp) => onSelectFile(fp)}`.
50. **DiffView flicker fix** — `useRef` with `JSON.stringify` serialized key prevents re-loading diff content on every parent re-render (previously `[diffSource]` dependency with inline object literal caused unnecessary re-renders).
51. **IDE icons from assets** — added `src/assets/ides/` with 8 SVG/PNG files (vscode, cursor, zed, idea, goland, rustrover, pycharm, default); `getIdeIconSrc(ideId)` and `getIdeIconByCommand(cmd, overrides)` in `utils/idePresets.ts`; `SettingsPanel` and `AddProjectModal` use new icons.
52. **IDE button visibility** — `.gh-ide-btn` only visible on `.active` project hover via CSS (`opacity`/`visibility` transition); custom override IDEs resolve icon via reverse lookup: command → `ideCommandOverrides` → presetId → icon.
53. **CREATE_NO_WINDOW on Windows** — `no_window_cmd()` helper added to `remote.rs` and `git.rs`; applies `CommandCreationFlags(0x08000000)` on `#[cfg(windows)]`, no-op on other platforms.

---

## Known Issues / Still Needs Work

- SSH credential persistence works but auto-fill on reconnect could be improved (currently restored in `useEffect` after `remoteEntries` load, but edge cases with partial saves may exist)
- SSH path autocomplete dropdown click-selection may still have issues (z-index fix applied, needs verification)
- IDE command override → icon resolution only works for presets, not fully custom IDEs added via the settings UI

---

## Relevant Files

### Frontend (`src/`)

| File | Purpose |
|---|---|
| `src/App.tsx` | Composition layer; domain hooks, cross-domain coordination, `suppressTerminalResizeRef`, `saveSession` (ref-based), width callbacks; `wslOpenedWt`/`remoteOpenedWt` worktree state; `restoreAuthFromEntries()`, `ideCommandOverrides` to sidebar |
| `src/types.ts` | All shared interfaces: `AppConfig` (with `customAgents`, `agentCommandOverrides`, `sidebar_width`, `side_terminal_width` persisted via config.json); `RemoteEntrySession.saved_auth` |
| `src/styles.css` | Global styles (including `.project-avatar`, `.agent-icon`, SVG color inheritance, `.custom-radio`, `.custom-checkbox`, `.gh-branch-inline`, `.gh-ide-icon`, `.gh-ide-btn` active-only visibility) |
| `src/utils/platform.ts` | `IS_WINDOWS = navigator.platform.toLowerCase().includes("win")` — gates WSL UI |
| `src/utils/terminal.ts` | `DEFAULT_FONT_FAMILY`, `buildFontFamily()` — shared by all terminal components |
| `src/utils/agents.ts` | `getAgentIconSrc(icon)` — resolves agent icon filename → Vite-imported URL; includes `cli.svg` for custom agents |
| `src/utils/distros.ts` | `getDistroIcon(name)` — WSL distro name fuzzy match → SVG logo |
| `src/utils/idePresets.ts` | `getIdeIconSrc(ideId)`, `getIdeIconByCommand(cmd, overrides)` — IDE icon resolution; `default.svg` fallback |
| `src/vite-env.d.ts` | Module declarations for `*.png` and `*.svg` imports |
| **assets/** | |
| `src/assets/agents/` | 7 agent logo files (5 PNG + 2 SVG): claude-code, opencode, qwen, gemini, codex, qoder, codebuddy |
| `src/assets/distros/` | 9 WSL distro SVGs: ubuntu, debian, fedora, opensuse, archlinux, kalilinux, alpine, centos, oracle |
| `src/assets/linux.svg` | Generic WSL icon (penguin, Simple Icons) |
| `src/assets/server.svg` | SSH icon (Charm Icons) |
| `src/assets/folder.svg` | Folder icon (Charm Icons) |
| `src/assets/ides/` | 8 IDE SVG/PNG files: vscode.svg, cursor.png, zed.png, idea.svg, goland.svg, rustrover.svg, pycharm.svg, default.svg |
| **terminal/** | |
| `src/components/terminal/TerminalView.tsx` | Local terminal; `terminalCache` (with `unlistenClosed`), `createTerminalForProject`, `launchAgentInTerminal`, `refreshTerminal()`; `React.memo` with custom comparator |
| `src/components/terminal/SideTerminalView.tsx` | Local side terminal; `onDestroy` prop; `refreshSideTerminal()` |
| `src/components/terminal/WorktreeTerminalView.tsx` | Worktree terminal; reuses TerminalView cache |
| `src/components/terminal/WSLTerminalView.tsx` | WSL terminal; `ResizeObserver`, `useEffect([width])`, `wslRebuildCallbacks`, `refreshWslTerminal()` |
| `src/components/terminal/RemoteTerminalView.tsx` | SSH terminal; `ResizeObserver`, `useEffect([width])`, `remoteRebuildCallbacks`, `refreshRemoteTerminal()` |
| `src/components/terminal/index.ts` | Barrel export including all refresh functions |
| **connections/** | |
| `src/components/connections/WSLDialog.tsx` | WSL distro/path selection dialog |
| `src/components/connections/RemoteDialog.tsx` | SSH server config + project path dialog; `saveCredentials` checkbox; `onAdd` includes `saved_auth` |
| `src/components/connections/RemoteAuthDialog.tsx` | SSH re-authentication dialog; "记住密码" checkbox; `onSuccess` returns `saved_auth` |
| `src/components/connections/RemoteItems.tsx` | `WSLItem`, `RemoteItem` sidebar components; `ActiveWslKey`, `ActiveRemoteKey` types; uses `AgentIcon` + `getDistroIcon()`; `ProjectBody` uses `buildTree`+`FileTree`; `ideCommandOverrides` prop |
| **project/** | |
| `src/components/project/ProjectSidebar.tsx` | Left sidebar; accepts `initialSidebarWidth`, `onSidebarWidthChange`, `suppressResizeRef`; CSS variable update via `useEffect([initialSidebarWidth])` |
| `src/components/project/ProjectItem.tsx` | Local project card; `useMemo` for `buildTree` + branch filtering; `filteredWorktrees` (excludes current); avatar click toggles collapse; IDE icon via `getIdeIconByCommand`; `ideCommandOverrides` prop |
| `src/components/project/FileTree.tsx` | Changed file tree; `buildTree` function; `useState<Set<string>>` expanded state with `useCallback` toggle |
| `src/components/project/GitDialog.tsx` | New branch/worktree dialog |
| `src/components/project/AddProjectModal.tsx` | Agent + IDE selection modal; IDE icons via `getIdeIconSrc()` |
| `src/components/MainContent.tsx` | Cross-domain composition; forwards `suppressResizeRef` and `agentCommandOverride` to `TerminalView`; WSL/SSH side terminal uses worktree paths |
| `src/components/DiffView.tsx` | Git diff viewer; `useRef` lastLoadKey prevents flicker on parent re-render |
| `src/components/SettingsPanel.tsx` | Settings panel with General/Theme/Agents tabs; Agents tab: built-in agent command editing + custom agent CRUD; IDE icons via `getIdeIconSrc()` |
| **layout/** | |
| `src/components/layout/TitleBar.tsx` | App title bar; agent selectors for all project types; `activeWslWorktreeBranch`, `activeRemoteWorktreeBranch` props |
| `src/components/layout/WindowControls.tsx` | Min/max/close buttons |
| `src/components/layout/AgentSelector.tsx` | Agent selection dropdown |
| `src/components/layout/AgentIcon.tsx` | Agent logo renderer; resolves `AgentConfig.icon` filename; fallback 🤖 |
| **hooks/** | |
| `src/hooks/useAppConfig.ts` | Config load/save with shallow comparison + CSS variable sync |
| `src/hooks/useLocalProjects.ts` | Local project CRUD + state; takes `SaveSessionFn` callback |
| `src/hooks/useWslProjects.ts` | WSL project CRUD + state; loads from unified `load_session`; takes `SaveSessionFn` callback |
| `src/hooks/useRemoteProjects.ts` | SSH project CRUD + state + auth; loads from unified `load_session`; takes `SaveSessionFn` callback; `restoreAuthFromEntries()` auto-restores saved auth on load |
| `src/hooks/useToast.ts` | Toast notification (useCallback) |
| `src/hooks/useSideTerminalResize.ts` | Drag-to-resize; accepts `initialWidth`, `onWidthChange`, `suppressResizeRef` |
| `src/hooks/useWorktreeState.ts` | Per-project worktree state |
| `src/hooks/useKeyboardShortcuts.ts` | All keyboard shortcut logic; `Ctrl+R` for terminal refresh; Ctrl+N: WSL/SSH worktree cycling via `wslOpenedWtRef`/`remoteOpenedWtRef` |

### Backend (`src-tauri/src/`)

| File | Purpose |
|---|---|
| `src-tauri/src/remote.rs` | Full SSH session management; `SSHHandle` with `resize_tx`; IO task `select!` (3 branches); `test_connection`; `list_directories`; `no_window_cmd()` helper with CREATE_NO_WINDOW; `#[allow(dead_code)]` on `input_tx` |
| `src-tauri/src/git.rs` | Git operations; `no_window_cmd()` helper with CREATE_NO_WINDOW on Windows |
| `src-tauri/src/lib.rs` | Tauri commands: `test_remote_connection`, `list_remote_directories`, `create_remote_terminal_session`, `resize_remote_terminal`; WSL commands gated `cfg!(target_os = "windows")`; `get_system_fonts` is `async fn` with `CREATE_NO_WINDOW`; `add_agent`/`remove_agent` sync to `config.json` |
| `src-tauri/src/state.rs` | `SessionStore` with `wsl_entries`, `remote_entries`, `sidebar_width`, `side_terminal_width`, `worktree_state: HashMap<String, String>`; `WSLEntrySession.saved_auth`, `RemoteEntrySession.saved_auth` |
| `src-tauri/src/storage.rs` | `create_session_from_projects` takes `Option<&[...]>` for wsl/remote and `Option<u32>` for widths; preserves `worktree_state`; `load_session` auto-migrates old `wsl_entries.json`/`remote_entries.json` |
| `src-tauri/src/terminal.rs` | Local/WSL terminal session management |
