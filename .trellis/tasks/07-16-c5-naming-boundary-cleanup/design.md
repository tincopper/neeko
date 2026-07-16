# C5 Design: Naming & Boundary Cleanup

## Goal

Clean up remaining naming inconsistencies, misplaced files, error variants, and update spec docs after C1-C4.

## Design

### Type Taxonomy Unification

- `ProjectEnvironment` (Rust enum, `type` tagged) is the single source of truth
- Eliminate frontend `ProjectType = "local"|"wsl"|"remote"` in favor of `ProjectEnvironment`
- Remove `ENV_TYPE_TO_VIEW_TYPE` and similar mapping helpers
- Remove `ConnectionContext.type` duplication — use `ProjectEnvironment` directly

### File Moves

- `connection/components/RemoteItems.tsx` → split `SectionHeader` into `project/components/` and rename `WSLItem`/`RemoteItem` to neutral names
- Move `connection/hooks/useRemoteAuthActions.ts` → stays in connection (auth is connection concern)

### Error Variant Fix

- `AppError::Wsl` currently used as generic "platform unsupported" error
- Add `AppError::Unsupported(String)` for platform errors
- `AppError::Wsl` usage in `cfg(not(windows))` guards → `AppError::Unsupported`

### `project/mod.rs` Cleanup

- Three `add_*_from_session` methods already merged by C1
- Ensure naming is clean (`add_project_from_session`)
- `resolve_agent_config` vs `resolve_agent_for_remote` naming → consolidate to `resolve_agent_command`

### Spec Updates

- `.trellis/spec/backend/directory-structure.md`
- `.trellis/spec/frontend/directory-structure.md`
- `.trellis/spec/frontend/state-management.md`
