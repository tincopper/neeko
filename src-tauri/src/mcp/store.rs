//! High-level MCP store wrapping the repository with CRUD, tags, cache, and settings.

use anyhow::Result;
use std::path::Path;
use std::sync::Arc;

use super::repository::McpRepository;
use super::types::*;

/// Thread-safe facade over [`McpRepository`] for all MCP data operations.
pub struct McpStore {
    repo: Arc<McpRepository>,
}

impl McpStore {
    /// Open or create an MCP store backed by a SQLite file at `db_path`.
    pub fn new(db_path: &Path) -> Result<Self> {
        Ok(Self {
            repo: Arc::new(McpRepository::open(db_path)?),
        })
    }

    /// Open an in-memory MCP store (for testing).
    pub fn new_in_memory() -> Result<Self> {
        Ok(Self {
            repo: Arc::new(McpRepository::open_in_memory()?),
        })
    }

    // ── MCP Server CRUD ───────────────────────────────────────────────────

    /// Insert a new MCP server.
    pub fn insert_mcp_server(&self, server: &McpServerRecord) -> Result<()> {
        self.repo.insert_mcp_server(server)
    }

    /// Get all MCP servers ordered by name.
    pub fn get_all_mcp_servers(&self) -> Result<Vec<McpServerRecord>> {
        self.repo.get_all_mcp_servers()
    }

    /// Get an MCP server by its ID.
    pub fn get_mcp_server_by_id(&self, id: &str) -> Result<Option<McpServerRecord>> {
        self.repo.get_mcp_server_by_id(id)
    }

    /// Update all fields of an MCP server.
    pub fn update_mcp_server(&self, server: &McpServerRecord) -> Result<()> {
        self.repo.update_mcp_server(server)
    }

    /// Delete an MCP server.
    pub fn delete_mcp_server(&self, id: &str) -> Result<()> {
        self.repo.delete_mcp_server(id)
    }

    /// Record MCP server usage.
    pub fn record_mcp_server_usage(&self, id: &str) -> Result<()> {
        self.repo.record_mcp_server_usage(id)
    }

    /// Get all unique tag names across all MCP servers.
    pub fn get_all_mcp_server_tags(&self) -> Result<Vec<String>> {
        self.repo.get_all_mcp_server_tags()
    }

    // ── MCP Tag Groups ────────────────────────────────────────────────────

    /// Insert a new MCP tag group.
    pub fn insert_mcp_tag_group(&self, group: &McpTagGroupRecord) -> Result<()> {
        self.repo.insert_mcp_tag_group(group)
    }

    /// Get all MCP tag groups.
    pub fn get_all_mcp_tag_groups(&self) -> Result<Vec<McpTagGroupRecord>> {
        self.repo.get_all_mcp_tag_groups()
    }

    /// Get an MCP tag group by ID.
    pub fn get_mcp_tag_group_by_id(&self, id: &str) -> Result<Option<McpTagGroupRecord>> {
        self.repo.get_mcp_tag_group_by_id(id)
    }

    /// Update an MCP tag group.
    pub fn update_mcp_tag_group(&self, group: &McpTagGroupRecord) -> Result<()> {
        self.repo.update_mcp_tag_group(group)
    }

    /// Delete an MCP tag group.
    pub fn delete_mcp_tag_group(&self, id: &str) -> Result<()> {
        self.repo.delete_mcp_tag_group(id)
    }

    /// Reorder MCP tag groups.
    pub fn reorder_mcp_tag_groups(&self, ids: &[String]) -> Result<()> {
        self.repo.reorder_mcp_tag_groups(ids)
    }

    /// Add a server to a tag group.
    pub fn add_server_to_mcp_tag_group(&self, tag_group_id: &str, server_id: &str) -> Result<()> {
        self.repo
            .add_server_to_mcp_tag_group(tag_group_id, server_id)
    }

