# C3 Design: Frontend Hook Merge + Connection Boundary

## Goal

Eliminate WSL/Remote parallel hooks, contexts, and store fields. Narrow `connection` feature to connection establishment only.

## Design

### Hook Merges

**`useWslActions` + `useRemoteActions` → `useProjectActions`**

Parameterized by `environment: ProjectEnvironment`:
```typescript
interface UseProjectActionsParams {
  environment: ProjectEnvironment;
  config: AppConfig;
  showToast: (message: string, type?: "info" | "error") => void;
  saveSession: SaveSessionFn;
}
```
Returns unified actions. Internal dispatch to WSL/Remote-specific API calls based on environment.

**`useWslProjects` + `useRemoteProjects` → `useConnectionProjects`**

Parameterized by `environment: ProjectEnvironment`:
```typescript
interface UseConnectionProjectsParams {
  environment: "wsl" | "remote";
  saveSession: SaveSessionFn;
  showToast?: (message: string, type?: "info" | "error") => void;
}
```
Returns unified CRUD operations. Auth handling for remote injected as optional.

### Context Merges

**`WslContext` + `RemoteContext` → `ConnectionProjectContext`**

```typescript
interface ConnectionProjectContextValue {
  entries: ConnectionEntrySession[];  // unified: { id, type: 'wsl'|'remote', ... }
  openSessions: Set<string>;
  // ... unified callbacks
}
```

### Store Changes

**`worktreeStore`**: Remove deprecated fields:
- Remove `wslActiveWtBranch`, `wslOpenedWt`
- Remove `remoteActiveWtBranch`, `remoteOpenedWt`
- Keep `activeWorktreePath`, `activeWorktreeBranch`, `openedWorktrees`, `worktreeStateMap`

**`connectionStore`**: Keep `remoteAuthStore` and `pendingAuthEntry` (auth UI state). `wslEntries`/`remoteEntries` → derived from `projectStore`.

### ProjectsPanel Fix

Remove the `local.push(p)` bug in the Remote branch. Panel regroups by `environment.type` but no longer duplicates remote items.

### Feature Boundary

Move project-level hooks from `connection/` to `project/`:
- `useWslActions`/`useRemoteActions` → `project/hooks/useProjectActions.ts`
- `useWslProjects`/`useRemoteProjects` → `project/hooks/useConnectionProjects.ts`
- Keep dialogs (`RemoteAuthDialog`, `WSLDialog`, `RemoteDialog`) in `connection/`
