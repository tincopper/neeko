//! MCP (Model Context Protocol) management: servers, tag groups, deployment targets, and registry.

/// Tauri commands for MCP operations.
pub mod commands;
/// Real MCP connectivity probe.
pub mod mcp_probe;
/// MCP Registry HTTP client and config generation.
pub mod mcp_registry_api;
/// Data types and DTOs.
pub mod types;
