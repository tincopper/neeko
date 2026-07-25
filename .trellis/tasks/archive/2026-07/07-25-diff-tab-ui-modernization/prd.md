# Diff tab panel UI modernization

## Goal

Modernize the center **Diff tab** (`DiffView`) so its toolbar adapts cleanly at all widths, combined (multi-file) mode supports file-level collapse and navigation, and the visual language matches Neeko’s dock/Git Log panels (tokens, soft segmented controls, English UI).

## Background

After the Git Log dock refactor, Diff is opened as a singleton tab from the right Git Log panel (single-file or combined). Current pain from product review:

1. **Toolbar is not responsive** — identity (icon + name + full path + stats + review) and controls (Unified/Split + hunk nav) fight for one row; buttons look disordered when narrow.
2. **Combined mode lacks file structure UX** — all files dump expanded; no per-file collapse, no collapse/expand all, no prev/next **file** navigation (only `scrollToPath` from Git Log).
3. **Visual mismatch** — hard-coded greens/reds, solid blue Unified/Split fill, raw sticky file headers; feels older than the polished Git Log panel.

## Requirements

### R1 — Adaptive Diff toolbar (single + combined)

1. Single-row toolbar with explicit **zones**: Identity · Stats · View mode · Navigate · Structure (combined) · Actions/overflow.
2. Responsive behavior without wrapping chaos:
   - **Wide**: filename + truncated path + stats + full controls.
   - **Medium**: hide path (keep full path in tooltip); compact mode toggle.
   - **Narrow**: icon/short labels; secondary actions in `⋯` overflow.
3. Identity uses **filename primary + directory secondary** (same language as Git Log file rows).
4. Unified | Split uses **soft segmented** style (`accent-blue/15`), not solid filled white-on-blue.
5. Stats use theme tokens (`accent-green` / `accent-red`), not hard-coded hex.
6. English UI copy only.

### R2 — Combined mode: file collapse

1. Each file is a **collapsible section** with sticky header: chevron, icon, filename, dir (truncate), status letter (M/A/D/R), `+/-`.
2. Click header toggles expand/collapse for that file.
3. **Single toggle** in toolbar for bulk fold state (not two separate buttons):
   - Label/icon reflects next action: when any file is expanded → **Collapse all**; when all collapsed → **Expand all**.
   - Tooltip describes the next action; narrow layouts use icon-only.
4. Default strategy:
   - ≤3 files: expand all.
   - 4–15 files: collapse all except `scrollToPath` target (or first file if none).
   - >15 files: collapse all except target; expanding all may be progressive if needed for perf.
5. Collapsed files do not mount heavy split tables (performance).

### R3 — Combined mode: file navigation

1. Toolbar shows **file** index `n / N` with prev/next (not hunk index in combined mode).
2. Prev/next: set current file, **expand** it, `scrollIntoView`.
3. Sync with Git Log `scrollToPath` / focused file when user clicks a file in the log expand list.
4. Optional later: mini file outline on wide layouts (not required for MVP).

### R4 — Single-file mode navigation remains

1. Keep hunk prev/next + `n / total` for single-file mode.
2. Do **not** show both file-nav and hunk-nav counters in the same toolbar at once (mode-specific).

### R5 — Visual / theme alignment

1. Toolbar, file headers, badges, and empty/loading states use existing CSS variables only.
2. File header hover/current styles align with Git Log density (no heavy left bar fighting code gutters unless scoped inside content).
3. Loading: skeleton or section-local spinner (not blank full page only).
4. Error: token red + Retry.

### R6 — Prototype tracked with task

1. Interactive HTML prototype lives in this task directory: `prototype.html`.
2. PRD/design/implement reference the prototype; implementation should match accepted prototype behavior for D1–D3.

## Non-goals (v1)

- Rewriting diff algorithms or split word-diff.
- Three-pane IDE layout with permanent file tree (optional wide outline only later).
- Persisting expand state across sessions (nice-to-have, not required).
- Changing Git Log panel behavior except sync hooks already implied by `scrollToPath`.

## Constraints

- Primary surfaces: `src/features/git/components/diff/DiffView.tsx` (+ related tables/hooks).
- Must keep `combined` / `files` / `scrollToPath` contracts used by `useSingletonDiff` + Git Log.
- English UI; match recent Git Log copy style.
- Prefer shared toolbar component for single vs combined to avoid two skins.

## Acceptance Criteria

- [ ] Single-file toolbar remains one clean row from ~360px content width upward; path truncates; overflow used when needed.
- [ ] Unified/Split soft segmented; stats use theme tokens.
- [ ] Combined mode: each file collapsible via header chevron/click.
- [ ] Combined mode: one bulk fold toggle collapses all when anything is expanded, and expands all when everything is collapsed.
- [ ] Combined mode: prev/next file control updates `n/N`, expands target, scrolls into view.
- [ ] Clicking a file in Git Log combined flow still scrolls/focuses the correct file section.
- [ ] Default expand strategy matches R2.4 for multi-file commits.
- [ ] Single-file hunk navigation still works when not combined.
- [ ] No hard-coded `#3fb950` / `#f85149` in new toolbar/header UI.
- [ ] English UI strings only in Diff chrome.
- [ ] `prototype.html` reviewed and linked from this task; implementation phases map to D1–D4.
- [ ] Regression: pinned diff tabs and non-commit local diffs still open.

## Prototype

- Path: `.trellis/tasks/07-25-diff-tab-ui-modernization/prototype.html`
- Open in browser to compare **Before / After**, **Single / Combined**, and width presets.

## Notes

- Complex task: `design.md` + `implement.md` required before `task.py start`.
- Related prior work: archived `07-24-git-log-panel-refactor` (dock Git Log + singleton diff).
- **Default view mode is Combined (`All`)** in Git Log (`combined` initial state `true`); user can still switch to Single.
