//! Agent session adapters.
//!
//! `mod.rs` 只做模块声明与 re-export（红线 9）：实现分别在
//! 各 agent 文件、[`shared`]（JSONL 公共管道）、[`content_blocks`]（内容块抽取）
//! 与 [`registry`]（适配器清单）里。

#![allow(clippy::unwrap_used, clippy::expect_used)]

/// Adapter for Claude Code session files.
pub mod claude_code;
/// Adapter for CodeBuddy session files.
pub mod codebuddy;
/// Adapter for Codex session files.
pub mod codex;
/// Shared Anthropic-style content-block extraction (Pi / Claude Code / OMP dialect).
pub(crate) mod content_blocks;
/// Adapter for Gemini session files.
pub mod gemini;
/// Adapter for Grok session files.
pub mod grok;
/// Adapter for OMP session files.
pub mod omp;
/// Adapter for OpenCode session files.
pub mod opencode;
/// Adapter for Pi session files.
pub mod pi;
/// Adapter for Qoder session files.
pub mod qoder;
/// Adapter for Reasonix session files.
pub mod reasonix;
mod registry;
mod shared;

pub use claude_code::ClaudeCodeAdapter;
pub use codebuddy::CodeBuddyAdapter;
pub use codex::CodexAdapter;
pub use gemini::GeminiAdapter;
pub use grok::GrokAdapter;
pub use omp::OmpAdapter;
pub use opencode::OpenCodeAdapter;
pub use pi::PiAdapter;
pub use qoder::QoderAdapter;
pub use reasonix::ReasonixAdapter;
pub use registry::all_adapters;
pub(crate) use shared::{
    linearize_tree_entries, message_role, parse_timestamp, read_jsonl, CONVERSATION_ROLES,
};