    /// Remove a server from a tag group.
    pub fn remove_server_from_mcp_tag_group(
        &self,
        tag_group_id: &str,
        server_id: &str,
    ) -> Result<()> {
        self.repo
            .remove_server_from_mcp_tag_group(tag_group_id, server_id)
    }

    /// Get server IDs for a tag group.
    pub fn get_servers_for_mcp_tag_group(&self, tag_group_id: &str) -> Result<Vec<String>> {
        self.repo.get_servers_for_mcp_tag_group(tag_group_id)
    }

    /// Get tag group IDs for a server.
    pub fn get_tag_groups_for_mcp_server(&self, server_id: &str) -> Result<Vec<String>> {
        self.repo.get_tag_groups_for_mcp_server(server_id)
    }

    /// Set the enabled toggle for a server in a tag group for a specific agent.
    pub fn set_mcp_server_agent_toggle(
        &self,
        tag_group_id: &str,
        server_id: &str,
        agent_id: &str,
        enabled: bool,
    ) -> Result<()> {
        self.repo
            .set_mcp_server_agent_toggle(tag_group_id, server_id, agent_id, enabled)
    }

    /// Get all agent toggles for a server in a tag group.
    pub fn get_mcp_tag_group_agent_toggles(
        &self,
        tag_group_id: &str,
        server_id: &str,
    ) -> Result<Vec<(String, bool)>> {
        self.repo
            .get_mcp_tag_group_agent_toggles(tag_group_id, server_id)
    }

    // ── Project ↔ MCP Tag Group ──────────────────────────────────────────

    /// Bind a project to an MCP tag group.
    pub fn insert_project_mcp_tag_group(&self, project_id: &str, tag_group_id: &str) -> Result<()> {
        self.repo
            .insert_project_mcp_tag_group(project_id, tag_group_id)
    }

    /// Unbind a project from an MCP tag group.
    pub fn delete_project_mcp_tag_group(&self, project_id: &str, tag_group_id: &str) -> Result<()> {
        self.repo
            .delete_project_mcp_tag_group(project_id, tag_group_id)
    }

    /// Get all tag group IDs bound to a project.
    pub fn get_project_mcp_tag_groups(&self, project_id: &str) -> Result<Vec<String>> {
        self.repo.get_project_mcp_tag_groups(project_id)
    }

    /// Atomically replace all tag group bindings for a project.
    pub fn set_project_mcp_tag_groups(
        &self,
        project_id: &str,
        tag_group_ids: &[String],
    ) -> Result<()> {
        self.repo
            .set_project_mcp_tag_groups(project_id, tag_group_ids)
    }

    /// Get per-project MCP tag group counts.
    pub fn get_all_project_mcp_tag_group_counts(&self) -> Result<Vec<(String, i64)>> {
        self.repo.get_all_project_mcp_tag_group_counts()
    }

    // ── MCP Server Targets ───────────────────────────────────────────────

    /// Insert a deployment target record.
    pub fn insert_mcp_server_target(&self, target: &McpServerTargetRecord) -> Result<()> {
        self.repo.insert_mcp_server_target(target)
    }

    /// Get all deployment targets for a server.
    pub fn get_mcp_server_targets(&self, server_id: &str) -> Result<Vec<McpServerTargetRecord>> {
        self.repo.get_mcp_server_targets(server_id)
    }

    /// Delete a deployment target.
    pub fn delete_mcp_server_target(&self, server_id: &str, agent_id: &str) -> Result<()> {
        self.repo.delete_mcp_server_target(server_id, agent_id)
    }

    // ── Cache & Settings ─────────────────────────────────────────────────

