# Research: Rounded Corners + Overflow-Hidden Audit

- **Query**: Audit ALL panels for `rounded-*` without `overflow-hidden` — child content bleeding through rounded corners
- **Scope**: internal
- **Date**: 2026-06-01

## Findings

### Methodology

Searched all `.tsx`/`.ts` files under `src/` for `rounded-*` classes, cross-referenced with `overflow-hidden` on the same element. Focused on **containers/panels** where child content could visually bleed. Small UI elements (buttons, icons, badges) are low-risk and listed separately.

---

### Panel / Container Elements (High Risk)

| # | File | Line | className | Has `rounded-*` | Has `overflow-hidden` | Assessment |
|---|------|------|-----------|-----------------|----------------------|------------|
| 1 | `src/layout/MainContent.tsx` | 196 | `main-content flex-1 flex flex-col overflow-hidden min-h-0 h-full rounded-lg shadow-sm bg-bg-secondary` | ✅ `rounded-lg` | ✅ `overflow-hidden` | ✅ **CORRECT** |
| 2 | `src/features/editor/components/EditorGroupLayout.tsx` | 178 | `flex-1 rounded-lg bg-bg-primary` | ✅ `rounded-lg` | ❌ NO | ⚠️ **POTENTIAL BUG** — outermost ResizablePanelGroup container; children are clipped by ResizablePanel's built-in `overflow-hidden`, but the group itself doesn't clip. If ResizablePanel children overflow their own bounds, corners bleed here. |
| 3 | `src/features/editor/components/EditorGroupLayout.tsx` | 188 | `flex-1 flex flex-col overflow-hidden min-w-0 rounded-lg shadow-sm bg-bg-secondary` | ✅ `rounded-lg` | ✅ `overflow-hidden` | ✅ **CORRECT** (pinned panel) |
| 4 | `src/features/editor/components/EditorGroupLayout.tsx` | 211 | `flex-1 flex flex-col overflow-hidden min-w-0 rounded-lg shadow-sm bg-bg-secondary` | ✅ `rounded-lg` | ✅ `overflow-hidden` | ✅ **CORRECT** (left panel) |
| 5 | `src/features/editor/components/EditorGroupLayout.tsx` | 232 | `flex-1 flex flex-col overflow-hidden min-w-0 rounded-lg shadow-sm bg-bg-secondary` | ✅ `rounded-lg` | ✅ `overflow-hidden` | ✅ **CORRECT** (right panel) |
| 6 | `src/layout/dock-layout/DockZone.tsx` | 52 | `flex h-full flex-col overflow-hidden rounded-lg shadow-sm bg-bg-secondary` | ✅ `rounded-lg` | ✅ `overflow-hidden` | ✅ **CORRECT** |
| 7 | `src/layout/dock-layout/DockBar.tsx` | 25 | `flex w-11 shrink-0 flex-col items-center py-2` | ❌ NONE | ❌ NONE | ✅ N/A — no rounding needed |
| 8 | `src/features/settings/components/SettingsView.tsx` | 216 | `flex-1 flex flex-col overflow-hidden bg-bg-secondary rounded-lg shadow-sm` | ✅ `rounded-lg` | ✅ `overflow-hidden` | ✅ **CORRECT** |
| 9 | `src/features/settings/components/SettingsPanel.tsx` | 228 | `w-[720px] h-[480px] bg-bg-secondary border border-border rounded-[10px] shadow-[...] flex flex-col overflow-hidden` | ✅ `rounded-[10px]` | ✅ `overflow-hidden` | ✅ **CORRECT** |
| 10 | `src/features/task/components/TaskDialog.tsx` | 35 | `w-[420px] bg-bg-secondary rounded-lg shadow-xl flex flex-col overflow-hidden` | ✅ `rounded-lg` | ✅ `overflow-hidden` | ✅ **CORRECT** |
| 11 | `src/features/task/components/TaskRunButton.tsx` | 158 | `absolute top-full right-0 mt-1.5 w-56 bg-bg-secondary border border-border rounded-lg shadow-xl z-50 overflow-hidden` | ✅ `rounded-lg` | ✅ `overflow-hidden` | ✅ **CORRECT** |
| 12 | `src/layout/OpenIdeButton.tsx` | 162 | `absolute top-full right-0 mt-1.5 w-64 bg-bg-secondary border border-border rounded-lg shadow-xl z-50 overflow-hidden` | ✅ `rounded-lg` | ✅ `overflow-hidden` | ✅ **CORRECT** |
| 13 | `src/ui/dialog.tsx` | 52 | `bg-bg-secondary border border-border rounded-lg shadow-xl` | ✅ `rounded-lg` | ❌ NO | ⚠️ **POTENTIAL BUG** — dialog content container. Child content (form fields, text) could bleed corners. |
| 14 | `src/shared/components/AppToast.tsx` | 13 | `fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 p-2.5 rounded-lg text-sm font-medium shadow-lg z-[9999] pointer-events-none max-w-md` | ✅ `rounded-lg` | ❌ NO | ⚠️ **POTENTIAL BUG** — toast message could overflow if very long. |
| 15 | `src/features/editor/components/FileViewer.tsx` | 447 | `bg-bg-primary border border-border rounded-lg shadow-xl p-6 w-[420px] max-w-[90vw]` | ✅ `rounded-lg` | ❌ NO | ⚠️ **POTENTIAL BUG** — externally-modified modal dialog; text content could bleed. |
| 16 | `src/features/git/components/gitlog/CommitDetailPanel.tsx` | 213 | `bg-bg-tertiary/30 rounded-md p-2 shrink-0` | ✅ `rounded-md` | ❌ NO | ⚠️ LOW RISK — inner card, content is text/hash refs unlikely to bleed. |
| 17 | `src/features/skill/components/SkillListSection.tsx` | 11 | `rounded-md border border-border bg-bg-secondary p-2 flex flex-col gap-1.5 animate-pulse` | ✅ `rounded-md` | ❌ NO | ⚠️ LOW RISK — skeleton card, short content unlikely to bleed. |
| 18 | `src/features/git/components/gitlog/CommitList.tsx` | 212 | `absolute right-2 top-10 z-50 w-36 bg-bg-secondary border border-border rounded-md shadow-lg py-0.5` | ✅ `rounded-md` | ❌ NO | ⚠️ **POTENTIAL BUG** — context menu/dropdown, could overflow. |
| 19 | `src/features/project/components/DraggableProjectItem.tsx` | 48 | `relative mb-0.5 rounded-md overflow-visible transition-[...]` | ✅ `rounded-md` | ❌ (has `overflow-visible`) | ✅ **INTENTIONAL** — drag shadow needs to extend beyond bounds. |
| 20 | `src/layout/AppLayout.tsx` | 151 | `flex-1 flex flex-col overflow-hidden bg-bg-secondary relative` | ❌ NONE | ✅ `overflow-hidden` | ✅ N/A — no rounding on this element. |

