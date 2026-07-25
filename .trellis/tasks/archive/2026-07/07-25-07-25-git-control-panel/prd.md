# Merge Commit and Git Log into a single Git Control panel

## Background

Today the Commit panel (`gitCommit`) and Git Log panel (`gitLog`) are two separate dock panels, each with its own dock tab and wrapper. Both read the exact same active-project context and serve the same mental model ("what am I about to commit" vs "what has been committed"). Splitting them into two dock entries costs the user an extra dock slot and forces context switching.

## Goal

Combine the two into one dock panel named **Git Control** with an internal two-tab switch:

- **Changes** tab — the current Commit panel (branch info + changed files + commit form)
- **History** tab — the current Git Log panel (log toolbar + commit list + inline expand)

## Requirements

1. A single dock panel titled **Git Control** with an internal tab bar: `Changes | History`.
2. **Changes** tab renders the existing commit UI unchanged in behavior (staging, discard, commit, commit & push, fetch/pull/push, AI generate, branch/worktree dialogs).
3. **History** tab renders the existing git log UI unchanged in behavior (search, single/all diff mode, commit selection + inline expand, open/pin diff, J/K/j/k/c shortcuts).
4. The **Changes** tab shows a badge with the count of uncommitted changed files when > 0.
5. Default active tab is **Changes**.
6. Committing on the Changes tab keeps the History tab data consistent (a subsequent switch to History reflects the new commit).
7. Git log keyboard shortcuts (J/K/j/k/c) must only be active while the History tab is showing, to avoid hijacking keys while the user is on Changes.
8. Behavior must be identical for Local / WSL / Remote projects (same as the two panels today).
9. English-only UI copy.

## Constraints

- Reuse existing `GitCommitPanel` and `GitLogPanel` components without behavioral changes.
- No backend (Rust) changes.
- `useActiveProject()` context should be read once at the merged wrapper level.

## Acceptance Criteria

- [ ] A `Git Control` dock panel exists with a working `Changes | History` tab switch.
- [ ] Changes tab reproduces every commit-panel action; History tab reproduces every git-log action.
- [ ] Changed-file count badge appears on the Changes tab when there are uncommitted files.
- [ ] Committing then switching to History shows the new commit (refresh linkage works).
- [ ] J/K/j/k/c shortcuts fire only when History is the active tab.
- [ ] `npx tsc --noEmit` clean; existing tests pass.
- [ ] Decision recorded on whether the old `gitCommit` / `gitLog` dock entries are removed or kept.
