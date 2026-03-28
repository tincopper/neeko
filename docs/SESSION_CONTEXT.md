# Neeko — Session Context

> Last updated: 2026-03-28 (session 5)

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
├── utils/                 ← 工具函数（terminal.ts, agents.ts, distros.ts, fileIcons.ts, idePresets.ts）
├── types.ts               ← 全局类型定义（单一源）
├── assets/
│   ├── agents/            ← Agent logo（PNG/SVG：claude-code, opencode, qwen, gemini, codex, qoder, codebuddy）
│   ├── distros/           ← WSL 发行版 logo（SVG：ubuntu, debian, fedora, opensuse, archlinux, ...）
│   ├── linux.svg          ← WSL 通用图标
│   ├── server.svg         ← SSH 图标
│   └── folder.svg         ← 文件夹图标
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

### App.tsx Architecture (Session 3 + 4)

Session 3: Hooks extracted: `useToast`, `useSideTerminalResize`, `useWorktreeState`, `useKeyboardShortcuts`.
Components extracted: `TitleBar`, `AddProjectModal`.

Session 4 (full refactor):
- Domain hooks extracted: `useAppConfig`, `useLocalProjects`, `useWslProjects`, `useRemoteProjects`
- `MainContent` component extracted for view rendering
- Types consolidated: `AppConfig` moved to `types.ts`, duplicate `Project`/`AgentConfig` removed
- App.tsx reduced from 1036 → 432 lines (pure composition layer)

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
Has `skipBackendPersist` prop — WSL/SSH pass `true` to skip `set_project_agent` invoke (they persist via `save_wsl_entries` / `save_remote_entries` instead).

### Agent Icon System
`AgentIcon` component (`layout/AgentIcon.tsx`) renders agent logos. `AgentConfig.icon` is a filename (e.g. `"claude-code.png"`, `"qoder.svg"`), resolved via `getAgentIconSrc()` in `utils/agents.ts`. Uses Vite static imports (auto-inline ≤4KB). Fallback: `🤖` emoji if no icon matches.

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
| `src/App.tsx` | Composition layer; calls domain hooks, renders layout |
| `src/types.ts` | All shared interfaces: `Project`, `AgentConfig`, `AppConfig`, `WSLProject`, `RemoteProject`, `AuthMethod`, etc. |
| `src/styles.css` | Global styles (including `.project-avatar`, `.agent-icon`, SVG color inheritance) |
| `src/vite-env.d.ts` | Module declarations for `*.png` and `*.svg` imports |
| `src/utils/terminal.ts` | `DEFAULT_FONT_FAMILY`, `buildFontFamily()` — shared by all terminal components |
| `src/utils/agents.ts` | `getAgentIconSrc(icon)` — resolves agent icon filename → Vite-imported URL |
| `src/utils/distros.ts` | `getDistroIcon(name)` — WSL distro name fuzzy match → SVG logo |
| **assets/** | |
| `src/assets/agents/` | 7 agent logo files (5 PNG + 2 SVG): claude-code, opencode, qwen, gemini, codex, qoder, codebuddy |
| `src/assets/distros/` | 9 WSL distro SVGs: ubuntu, debian, fedora, opensuse, archlinux, kalilinux, alpine, centos, oracle |
| `src/assets/linux.svg` | Generic WSL icon (penguin, Simple Icons) |
| `src/assets/server.svg` | SSH icon (Charm Icons) |
| `src/assets/folder.svg` | Folder icon (Charm Icons) |
| **terminal/** | |
| `src/components/terminal/TerminalView.tsx` | Local terminal; `terminalCache`, `createTerminalForProject`, `launchAgentInTerminal` |
| `src/components/terminal/SideTerminalView.tsx` | Local side terminal; `onDestroy` prop; no PTY destroy on unmount |
| `src/components/terminal/WorktreeTerminalView.tsx` | Worktree terminal; reuses TerminalView cache |
| `src/components/terminal/WSLTerminalView.tsx` | WSL terminal; `ResizeObserver` + `useEffect([width])` |
| `src/components/terminal/RemoteTerminalView.tsx` | SSH terminal; same props as WSL |
| **connections/** | |
| `src/components/connections/WSLDialog.tsx` | WSL distro/path selection dialog |
| `src/components/connections/RemoteDialog.tsx` | SSH server config + project path dialog |
| `src/components/connections/RemoteAuthDialog.tsx` | SSH re-authentication dialog |
| `src/components/connections/RemoteItems.tsx` | `WSLItem`, `RemoteItem` sidebar components; `ActiveWslKey`, `ActiveRemoteKey` types; uses `AgentIcon` + `getDistroIcon()` |
| **project/** | |
| `src/components/project/ProjectSidebar.tsx` | Left sidebar; all project types |
| `src/components/project/ProjectItem.tsx` | Local project card; `useMemo` for `buildTree` + branch filtering |
| `src/components/project/FileTree.tsx` | Changed file tree; `buildTree` function |
| `src/components/project/GitDialog.tsx` | New branch/worktree dialog |
| `src/components/project/AddProjectModal.tsx` | Agent + IDE selection modal |
| **layout/** | |
| `src/components/layout/TitleBar.tsx` | App title bar; agent selectors for all project types |
| `src/components/layout/WindowControls.tsx` | Min/max/close buttons |
| `src/components/layout/AgentSelector.tsx` | `skipBackendPersist` prop for WSL/SSH |
| `src/components/layout/AgentIcon.tsx` | Agent logo renderer; resolves `AgentConfig.icon` filename; fallback 🤖 |
| **hooks/** | |
| `src/hooks/useAppConfig.ts` | Config load/save + CSS variable sync |
| `src/hooks/useLocalProjects.ts` | Local project CRUD + state |
| `src/hooks/useWslProjects.ts` | WSL project CRUD + state |
| `src/hooks/useRemoteProjects.ts` | SSH project CRUD + state + auth |
| `src/hooks/useToast.ts` | Toast notification (useCallback) |
| `src/hooks/useSideTerminalResize.ts` | Drag-to-resize (useCallback) |
| `src/hooks/useWorktreeState.ts` | Per-project worktree state |
| `src/hooks/useKeyboardShortcuts.ts` | All keyboard shortcut logic |

### Backend (`src-tauri/src/`)

| File | Purpose |
|---|---|
| `src-tauri/src/remote.rs` | Full SSH session management; `SSHHandle` with `resize_tx`; IO task `select!` (3 branches); `test_connection`; `list_directories` |
| `src-tauri/src/lib.rs` | Tauri command registrations: `test_remote_connection`, `list_remote_directories`, `create_remote_terminal_session`, `resize_remote_terminal`, etc. |
| `src-tauri/src/state.rs` | `WSLProjectSession`, `RemoteProjectSession` with `selected_agent: Option<String>`; `RemoteEntrySession` with `saved_auth: Option<String>` |
| `src-tauri/src/terminal.rs` | Local/WSL terminal session management |
