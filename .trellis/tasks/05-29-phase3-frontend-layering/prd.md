# Phase 3: Frontend Layering & Isolation

Restructure frontend to match spec §2 directory tree and §1.3-1.4 dependency rules.

## 1. Create api/ layer per feature (12 modules)

Every feature module needs an `api/` subdirectory. Move all `invoke()` calls out of hooks, stores, components, and strategies into dedicated API modules.

### Current state: 59 files with direct invoke()
- Hooks: useLocalProjects, useProjectSelection, useWorktreeActions, etc.
- Stores: skill/store, task/store
- Components: ProjectItem, ProjectsPanel, WorktreeList, GitDialog, CommitDialog, etc.
- Strategies: terminal/strategies/local, wsl, remote
- Layout: DockPanelWrappers

### Target structure per feature:
```
<feature>/
├── api/           # NEW: invoke() wrappers only
│   └── index.ts  # barrel re-export
├── components/
├── hooks/
├── types.ts
├── store.ts
└── index.ts
```

### API naming convention: `<feature>/api/<action>.ts`
Examples: `project/api/addProject.ts`, `git/api/getGitInfo.ts`, `skill/api/fetchSkills.ts`

### Each API file: simple invoke wrapper
```typescript
import { invoke } from '@tauri-apps/api/core';
import type { SomeType } from '../types';

export const someAction = async (payload: Payload): Promise<Result> => {
  return invoke<Result>('command_name', { ...payload });
};
```

## 2. Fix shared/ → features/ reverse imports (6 violations)

| File | Imports from | Fix |
|------|-------------|-----|
| `shared/types/app.ts` | `@/features/settings/types` | Move AppTheme type to shared, re-export from settings |
| `shared/types/adapter.ts` | `@/features/connection/types`, `@/features/project/types` | Move adapter types to shared, re-export from features |
| `shared/utils/diffSource.ts` | `@/features/git/components/diff/types` | Move DiffMode type to shared |
| `shared/utils/browserUtils.ts` | `@/features/browser/store` | Create browser API module, inject via context or inversion |
| `shared/hooks/useKeyboardShortcuts.ts` | 4 features (terminal/project/connection/editor) | Refactor to event-based or dependency injection |

## 3. Fix naming violations

- Rename `src/layout/DockLayout/` → `dock-layout/` (kebab-case)
- Rename `src/features/project/hooks/useActiveProject/` → `active-project/`

## 4. Eliminate duplicate cn.ts

Remove `src/lib/utils.ts` (duplicate), keep `src/shared/utils/cn.ts`.
Update all imports to point to `@/shared/utils/cn`.

## 5. Clean up legacy src/types/

Evaluate whether `src/types/` flat files are still needed or can be superseded by feature-level types.ts.

## 6. Component invoke() cleanup

For components that directly call invoke (ProjectItem, TerminalViewBase, etc):
Replace with hook that calls api layer, or lift to parent.

## Files to modify (summary)

| Scope | Count |
|-------|-------|
| New api/ modules | 12 directories |
| Remove direct invoke from | ~59 files |
| Fix shared/ imports | 6 files |
| Rename directories | 2 |
| Remove duplicate cn | 1 |
| Update barrel index files | 12 |
| Update cross-references | all consumers |

## Completion criteria
- [ ] All 12 features have api/ with invoke() wrappers
- [ ] Zero direct invoke() in components/stores/view strategies
- [ ] Zero shared/ → features/ imports
- [ ] `DockLayout/` → `dock-layout/`, `useActiveProject/` → `active-project/`
- [ ] Single cn.ts source of truth
- [ ] `pnpm tsc --noEmit` passes
- [ ] `eslint src/` passes (once ESLint is set up in Phase 1)