---

### Dropdown / Popover Elements (Medium Risk)

All absolute-positioned dropdowns and popovers are listed below. These typically clip correctly.

| # | File | Line | Has `rounded-*` | Has `overflow-hidden` | Assessment |
|---|------|------|-----------------|----------------------|------------|
| 1 | `src/features/connection/components/WSLDialog.tsx` | 283 | ✅ `rounded-md` | ❌ (has `overflow-y-auto`) | ⚠️ dropdown list, no overflow-hidden — could bleed |
| 2 | `src/features/connection/components/WSLDialog.tsx` | 338 | ✅ `rounded-md` | ✅ | ✅ CORRECT |
| 3 | `src/features/connection/components/WSLDialog.tsx` | 396 | ✅ `rounded-md` | ✅ | ✅ CORRECT |
| 4 | `src/features/connection/components/RemoteDialog.tsx` | 408 | ✅ `rounded-md` | ❌ (has `overflow-y-auto`) | ⚠️ dropdown list — same pattern as WSL |
| 5 | `src/features/connection/components/RemoteDialog.tsx` | 467 | ✅ `rounded-md` | ✅ | ✅ CORRECT |
| 6 | `src/features/connection/components/RemoteDialog.tsx` | 523 | ✅ `rounded-md` | ✅ | ✅ CORRECT |
| 7 | `src/features/project/components/ProjectSettingsDialog.tsx` | 136 | ✅ `rounded-md` | ✅ | ✅ CORRECT |
| 8 | `src/features/project/components/ProjectSettingsDialog.tsx` | 166 | ✅ `rounded-md` | ✅ | ✅ CORRECT |
| 9 | `src/features/project/components/AddProjectModal.tsx` | 103 | ✅ `rounded-md` | ✅ | ✅ CORRECT |
| 10 | `src/features/project/components/AddProjectModal.tsx` | 161 | ✅ `rounded-md` | ✅ | ✅ CORRECT |
| 11 | `src/features/project/components/ProjectGitMenu.tsx` | 57 | ✅ `rounded-md` | ✅ | ✅ CORRECT |
| 12 | `src/features/project/components/ContextMenu.tsx` | 58 | ✅ `rounded-md` | ✅ | ✅ CORRECT |
| 13 | `src/layout/AppLayout.tsx` | 71 | ✅ `rounded-md` | ✅ | ✅ CORRECT |
| 14 | `src/layout/ActivityBar.tsx` | 80 | ✅ `rounded-md` | ✅ | ✅ CORRECT |
| 15 | `src/shared/components/BranchDropdownContent.tsx` | 53 | ✅ `rounded-lg` | ✅ | ✅ CORRECT |
| 16 | `src/features/settings/components/TerminalPanel.tsx` | 125 | ✅ `rounded-md` | ✅ | ✅ CORRECT |
| 17 | `src/features/git/components/gitlog/CommitList.tsx` | 212 | ✅ `rounded-md` | ❌ | ⚠️ context menu — could bleed |

