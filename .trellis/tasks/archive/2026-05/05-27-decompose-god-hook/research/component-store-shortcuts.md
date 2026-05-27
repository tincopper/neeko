# Research: Component-Store Shortcuts

- **Query**: Find React components/hooks that call zustand stores directly (`useProjectStore`, `useConnectionStore`, `useWorktreeStore`, `useEditorStore`, `useAppViewStore`) instead of routing through the hook/context layer.
- **Scope**: Internal — `src/components/` (components) and `src/hooks/` (hooks, excluding `useAppContainer.ts`)
- **Date**: 2026-05-27

## Exclusions applied

- Store definition files (`src/store/`) — ignored
- `useAppContainer.ts` — known coordination hub
- `src/testing/` — test files

## Findings

### 1. Components accessing stores directly

#### 1A. `useProjectStore` in components — 12 files, 15 call sites

| File | Line | Selector | Classification |
|---|---|---|---|
| `src/components/panels/ProjectsPanel.tsx` | 19 | `(s) => s.projects` | Questionable — `projects` is a full array; no hook wraps this selector |
| `src/components/panels/ProjectsPanel.tsx` | 20 | `(s) => s.activeProjectId` | **Legitimate** — scalar ID |
| `src/components/layout/OpenIdeButton.tsx` | 23 | `(s) => s.activeProject` | **Legitimate** — scalar object |
| `src/components/layout/OpenIdeButton.tsx` | 26 | `(s) => s.openIde` | Questionable — store action, not an event-handler callback |
| `src/components/layout/OpenIdeButton.tsx` | 27 | `(s) => s.setProjectIde` | Questionable — store action called directly from component |
| `src/components/dock/DockBarButton.tsx` | 37 | `(s) => s.activeProjectId` | **Legitimate** — scalar ID used in expression |
| `src/components/terminal/strategies/local.ts` | 21 | `(s) => s.activeProject` | **Legitimate** — scalar object (inside hook-like `useLocalTerminalStrategy`) |
| `src/components/terminal/TerminalView.tsx` | 24 | `(s) => s.activeProject` | **Legitimate** — scalar object |
| `src/components/MainContent.tsx` | 48 | `(s) => s.activeProject` | **Questionable** — component already uses `useWslContext()` / `useRemoteContext()` for WSL/remote, but reads local `activeProject` from store directly instead of via context or `useActiveProject()` |
| `src/components/files/FileViewer.tsx` | 59 | `(s) => s.activeProjectId` | **Legitimate** — scalar ID |
| `src/components/files/FileViewer.tsx` | 60 | `(s) => s.activeProject` | **Questionable** — component should use `useActiveProject()` hook (not yet imported for this purpose) |
| `src/components/layout/TaskRunButton.tsx` | 29 | `(s) => s.activeProject` | **Legitimate** — scalar object |
| `src/components/settings/ProjectPanel.tsx` | 29 | `(s) => s.projects.find(...)` | **Legitimate** — per-project lookup with callback selector |
| `src/components/settings/SettingsView.tsx` | 23 | `(s) => s.projects` | **Legitimate** — full array needed for project list sidebar |
| `src/components/project/ProjectItem.tsx` | 52 | `(s) => s.projects` | **Legitimate** — full array needed for shortcut index calculation |
| `src/components/project/WorktreeList.tsx` | 34 | `(s) => s.projects.find(...)` | **Legitimate** — fallback path lookup when propProjectPath missing |
| `src/components/dock/DockPanelWrappers.tsx` | 56 | `(s) => s.activeProjectId` | **Legitimate** — scalar ID for file tree scope |

#### 1B. `useConnectionStore` in components — 4 files, 8 call sites

