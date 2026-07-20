//! Skill management: installation, scanning, syncing, repository, and marketplace integration.

/// Central repository directory management.
pub mod central_repo;
/// Skill management commands exposed to the Tauri frontend.
pub mod commands;
/// Content-addressed hashing for skill directories.
pub mod content_hash;
/// Git repository cloning and URL parsing helpers.
pub mod git_fetcher;
/// Skill installation from local paths, archives, and git.
pub mod installer;
/// Database schema migrations.
pub mod migrations;
/// Data model types for skill records.
pub mod model;
mod repository;
/// Scanning tool directories for unmanaged skills.
pub mod scanner;
/// SKILL.md frontmatter parsing utilities.
pub mod skill_metadata;
/// High-level store wrapping the SQLite repository.
pub mod skill_store;
/// skills.sh marketplace HTTP client.
pub mod skillssh_api;
/// Sync engine for deploying skills to tool directories.
pub mod sync_engine;
/// Tool adapter definitions for agent platforms.
pub mod tool_adapters;
/// Shared types and DTOs.
pub mod types;
