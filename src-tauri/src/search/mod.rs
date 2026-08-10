//! Search domain: content full-text search across local / WSL / SSH projects.

pub mod commands;
pub mod engine_local;
pub mod engine_remote;
pub mod matcher;
pub mod services;
pub mod types;

pub use types::{
    SearchCursor, SearchFileGroup, SearchMatch, SearchMode, SearchOptions, SearchPage,
};