    /// Get a setting value by key.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        self.repo.get_setting(key)
    }

    /// Set a setting value.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.repo.set_setting(key, value)
    }

    /// Get cached data by key if within TTL.
    pub fn get_cache(&self, key: &str, ttl_secs: i64) -> Result<Option<String>> {
        self.repo.get_cache(key, ttl_secs)
    }

    /// Cache data with a key.
    pub fn set_cache(&self, key: &str, data: &str) -> Result<()> {
        self.repo.set_cache(key, data)
    }

    // ── Prompt access (for command deployment, slash resolution) ─────────

    /// Get all prompts (delegates to skill module for now).
    pub fn get_all_prompts(&self) -> Result<Vec<crate::library::skill::types::PromptRecord>> {
        self.repo.get_all_prompts()
    }

    /// Get a prompt by ID.
    pub fn get_prompt_by_id(&self, id: &str) -> Result<Option<crate::library::skill::types::PromptRecord>> {
        self.repo.get_prompt_by_id(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store() -> McpStore {
        McpStore::new_in_memory().unwrap()
    }

    fn sample_server(id: &str, name: &str) -> McpServerRecord {
        McpServerRecord {
            id: id.to_string(),
            name: name.to_string(),
            description: Some("test mcp".to_string()),
            command: "npx".to_string(),
            url: None,
            args_json: "[]".to_string(),
            env_json: "{}".to_string(),
            transport: "stdio".to_string(),
            scope: "global".to_string(),
            project_id: None,
            source_registry: None,
            source_ref: None,
            tags: vec![],
            enabled: true,
            usage_count: 0,
            last_used_at: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn test_insert_and_get_all_mcp_servers() {
        let store = test_store();
        store.insert_mcp_server(&sample_server("mcp-1", "server-1")).unwrap();
        store.insert_mcp_server(&sample_server("mcp-2", "server-2")).unwrap();
        let servers = store.get_all_mcp_servers().unwrap();
        assert_eq!(servers.len(), 2);
    }

    #[test]
    fn test_get_mcp_server_by_id_found() {
        let store = test_store();
        store.insert_mcp_server(&sample_server("mcp-1", "server-1")).unwrap();
        let server = store.get_mcp_server_by_id("mcp-1").unwrap();
        assert!(server.is_some());
        assert_eq!(server.unwrap().name, "server-1");
    }

    #[test]
    fn test_get_mcp_server_by_id_not_found() {
        let store = test_store();
        let server = store.get_mcp_server_by_id("missing").unwrap();
        assert!(server.is_none());
    }

    #[test]
    fn test_delete_mcp_server() {
        let store = test_store();
        store.insert_mcp_server(&sample_server("mcp-1", "server-1")).unwrap();
        store.delete_mcp_server("mcp-1").unwrap();
        let servers = store.get_all_mcp_servers().unwrap();
        assert!(servers.is_empty());
    }

    #[test]
    fn test_mcp_tag_group_crud() {
        let store = test_store();
        let group = McpTagGroupRecord {
            id: "tg-1".to_string(),
            name: "Backend".to_string(),
            description: None,
            icon: None,
            sort_order: 0,
            created_at: 1,
            updated_at: 1,
        };
        store.insert_mcp_tag_group(&group).unwrap();
        let fetched = store.get_mcp_tag_group_by_id("tg-1").unwrap();
        assert!(fetched.is_some());
        assert_eq!(fetched.unwrap().name, "Backend");
    }

    #[test]
    fn test_mcp_tag_group_server_mapping() {
        let store = test_store();
        store.insert_mcp_server(&sample_server("mcp-1", "server-1")).unwrap();
        let group = McpTagGroupRecord {
            id: "tg-1".to_string(),
            name: "Backend".to_string(),
            description: None,
            icon: None,
            sort_order: 0,
            created_at: 1,
            updated_at: 1,
        };
        store.insert_mcp_tag_group(&group).unwrap();
        store.add_server_to_mcp_tag_group("tg-1", "mcp-1").unwrap();
        let servers = store.get_servers_for_mcp_tag_group("tg-1").unwrap();
        assert_eq!(servers, vec!["mcp-1".to_string()]);
    }
}