---

### Small UI Elements (Low Risk)

These are buttons, icons, badges, and decorative elements. `rounded-*` without `overflow-hidden` is generally fine because the content (text, icons) is constrained by padding and won't visually bleed through corners.

| File | Line | Element Type | Has `rounded-*` | Has `overflow-hidden` | Notes |
|------|------|-------------|-----------------|----------------------|-------|
| `TabItem.tsx` | 99 | Tab item | `rounded-md` | ❌ | Low risk — text/icon content |
| `TabBar.tsx` | 140 | Icon button | `rounded-md` | ❌ | Low risk — icon only |
| `EditorGroupPane.tsx` | 265 | Agent button | `rounded-md` | ❌ | Low risk — icon + text |
| `EditorGroupPane.tsx` | 283 | Split button | `rounded-md` | ❌ | Low risk — icon only |
| `EditorGroupPane.tsx` | 294 | Split button | `rounded-md` | ❌ | Low risk — icon only |
| `EditorGroupPane.tsx` | 306 | Close button | `rounded-md` | ❌ | Low risk — icon only |
| `DockBarButton.tsx` | 109 | Bar icon | `rounded-md` | ❌ | Low risk — icon only |
| `AppLayout.tsx` | 66 | Add icon | `rounded-md` | ❌ | Low risk — icon only |
| `AppLayout.tsx` | 107 | Settings icon | `rounded-md` | ❌ | Low risk — icon only |
| `BranchInfo.tsx` | 78 | Branch bar | `rounded-md` | ❌ | Low risk — flex row |
| `BranchInfo.tsx` | 127 | Action group | `rounded-md` | ❌ | Low risk — button group |
| `BranchInfo.tsx` | 154 | Action group | `rounded-md` | ❌ | Low risk — button group |
| `GitCommitPanel.tsx` | 399 | Changes list | `rounded-md` | ✅ | ✅ CORRECT |
| `GitLogPanel.tsx` | 205 | Commit list | `rounded-md` | ✅ | ✅ CORRECT |
| `GitLogPanel.tsx` | 230 | Detail panel | `rounded-md` | ✅ | ✅ CORRECT |
| `SettingsView.tsx` | 243 | Search input | `rounded-md` | ❌ | Low risk — input field |
| Various dropdowns | — | Menu items | `rounded-md` | ❌ | Low risk — text items |

