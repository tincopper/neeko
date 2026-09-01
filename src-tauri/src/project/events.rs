//! Project clone event names and payloads.
//!
//! Single source of truth on the Rust side (Review Gate #5); frontend mirror:
//! `src/shared/utils/projectEvents.ts`.

use serde::Serialize;

/// Emitted while a project clone is running, on every phase/percent change.
pub const CLONE_PROGRESS_EVENT: &str = "project-clone-progress";

/// Payload for [`CLONE_PROGRESS_EVENT`].
#[derive(Debug, Clone, Serialize)]
pub struct CloneProgressEvent {
    /// Identifies the clone run — lets the frontend ignore stale events.
    pub clone_id: String,
    /// Phase keyword: counting | compressing | receiving | resolving | updating.
    pub phase: String,
    /// Percentage (0-100).
    pub percent: u8,
    /// Raw stderr line, fallback display when no percent is parsed yet.
    pub message: String,
}
