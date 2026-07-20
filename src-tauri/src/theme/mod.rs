//! Theme management: loading, switching, and custom theme support.

/// Tauri command handlers for theme operations.
pub mod commands;
/// Common theme types shared across variants.
pub mod common;
/// User-custom theme definitions.
pub mod custom;
/// OpenCode integration theme support.
pub mod opencode;
/// Pi (Pixin) theme variant support.
pub mod pi;
/// Theme service layer for loading and applying themes.
pub mod service;
