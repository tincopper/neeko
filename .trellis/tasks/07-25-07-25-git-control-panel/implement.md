# Implementation Plan: Git Control Panel

## Checklist

- [x] 1. Create `src/features/git/components/GitControlPanel.tsx`
  - Shell component: tab bar + keep both panels mounted (`hidden` toggle so draft state survives)
  - Props: see `design.md` interface
  - Tab bar: underline tabs (Settings/Debug style), not segmented pill buttons; changed-file badge

- [x] 2. Add `GitControlPanelWrapper` to `src/app/dock/DockPanelWrappers.tsx`
  - Merge logic from `GitCommitPanelWrapper` and `GitLogPanelWrapper`
  - Single `useActiveProject()` call
  - `tab` state (`'changes' | 'history'`, default `'changes'`)
  - `handleRefreshGit`: calls `baseRefreshGit()` then `refresh()` (log refresh linkage)
  - Keyboard handler gated on `tab === 'history'` (+ contentEditable guard)
  - Export `GitControlPanelWrapper`

- [x] 3. Lazy import for `GitControlPanelWrapper` in `registry.ts`

- [x] 4. Update `src/shared/dock/panelMeta.ts`
  - Add `gitControl`; remove `gitCommit` / `gitLog`; reorder right-zone panels

- [x] 5. Update `src/app/dock/registry.ts`
  - `gitControl` binding; remove old commit/log bindings

- [x] 6. `prototype.html` present in task directory

- [x] 7. Quality check fixes: keep both tabs mounted; contentEditable shortcut guard

## Validation

```bash
npx tsc --noEmit          # must be clean
pnpm test                 # existing tests must pass
```

Manual smoke test:
- Git Control panel appears in dock
- Changes tab: stage/discard/commit/push all work
- History tab: commit list loads, click expands, diff opens
- Commit on Changes → switch to History → new commit visible
- J/K/j/k/c only fire on History tab

## Rollback

Re-add `gitCommit` and `gitLog` to `panelMeta.ts` and `registry.ts`. The original wrappers remain in `DockPanelWrappers.tsx` and can be re-exported immediately.
