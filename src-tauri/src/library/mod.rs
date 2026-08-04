//! Library management: skills, MCP servers, prompts, actions, and tags.
//!
//! Unified module for all "resource library" concerns. Replaces the old
//! `skill` and `mcp` top-level modules to eliminate migration version
//! conflicts (both modules used to share `skills.db` with overlapping
//! `user_version` ranges).

pub mod db;
pub mod migrations;
pub mod store;

// Sub-modules (migrated from `skill/` and `mcp/`)
pub mod mcp;
pub mod skill;

pub use store::LibraryStore;