---

### Summary of Bugs Found

#### HIGH PRIORITY (containers where child content could bleed)

| # | File | Line | Issue | Severity |
|---|------|------|-------|----------|
| 1 | `src/features/editor/components/EditorGroupLayout.tsx` | 178 | `ResizablePanelGroup` has `rounded-lg` but no `overflow-hidden`. Child `ResizablePanel` components have built-in `overflow-hidden` (from `resizable.tsx:23`), so immediate children are clipped. However, if the group itself receives any direct child overflow (e.g., resize handle drag artifacts, animation glitches), corners won't clip. | Medium |
| 2 | `src/ui/dialog.tsx` | 52 | Dialog content container has `rounded-lg` but no `overflow-hidden`. Long text, images, or form fields could bleed corners. | Medium |
| 3 | `src/shared/components/AppToast.tsx` | 13 | Toast has `rounded-lg` but no `overflow-hidden`. Long messages could bleed. | Low |
| 4 | `src/features/editor/components/FileViewer.tsx` | 447 | External-modification modal has `rounded-lg` but no `overflow-hidden`. | Low |

#### MEDIUM PRIORITY (dropdowns without overflow-hidden)

| # | File | Line | Issue | Severity |
|---|------|------|-------|----------|
| 5 | `src/features/connection/components/WSLDialog.tsx` | 283 | Dropdown with `overflow-y-auto` but no `overflow-hidden` | Low |
| 6 | `src/features/connection/components/RemoteDialog.tsx` | 408 | Same pattern as WSL | Low |
| 7 | `src/features/git/components/gitlog/CommitList.tsx` | 212 | Context menu with `rounded-md` but no `overflow-hidden` | Low |

### ResizablePanel / ResizablePanelGroup Analysis

The `ResizablePanel` component (`src/ui/resizable.tsx:23`) has `overflow-hidden` **built into its base className**:

```tsx
const ResizablePanel = ({ className, ...props }) => (
  <ResizablePrimitive.Panel
    className={cn("flex flex-col overflow-hidden", className)}
    {...props}
  />
)
```

This means every `ResizablePanel` automatically gets `overflow-hidden`. The `ResizablePanelGroup` does NOT have it:

```tsx
const ResizablePanelGroup = ({ className, ...props }) => (
  <ResizablePrimitive.Group
    className={cn("flex h-full w-full", className)}
    {...props}
  />
)
```

**Key finding**: `EditorGroupLayout.tsx:178` adds `rounded-lg` to the ResizablePanelGroup but not `overflow-hidden`. Since all child `ResizablePanel` instances have built-in `overflow-hidden`, the risk is low — but not zero (resize handles, animations, or browser rendering artifacts could theoretically bleed).

### Recommendations

1. **`EditorGroupLayout.tsx:178`**: Add `overflow-hidden` to the ResizablePanelGroup className for defense-in-depth:
   ```
   "flex-1 rounded-lg overflow-hidden bg-bg-primary"
   ```

2. **`dialog.tsx:52`**: Add `overflow-hidden` to the dialog content container:
   ```
   "bg-bg-secondary border border-border rounded-lg shadow-xl overflow-hidden"
   ```

3. **`AppToast.tsx:13`**: Add `overflow-hidden` for long messages:
   ```
   "fixed ... rounded-lg ... overflow-hidden ..."
   ```

4. **`FileViewer.tsx:447`**: Add `overflow-hidden` to the modal dialog.

## Caveats / Not Found

- The audit covers all `.tsx`/`.ts` files under `src/`. CSS files were not checked for additional rounding rules.
- `rounded-full`, `rounded-sm`, `rounded-none` were included in the search but are generally used on small elements (dots, toggles, badges) where overflow-hidden is unnecessary.
- Some elements use `overflow-y-auto` instead of `overflow-hidden` — these may still clip corners if the content doesn't scroll beyond the bounds, but are less safe than explicit `overflow-hidden`.