| File | Line | Selector | Classification |
|---|---|---|---|
| `src/components/connections/ConnectionProjectCard.tsx` | 102 | `(s) => s.remoteAuthStore` | **Questionable** — This component is inside `RemoteProvider`/`WslProvider` scope; `remoteAuthStore` is available from `useRemoteContext()` |
| `src/components/connections/ConnectionProjectCard.tsx` | 103 | `(s) => s.remoteEntries` | **Questionable** — Same as above; `remoteEntries` available from `useRemoteContext()` |
| `src/components/layout/OpenIdeButton.tsx` | 24 | `(s) => s.activeWslProject` | **Legitimate** — no context provides this in OpenIdeButton's scope |
| `src/components/layout/OpenIdeButton.tsx` | 25 | `(s) => s.activeRemoteProject` | **Legitimate** — same as above |
| `src/components/dock/DockBarButton.tsx` | 38 | `(s) => s.activeWslProject?.project.id` | **Legitimate** — scalar expression |
| `src/components/dock/DockBarButton.tsx` | 39 | `(s) => s.activeRemoteProject?.project.id` | **Legitimate** — scalar expression |
| `src/components/files/FileViewer.tsx` | 61 | `(s) => s.activeWslProject` | **Questionable** — could use `useActiveProject()` or `useWslContext()` |
| `src/components/files/FileViewer.tsx` | 62 | `(s) => s.activeRemoteProject` | **Questionable** — could use `useActiveProject()` or `useRemoteContext()` |

#### 1C. `useWorktreeStore` in components — 7 files, 11 call sites

| File | Line | Selector | Classification |
|---|---|---|---|
| `src/components/connections/ConnectionProjectCard.tsx` | 58 | `(s) => s.activeWslWorktreePath` | **Legitimate** — scalar string; available from context but reasonable direct read |
| `src/components/connections/ConnectionProjectCard.tsx` | 59 | `(s) => s.activeRemoteWorktreePath` | **Legitimate** — scalar string |
| `src/components/project/ProjectGitSection.tsx` | 31 | `(s) => s.activeWorktreePath` | **Legitimate** — scalar string |
| `src/components/project/WorktreeList.tsx` | 44 | `(s) => s.activeWorktreePath` | **Legitimate** — scalar string |
| `src/components/terminal/strategies/local.ts` | 22 | `(s) => s.activeWorktreePath` | **Legitimate** — scalar string (inside hook-like fn) |
| `src/components/terminal/strategies/local.ts` | 23 | `(s) => s.activeWorktreeBranch` | **Legitimate** — scalar string |
| `src/components/terminal/TerminalView.tsx` | 25 | `(s) => s.activeWorktreePath` | **Legitimate** — scalar string |
| `src/components/terminal/TerminalView.tsx` | 26 | `(s) => s.activeWorktreeBranch` | **Legitimate** — scalar string |
| `src/components/MainContent.tsx` | 49 | `(s) => s.activeWorktreePath` | **Legitimate** — scalar string (though `activeWorktreePath` is only used for tabKey construction) |
| `src/components/files/FileViewer.tsx` | 63 | `(s) => s.activeWorktreePath` | **Legitimate** — scalar string |
| `src/components/files/FileViewer.tsx` | 64 | `(s) => s.activeWslWorktreePath` | **Legitimate** — scalar string |
| `src/components/files/FileViewer.tsx` | 65 | `(s) => s.activeRemoteWorktreePath` | **Legitimate** — scalar string |
| `src/components/dock/DockPanelWrappers.tsx` | 219 | `(s) => s.activeWorktreeBranch` | **Legitimate** — scalar string |
| `src/components/dock/DockPanelWrappers.tsx` | 220 | `(s) => s.activeWorktreePath` | **Legitimate** — scalar string |

#### 1D. `useEditorStore` in components — 4 files, 12 call sites

