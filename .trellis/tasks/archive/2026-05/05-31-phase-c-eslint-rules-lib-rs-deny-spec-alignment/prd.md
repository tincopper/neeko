# Phase C: ESLint rules, lib.rs deny, spec alignment

## Goal
Close the remaining compliance gaps: ESLint rule levels, lib.rs deny list, spec drift.

## Items

### 1. ESLint rules → error
- `import/no-cycle` → `'error'`
- `import/order` → `'error'` (then `--fix` all violations)
- `check-file/filename-naming-convention` → `'error'` (Phase B already fixed names)

### 2. lib.rs deny list sync
Add missing entries:
- `clippy::unwrap_used`
- `rust_2018_idioms`
- `missing_docs`

### 3. Spec alignment
- `.trellis/spec/`: update `unwrap_used` from `"deny"` to `"warn"`
- `.trellis/spec/backend/quality-guidelines.md`: update `lib.rs` table

## Acceptance Criteria
- [ ] `pnpm lint` passes (only pre-existing prettier errors)
- [ ] `pnpm tsc --noEmit` passes
- [ ] `cargo check` + `cargo clippy` passes
- [ ] `cargo test` passes

## Out of Scope
Nothing for Phase C — this is the last compliance phase.
