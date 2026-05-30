# Phase B: Infrastructure cleanup

## Goal
Fill infrastructure holes: core/db.rs, naming conventions, module visibility.

## Items

### 1. core/db.rs — real Connection management
- Extract shared DB connection logic from `skill/skill_store.rs` and `skill/repository.rs` into `core/db.rs`
- Move `SkillRepository`'s `open` and `open_in_memory` patterns to core

### 2. Naming convention fixes
- 10 kebab-case .tsx files → PascalCase
- 2 camelCase directories → kebab-case (useActiveProject/, DockLayout/)

### 3. Module visibility
- Change `pub mod services` → `mod services` where applicable (7 domains)
- Check `pub use ...::*` re-exports

## Acceptance Criteria
- [ ] `cargo check` + `cargo test` pass
- [ ] `pnpm tsc --noEmit` passes
- [ ] core/db.rs has real Connection logic (not just `pub struct DbConfig;`)

## Out of Scope
- ESLint `no-cycle`/`import/order` upgrade (Phase C)
- Cross-domain Rust calls (Phase A — already done)
