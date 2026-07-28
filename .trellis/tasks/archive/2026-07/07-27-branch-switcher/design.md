# Branch Switcher Panel — Technical Design

## Overview

Replace the flat dropdown (`BranchDropdownContent`) with a rich partitional panel (`BranchSwitcherPanel`) inspired by IntelliJ IDEA 2026 VCS Widget. Add a status bar entry point (`BranchStatusBarWidget`). Favorites are stored in `AppConfig.favoriteBranches` and persisted via the existing `save_config` / `load_config` mechanism.

## Component Architecture

```
StatusBar (右区)
 └─ BranchStatusBarWidget (新增)
     └─ onClick → renders BranchSwitcherPanel via createPortal

GitCommitPanel (左侧 Git 面板)
 └─ BranchInfo (改造 → 移除内联 BranchDropdownContent)
     └─ onClick → renders BranchSwitcherPanel via absolute positioning
```

### New Components

| Component | Path | Role |
|---|---|---|
| `BranchSwitcherPanel` | `src/features/git/components/BranchSwitcherPanel.tsx` | Core panel: search + 3 sections + bottom bar + keyboard nav |
| `BranchContextMenu` | `src/features/git/components/BranchContextMenu.tsx` | Right-click context menu for branch items |
| `BranchStatusBarWidget` | `src/features/git/components/BranchStatusBarWidget.tsx` | Status bar widget showing current branch |

### Modified Components

| Component | Change |
|---|---|
| `BranchInfo` | Simplify to trigger container; render `BranchSwitcherPanel` instead of `BranchDropdownContent` |
| `BranchDropdownContent` | Mark deprecated (retain for migration) |

### Modified Types

| File | Change |
|---|---|
| `src/shared/types/settings.ts` | Add `favoriteBranches: Record<string, string[]>` to `AppConfig` |

### Modified Store

| File | Change |
|---|---|
| `src/shared/store/gitStore.ts` | Add `favoriteBranches` state + `toggleFavorite` + `setFavoriteBranches` actions |

## Data Flow

```
[User clicks branch pill / status bar widget]
  → BranchInfo / BranchStatusBarWidget toggle open state
  → BranchSwitcherPanel renders (reads branches from props)
  → User interacts (search, star, arrow keys, click)
  → Panel calls callback:
      onCheckout(branchName) → GitCommitPanel.handleCheckoutBranch → invoke('checkout_branch') → onRefreshGit
      onToggleFavorite(branchName) → gitStore.toggleFavorite → (debounced) saveConfig
      onNewBranch() → open GitDialog
      onNewWorktree() → open GitDialog
  → onClose fires panel dismiss
```

## Panel Layout

```
┌─────────────────────────────────────────┐
│ 🔍  Search branches...                  │  ← auto-focus, type to filter
├─────────────────────────────────────────┤
│ ★  Favorites                    [2]     │  ← section header with count
│   ★  main               ↑0 ↓3          │  ← starred, ahead/behind
│   ★  develop            ↑5 ↓0          │
├─────────────────────────────────────────┤
│ 📁  Local                      [6]     │
│     main                     CURRENT    │  ← green dot + "current" badge
│     feature/new-ui          ↑2 ↓1      │
├─────────────────────────────────────────┤
│ ☁  Remote (origin)            [3]     │
│     origin/main                         │
│     origin/feature/x                    │
├─────────────────────────────────────────┤
│ [+ New Branch]    [⇄ New Worktree]     │  ← bottom action bar
└─────────────────────────────────────────┘
```

## Keyboard Navigation

| Key | Action |
|---|---|
| ↑↓ | Move focus between branch items |
| Enter | Checkout focused branch |
| Space | Toggle favorite on focused branch |
| Escape | Close panel |
| Type | Filter branches across all sections |

## Branch Item Interaction

- **Click on branch name**: checkout
- **Click on star icon**: toggle favorite (does not checkout)
- **Right-click**: open `BranchContextMenu`
- **Hover**: show action icons (star, checkout arrow)

## Context Menu (BranchContextMenu)

```
Checkout
─────────────
Compare with Current
Merge into Current
Rebase onto Current
─────────────
Rename
Delete
─────────────
Copy Name
```

Most context menu items are placeholders for now (just close menu). Only `Checkout` + `Delete` + `Copy Name` + `Compare` will have actual handlers.

## Favorites Persistence

1. `AppConfig.favoriteBranches: Record<string, string[]>` — keyed by `projectId`
2. Stored via existing `save_config` / `load_config` (serialized as part of the config JSON)
3. Loaded on app startup in `useAppConfig` effect
4. Debounced save (300ms) when favorites change to avoid excessive file writes

## Backend Changes

**No new Rust commands needed.** Favorites are stored client-side as part of AppConfig. All branch operations already exist in the backend.

The only backend-dependent data change is that we need to distinguish local vs remote branches, which is already done: remote branches contain `/` (e.g., `origin/feature/x`).

## Edge Cases

- **No branches**: Show "No branches found" centered message
- **No git repo**: `BranchStatusBarWidget` hides entirely; `BranchInfo` shows "Not a git repo"
- **Worktree branches**: Filtered out (same as current behavior)
- **Detached HEAD**: Show "HEAD (detached)" as current branch
- **Single branch**: Still show all sections (can be empty)
