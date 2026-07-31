# Git History Full Load + Virtual Scroll

## Goal

Eliminate Git graph line disconnections caused by pagination truncation. Load the entire commit history at once and render it with virtual scrolling to maintain performance for large repositories.

## Background

The current implementation paginates commit history (`PAGE_SIZE = 50`). When a commit's parent falls outside the loaded window, `CommitGraph.computeLayout` truncates the branch segment at the commit's own row (`end = index` instead of `Infinity`). This causes dots to float without connecting lines — the "断头" (broken head) problem.

## Requirements

### R1 — Full Load Backend Support
- `get_commit_log` must support loading all commits in a single request.
- `count = 0` means no limit (omit `-n` flag from `git log`).
- Skip parameter remains available for future pagination fallback.

### R2 — Front-End Full Load
- `useGitLog` must load the complete commit history on first mount.
- Remove pagination state (`hasMore = false`, `loadMore` no-op).
- Keep the `GitLogData` interface unchanged for backward compatibility.

### R3 — Virtual Scrolling in CommitList
- Only render DOM nodes for rows inside the visible viewport plus an overscan buffer.
- Account for inline expand panel height when computing row offsets.
- Maintain all existing interactions: selection, hover, expand, search filter, context menu.
- The `CommitGraph` SVG overlay must scroll naturally with the row list.

### R4 — Graph Rendering Stability
- `computeLayout` continues to run on the full `filteredCommits` array so columns and branch orders are correct.
- `CommitGraph` must not re-render on scroll; it re-renders only when `commits`, `selectedHash`, `hoveredHash`, or expand state changes.

### R5 — Out of Scope (Explicitly Excluded)
- Regression curves when first parent jumps columns (pre-existing, ~74 edges).
- Column packing optimization (pre-existing spacing issue).
- Pagination fallback with truncation markers: implemented. When total commits > THRESHOLD, switch to paged mode; CommitGraph renders dashed-line truncation markers at page boundaries.

## Acceptance Criteria

- [ ] `cargo check` passes for Rust backend changes.
- [ ] `pnpm type-check` passes for all TypeScript changes.
- [ ] `pnpm exec eslint src/features/git/components/gitlog/` passes with no new warnings.
- [ ] Scrolling through commit history in a repo with ≥ 1 000 commits remains smooth (no frame drops).
- [ ] Selecting a commit and expanding its detail panel works correctly; scrolling away and back preserves the panel.
- [ ] Search filtering updates the graph and list correctly; no phantom truncation markers appear.
- [ ] Unit tests cover:
  - `computeLayout` produces correct `nodes` and `segments` for a simple linear + merge history.
  - Virtual-scroll range calculation (`findRowIndex`, overscan) returns expected indices.

## Constraints

- No new npm dependencies (no `react-window`, `@tanstack/react-virtual`, etc.). Virtual scroll is self-implemented.
- IPC payload size limit: 2 MB. Verified empirically that ~2 000 commits ≈ 300 KB JSON, well within bounds.
- Keep edits scoped to `src/features/git/components/gitlog/` and `src-tauri/src/common/git/`.
