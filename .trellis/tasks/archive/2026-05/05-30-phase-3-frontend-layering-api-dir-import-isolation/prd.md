# Phase 3: Frontend Layering — api/ dir + import isolation

## Goal

Bring frontend code structure in line with `docs/neeko-development-spec.md`: each feature domain gets an `api/` sub-module wrapping `invoke` calls, and component/store code is isolated from direct IPC.

## Current state

Frontend already uses `src/features/<domain>/` structure, but `invoke` calls are scattered across:
- Component files (direct `import { invoke } from '@tauri-apps/api/core'`)
- Store files
- Hook files

## Decision (ADR-lite)

**Context**: Frontend layering to enforce unidirectional data flow per `docs/neeko-development-spec.md`.
**Decision**: Per-feature `api/` directory (`src/features/<domain>/api/`), keeping each domain self-contained.
**Consequences**: Higher cohesion, each feature owns its IPC boundary; no cross-feature import of `invoke` wrappers.

## Requirements

1. Create `src/features/<domain>/api/<domain>Api.ts` for each domain that has Rust commands:
   - `agent/` → has commands
   - `browser/` → has commands
   - `connection/` → has commands  
   - `file/` → has commands
   - `git/` → has commands
   - `project/` → has commands
   - `session/` → has commands
   - `settings/` → has commands
   - `skill/` → has commands
   - `task/` → has commands
   - `terminal/` → has commands
   - `theme/` → has commands

2. Every API function wraps `invoke(<command>, <args>)` with typed parameters and return types.

3. Components / stores / hooks import from `../api/<domain>Api` instead of calling `invoke` directly.

4. ESLint rule `no-restricted-imports` (or similar) to prevent direct `@tauri-apps/api/core` imports in components.

## Acceptance Criteria

- [ ] All 12 domains have `<domain>Api.ts` with typed invoke wrappers
- [ ] No direct `invoke` calls in `src/features/**/components/` or `src/features/**/stores/`
- [ ] ESLint rule enforces `no-restricted-imports` from `@tauri-apps/api/core` in feature components
- [ ] `pnpm tsc --noEmit` passes
- [ ] `pnpm lint` passes

## Out of Scope

- Full type alignment between Rust structs and TS interfaces (ongoing work)
- Backend changes
- `src/shared/` → `src/app/` restructure
