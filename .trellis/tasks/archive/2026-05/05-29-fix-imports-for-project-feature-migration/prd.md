# Fix Imports for Project Feature Migration

## Overview

Fix all imports for the project feature migration. Files have been moved from `src/components/project/`, `src/hooks/`, `src/store/`, and `src/contexts/` to `src/features/project/`.

## Files Moved

### Components (to `src/features/project/components/`)
- AddProjectModal.tsx
- ContextMenu.tsx
- DraggableProjectItem.tsx
- ProjectGitMenu.tsx
- ProjectGitSection.tsx
- ProjectGroup.tsx
- ProjectGuidePage.tsx
- ProjectItem.tsx
- projectItemTypes.ts
- ProjectSettingsDialog.tsx
- ProjectSidebar.tsx
- SessionChips.tsx
- SessionRow.tsx
- useProjectItemDrag.ts
- useProjectItemMenu.ts
- WorktreeList.tsx

### Hooks (to `src/features/project/hooks/`)
- useLocalProjects.ts
- useUnifiedProjectList.ts
- useProjectSelection.ts
- useCrossTypeSelection.ts
- useWorktreeActions.ts
- useWorktreeState.ts

### Store & Context
- `src/store/projectStore.ts` → `src/features/project/store.ts`
- `src/store/worktreeStore.ts` → `src/features/project/worktreeStore.ts`
- `src/contexts/project-actions-context.tsx` → `src/features/project/context.tsx`

## Import Fix Rules

### For `src/features/project/components/` (was `src/components/project/`)

| Old Import | New Import |
|------------|------------|
| `../../types` | `../../../types` |
| `../../utils/` | `../../../utils/` |
| `../../store/` | `../../../store/` |
| `../../components/` | `../../../components/` |
| `../../hooks/` | `../../../hooks/` |
| `../../contexts/` | `../../../contexts/` |
| `../ui/` | `@/ui/` |
| `@/components/icons` | `@/shared/components/icons` |
| `../shared/` | `../../../components/shared/` |
| `./GitDialog` | `@/features/git/components/GitDialog` |
| `./CommitDialog` | `@/features/git/components/CommitDialog` |
| `./GitCommitPanel` | `@/features/git/components/GitCommitPanel` |
| `./BranchInfo` | `@/features/git/components/BranchInfo` |
| `./ChangesList` | `@/features/git/components/ChangesList` |
| `./CommitForm` | `@/features/git/components/CommitForm` |

### For `src/features/project/hooks/` (was `src/hooks/`)

| Old Import | New Import |
|------------|------------|
| `../types` | `../../types` |
| `../store/` | `../../store/` (but projectStore/worktreeStore → `../store`) |
| `../utils/` | `../../utils/` |
| `../components/terminal` | `../../components/terminal` |
| `../components/project/` | `../components/` (same feature) |
| `../components/layout/` | `../../components/layout/` |
| `../contexts/` | `../../contexts/` |
| `./useWorktreeState` | `./useWorktreeState` (same feature) |

### For `src/features/project/store.ts` and `worktreeStore.ts`

| Old Import | New Import |
|------------|------------|
| `../types` | `../../types` |

### For `src/features/project/context.tsx`

| Old Import | New Import |
|------------|------------|
| `../types` | `../../types` |

## Re-export Stubs

Create re-export stubs for backward compatibility:

### Component stubs (`src/components/project/`)
- For each moved component file, create a re-export stub

### Store stubs
- `src/store/projectStore.ts` → re-export from `@/features/project/store`
- `src/store/worktreeStore.ts` → re-export from `@/features/project/worktreeStore`

### Hook stubs
- `src/hooks/useLocalProjects.ts` → re-export from `@/features/project/hooks/useLocalProjects`
- `src/hooks/useUnifiedProjectList.ts` → re-export from `@/features/project/hooks/useUnifiedProjectList`
- `src/hooks/useProjectSelection.ts` → re-export from `@/features/project/hooks/useProjectSelection`
- `src/hooks/useCrossTypeSelection.ts` → re-export from `@/features/project/hooks/useCrossTypeSelection`
- `src/hooks/useWorktreeActions.ts` → re-export from `@/features/project/hooks/useWorktreeActions`
- `src/hooks/useWorktreeState.ts` → re-export from `@/features/project/hooks/useWorktreeState`

### Context stub
- `src/contexts/project-actions-context.tsx` → re-export from `@/features/project/context`

## Barrel File

Create `src/features/project/index.ts` to export all components, hooks, store, and context.

## Verification

Run `pnpm type-check` to verify all imports are correct.
