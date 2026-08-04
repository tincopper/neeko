//! MCP (Model Context Protocol) management: servers, tag groups, deployment targets, and registry.

/// Tauri commands for MCP operations.
pub mod commands;
/// MCP Registry HTTP client and config generation.
pub mod mcp_registry_api;
/// Real MCP connectivity probe.
pub mod mcp_probe;
/// SQLite-backed repository for MCP persistence.
mod repository;
/// Data types and DTOs.
pub mod types;
