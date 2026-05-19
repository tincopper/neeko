# Changelog

All notable changes to this project will be documented in this file.

## [unreleased]

### 🚀 Features

- Project avatar 颜色支持自定义：新建项目时从 10 色调色板随机分配（取代易撞色的 DJB2 hash），用户可在全局 Settings → Project 子面板的 Appearance section 自由切换颜色或重置回默认（hash 兜底）；三端 Local / WSL / SSH schema 与后端命令均已对齐（WSL/SSH UI 入口待后续接入）

### 🎨 Styling

- ProjectsPanel 视觉重设计：Local / WSL / SSH 三端统一为 V1 Reference Faithful 风格（字母色块头像、双行 session、行尾 ↑N / +A -D / ⌘N chip、WSL/SSH 外层 lightweight section header）；下线侧边栏内嵌的 Worktree Changes 文件树（变更明细仍走 DiffView）

## [1.0.4] - 2026-04-11

### 🚀 Features

- Add WSL terminal support (Phase 1)
- Add SSH remote terminal support (Phase 2)
- Add dropdown menu for WSL and SSH options
- Improve WSL dialog with path selector and auto project name
- Improve WSL terminal support with UTF-8 encoding fix and path autocomplete
- Add SSH re-auth dialog, fix terminal resize, refactor App.tsx
- Add real agent icons (SVG/PNG) and AgentIcon component
- Replace emojis with SVG icons for WSL/SSH, add distro-specific logos, and revamp project avatars
- Gate WSL support to Windows only (frontend + backend)
- Persist sidebar and side terminal widths in sessions.json
- Custom Agent CLI support with Settings panel and command override
- Add Ctrl+R terminal refresh with proper PTY cleanup
- WSL/SSH git feature parity, IDE selection, and consistency
- WSL/SSH worktree cycling, SSH credential persistence, file tree hierarchy, UI fixes
- IDE icons from assets, default fallback, command-based icon matching
- 改进SSH打开IDE功能，支持跨平台和Cursor IDE
- Add per-project settings dialog and context menu for agent/IDE selection
- Replace branch list with searchable dropdown in project header
- Support multiple side terminal windows with tile layout
- Add drag-and-drop reordering for local projects
- Add Claude AI assistant integration files
- Add check_agents_installed Tauri command
- Add blockCtrlC prop to prevent Ctrl+C killing Agent in TerminalView
- **agent**: Show CLI installation status in dropdown with toast feedback
- Rebuild blank terminal when selecting None agent + pass showToast to TitleBar
- Smart Ctrl+C - copy selected text via Clipboard API while blocking SIGINT
- Add terminalWrapperRefs and switchAgentInTerminal for instant agent switch
- Add wslWrapperRefs and switchAgentInWslTerminal
- Add remoteWrapperRefs and switchAgentInRemoteTerminal
- Export switch-agent functions from terminal barrel
- Use switchAgentInTerminal in handleSelectLocalAgent for instant switch
- Use switchAgentInWslTerminal in handleSelectWslAgent
- Use switchAgentInRemoteTerminal in handleSelectRemoteAgent
- Filter .neeko/ paths from sidebar file tree
- Add quick worktree creation mode and improve worktree deletion flow

### 🐛 Bug Fixes