| File | Line | Selector | Classification |
|---|---|---|---|
| `src/components/dock/DockBarButton.tsx` | 40 | `(s) => { ... tab lookup ... }` | **Legitimate** — derived bool based on tab existence |
| `src/components/dock/DockBarButton.tsx` | 60 | `(s) => s.addTab` | **Questionable** — store action, not context callback |
| `src/components/dock/DockBarButton.tsx` | 61 | `(s) => s.closeTab` | **Questionable** — store action |
| `src/components/dock/DockBarButton.tsx` | 62 | `(s) => s.activateTab` | **Questionable** — store action |
| `src/components/dock/DockBarButton.tsx` | 65 | `(s) => s.tabs` (useShallow) | **Questionable** — full tabs object for lookup in `handleClick` |
| `src/components/terminal/TerminalView.tsx` | 50 | `(s) => { ... tab data lookup }` | **Legitimate** — reads tab data for task fields |
| `src/components/MainContent.tsx` | 60 | `(s) => state.tabs[tabKey]` | **Legitimate** — tabs lookup by composite key (would be awkward to context-ify) |
| `src/components/files/FileViewer.tsx` | 89 | `(s) => state.tabs[tabKey]` | **Legitimate** — tabs lookup by composite key |

#### 1E. `useAppViewStore` in components — 2 files, 2 call sites

| File | Line | Selector | Classification |
|---|---|---|---|
| `src/components/settings/SettingsView.tsx` | 21 | `(s) => s.setAppView` | **Legitimate** — action call, only used in SettingsView lifecycle |
| `src/components/layout/AppLayout.tsx` | 135 | `(s) => s.appView` | **Legitimate** — scalar enum read |

---

### 2. Store mutation (`setState`) from outside store files

#### 2A. From components

**1 file, 1 call site — HIGH CONCERN**

| File | Line | Code | Notes |
|---|---|---|---|
| `src/components/dock/DockPanelWrappers.tsx` | 225-236 | `useProjectStore.setState(...)` | `GitCommitPanelWrapper.onRefreshGit` calls `setState` to update `projects` and `activeProject` directly. This is the **only** direct `setState` from a component. |

```typescript
const onRefreshGit = useCallback(async () => {
    // ...
    useProjectStore.setState((state) => {
      const nextProjects = state.projects.map((p) =>
        p.id === project.id ? { ...p, git_info: gitInfo } : p,
      );
      return { projects: nextProjects, activeProject: /* ... */ };
    });
}, [commands, project]);
```

#### 2B. From hooks (expected — hooks are the mutation layer)

These are **by-design** usage patterns, tracked for completeness:

| File | Store | Pattern |
|---|---|---|
| `src/hooks/useLocalProjects.ts:20` | `useProjectStore.setState` | `setProjects` updater wrapper |
| `src/hooks/useLocalProjects.ts:37` | `useProjectStore.setState` | `setActiveProjectId` updater wrapper |
| `src/hooks/useRemoteActions.ts:41` | `useConnectionStore.setState` | `setRemoteEntries` updater |
| `src/hooks/useRemoteActions.ts:50` | `useConnectionStore.setState` | `setActiveRemoteProject` updater |
| `src/hooks/useRemoteActions.ts:65` | `useWorktreeStore.setState` | `setActiveRemoteWorktreePath` updater |
| `src/hooks/useRemoteActions.ts:69` | `useWorktreeStore.setState` | `setRemoteActiveWtBranch` updater |
| `src/hooks/useWslActions.ts:46` | `useConnectionStore.setState` | `setWslEntries` updater |
| `src/hooks/useWslActions.ts:52` | `useConnectionStore.setState` | `setActiveWslProject` updater |
| `src/hooks/useWslActions.ts:68` | `useWorktreeStore.setState` | `setActiveWslWorktreePath` updater |
| `src/hooks/useRemoteProjects.ts:20` | `useConnectionStore.setState` | `setRemoteEntries` updater |
| `src/hooks/useRemoteProjects.ts:26` | `useConnectionStore.setState` | `setActiveRemoteKey` updater |
| `src/hooks/useWslProjects.ts:17` | `useConnectionStore.setState` | `setWslEntries` updater |
| `src/hooks/useWslProjects.ts:23` | `useConnectionStore.setState` | `setActiveWslKey` updater |
| `src/hooks/useWslProjects.ts:29` | `useConnectionStore.setState` | `setActiveWslProject` updater |
| `src/hooks/useAgentActions.ts:53` | `useProjectStore.setState` | Agent selection mutation |
| `src/hooks/useWorktreeState.ts:33` | `useWorktreeStore.setState` | Worktree state mutation |

