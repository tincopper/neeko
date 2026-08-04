//! SQLite-backed repository for MCP servers, tag groups, and deployment targets.

use anyhow::Result;
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

use super::types::{McpServerRecord, McpServerTargetRecord, McpTagGroupRecord};

/// SQLite data access layer for all MCP-related persistence.
pub struct McpRepository {
    conn: Mutex<Connection>,
}

impl McpRepository {
    /// Open or create an MCP database at the given path.
    pub fn open(db_path: &Path) -> Result<Self> {
        let conn = crate::common::db::open(db_path)?;
        super::migrations::run_migrations(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Open an in-memory SQLite database (for testing).
    pub fn open_in_memory() -> Result<Self> {
        let conn = crate::common::db::open_in_memory()?;
        super::migrations::run_migrations(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    // ── MCP Server CRUD ────────────────────────────────────────────────────

    /// Insert a new MCP server record.
    pub fn insert_mcp_server(&self, server: &McpServerRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "INSERT INTO mcp_servers (id, name, description, command, url, args_json, env_json,
             transport, scope, project_id, source_registry, source_ref, tags_json, enabled,
             usage_count, last_used_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                server.id, server.name, server.description, server.command, server.url,
                server.args_json, server.env_json, server.transport, server.scope, server.project_id,
                server.source_registry, server.source_ref,
                serde_json::to_string(&server.tags).unwrap_or_else(|_| "[]".to_string()),
                i32::from(server.enabled), server.usage_count, server.last_used_at,
                server.created_at, server.updated_at
            ],
        )?;
        Ok(())
    }

    /// Get all MCP servers ordered by name.
    pub fn get_all_mcp_servers(&self) -> Result<Vec<McpServerRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, command, url, args_json, env_json, transport, scope,
             project_id, source_registry, source_ref, tags_json, enabled, usage_count,
             last_used_at, created_at, updated_at
             FROM mcp_servers ORDER BY name",
        )?;
        let rows = stmt.query_map([], map_mcp_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get an MCP server by its ID.
    pub fn get_mcp_server_by_id(&self, id: &str) -> Result<Option<McpServerRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, command, url, args_json, env_json, transport, scope,
             project_id, source_registry, source_ref, tags_json, enabled, usage_count,
             last_used_at, created_at, updated_at
             FROM mcp_servers WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], map_mcp_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Update all fields of an MCP server record.
    pub fn update_mcp_server(&self, server: &McpServerRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE mcp_servers SET name = ?1, description = ?2, command = ?3, url = ?4,
             args_json = ?5, env_json = ?6, transport = ?7, scope = ?8, project_id = ?9,
             source_registry = ?10, source_ref = ?11, tags_json = ?12, enabled = ?13,
             usage_count = ?14, last_used_at = ?15, updated_at = ?16 WHERE id = ?17",
            params![
                server.name, server.description, server.command, server.url,
                server.args_json, server.env_json, server.transport, server.scope,
                server.project_id, server.source_registry, server.source_ref,
                serde_json::to_string(&server.tags).unwrap_or_else(|_| "[]".to_string()),
                i32::from(server.enabled), server.usage_count, server.last_used_at, now, server.id
            ],
        )?;
        Ok(())
    }

    /// Delete an MCP server by ID.
    pub fn delete_mcp_server(&self, id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute("DELETE FROM mcp_servers WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Increment usage counter and update last_used_at.
    pub fn record_mcp_server_usage(&self, id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE mcp_servers SET usage_count = usage_count + 1, last_used_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    // ── MCP Tag Groups ────────────────────────────────────────────────────

    /// Insert a new MCP tag group.
    pub fn insert_mcp_tag_group(&self, group: &McpTagGroupRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "INSERT INTO mcp_tag_groups (id, name, description, icon, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![group.id, group.name, group.description, group.icon, group.sort_order, group.created_at, group.updated_at],
        )?;
        Ok(())
    }

    /// Get all MCP tag groups ordered by sort_order.
    pub fn get_all_mcp_tag_groups(&self) -> Result<Vec<McpTagGroupRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, icon, sort_order, created_at, updated_at
             FROM mcp_tag_groups ORDER BY sort_order, name",
        )?;
        let rows = stmt.query_map([], map_mcp_tag_group_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get an MCP tag group by ID.
    pub fn get_mcp_tag_group_by_id(&self, id: &str) -> Result<Option<McpTagGroupRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, icon, sort_order, created_at, updated_at
             FROM mcp_tag_groups WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], map_mcp_tag_group_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Update an MCP tag group fields.
    pub fn update_mcp_tag_group(&self, group: &McpTagGroupRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE mcp_tag_groups SET name = ?1, description = ?2, icon = ?3, sort_order = ?4, updated_at = ?5 WHERE id = ?6",
            params![group.name, group.description, group.icon, group.sort_order, now, group.id],
        )?;
        Ok(())
    }

