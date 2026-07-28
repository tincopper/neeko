# Branch Switcher Panel — Implementation Plan

## Step 1: Backend — Add `favoriteBranches` to `AppConfig` types

- [ ] **1.1** Add `favoriteBranches: Record<string, string[]>` to `AppConfig` in `src/shared/types/settings.ts`
- [ ] **1.2** Update `DEFAULT_CONFIG` in `src/features/settings/hooks/useAppConfig.ts`
- [ ] **1.3** Add `favoriteBranches` loading in the `loadConfig` effect in `useAppConfig.ts`
- [ ] **1.4** `cargo check` + `pnpm type-check`

## Step 2: Frontend Store — `gitStore.ts` extension

- [ ] **2.1** Add `favoriteBranches: Record<string, string[]>` to `GitStoreState`
- [ ] **2.2** Add `toggleFavorite(projectId, branchName)` action
- [ ] **2.3** Add `setFavoriteBranches(projectId, branches)` action
- [ ] **2.4** `pnpm type-check`

## Step 3: Core Panel — `BranchSwitcherPanel.tsx`

- [ ] **3.1** Create component file at `src/features/git/components/BranchSwitcherPanel.tsx`
- [ ] **3.2** Implement `BranchSwitcherPanelProps` interface
- [ ] **3.3** Render search bar with auto-focus + Escape handler
- [ ] **3.4** Render section headers: Favorites, Local, Remote
- [ ] **3.5** Render branch items with: icon, name, star, ahead/behind, current badge
- [ ] **3.6** Implement keyboard navigation (↑↓, Enter, Space)
- [ ] **3.7** Implement real-time search filtering
- [ ] **3.8** Render bottom action bar (New Branch, New Worktree)
- [ ] **3.9** Categorize branches: local vs remote (check if name contains `/`)
- [ ] **3.10** Filter out worktree branches (via prop, same as current)
- [ ] **3.11** `pnpm lint` + `pnpm type-check`

## Step 4: Context Menu — `BranchContextMenu.tsx`

- [ ] **4.1** Create component at `src/features/git/components/BranchContextMenu.tsx`
- [ ] **4.2** Implement: Checkout, Compare, Merge, Rebase, Rename, Delete, Copy Name
- [ ] **4.3** Implement callback for each action
- [ ] **4.4** `pnpm type-check`

## Step 5: Status Bar Widget — `BranchStatusBarWidget.tsx`

- [ ] **5.1** Create component at `src/features/git/components/BranchStatusBarWidget.tsx`
- [ ] **5.2** Show current branch name + ahead/behind indicators
- [ ] **5.3** Click opens `BranchSwitcherPanel` via `createPortal`
- [ ] **5.4** Integrate into `StatusBar.tsx` (right side, after notification button)
- [ ] **5.5** `pnpm lint` + `pnpm type-check`

## Step 6: Adapt `BranchInfo.tsx`

- [ ] **6.1** Replace `BranchDropdownContent` usage with `BranchSwitcherPanel`
- [ ] **6.2** Add `favoriteBranches` and `onToggleFavorite` props
- [ ] **6.3** Pass ahead/behind to panel
- [ ] **6.4** Remove `dropdownFooter` composition (now built-in)
- [ ] **6.5** `pnpm lint` + `pnpm type-check`

## Step 7: Quality Gate

- [ ] **7.1** `pnpm lint`
- [ ] **7.2** `pnpm type-check`
- [ ] **7.3** `pnpm test:run`
- [ ] **7.4** `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] **7.5** Manual test: switch branches, favorites persist, status bar works, context menu works

## Rollback

- Revert branch dropdown changes if panel has layout issues
- Favorite branches: stored only in config.json, no data loss on revert
- Status bar widget: remove import from StatusBar.tsx, component still exists