- Suppress terminal resize during sidebar/side-terminal drag to eliminate flicker
- Restore sidebar width from session on app startup
- Eliminate terminal flash on Settings panel interaction
- Eliminate WSL/SSH terminal flash on project selection
- Project collapse only on icon click, fix FileTree double-click
- WSL/SSH button consistency, IDE button visibility, CREATE_NO_WINDOW for git/wsl
- Indent WSL/SSH sub-projects under group header
- IDE button only visible on hover when project is active
- Add indentation for file tree child items under branches
- Support custom IDE paths for SSH remote opening
- Use --folder-uri for VSCode SSH remote opening
- Support macOS DMG bundling with custom layout
- Use platform-specific bundle targets for cross-platform builds
- Resolve macOS terminal character duplication on IME input
- Hide window controls on macOS to preserve native traffic light buttons
- Improve error messages and log silent failures
- Resolve TypeScript errors in P2 hook test fixtures
- Resolve CI compilation and JSON syntax errors
- **terminal**: Sync IME textarea position to cursor
- Resolve compilation errors and clean up WSL module cfg guards
- Resolve Rust compilation errors
- Show IDE icon image in add project dialog instead of filename text
- Restore shell line editing and migrate test to __tests__
- Add env default value in createAgent factory
- Restore PTY native echo for Linux terminal input display
- Clear stale worktree path when switching projects
- Allow Ctrl+C when terminal has text selected to preserve copy behavior
- Track selection state via onSelectionChange for reliable Ctrl+C copy handling
- Delay terminal rebuild on None selection to ensure selected_agent=null is applied
- Update selected_agent state when selecting agent, not just for None
- Recover terminal on switchAgentInTerminal failure

### 🚜 Refactor

- Modularize App.tsx into domain hooks and MainContent component
- Reorganize components into functional modules and apply React optimizations
- Unify persistence into single sessions.json with auto-migration
- Extract App.tsx into focused hooks and components
- Replace all inline SVGs with lucide-react icon components
- Split lib.rs into command modules, fix type safety and error handling
- Add UnifiedProject types for adapter pattern
- Add ProjectAdapter interface
- Implement LocalProjectAdapter
- Implement WslProjectAdapter
- Implement RemoteProjectAdapter
- Add useUnifiedProjects hook
- **backend**: Reorganize backend module structure
- **terminal**: Extract shared PTY pipeline functions
- Move AgentConfig to state/agent.rs, add changes stats to sidebar
- Add folder-git-2 icon for New Worktree menu items
- Align WSL/SSH worktree layout with local projects
- Move worktree delete button to left of branch name
- Remove unused FileIcon import
- Extract 4 orchestration hooks from App.tsx
- Use conditional rendering for main terminal instead of display:none

### 📚 Documentation

- Update SESSION_CONTEXT.md with session 3 discoveries and completed work
- Add frontend development conventions and session 4 context
- Update SESSION_CONTEXT.md with session 5 agent icons and SVG icon system
- Update README and session context for session 6 changes
- Update README and SESSION_CONTEXT for session 7 features
- Sync REQUIREMENTS.md with codebase, add AGENTS.md, update SESSION_CONTEXT
- Add Tauri 2 security and API layer specs
- Add main terminal management design spec and implementation plan

### ⚡ Performance

- Optimize React memoization, Rust I/O, Git diff, CSS, and Vite config
- Add React.memo, replace any types, extract inline styles to CSS

### 🎨 Styling

- Add WSL and Remote dialog styles
- Show sidebar action buttons on hover instead of always visible
- Unify branch badge style, add hover title for truncated names

### 🧪 Testing

- Add unit tests with Vitest and Rust built-in testing
- Add backend unit test scaffolding and testability improvements
- Add frontend unit test scaffolding with 126 test cases
- Add P3 component tests for FileTree, DiffView, SettingsPanel

### ⚙️ Miscellaneous Tasks

- Remove dead code and suppress false positive warnings
- Remove accidental .bak file
- **task**: Archive 00-bootstrap-guidelines
- Record journal
- **task**: Archive 04-05-backend-unit-test-plan
- Record journal
- Record journal
- Split frontend and backend lint/test into parallel jobs
- Record journal
- Exclude test directories from tsconfig build config
- Improve CI workflow with dependency management and coverage reports
- Adjust workflow triggers
- Record journal
- Remove coverage report from frontend test
- Ignore generated Tauri schemas
- **trellis**: Add IME cursor position analysis task and PRD
- Record journal
- **task**: Archive 04-08-04-08-branch-display
- Record journal
- **task**: Archive 04-09-multi-side-terminal
- Record journal
- **task**: Archive 04-11-refactor-app
- Record journal
- Add tag trigger and auto-generate release notes for GitHub Releases
- **task**: Archive 04-11-quick-worktree
- Record journal