    /// Delete an MCP tag group by ID.
    pub fn delete_mcp_tag_group(&self, id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute("DELETE FROM mcp_tag_groups WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Reorder MCP tag groups by providing id->sort_order pairs.
    pub fn reorder_mcp_tag_groups(&self, ids: &[String]) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        for (i, id) in ids.iter().enumerate() {
            conn.execute(
                "UPDATE mcp_tag_groups SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
                params![
                    i64::try_from(i).unwrap_or(i64::MAX),
                    chrono::Utc::now().timestamp_millis(),
                    id
                ],
            )?;
        }
        Ok(())
    }

    // ── MCP Tag Group → Server associations ────────────────────────────────

    /// Add a server to a tag group.
    pub fn add_server_to_mcp_tag_group(&self, tag_group_id: &str, server_id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR IGNORE INTO mcp_tag_group_servers (tag_group_id, server_id, added_at, sort_order)
             VALUES (?1, ?2, ?3, 0)",
            params![tag_group_id, server_id, now],
        )?;
        Ok(())
    }

    /// Remove a server from a tag group.
    pub fn remove_server_from_mcp_tag_group(
        &self,
        tag_group_id: &str,
        server_id: &str,
    ) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "DELETE FROM mcp_tag_group_servers WHERE tag_group_id = ?1 AND server_id = ?2",
            params![tag_group_id, server_id],
        )?;
        Ok(())
    }

    /// Get all server IDs for a tag group.
    pub fn get_servers_for_mcp_tag_group(&self, tag_group_id: &str) -> Result<Vec<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT server_id FROM mcp_tag_group_servers WHERE tag_group_id = ?1 ORDER BY sort_order",
        )?;
        let rows = stmt.query_map(params![tag_group_id], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get all tag group IDs for a server.
    pub fn get_tag_groups_for_mcp_server(&self, server_id: &str) -> Result<Vec<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt =
            conn.prepare("SELECT tag_group_id FROM mcp_tag_group_servers WHERE server_id = ?1")?;
        let rows = stmt.query_map(params![server_id], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // ── MCP Tag Group → Server → Agent toggles ────────────────────────────

    /// Set the enabled/disabled toggle for a server in a tag group for a specific agent.
    pub fn set_mcp_server_agent_toggle(
        &self,
        tag_group_id: &str,
        server_id: &str,
        agent_id: &str,
        enabled: bool,
    ) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR REPLACE INTO mcp_tag_group_server_agents (tag_group_id, server_id, agent_id, enabled, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![tag_group_id, server_id, agent_id, i32::from(enabled), now],
        )?;
        Ok(())
    }

    /// Get all toggles for a tag group.
    pub fn get_mcp_tag_group_agent_toggles(
        &self,
        tag_group_id: &str,
        server_id: &str,
    ) -> Result<Vec<(String, bool)>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT agent_id, enabled FROM mcp_tag_group_server_agents WHERE tag_group_id = ?1 AND server_id = ?2",
        )?;
        let rows = stmt.query_map(params![tag_group_id, server_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)? != 0))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // ── Project ↔ MCP Tag Group bindings ──────────────────────────────────

    /// Bind a project to an MCP tag group.
    pub fn insert_project_mcp_tag_group(&self, project_id: &str, tag_group_id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR IGNORE INTO project_mcp_tag_groups (project_id, tag_group_id, added_at)
             VALUES (?1, ?2, ?3)",
            params![project_id, tag_group_id, now],
        )?;
        Ok(())
    }

    /// Unbind a project from an MCP tag group.
    pub fn delete_project_mcp_tag_group(&self, project_id: &str, tag_group_id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "DELETE FROM project_mcp_tag_groups WHERE project_id = ?1 AND tag_group_id = ?2",
            params![project_id, tag_group_id],
        )?;
        Ok(())
    }

    /// Get all tag group IDs bound to a project.
    pub fn get_project_mcp_tag_groups(&self, project_id: &str) -> Result<Vec<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT tag_group_id FROM project_mcp_tag_groups WHERE project_id = ?1 ORDER BY added_at",
        )?;
        let rows = stmt.query_map(params![project_id], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Atomically replace all tag group bindings for a project.
    pub fn set_project_mcp_tag_groups(
        &self,
        project_id: &str,
        tag_group_ids: &[String],
    ) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "DELETE FROM project_mcp_tag_groups WHERE project_id = ?1",
            params![project_id],
        )?;
        let now = chrono::Utc::now().timestamp_millis();
        for tg_id in tag_group_ids {
            conn.execute(
                "INSERT INTO project_mcp_tag_groups (project_id, tag_group_id, added_at) VALUES (?1, ?2, ?3)",
                params![project_id, tg_id, now],
            )?;
        }
        Ok(())
    }

    /// Get per-project MCP tag group counts for all projects that have bindings.
    pub fn get_all_project_mcp_tag_group_counts(&self) -> Result<Vec<(String, i64)>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT project_id, COUNT(*) FROM project_mcp_tag_groups GROUP BY project_id ORDER BY project_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // ── MCP Server Deployment Targets ──────────────────────────────────────

    /// Insert a deployment target record.
    pub fn insert_mcp_server_target(&self, target: &McpServerTargetRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "INSERT OR REPLACE INTO mcp_server_targets (id, server_id, agent_id, target_path, status, deployed_at, last_error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![target.id, target.server_id, target.agent_id, target.target_path, target.status, target.deployed_at, target.last_error],
        )?;
        Ok(())
    }

    /// Get all deployment targets for a server.
    pub fn get_mcp_server_targets(&self, server_id: &str) -> Result<Vec<McpServerTargetRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, server_id, agent_id, target_path, status, deployed_at, last_error
             FROM mcp_server_targets WHERE server_id = ?1 ORDER BY agent_id",
        )?;
        let rows = stmt.query_map(params![server_id], map_mcp_server_target_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Delete a deployment target.
    pub fn delete_mcp_server_target(&self, server_id: &str, agent_id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "DELETE FROM mcp_server_targets WHERE server_id = ?1 AND agent_id = ?2",
            params![server_id, agent_id],
        )?;
        Ok(())
    }

    // ── Cache & Settings ─────────────────────────────────────────────────

    /// Get all unique tag names across all MCP servers.
    pub fn get_all_mcp_server_tags(&self) -> Result<Vec<String>> {
        let servers = self.get_all_mcp_servers()?;
        let mut tags = std::collections::BTreeSet::new();
        for s in &servers {
            for t in &s.tags {
                let trimmed = t.trim();
                if !trimmed.is_empty() {
                    tags.insert(trimmed.to_string());
                }
            }
        }
        Ok(tags.into_iter().collect())
    }

    /// Get a setting value by key.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt =
            conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Set a setting value.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![key, value, now],
        )?;
        Ok(())
    }

    /// Get cached data by key if within TTL.
    pub fn get_cache(&self, key: &str, ttl_secs: i64) -> Result<Option<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt =
            conn.prepare("SELECT value, created_at FROM cache WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        if let Some((value, created_at)) = rows.next().and_then(|r| r.ok()) {
            let now = chrono::Utc::now().timestamp_millis();
            let age_secs = (now - created_at) / 1000;
            if age_secs < ttl_secs {
                return Ok(Some(value));
            }
        }
        Ok(None)
    }

    /// Cache data with a key.
    pub fn set_cache(&self, key: &str, data: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR REPLACE INTO cache (key, value, created_at) VALUES (?1, ?2, ?3)",
            params![key, data, now],
        )?;
        Ok(())
    }

    /// Get all prompts (for command deployment, slash resolution).
    pub fn get_all_prompts(&self) -> Result<Vec<crate::library::skill::types::PromptRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, content, slash, tags_json, scope, project_id,
             variables_json, kind, favorite, usage_count, last_used_at, created_at, updated_at
             FROM prompts ORDER BY name",
        )?;
        let rows = stmt.query_map([], |row| {
            let tags_json: String = row.get(5)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            let variables_json: String = row.get(8)?;
            let variables: Vec<crate::library::skill::types::PromptVariableRecord> =
                serde_json::from_str(&variables_json).unwrap_or_default();
            Ok(crate::library::skill::types::PromptRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                content: row.get(3)?,
                slash: row.get(4)?,
                tags,
                scope: row.get(6)?,
                project_id: row.get(7)?,
                variables,
                kind: row.get(9)?,
                favorite: row.get(10).map(|v: i32| v != 0).unwrap_or(false),
                usage_count: row.get(11)?,
                last_used_at: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get a prompt by ID.
    pub fn get_prompt_by_id(&self, id: &str) -> Result<Option<crate::library::skill::types::PromptRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, content, slash, tags_json, scope, project_id,
             variables_json, kind, favorite, usage_count, last_used_at, created_at, updated_at
             FROM prompts WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            let tags_json: String = row.get(5)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            let variables_json: String = row.get(8)?;
            let variables: Vec<crate::library::skill::types::PromptVariableRecord> =
                serde_json::from_str(&variables_json).unwrap_or_default();
            Ok(crate::library::skill::types::PromptRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                content: row.get(3)?,
                slash: row.get(4)?,
                tags,
                scope: row.get(6)?,
                project_id: row.get(7)?,
                variables,
                kind: row.get(9)?,
                favorite: row.get(10).map(|v: i32| v != 0).unwrap_or(false),
                usage_count: row.get(11)?,
                last_used_at: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })?;
        Ok(rows.next().and_then(|r| r.ok()))
    }
}

