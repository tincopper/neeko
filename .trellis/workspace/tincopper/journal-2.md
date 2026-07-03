# Journal - tincopper (Part 2)

> Continuation from `journal-1.md` (archived at ~2000 lines)
> Started: 2026-05-27

---



## Session 58: Refactor Round 3 #1+4: delete useDelayedInit, extract fileTree utils, fix WSL/Remote file refresh

**Date**: 2026-05-27
**Task**: Refactor Round 3 #1+4: delete useDelayedInit, extract fileTree utils, fix WSL/Remote file refresh
**Branch**: `refactor/architecture-optimization`

### Summary

Deleted useDelayedInit (inlined 3-line useEffect). Extracted mergeSubTree/getTabId/getFileName/isFileTab to shared utils/fileTree.ts, removing duplication. Fixed useFileTabRefresh to accept commands for WSL/Remote file reading — was hardcoded to local invoke only.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `361685e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 59: Refactor Round 3 #2: flatten AppModals, delete useAppModalsProps

**Date**: 2026-05-27
**Task**: Refactor Round 3 #2: flatten AppModals, delete useAppModalsProps
**Branch**: `refactor/architecture-optimization`

### Summary

Flattened AppModals to accept flat props directly (18 individual fields instead of 4 nested sub-objects). Deleted useAppModalsProps.ts (60-line pure adapter). AppModals now has a self-documenting flat interface. Skipped #3 (shared agent skeleton): abstraction cost exceeds duplication cost.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a32f0ae` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 60: Refactor Round 3 #5: extract useBrowserPicker from useBrowserPanel

**Date**: 2026-05-27
**Task**: Refactor Round 3 #5: extract useBrowserPicker from useBrowserPanel
**Branch**: `refactor/architecture-optimization`

### Summary

Extracted useBrowserPicker hook from useBrowserPanel (592→534 lines). New hook manages isPicking state, startPicker/stopPicker/reinjectPicker callbacks, picker-cancelled event listener, and periodic fallback re-injection interval. Shared BROWSER_WEBVIEW_LABEL constant moved to useBrowserConstants.ts.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8c2fdfc` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 61: Fix Round 4 #1+3: Local transport bypass + FileViewer capabilities

**Date**: 2026-05-27
**Task**: Fix Round 4 #1+3: Local transport bypass + FileViewer capabilities
**Branch**: `refactor/architecture-optimization`

### Summary

Fixed WSL/Remote diff stats bug in GitCommitPanel — was hardcoded to Local transport, now uses commands.getChangedFilesDiffStats() (unified). Added getChangedFilesDiffStats to ProjectCommands interface. Replaced project.type check with capabilities.canEditFiles in FileViewer.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `20b3f2f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 62: Refactor Round 4 #2: simplify useDiffData with unified commands

**Date**: 2026-05-27
**Task**: Refactor Round 4 #2: simplify useDiffData with unified commands
**Branch**: `refactor/architecture-optimization`

### Summary

Added unified commands path to useDiffData hook — 7-branch diffSource.type switch now has a clean path using commands.getCommitFileDiff() and commands.getFileDiff(). Legacy per-type invoke dispatch preserved as fallback. Added getFileDiff to ProjectCommands interface.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `5281940` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 63: chore: remove all dead code

**Date**: 2026-05-27
**Task**: chore: remove all dead code
**Branch**: `refactor/architecture-optimization`

### Summary

Backend: 15 compiler warnings eliminated (9 via cargo fix, 6 manual). Removed dead functions (is_directory, clear, add_column_if_missing, validate_identifier, has_column), dead assignment (found=true), unused imports, unnecessary mut. Frontend: removed noop handleToggleTerminal callback, unused dockStore methods (expandZone, restoreDefaultLayout), unused worktreeStore.worktreeState field, unused barrel exports (ProjectSidebar, SessionKind). All tests pass.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `HEAD` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 64: Phase 2 + 3: backend layering, services/repository extraction, frontend api wrappers

**Date**: 2026-05-30
**Task**: Phase 2 + 3: backend layering, services/repository extraction, frontend api wrappers
**Branch**: `refactor/architecture-optimization`

### Summary

Completed Phase 2 (core module, services/repository extraction, skill repository SQL extraction) and Phase 3 (per-feature api/ wrappers, import isolation, ESLint restricted-imports)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `bdc23e6` | (see git log) |
| `0357db0` | (see git log) |
| `59fb6a4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 65: Phase 4: eliminate unwrap() — 55 calls replaced with ? + AppError

**Date**: 2026-05-30
**Task**: Phase 4: eliminate unwrap() — 55 calls replaced with ? + AppError
**Branch**: `refactor/architecture-optimization`

### Summary

Replaced 55 unwrap()/expect() calls in production code across 8 files. Patterns: .expect("infallible: ...") for internal locks, .map_err() for state locks, .ok_or_else() / .context() for options. All 4 phases of Architecture Compliance Refactor complete.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `02047ac` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 66: Spec compliance audit fixes: editor to app/, invoke isolation, ESLint rules

**Date**: 2026-05-31
**Task**: Spec compliance audit fixes: editor to app/, invoke isolation, ESLint rules
**Branch**: `refactor/architecture-optimization`

### Summary

Fixed P0/P1 compliance gaps: moved editor to app/ layer (1:1 domain alignment), replaced direct invoke calls with strategy function refs, upgraded no-restricted-imports to error. Remaining: cross-domain Rust calls, import/order cleanup, core/db.rs implementation.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `b6a537f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 67: Spec compliance refactor complete - Phases A, B, C

**Date**: 2026-05-31
**Task**: Spec compliance refactor complete - Phases A, B, C
**Branch**: `refactor/architecture-optimization`

### Summary

Completed all 3 phases of remaining compliance gaps: Phase A (cross-domain Rust cleanup - core/services/commit + core/watcher), Phase B (core/db.rs, naming conventions, module visibility), Phase C (ESLint rules to error, lib.rs deny sync, spec alignment). All 4 compliance phases (1-4 + A-C) now complete.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f72ba98` | (see git log) |
| `0e0c84d` | (see git log) |
| `23c4588` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 68: watcher: only watch active project

**Date**: 2026-06-01
**Task**: watcher: only watch active project
**Branch**: `refactor/architecture-optimization`

### Summary

WatcherManager 退化为只挂激活项目；消除 30s 全项目 heartbeat 噪声；status_worker 日志拆出 exit code + signal 便于诊断 SIGHUP

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `688d27b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 69: Remove project name and branch name from TitleBar

**Date**: 2026-06-01
**Task**: Remove project name and branch name from TitleBar
**Branch**: `refactor/architecture-optimization`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `59654bbcb099640ae1b72f7ff8d280e7a8ec33b7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 70: Editor and Diff AI Selection

**Date**: 2026-07-03
**Task**: Editor and Diff AI Selection
**Branch**: `main`

### Summary

Implemented code selection and AI agent interaction in CodeMirror editor (floating SelectionToolbar with Ask/Explain/Review/Fix) and Git Diff views (clickable line number selection with Review this change button). Core hook useEditorAgentActions finds agent terminal tab and sends code location via sendToTerminal(). Pure prompt builders in agentPrompt.ts.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `2f82df6` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
