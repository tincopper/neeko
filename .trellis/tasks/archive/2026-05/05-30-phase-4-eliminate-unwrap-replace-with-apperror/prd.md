# Phase 4: Eliminate unwrap() — replace with ? + AppError

## Goal

Replace all `unwrap()` / `expect()` calls across `src-tauri/src/` with proper error propagation (`?` operator + `AppError`), completing the architecture compliance refactor.

## Background

- `unwrap_used` clippy lint is set to `warn` (not `deny`) — 271 unwrap calls exist
- Many are in test code (`#[cfg(test)]`) where `.unwrap()` is acceptable
- Some are in production code that should use `?` + `AppError` or `.map_err(|e| ...)`

## Requirements

1. Production `.unwrap()` calls → `?` + `map_err(AppError::from)` or `.context()`
2. Production `.expect("...")` calls → `?` + proper error context
3. Test code `.unwrap()` → keep as-is (acceptable in tests)
4. `unwrap_used` clippy lint → remains `warn` for test code, no violations in prod code
5. Safe `.unwrap()` calls on `Option` where `None` is logically impossible → `.expect("infallible: ...")` with justification

## Strategy

- `src-tauri/src/core/error.rs` already has `AppError` — use it
- Most common patterns:
  - `thing.unwrap()` → `thing.map_err(|e| AppError::X(e.to_string()))?`
  - `opt.unwrap()` → `opt.ok_or(AppError::X("...".to_string()))?`
  - `lock.lock().unwrap()` → `lock.lock().map_err(|e| AppError::Internal(e.to_string()))?`
- Target: zero clippy `unwrap_used` warnings in production code

## Acceptance Criteria

- [ ] `cargo clippy` shows zero `unwrap_used` warnings in production code
- [ ] `cargo test` passes
- [ ] Test code `.unwrap()` calls remain unchanged
- [ ] `unwrap_used` lint stays `warn` (not `deny`)

## Out of Scope

- `unwrap()` calls in `node_modules` / `target/` (not our code)
- Frontend `.unwrap()` / non-null assertions
- Refactoring logic beyond error propagation