### ◀️ Revert

- Remove Ctrl+C interception from main terminal

### spec

- Trellis init
- Bootstrap frontend/backend/unit-test development guidelines

## [1.0.3] - 2026-03-25

### 🐛 Bug Fixes

- Disable hardenedRuntime to fix macOS unexpected exit issue

### ⚙️ Miscellaneous Tasks

- Bump version to 1.0.3

## [1.0.2] - 2026-03-25

### 🐛 Bug Fixes

- Show new files in DiffView by reading file content when diff is empty
- Use JavaScript API for directory dialog to fix macOS compatibility
- Add ad-hoc signing for macOS and update release notes with installation instructions

### ⚙️ Miscellaneous Tasks

- Update tauri-action to v0.6.2 to fix release upload
- Add releaseAssetNamePattern to include version in release file names
- Bump version to 1.0.2

## [0.1.1] - 2026-03-24

### 🚀 Features

- 项目折叠状态持久化 - 记住每个项目的折叠状态

### 🐛 Bug Fixes

- Add contents write permission for release creation
- MacOS dialog not opening + upgrade tauri to stable
- Update pnpm-lock.yaml for stable tauri deps
- 修复编译错误 - 所有权和可变借用问题
- 删除项目时持久化会话 + 项目默认折叠 + 消除dead_code警告
- Enable log file creation with create(true) flag
- Resolve terminal backspace deletion and build errors

### ⚡ Performance

- Non-recursive watcher + 10s polling for deep file changes

### ⚙️ Miscellaneous Tasks

- Only trigger build on tag push, add separate CI check for PRs

## [0.1.0] - 2026-03-24

### 🚀 Features

- Enhance DiffView with syntax highlighting, block navigation, and fast git2 diff
- Auto-refresh sidebar when project files change
- Worktree terminals, inline rename, file watch, diff improvements + cleanup

### 🐛 Bug Fixes

- Use async pick_folder to fix Add Project dialog on macOS
- Reorder pnpm setup before node setup in CI workflow
- Remove pnpm version override to avoid conflict with packageManager

## [0.1.0] - 2026-03-22

### 🚀 Features

- Complete Neeko MVP with terminal, diff, git management and agent integration
- Add custom app icon with blue-purple gradient N on dark background
- Add shell selector in settings panel
- Redesign settings as full dialog with left-nav + right-content layout
- Add font family selector in settings with system font discovery
- Set Cascadia Code as default terminal font on Linux
- Add SideTerminalView with Ctrl+Alt+T / Ctrl+W shortcuts
- Add OpenIDE, toast notifications, draggable side terminal divider, and UI polish
- Add side terminal button to project header, fix always-visible buttons
- Improve terminal resize handling and add file logging
- Add EULA, publisher info, and hide console window on Windows

### 🐛 Bug Fixes

- Add missing icon.icns and fix tauri.conf.json schema URL
- Improve terminal reliability and UI dropdown layering
- Resolve Linux PTY and IME compatibility issues
- Add -ExecutionPolicy Bypass to PowerShell on Windows to allow script execution
- Auto-apply -ExecutionPolicy Bypass for PowerShell regardless of how it is configured
- Detect shell exit and auto-restart terminal session
- Graceful process cleanup to prevent subprocess memory leaks
- Resolve Linux Chinese IME duplicate input issue
- Font selector now closes after selection with proper dropdown UI
- SideTerminalView passes real project.id to backend instead of cache key
- Resolve build errors (TS unused vars, CSS brace imbalance, tsconfig references)

### 📚 Documentation

- Update README license to Apache 2.0 and trim redundant sections
- Rewrite README header with better project description and badges
- Add chinese-input-fix.md
- Update README and REQUIREMENTS to reflect current feature set
- Switch README to English as primary, add Chinese version and preview images

### ⚙️ Miscellaneous Tasks

- Remove accidental canvas dev dependency
- Update Cargo.lock with libc dependency
- Add GitHub Actions workflow for multi-platform builds (Windows/macOS/Linux)


