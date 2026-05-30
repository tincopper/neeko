# Research: Spec Updates for Phase B Changes

- **Query**: What changed in Phase B and what spec files need updating
- **Scope**: Mixed (internal code audit + spec compliance)
- **Date**: 2026-05-31

## Findings

### 1. core/db.rs — From Stub to Real Implementation

**Before**: `src-tauri/src/core/db.rs` contained only a stub `pub struct DbConfig;` with a doc comment promising future extraction.

**After**: Real functions using `rusqlite`:

```rust
// src-tauri/src/core/db.rs
pub fn open(db_path: &Path) -> Result<Connection, rusqlite::Error> { ... }
pub fn open_in_memory() -> Result<Connection, rusqlite::Error> { ... }
```

Both functions open a SQLite connection with WAL journal mode and foreign keys enabled.

**Impact**: The `core/db.rs` description in `backend/directory-structure.md` says "stub" — needs updating.

---

### 2. Naming Convention Changes (Frontend)

**10 .tsx files renamed to PascalCase** (from camelCase/kebab-case):

| # | Old Name | New Name | Directory |
|---|----------|----------|-----------|
| 1 | `file-actions-context.tsx` | `FileActionsContext.tsx` | `src/app/editor/` |
| 2 | `remote-context.tsx` | `RemoteContext.tsx` | `src/features/connection/contexts/` |
| 3 | `wsl-context.tsx` | `WslContext.tsx` | `src/features/connection/contexts/` |
| 4 | `app-context.tsx` | `AppContext.tsx` | `src/shared/contexts/` |
| 5 | `sidebar-context.tsx` | `SidebarContext.tsx` | `src/shared/contexts/` |
| 6 | `context-menu.tsx` | `ContextMenu.tsx` | `src/ui/` |
| 7 | `dropdown-menu.tsx` | `DropdownMenu.tsx` | `src/ui/` |
| 8 | `resizable-panel.tsx` | `ResizablePanel.tsx` | `src/ui/` |
| 9 | `scroll-area.tsx` | `ScrollArea.tsx` | `src/ui/` |
| 10 | `toggle-group.tsx` | `ToggleGroup.tsx` | `src/ui/` |

**2 directories renamed to kebab-case** (from PascalCase):

| # | Old Name | New Name | Parent Directory |
|---|----------|----------|-----------------|
| 1 | `DockLayout/` | `dock-layout/` | `src/layout/` |
| 2 | `useActiveProject/` | `use-active-project/` | `src/features/project/hooks/` |

**Note**: These renames bring the codebase into compliance with the ESLint rules already declared in `frontend/quality-guidelines.md`:
- `check-file/filename-naming-convention`: `.tsx` → PascalCase, `.ts` → camelCase
- `check-file/folder-naming-convention`: kebab-case (except `__tests__`)

**Impact**: The frontend spec files describe the correct convention rules but their directory trees contain the old names — needs tree updates in `frontend/directory-structure.md`.

---

### 3. Module Visibility Changes (Backend)

**4 domains** changed `pub mod services;` → `mod services;`:

| Domain | File | Change |
|--------|------|--------|
| `agent/` | `mod.rs` | `pub mod services` → `mod services` |
| `connection/` | `mod.rs` | `pub mod services` → `mod services` |
| `terminal/` | `mod.rs` | `pub mod services` → `mod services` |
| `task/` | `mod.rs` | `pub mod services` → `mod services` |

This aligns with the existing backend quality guideline:
> **所有模块为私有**（`mod name;` 不带 `pub`）

The services modules are accessed via `crate::domain::services::fn_name` from within the same crate, or re-exported via `pub use services::*` (as in `task/mod.rs`).

**Impact**: The `backend/quality-guidelines.md` already documents the "所有模块为私有" rule. The visibility changes are consistent with the existing spec — no spec change needed for this topic, but worth noting compliance.

---

## Summary of Required Spec Changes

| Spec File | Change Required | Reason |
|-----------|----------------|--------|
| `backend/directory-structure.md` | Update core/db.rs description from "stub" to real functions | core/db.rs now has real `open()`/`open_in_memory()` |
| `frontend/quality-guidelines.md` | Minor — add note about Phase B renaming compliance or update checklist | Naming violations resolved |
| `frontend/directory-structure.md` | Update renamed directories in tree: `DockLayout`→`dock-layout`, `useActiveProject`→`use-active-project`, also update paths for moved files | Directory tree is stale |
| `backend/quality-guidelines.md` | Minor — add note that 4 domains now use `mod services` (private) per spec | Visibility changes are already aligned with existing rules, but worth documenting compliance achieved |
