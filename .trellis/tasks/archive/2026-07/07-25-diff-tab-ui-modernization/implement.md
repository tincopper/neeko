# Diff tab panel UI modernization — Implement plan

## Phases

Map to PRD D1–D4. Validate after each phase. Prototype: `prototype.html`.

---

## D1 — Adaptive toolbar + visual tokens

**Goal:** Fix disordered header; align segmented/stats with theme.

### Tasks

1. Extract `DiffToolbar` (or inline structured zones) from `DiffView.tsx`.
2. Identity: filename + truncated dir; full path in `title`.
3. Soft Unified | Split segmented control.
4. Stats pills with `accent-green` / `accent-red`.
5. Single-file: hunk nav on the right; review icon shrinks to overflow when narrow.
6. Combined: show “Combined · N files” + aggregate stats (sum from `files` props).
7. Remove hard-coded hex from toolbar/file-header chrome touched in this phase.

### Validate

- [x] Narrow center pane: no overlapping controls; path truncates.
- [x] Unified/Split matches Git Log soft segment look.
- [x] `pnpm type-check` / relevant tests pass.

---

## D2 — Combined file collapse

**Goal:** File sections collapsible; one bulk fold toggle.

### Tasks

1. Convert `FileDiffBlock` wrapper into collapsible `FileDiffSection` with chevron header.
2. State: `expandedPaths: Set<string>`.
3. Default expand policy R2.4.
4. Toolbar: **single** bulk fold control (not two buttons).
   - `allCollapsed = expandedPaths.size === 0` (or no paths expanded among `files`).
   - Click → if anything expanded, clear set (collapse all); else expand all paths.
   - Icon/tooltip flip with state (`Collapse all` vs `Expand all`).
5. Gate diff data mount on `expanded` to avoid loading all files at once.
6. Preserve `id=fileblock-*` for scroll.

### Validate

- [x] 16-file commit opens without expanding every file. (default expand policy + gated load)
- [x] One bulk toggle collapses all when any section is open; expands all when none are open.
- [x] Header click toggles one file.
- [x] Expanded file still renders unified/split correctly.

---

## D3 — File navigation + Git Log sync

**Goal:** `‹ n/N ›` is file-level in combined mode.

### Tasks

1. `currentFileIdx` + prev/next in toolbar when `combined`.
2. Next/prev expands target and scrolls into view.
3. React to `scrollToPath` updates from Git Log (expand + index + scroll).
4. Optional: call `onScrollToPathChange` if needed for reverse sync.
5. Ensure single-file mode still uses hunk nav only.

### Validate

- [x] Combined: n/N matches files.length; buttons disable at ends.
- [x] Click file in Git Log → correct section expanded and visible. (`scrollToPath` expand+scroll)
- [x] Single-file hunk 1/10 still works.

---

## D4 — Polish

1. Loading skeletons for toolbar/content.
2. Keyboard shortcuts when Diff focused (document in code comments / UI hint).
3. Status letter badges aligned with Git Log.
4. Sweep remaining hard-coded colors in touched files.
5. Manual regression: pinned diff, local file diff, WSL/remote commit if available.

### Validate

- [x] PRD acceptance checklist largely implemented (manual UI pass recommended).
- [x] Prototype behaviors D1–D3 matched in app.

---

## Validation commands

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run src/features/git
# manual: open Git Log → All → large commit → exercise collapse/nav/toolbar widths
```

## Rollback

- Revert DiffView/toolbar commits; singleton + Git Log contracts remain backward compatible if props unchanged.

## Out of scope this task

- Mini file outline sidebar (post-MVP).
- Virtualizing thousands of diff lines inside a hunk (existing).
