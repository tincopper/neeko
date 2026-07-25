# Design: Git Control Panel

## Component Tree

```
GitControlPanelWrapper          (new, in DockPanelWrappers.tsx)
  └── GitControlPanel           (new, src/features/git/components/GitControlPanel.tsx)
        ├── tab bar: [Changes (N)] [History]
        ├── tab === 'changes'  → <GitCommitPanel .../>
        └── tab === 'history'  → <GitLogPanel .../>
```

Both child panels are rendered unchanged. The wrapper owns all data-fetching and passes props down.

## State

```ts
// GitControlPanel (shell only — no data)
const [tab, setTab] = useState<'changes' | 'history'>('changes');

// GitControlPanelWrapper (all data, same as today's two wrappers combined)
// from GitCommitPanelWrapper: aheadBehind, onRefreshGit, handleSelectFile
// from GitLogPanelWrapper:    useGitLog, useCommitDetail, useSingletonDiff,
//                             selectedHash, selectedExpanded, searchQuery,
//                             combined, currentFileIdx, keyboard handler
```

## Refresh Linkage

After a successful commit, `onRefreshGit` already refreshes `project.gitInfo`. The git log's `refresh()` (from `useGitLog`) must also be called so the History tab reflects the new commit immediately:

```ts
const handleRefreshGit = useCallback(async () => {
  await baseRefreshGit();   // updates project.gitInfo (changed files, branch)
  refresh();                // re-fetches git log commits
}, [baseRefreshGit, refresh]);
```

Pass `handleRefreshGit` to `<GitCommitPanel onRefreshGit={handleRefreshGit} .../>`.

## Keyboard Shortcut Gating

The J/K/j/k/c handler in `GitLogPanelWrapper` today attaches to `window`. In the merged wrapper, gate it on `tab`:

```ts
useEffect(() => {
  if (tab !== 'history') return;
  const handler = (e: KeyboardEvent) => { /* existing logic */ };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [tab, /* existing deps */]);
```

## Tab Bar UI

```
┌─────────────────────────────────────┐
│ Changes ③    History                │  ← underline tabs, full-width bar
│ ────────                            │     active: border-b-2 accent-blue
└─────────────────────────────────────┘
```

- Underline tab style (same as Settings ProjectPanel / DebugPanel), **not** segmented pill buttons.
- Full-width `border-b` bar; active tab uses `border-b-2 border-accent-blue text-text-primary`.
- Inactive: `border-transparent text-text-muted`, hover → primary.
- Badge: `changedFiles.length > 0` → small pill; active tab uses accent colors, inactive muted.
- `changedFiles` is passed as a prop from the wrapper (`project.gitInfo?.changed_files ?? []`).

## Dock Registration

### `src/shared/dock/panelMeta.ts`
Add:
```ts
gitControl: { id: 'gitControl', defaultZone: 'right', defaultOrder: 1 }
```
Update `DockPanelId` union to include `'gitControl'`.

Remove `gitCommit` and `gitLog` entries (they are replaced). `defaultOrder` of remaining panels adjusted so there are no gaps.

### `src/app/dock/registry.ts`
Add `gitControl` binding:
```ts
gitControl: {
  title: 'Git Control',
  icon: 'GitBranch',
  component: LazyGitControlPanelWrapper,
  minPanelSize: 280,
}
```
Remove `gitCommit` and `gitLog` bindings.

## Props Interface

```ts
// GitControlPanel.tsx
interface GitControlPanelProps {
  // Changes tab
  project: ProjectView;
  commands: ProjectCommands;
  capabilities: ProjectCapabilities;
  onRefreshGit: () => Promise<void>;
  onSelectFile?: (filePath: string) => void;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  onOpenDialog?: (type: 'new-branch' | 'new-worktree', e: React.MouseEvent) => void;
  aheadBehind: AheadBehind | null;
  changedFileCount: number;
  // History tab
  commits: CommitEntry[];
  logLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  onRefreshLog: () => void;
  selectedHash: string | null;
  selectedExpanded: boolean;
  searchQuery: string;
  combined: boolean;
  detail: CommitDetail | null;
  logFiles: CommitFileChange[];
  detailLoading: boolean;
  detailError: string | null;
  onSelectCommit: (hash: string) => void;
  onOpenDiff: (filePath: string) => void;
  onPinFile: (filePath: string) => void;
  onSearchChange: (query: string) => void;
  onToggleCombined: (combined: boolean) => void;
  focusedFileIndex?: number;
  activeTab: 'changes' | 'history';
  onTabChange: (tab: 'changes' | 'history') => void;
}
```

Tab state (`activeTab` / `onTabChange`) is lifted to the wrapper so the keyboard handler can read it without prop-drilling through GitControlPanel.

## Rollback

If the merged panel causes issues, the old `gitCommit` and `gitLog` entries can be re-added to `panelMeta.ts` and `registry.ts` without touching any component logic — the two original wrappers remain in `DockPanelWrappers.tsx` until the task is confirmed stable.
