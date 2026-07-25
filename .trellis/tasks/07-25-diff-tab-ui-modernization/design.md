# Diff tab panel UI modernization — Design

## Current architecture

```
GitLogPanel (right dock)
  → useSingletonDiff
  → Editor Diff tab (kind: diff, singleton or pinned)
  → DiffView
       ├─ combined && files → FileDiffBlock[] (always expanded)
       └─ single file → DiffTable | SplitDiffTable + hunk nav
```

Key files:

| File | Role today |
|------|------------|
| `src/features/git/components/diff/DiffView.tsx` | Toolbar + combined list + single view |
| `src/features/git/components/diff/types.ts` | `DiffViewProps`, `CommitFileChange`, `ViewMode` |
| `src/features/git/components/diff/useDiffData.ts` | Load per path; hunk stats for single file |
| `src/features/git/hooks/useSingletonDiff.ts` | Singleton tab + `scrollToPath` / combined |

## Target architecture

```
DiffView
  ├─ DiffToolbar (shared)
  │    zones: Identity | Stats | Mode | Nav | Structure? | Actions
  ├─ CombinedFileList (combined only)
  │    └─ FileDiffSection[]  (collapsed by default policy)
  │         header (sticky, toggle)
  │         body → existing FileDiffBlock content / tables
  └─ SingleFileBody
       └─ DiffTable | SplitDiffTable
```

## Component contracts

### DiffToolbar props (conceptual)

```ts
type DiffNavMode = 'hunks' | 'files';

interface DiffToolbarProps {
  // Identity
  title: string;           // filename or "Combined"
  subtitle?: string;       // directory or "N files"
  iconSrc?: string;
  // Stats
  additions: number;
  deletions: number;
  // Mode
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  // Navigate
  navMode: DiffNavMode;
  navIndex: number;        // 0-based
  navTotal: number;
  onNavPrev: () => void;
  onNavNext: () => void;
  // Combined structure — single bulk fold toggle (not two buttons)
  showStructureActions?: boolean;
  /** True when every file section is collapsed. */
  allCollapsed?: boolean;
  /** Toggle: collapse all if anything expanded; expand all if all collapsed. */
  onToggleFoldAll?: () => void;
  // Actions
  onReview?: () => void;
  reviewPending?: boolean;
}
```

Responsive: CSS `container-type: inline-size` on toolbar host, or simple width classes; hide `.path`, compact mode labels, move review into overflow under `@[container]`.

### FileDiffSection

```ts
interface FileDiffSectionProps {
  file: CommitFileChange;
  expanded: boolean;
  active: boolean;          // current file in n/N
  viewMode: ViewMode;
  projectId: string;
  diffSource: DiffSource;
  onToggle: () => void;
}
```

- When `!expanded`, do **not** call heavy render path for tables (skip `useDiffData` mount or gate with `expanded`).
- `id={fileblock-...}` preserved for `scrollToPath`.

### Expand state

```ts
// DiffView combined
const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => initialExpanded(files, scrollToPath));
const [currentFileIdx, setCurrentFileIdx] = useState(0);
```

`initialExpanded(files, scrollToPath)` implements PRD R2.4.

## Data flow

### Combined nav

```
onNavNext
  → idx' = min(idx+1, n-1)
  → ensure path in expandedPaths
  → setCurrentFileIdx
  → scroll #fileblock-path into view
  → optional onScrollToPathChange(path) for Git Log sync
```

### From Git Log

```
scrollToPath changes
  → expand path
  → setCurrentFileIdx from files.findIndex
  → scrollIntoView
```

## Visual system

| Element | Token / pattern |
|---------|-----------------|
| Toolbar bg | `bg-bg-secondary` + `border-border` |
| Segmented | same as Git Log Single/All |
| +/- | `text-accent-green` / `text-accent-red` |
| File header | `bg-bg-tertiary/30`, active `bg-bg-selected/40` |
| Status | M blue · A green · D red · R yellow soft badges |
| Mono paths | `font-mono` + `var(--font-size)` steps |

## Compatibility

- Keep `DiffViewProps.combined | files | scrollToPath`.
- Pinned tabs unchanged (`diff_pinned_*`).
- Local working-tree diffs (non-commit) keep single-file path.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Expand-all side of bulk toggle on huge commits | Cap or progressive expand; collapse default |
| Split mode perf × N files | Only mount expanded sections |
| Toolbar still crowded | Overflow menu + container queries |
| Nav semantic confusion | `navMode` strictly files vs hunks |

## Prototype

Interactive reference: `prototype.html` in this task directory.

## Rollout

1. D1 Toolbar (no behavior change to combined expand).
2. D2 Collapse state + headers.
3. D3 File nav + Git Log sync polish.
4. D4 Skeleton/empty/token cleanup + shortcuts.
