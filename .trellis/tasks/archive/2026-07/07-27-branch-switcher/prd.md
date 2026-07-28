# IDEA-2026 style branch switcher panel

## Goal

Redesign Neeko's branch switching experience to match IntelliJ IDEA 2026's VCS Widget pattern: a rich panel with search, favorites, categorized branch lists (Local / Remote), ahead/behind indicators, right-click context menu, and dual entry points (Git sidebar + status bar widget).

## Requirements

1. **Rich panel**: Replace the flat `BranchDropdownContent` dropdown with a partitional panel showing Favorites / Local / Remote sections
2. **Search + keyboard nav**: Type to filter, ↑↓ arrows to navigate, Enter to checkout, Escape to close
3. **Star favorites**: Click star icon to favorite/unfavorite a branch; favorites appear at top in their own section
4. **Favorites persistence**: Store favorites in `~/.neeko/config.json` (via existing `AppConfig`)
5. **Ahead/behind per branch**: Show incoming/outgoing commit counts (reuse existing `AheadBehind` data for current branch only)
6. **Current branch indicator**: Green dot + `CURRENT` label for the active branch
7. **Right-click context menu**: Checkout / Compare with Current / Merge / Rebase / Delete / Rename / Copy Name
8. **Dual entry points**:
   - Git sidebar (existing `BranchInfo` trigger)
   - Status bar (new `BranchStatusBarWidget`)
9. **Remote branches**: Grouped under `☁ Remote (origin)` section
10. **Bottom action bar**: [+ New Branch] [⇄ New Worktree]

## Acceptance Criteria

- [ ] `BranchSwitcherPanel` renders with search, Favorites/Local/Remote sections, ahead/behind, current branch indicator
- [ ] Search filters across all sections in real-time
- [ ] Keyboard navigation (↑↓, Enter, Escape) works correctly
- [ ] Clicking star toggles favorite; favorites persist across app restarts
- [ ] Right-click on branch item opens context menu with all listed actions
- [ ] `BranchInfo` uses the new panel (backward compatible)
- [ ] Status bar shows current branch; clicking opens the same panel
- [ ] `pnpm lint` and `pnpm type-check` pass
- [ ] No regressions in existing Git workflow (checkout, fetch, pull, push still work)