// Row Mappers

fn map_mcp_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<McpServerRecord> {
    let tags_json: String = row.get(12)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(McpServerRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        command: row.get(3)?,
        url: row.get(4)?,
        args_json: row.get(5)?,
        env_json: row.get(6)?,
        transport: row.get(7)?,
        scope: row.get(8)?,
        project_id: row.get(9)?,
        source_registry: row.get(10)?,
        source_ref: row.get(11)?,
        tags,
        enabled: row.get(13).map(|v: i32| v != 0).unwrap_or(true),
        usage_count: row.get(14)?,
        last_used_at: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

fn map_mcp_tag_group_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<McpTagGroupRecord> {
    Ok(McpTagGroupRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        icon: row.get(3)?,
        sort_order: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn map_mcp_server_target_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<McpServerTargetRecord> {
    Ok(McpServerTargetRecord {
        id: row.get(0)?,
        server_id: row.get(1)?,
        agent_id: row.get(2)?,
        target_path: row.get(3)?,
        status: row.get(4)?,
        deployed_at: row.get(5)?,
        last_error: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_repository_new_in_memory() {
        let repo = McpRepository::open_in_memory().unwrap();
        let servers = repo.get_all_mcp_servers().unwrap();
        assert!(servers.is_empty());
    }

    #[test]
    fn test_mcp_server_crud() {
        let repo = McpRepository::open_in_memory().unwrap();
        let server = McpServerRecord {
            id: "mcp-1".to_string(),
            name: "test-server".to_string(),
            description: Some("A test MCP server".to_string()),
            command: "npx".to_string(),
            url: None,
            args_json: r#"["-y","@modelcontextprotocol/server-filesystem"]"#.to_string(),
            env_json: "{}".to_string(),
            transport: "stdio".to_string(),
            scope: "global".to_string(),
            project_id: None,
            source_registry: None,
            source_ref: None,
            tags: vec!["filesystem".to_string()],
            enabled: true,
            usage_count: 0,
            last_used_at: None,
            created_at: 1,
            updated_at: 1,
        };
        repo.insert_mcp_server(&server).unwrap();
        let fetched = repo.get_mcp_server_by_id("mcp-1").unwrap();
        assert!(fetched.is_some());
        let fetched = fetched.unwrap();
        assert_eq!(fetched.name, "test-server");
        assert_eq!(fetched.tags, vec!["filesystem".to_string()]);
    }

    #[test]
    fn test_mcp_tag_group_crud() {
        let repo = McpRepository::open_in_memory().unwrap();
        let group = McpTagGroupRecord {
            id: "tg-1".to_string(),
            name: "Backend".to_string(),
            description: Some("Backend MCP servers".to_string()),
            icon: None,
            sort_order: 0,
            created_at: 1,
            updated_at: 1,
        };
        repo.insert_mcp_tag_group(&group).unwrap();
        let fetched = repo.get_mcp_tag_group_by_id("tg-1").unwrap();
        assert!(fetched.is_some());
        assert_eq!(fetched.unwrap().name, "Backend");
    }
}
