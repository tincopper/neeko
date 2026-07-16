# C3 Implementation Plan

## Order

1. Create `project/hooks/useProjectActions.ts` — merge `useWslActions` + `useRemoteActions`
2. Create `project/hooks/useConnectionProjects.ts` — merge `useWslProjects` + `useRemoteProjects`
3. Mark old hooks as deprecated, re-export from new location
4. Merge `WslContext.tsx` + `RemoteContext.tsx` → `project/contexts/ConnectionProjectContext.tsx`
5. Remove deprecated worktree store fields (`wslActiveWtBranch`, `remoteActiveWtBranch`, `wslOpenedWt`, `remoteOpenedWt`)
6. Fix `ProjectsPanel.tsx` remote push bug
7. Update all consumers to use new hooks
8. Delete old hook files after migration

## Validation

```bash
pnpm lint
pnpm type-check
pnpm test:run
```
