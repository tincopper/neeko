# Research: Spec Updates for Phase 3 Frontend Layering

- **Query**: Identify all spec files needing updates for the new API wrapper layer in Phase 3
- **Scope**: internal (spec docs + codebase)
- **Date**: 2026-05-30

## Findings

### Phase 3 Changes Summary

1. **12 API wrapper files** created at `src/features/<domain>/api/<domain>Api.ts`:
   - `agent/`, `browser/`, `connection/`, `file/`, `git/`, `project/`, `session/`, `settings/`, `skill/`, `task/`, `terminal/`, `theme/`

2. **ESLint `no-restricted-imports`** rule added (`.eslintrc.cjs:97-113`):
   - Blocks `@tauri-apps/api/core` (both path and pattern) outside `api/` directories
   - Exception for `api/` files themselves (they are the only files that should import `invoke` directly)

3. **Consumer pattern established**: 66 import sites across features now use API wrappers via:
   - Relative imports within features: `../../git/api/gitApi`
   - `@/` alias from layout layer: `@/features/session/api/sessionApi`

4. **New types added**:
   - `src/features/file/types.ts` — `FileTransportKind` (FileTransportLocal | FileTransportWsl | FileTransportRemote)
   - `src/features/git/types.ts` — `FileDiffStats` (path + additions/deletions)
   - `src/features/git/api/gitApi.ts` — `GitTransportKind`, `FileTransportKind` (transport union types)

### Files Updated

| Spec File | Changes Made |
|---|---|
| `.trellis/spec/frontend/api-layer.md` | Full rewrite: Feature API Wrapper as primary pattern, 12 API file listing, ESLint rule doc, consumption examples, transport types, updated call distribution tables, new common errors |
| `.trellis/spec/frontend/quality-guidelines.md` | Added `no-restricted-imports` to core rules table, added section 5 "在 API wrapper 目录外直接使用 invoke", added checklist item for API wrapper usage |
| `.trellis/spec/frontend/directory-structure.md` | Added full `features/` directory tree with each domain's `api/` subdirectory, updated "新代码应该放在哪里" to list IPC 封装 as required in features/domain/api/ |
| `.trellis/spec/frontend/hook-guidelines.md` | Updated overview to mention feature hooks directories, rewrote data-fetching section to use API wrappers, updated config load/save examples |
| `.trellis/spec/frontend/type-safety.md` | Updated typed invoke section to reference API wrappers, updated "禁止 any" examples |
| `.trellis/spec/frontend/component-guidelines.md` | Updated standard template to import from API wrappers, updated ProjectPanel/Dialog examples to use API wrappers |
| `.trellis/spec/frontend/state-management.md` | Updated persistence and server-state sections to use API wrappers, updated architecture diagram to show Feature API Wrapper Layer |

## Caveats / Not Found

- No spec files under `.trellis/spec/features/` exist yet (no feature-architecture-level spec)
- The `import/no-restricted-paths` zones in ESLint (feature isolation) are not affected by this change
- No functional behavior changed — only import paths were refactored
