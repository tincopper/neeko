# LSP Review Fixes

## Goal
Fix critical issues identified in the Tauri FDD review.

## Requirements

### 1. Fix blocking `kill_child()` in session_store.rs
- Change `close_session` to return `Option<LspSession>` instead of killing internally
- Let caller handle kill in appropriate context

### 2. Fix poison error handling in session_store.rs
- Replace `if let Ok` with explicit poison handling for `clear_restart` and `clear_open_documents`
- Recover from poison and log warning

### 3. Fix settings double-lock in manager.rs
- Apply settings to plugin_manager first, then set default_auto_start in one place

### 4. Fix `thread::sleep` blocking in manager.rs close_session
- Move shutdown sequence to `spawn_blocking` or keep sleep but use `tokio::task::block_in_place`

## Acceptance Criteria
- [ ] `session_store::close_session` returns `Option<LspSession>`
- [ ] `manager::close_session` spawns blocking kill in `spawn_blocking`
- [ ] Poison errors are explicitly handled with `match` + `log::warn`
- [ ] Settings applied once without redundant locks
- [ ] All 48 LSP tests still pass

## References
- Tauri FDD review session `history://LspTauriReview`
- Files: `src-tauri/src/lsp/session_store.rs`, `src-tauri/src/lsp/manager.rs`
