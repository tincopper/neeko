//! Repository layer for skill domain.
//!
//! TODO: Extract SQL persistence logic from `skill_store.rs`, `central_repo.rs`,
//! `scanner.rs`, and `sync_engine.rs` into dedicated repository functions.
//!
//! Repository is the ONLY layer allowed to write SQL.
//! Repository functions must NOT:
//! - Contain business logic
//! - Use `#[tauri::command]`
//! - Access `tauri::State` directly
