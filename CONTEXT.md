# Neeko — Domain Glossary

> Canonical vocabulary for this project. Use these terms and no others when writing code, issues, PRDs, and test descriptions.
> For architecture details (module layout, type definitions, data flows), see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Project

A working directory tracked by Neeko. Three variants exist:

| Term | Scope | Lifespan |
|------|-------|----------|
| **Local project** | Native filesystem directory. Has an initial main terminal created at project-add time, active view, collapsed state. Can also host task-runner terminals. | Persistent (stored in session). |
| **WSL project** | Directory inside a Windows Subsystem for Linux distro. Terminal sessions are 1:N (on-demand per tab). | Persistent (stored in session). |
| **Remote project** | Directory on an SSH server. Terminal sessions are 1:N (on-demand per tab). | Persistent (stored in session). |

The frontend also has a **Unified project** — an adapter view that flattens all three variants into a single interface for cross-type operations (git, file browsing).

---

## Agent

An AI CLI tool configured to run in a terminal (e.g. opencode, claude-code, gemini, codex, qoder, codebuddy). Each agent record specifies the executable command, arguments, and prompt wiring. Built-in agents are pre-configured; custom agents are user-defined via settings.

---

## IDE

A configured code editor (VS Code, Cursor, Zed, IntelliJ IDEA, GoLand, RustRover, PyCharm). Each IDE record specifies its launch command. Users can add custom IDEs and override commands for built-in ones. The "Open in IDE" action launches the project's selected IDE at the project path.

---

## Skill

A reusable AI capability packaged as a directory containing a `SKILL.md` manifest. Skills can be sourced from:

- **Local** — a directory on disk.
- **Git** — a remote git repository (branch/tag/subpath).
- **Marketplace** — the skillssh registry.

Once installed, a skill is managed in a central repository (`~/.neeko/skills/`) and synced to agent tool directories via symlink or copy.

---

## Tag Group

An organizational bundle that groups skills under a persona or role (e.g. "backend engineer", "designer"). All skills in a tag group inherit the group's enabled/disabled state. Tag groups can be bound to specific projects or left global.

---

## Terminal

A full-stack interactive shell: an xterm.js component in the frontend wired to a PTY/SSH process on the backend, tracked by a cache entry for DOM detach/reattach across tab switches. Creating a terminal atomically creates all three layers; closing it tears them all down. A project can have multiple terminals — the main interactive shell plus any number of task-runner terminals. The backend component was formerly called `TerminalSession` — the canonical term is now simply **Terminal**.

- **Main terminal** — the default interactive shell for a project.
- **Task terminal** — spawned by the task runner with a specific command (instead of a shell). Managed by `taskStore`.
- **WSL/Remote terminal** — created on demand when the user opens a terminal tab for a WSL/Remote project. No persistent 1:1 terminal exists.

Destroying a terminal's cache entry forces a clean-slate recreation — used by the task runner when reusing a finished task tab.

---

## Tab

A content panel inside the editor area. Kinds:

| Kind | What it displays |
|------|-----------------|
| `terminal` | xterm.js PTY session (optionally with a task command instead of a shell) |
| `file` | Text file editor |
| `diff` | Git diff viewer (unified or split) |
| `gitLog` | Commit history browser |
| `html-preview` | Rendered HTML file preview |

A task-runner tab is a `terminal`-kind tab that spawns a specific command rather than an interactive shell. It carries extra metadata: the task command and a config ID for lifecycle tracking.

---

## Tab Group

An ordered collection of `Tab` objects scoped to one project. Only the active project's tab group is rendered at any time.

---

## Editor Split

A left/right layout dividing the editor area into two tab groups. A tab can be **pinned** — it remains visible on one side while the other side continues normal navigation. The split ratio and pin state are persisted in the dock store.

---

## Dock Panel

A collapsible sidebar panel managed by the dock system. **Dock** is the canonical term — "sidebar" and "panel" are synonyms in conversation but all state lives in `dockStore`.

- **Left dock** — the project sidebar (project list + worktree picker). Width is persisted as a percentage.
- **Right dock** — tool panels (Files, Git, Browser, Settings, Skill Manager).

Panel visibility, stacking order, and width are persisted in localStorage via `dockStore`. The left dock's pixel width (used for TitleBar layout offset) is computed from the percentage × window width — there should be no duplicate `leftPanelWidth` outside dockStore.

---

## Worktree

A git worktree: a parallel checkout of a branch into a separate directory. Neeko tracks which worktree is **active** (currently viewed) and maintains a list of **opened worktrees** per project. Worktree state is persisted in the session store.

---

## Task Runner

A per-project command runner. Tasks are persisted configuration objects (name + command + scope). Running a task spawns a terminal tab with the command directly (no shell wrapper). Tasks reuse existing terminal tabs via a guard mechanism: if a task tab already exists and is running, it's focused; if it's finished, its stale cache is destroyed and a fresh session is created.

---

## Browser

An embedded WebView window for in-app web browsing and element inspection. The **element picker** injects JavaScript into the page; when the user selects an element, its HTML is sent back to Neeko via the `neeko://` protocol.

---

## Connection Context

A discriminated union carrying the parameters needed to dispatch an operation to the correct backend handler:

- **Local** — just a project ID.
- **WSL** — a distro name + project path.
- **Remote** — host, port, username, auth method + project path.

The unified Git command factory uses the connection context to route calls to the correct command variant (local / `wsl_*` / `remote_*`) without the UI needing to know the project type.

---

## Capabilities

A set of 14 boolean flags describing what operations a project supports. Panels check capabilities rather than switching on project type:

- **Git**: `canCommit`, `canPush`, `canPull`, `canFetch`, `canStage`, `canDiscard`, `canViewLog`, `canCherryPick`, `canRevert`, `canCreateTag`, `canManagePRs`
- **Files**: `canBrowseFiles`, `canEditFiles`
- **AI**: `canGenerateCommitMessage`

For example, WSL/Remote projects have `canEditFiles` and `canGenerateCommitMessage` set to `false`, so the UI hides those controls without knowing the project type. Capabilities are derived from the project type and never vary at runtime.

---

## Active Project

The currently focused project. Its tab group fills the editor area and its dock panels are visible. Only one project can be active at a time. The active project ID is persisted in the session store.

---

## Session

The word "session" appears in two unrelated domains:

- **Persistence suffix** — `ProjectSession`, `WSLEntrySession`, `RemoteEntrySession`, `WSLProjectSession`, `RemoteProjectSession` are snapshots stored in `sessions.json`. The suffix means "persisted record."
- **No relation** — The old `TerminalSession` was the one exception (runtime, not persisted). This has been renamed to **Terminal**.

When you see `*Session` in code, it's a persistence record. When you see **Terminal**, it's a runtime shell.

---

## Session Store

The root persistence container. Stored as `~/.neeko/sessions.json`. Contents:

- Local projects (with terminal history for restore).
- WSL entries (distros + their projects).
- Remote entries (servers + their projects).
- Active project ID, sidebar width, worktree state.

---

## Config

User preferences stored as `~/.neeko/config.json`. Includes theme, font settings, shell path, diff mode, IDE/agent overrides, and keyboard shortcuts.

---

## Watcher

A file system monitor that detects changes to tracked directories. Emits events (`file-changed`, `file-tree-changed`, `git-status-diff`) to the frontend so the UI stays live without polling.
