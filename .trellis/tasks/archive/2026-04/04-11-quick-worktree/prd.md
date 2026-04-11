# Quick Worktree Creation Option

## Goal
Add a quick creation mode for worktrees so users only need to type a name instead of filling in both a path and branch name. A toggle switches between quick and custom (current) mode.

## Requirements
- Add a toggle switch to GitDialog (worktree mode) to switch between quick and custom modes
- **Quick mode (default, toggle OFF)**: Single input field for worktree name
  - Path auto-computed as `{projectPath}/.neeko/worktrees/{name}`
  - Branch name = worktree name
  - Always creates a new branch (`newBranch=true`)
  - Parent directory `worktrees/` created automatically by git
- **Custom mode (toggle ON)**: Current behavior — separate path and branch inputs
- Toggle state should persist per-session (component state is fine)
- Quick mode only applies to local projects (WSL/Remote keep existing custom mode)

## Acceptance Criteria
- [ ] Toggle switch visible in "New Worktree" dialog for local projects
- [ ] Quick mode: single name input, confirm button creates worktree at `{projectPath}/worktrees/{name}` with branch `{name}`
- [ ] Custom mode: existing two-input behavior unchanged
- [ ] WSL/Remote worktree dialogs are unaffected (no toggle shown)
- [ ] Path input shows auto-computed path as placeholder or preview in quick mode
- [ ] Enter key submits in quick mode

## Technical Notes
- `DialogState` needs `projectPath` field added (optional, for local projects)
- `ProjectItem.tsx` passes `project.path` when opening dialog
- `GitDialog.tsx` handles toggle UI and mode switching
- Rust backend (`create_worktree`) already supports relative paths via `current_dir(repo_path)`
- Files: `src/components/project/GitDialog.tsx`, `src/components/project/ProjectItem.tsx`, `src/components/project/ProjectSidebar.tsx` (type export)