---

### 3. What the context layer already provides (missed reuse opportunities)

The following contexts exist but some components bypass them:

| Context | Provides | Bypassed by |
|---|---|---|
| `useWslContext()` | `wslEntries`, `activeWslProject`, `activeWslWorktreePath` | `ConnectionProjectCard.tsx`, `OpenIdeButton.tsx`, `FileViewer.tsx` |
| `useRemoteContext()` | `remoteEntries`, `activeRemoteProject`, `remoteAuthStore`, `activeRemoteWorktreePath` | `ConnectionProjectCard.tsx` (remoteAuthStore, remoteEntries), `OpenIdeButton.tsx`, `FileViewer.tsx` |
| `useEditorContext()` | `tabs` (terminal tabs only), `activeTabId` | Components access `useEditorStore` for full tab system (editor/file tabs), which is a different concern — context only provides terminal tabs |
| `useActiveProject()` hook | Unified `project`, `commands`, `capabilities`, `worktreePath` | `FileViewer.tsx` (reads individual stores instead), `MainContent.tsx` (partially, still reads local `activeProject` from store) |
| `useProjectActionsContext()` | Callbacks for project CRUD | Not a state provider — only callbacks |

---

### 4. Summary by category

#### Legitimate bypasses (scalar/derived reads — fine to keep)
- `activeProjectId` reads (5 components)
- `activeProject` object reads (7 components) — scalar reference semantics, acceptable
- `activeWorktreePath` / `activeWorktreeBranch` scalar reads (7 components)
- `appView` enum read (1 component)
- `projects.find(...)` callbacks (3 components) — won't cause excess re-renders with useCallback selector

#### Questionable bypasses (should route through hook/context)
1. **`src/components/connections/ConnectionProjectCard.tsx:102-103`** — reads `remoteAuthStore` and `remoteEntries` from store even though `useRemoteContext()` provides both
2. **`src/components/layout/OpenIdeButton.tsx:26-27`** — calls `s.openIde` and `s.setProjectIde` store actions directly from component; no hook indirection
3. **`src/components/MainContent.tsx:48`** — reads `activeProject` directly while already using `useWslContext()` and `useRemoteContext()` for the other two project types — inconsistency
4. **`src/components/files/FileViewer.tsx:60-62`** — reads `activeProject`, `activeWslProject`, `activeRemoteProject` directly instead of using `useActiveProject()` hook (which is already imported!)
5. **`src/components/dock/DockBarButton.tsx:60-65`** — calls `addTab`, `closeTab`, `activateTab` and reads `tabs` directly from editorStore; these are complex tab mutations happening deep in the component tree

#### Store mutations from components (HIGH concern)
1. **`src/components/dock/DockPanelWrappers.tsx:225-236`** — `useProjectStore.setState()` in a component wrapper (`GitCommitPanelWrapper.onRefreshGit`). Should be moved to a hook or called through context.

#### Store mutations from hooks (expected, but pattern should be unified)
13 hooks across 6 files call `setState()` on stores directly. These don't bypass the hook layer (they *are* the hook layer) but the mutation logic is spread across many files rather than centralized in the store.

---

## Caveats

- `useEditorContext` only provides terminal `Tab[]`, not the full editor tab system (file tabs, split layout), so components reading `tabs` from `useEditorStore` for file/editor tab purposes are NOT bypassing — they need data the context doesn't provide.
- The `useActiveProject()` hook (`src/hooks/useActiveProject/index.ts`) is specifically designed to unify local/WSL/remote project state, but only `DockPanelWrappers.tsx` uses it. `FileViewer.tsx`, `MainContent.tsx`, `TerminalView.tsx`, etc. would benefit from adopting it.
- No components call `useAppViewStore.setState()` directly — that's a good sign. The one `setAppView` read is an action reference, not mutation.
