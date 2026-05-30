# Fix Imports for Session Feature Migration

## Goal
Fix broken imports after moving session hooks from `src/hooks/` to `src/features/session/hooks/`.

## Requirements
1. Fix relative imports in moved files
2. Create re-export stubs at old locations for backward compatibility
3. Create barrel file for session feature

## Files to Modify
- `src/features/session/hooks/useSessionBootstrap.ts` - Fix relative paths (../../.. instead of ../..)
- `src/features/session/hooks/useSessionPersistence.ts` - Fix relative paths
- `src/hooks/useSessionBootstrap.ts` - Re-export stub
- `src/hooks/useSessionPersistence.ts` - Re-export stub
- `src/features/session/index.ts` - Barrel file

## Acceptance Criteria
- [x] All imports resolve correctly
- [x] `pnpm type-check` passes
