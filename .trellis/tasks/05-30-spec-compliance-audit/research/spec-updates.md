# Research: Spec Updates for Compliance Audit

- **Query**: Update spec documents to reflect changes from spec compliance audit
- **Scope**: mixed (internal files)
- **Date**: 2026-05-31

## Changes Applied

### 1. `.trellis/spec/frontend/directory-structure.md`

**Changes made:**
- Replaced flat `src/` listing (`App.tsx`, `AppProviders.tsx`, `AppModals.tsx`, `main.tsx`, `vite-env.d.ts`) with `src/app/` directory block containing those files plus `editor/` subdirectory
- Added `editor/` under `app/` with its internal structure (`components/`, `hooks/`, `context.tsx`, `file-actions-context.tsx`, `store.ts`, `types.ts`)
- Removed `editor/` from `features/` tree (was line 35-36)
- Updated "新代码应该放在哪里" table: added `app/<domain>/` variants for components, hooks, IPC, types; added "App 域入口" row
- Updated IPC encapsulation rule to mention `app/<domain>/api/` alongside `features/<domain>/api/`

### 2. `.trellis/spec/frontend/api-layer.md`

**Changes made:**
- Added re-export pattern note: `connectionApi.ts` re-exports `invoke` for strategy/script layers
- Updated ESLint example from `'warn'` to `'error'`, with note about `api/` exemptions
- Updated all editor paths from `features/editor/` to `app/editor/` in the "调用分布" tables (6 entries)

### 3. `.trellis/spec/frontend/quality-guidelines.md`

**Changes made:**
- `no-restricted-imports` table row: `warn` → `error`
- Text description: "检测并 warning" → "检测并报 error 拦截"
- Code review checklist item #8: updated to mention `connectionApi` re-export as alternative

### 4. `.trellis/spec/backend/quality-guidelines.md`

**Changes made:**
- Added "已知 spec drift：`unwrap_used`" subsection under `[lints.clippy]` section
- Documents the gap: spec expects `deny` but `Cargo.toml` has `warn`
- States the drift is acknowledged and undergoing incremental cleanup
- References Phase 4 lock migration pattern

### 5. `docs/neeko-development-spec.md`

**Changes made:**
- Added §8 "Neeko 领域映射（实际项目）" section at end of document
- Domain mapping table shows all 13 feature domains plus editor under `app/`
- Migration note explains editor move from `features/` to `app/` as intentional deviation
- States `app/` → `features/` dependency direction constraint

## Files Modified

| File | Summary |
|------|---------|
| `.trellis/spec/frontend/directory-structure.md` | Moved editor from features/ to app/, updated new-code table and IPC rule |
| `.trellis/spec/frontend/api-layer.md` | Added invoke re-export pattern, updated ESLint to error, updated editor paths |
| `.trellis/spec/frontend/quality-guidelines.md` | Changed no-restricted-imports from warn to error |
| `.trellis/spec/backend/quality-guidelines.md` | Added unwrap_used spec drift acknowledgment |
| `docs/neeko-development-spec.md` | Added §8 Neeko domain mapping table |

## Caveats

- `neeko-development-spec.md` is a general architecture reference template; §8 was added as a Neeko-specific supplement rather than modifying the template skeleton itself.
- The `src/app/` directory structure in `directory-structure.md` now shows `editor/` and references `components/` and `hooks/` as subdirs — these app-level directories exist but may expand over time.
- ESLint exemption override in `.eslintrc.cjs` already includes `src/app/*/api/*.ts` pattern (line 258), which is consistent with the new spec text.
