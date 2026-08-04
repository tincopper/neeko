//! Unified library store combining skill, MCP, and prompt management.
//!
//! Replaces the old `SkillStore` + `McpStore` duo. All methods from both
//! stores are available on this single facade, backed by one shared SQLite
//! connection (`neeko.db`).

use anyhow::Result;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

// Re-export types from sub-modules for convenience
pub use crate::library::skill::types::{
    PromptRecord, PromptVariableRecord, SkillRecord, SkillTargetRecord,
    TagGroupRecord, ToolToggleRecord,
};
pub use crate::library::mcp::types::{McpServerTargetRecord, McpTagGroupRecord};
pub use crate::library::skill::types::McpServerRecord;

/// Thread-safe facade over the library database.
pub struct LibraryStore {
    conn: Mutex<Connection>,
}

impl LibraryStore {
    /// Open or create the library database at the given path.
    pub fn open(db_path: &Path) -> Result<Self> {
        let conn = crate::common::db::open(db_path)?;
        crate::library::migrations::run_migrations(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Open an in-memory library database (for testing).
    pub fn open_in_memory() -> Result<Self> {
        let conn = crate::common::db::open_in_memory()?;
        crate::library::migrations::run_migrations(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Skills CRUD
    // ═══════════════════════════════════════════════════════════════════════

    /// Insert a new skill record.
    pub fn insert_skill(&self, skill: &SkillRecord) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute(
            "INSERT INTO skills (id, name, description, source_type, source_ref, source_ref_resolved,
             source_subpath, source_branch, source_revision, remote_revision, central_path,
             content_hash, enabled, status, update_status, last_checked_at, last_check_error,
             created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            rusqlite::params![
                skill.id, skill.name, skill.description, skill.source_type, skill.source_ref,
                skill.source_ref_resolved, skill.source_subpath, skill.source_branch,
                skill.source_revision, skill.remote_revision, skill.central_path,
                skill.content_hash, skill.enabled, skill.status, skill.update_status,
                skill.last_checked_at, skill.last_check_error, skill.created_at, skill.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Get all skill records ordered by name.
    pub fn get_all_skills(&self) -> Result<Vec<SkillRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, source_type, source_ref, source_ref_resolved,
             source_subpath, source_branch, source_revision, remote_revision, central_path,
             content_hash, enabled, status, update_status, last_checked_at, last_check_error,
             created_at, updated_at FROM skills ORDER BY name",
        )?;
        let rows = stmt.query_map([], map_skill_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get a skill by its ID.
    pub fn get_skill_by_id(&self, id: &str) -> Result<Option<SkillRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, source_type, source_ref, source_ref_resolved,
             source_subpath, source_branch, source_revision, remote_revision, central_path,
             content_hash, enabled, status, update_status, last_checked_at, last_check_error,
             created_at, updated_at FROM skills WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![id], map_skill_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Get a skill by its central repository path.
    pub fn get_skill_by_central_path(&self, central_path: &str) -> Result<Option<SkillRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, source_type, source_ref, source_ref_resolved,
             source_subpath, source_branch, source_revision, remote_revision, central_path,
             content_hash, enabled, status, update_status, last_checked_at, last_check_error,
             created_at, updated_at FROM skills WHERE central_path = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![central_path], map_skill_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Update all fields of a skill record.
    pub fn update_skill(&self, skill: &SkillRecord) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE skills SET name = ?1, description = ?2, source_type = ?3, source_ref = ?4,
             source_ref_resolved = ?5, source_subpath = ?6, source_branch = ?7, source_revision = ?8,
             remote_revision = ?9, central_path = ?10, content_hash = ?11, enabled = ?12,
             status = ?13, update_status = ?14, last_checked_at = ?15, last_check_error = ?16,
             updated_at = ?17 WHERE id = ?18",
            rusqlite::params![
                skill.name, skill.description, skill.source_type, skill.source_ref,
                skill.source_ref_resolved, skill.source_subpath, skill.source_branch,
                skill.source_revision, skill.remote_revision, skill.central_path,
                skill.content_hash, skill.enabled, skill.status, skill.update_status,
                skill.last_checked_at, skill.last_check_error, now, skill.id,
            ],
        )?;
        Ok(())
    }

    /// Update a skill's metadata after re-installation.
    #[allow(clippy::too_many_arguments)]
    pub fn update_skill_after_install(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        source_revision: Option<&str>,
        remote_revision: Option<&str>,
        content_hash: Option<&str>,
        update_status: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE skills SET name = ?1, description = ?2, source_revision = ?3,
             remote_revision = ?4, content_hash = ?5, updated_at = ?6, update_status = ?7,
             last_checked_at = ?6, last_check_error = NULL WHERE id = ?8",
            rusqlite::params![name, description, source_revision, remote_revision, content_hash, now, update_status, id],
        )?;
        Ok(())
    }

    /// Update a skill's remote revision and check status.
    pub fn update_skill_check_state(
        &self,
        id: &str,
        remote_revision: Option<&str>,
        update_status: &str,
        last_check_error: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE skills SET remote_revision = ?1, update_status = ?2, last_checked_at = ?3,
             last_check_error = ?4 WHERE id = ?5",
            rusqlite::params![remote_revision, update_status, now, last_check_error, id],
        )?;
        Ok(())
    }

    /// Delete a skill and its associated targets and tags.
    pub fn delete_skill(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute("DELETE FROM skills WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Skill Targets
    // ═══════════════════════════════════════════════════════════════════════

    /// Insert a skill target (deployment) record.
    pub fn insert_target(&self, target: &SkillTargetRecord) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute(
            "INSERT OR REPLACE INTO skill_targets (id, skill_id, tool, target_path, mode, status, synced_at, last_error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                target.id, target.skill_id, target.tool, target.target_path, target.mode,
                target.status, target.synced_at, target.last_error,
            ],
        )?;
        Ok(())
    }

    /// Get all target records for a skill.
    pub fn get_targets_for_skill(&self, skill_id: &str) -> Result<Vec<SkillTargetRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, skill_id, tool, target_path, mode, status, synced_at, last_error
             FROM skill_targets WHERE skill_id = ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![skill_id], map_target_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get all target records across all skills.
    pub fn get_all_targets(&self) -> Result<Vec<SkillTargetRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, skill_id, tool, target_path, mode, status, synced_at, last_error FROM skill_targets",
        )?;
        let rows = stmt.query_map([], map_target_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Delete a target record by skill ID and tool key.
    pub fn delete_target(&self, skill_id: &str, tool: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute(
            "DELETE FROM skill_targets WHERE skill_id = ?1 AND tool = ?2",
            rusqlite::params![skill_id, tool],
        )?;
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Skill Tags
    // ═══════════════════════════════════════════════════════════════════════

    /// Get all unique tag names across all skills.
    pub fn get_all_tags(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare("SELECT DISTINCT tag FROM skill_tags ORDER BY tag")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Set tags for a skill (replaces existing tags).
    pub fn set_tags_for_skill(&self, skill_id: &str, tags: &[String]) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute("DELETE FROM skill_tags WHERE skill_id = ?1", rusqlite::params![skill_id])?;
        for tag in tags {
            let trimmed = tag.trim();
            if !trimmed.is_empty() {
                conn.execute(
                    "INSERT OR IGNORE INTO skill_tags (skill_id, tag) VALUES (?1, ?2)",
                    rusqlite::params![skill_id, trimmed],
                )?;
            }
        }
        Ok(())
    }

    /// Get a map of skill ID to its list of tag names.
    pub fn get_tags_map(&self) -> Result<HashMap<String, Vec<String>>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare("SELECT skill_id, tag FROM skill_tags ORDER BY tag")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        for row in rows.filter_map(|r| r.ok()) {
            map.entry(row.0).or_default().push(row.1);
        }
        Ok(map)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Tag Groups
    // ═══════════════════════════════════════════════════════════════════════

    /// Insert a new tag group.
    pub fn insert_tag_group(&self, tg: &TagGroupRecord) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute(
            "INSERT INTO tag_groups (id, name, description, icon, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![tg.id, tg.name, tg.description, tg.icon, tg.sort_order, tg.created_at, tg.updated_at],
        )?;
        Ok(())
    }

    /// Get all tag groups ordered by sort_order and creation time.
    pub fn get_all_tag_groups(&self) -> Result<Vec<TagGroupRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, icon, sort_order, created_at, updated_at
             FROM tag_groups ORDER BY sort_order, created_at",
        )?;
        let rows = stmt.query_map([], map_tag_group_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Update a tag group's name, description, and icon.
    pub fn update_tag_group(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        icon: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE tag_groups SET name = ?1, description = ?2, icon = ?3, updated_at = ?4 WHERE id = ?5",
            rusqlite::params![name, description, icon, now, id],
        )?;
        Ok(())
    }

    /// Delete a tag group by ID.
    pub fn delete_tag_group(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute("DELETE FROM tag_groups WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    /// Reorder tag groups by providing a sorted list of IDs.
    pub fn reorder_tag_groups(&self, ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let tx = conn.unchecked_transaction()?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE tag_groups SET sort_order = ?1 WHERE id = ?2",
                rusqlite::params![i as i32, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // TagGroup-Skill mapping

    /// Add a skill to a tag group.
    pub fn add_skill_to_tag_group(&self, tag_group_id: &str, skill_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR IGNORE INTO tag_group_skills (tag_group_id, skill_id, added_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![tag_group_id, skill_id, now],
        )?;
        Ok(())
    }

    /// Remove a skill from a tag group.
    pub fn remove_skill_from_tag_group(&self, tag_group_id: &str, skill_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute(
            "DELETE FROM tag_group_skills WHERE tag_group_id = ?1 AND skill_id = ?2",
            rusqlite::params![tag_group_id, skill_id],
        )?;
        Ok(())
    }

    /// Get all skills belonging to a tag group.
    pub fn get_skills_for_tag_group(&self, tag_group_id: &str) -> Result<Vec<SkillRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT s.id, s.name, s.description, s.source_type, s.source_ref, s.source_ref_resolved,
             s.source_subpath, s.source_branch, s.source_revision, s.remote_revision, s.central_path,
             s.content_hash, s.enabled, s.status, s.update_status, s.last_checked_at, s.last_check_error,
             s.created_at, s.updated_at FROM skills s INNER JOIN tag_group_skills tgs ON s.id = tgs.skill_id
             WHERE tgs.tag_group_id = ?1 ORDER BY tgs.sort_order, s.name",
        )?;
        let rows = stmt.query_map(rusqlite::params![tag_group_id], map_skill_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Count enabled skills in a tag group.
    pub fn count_skills_for_tag_group(&self, tag_group_id: &str) -> Result<i64> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tag_group_skills tgs INNER JOIN skills s ON s.id = tgs.skill_id
             WHERE tgs.tag_group_id = ?1 AND s.enabled = 1",
            rusqlite::params![tag_group_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Reorder skills within a tag group.
    pub fn reorder_tag_group_skills(&self, tag_group_id: &str, skill_ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let tx = conn.unchecked_transaction()?;
        for (i, skill_id) in skill_ids.iter().enumerate() {
            tx.execute(
                "UPDATE tag_group_skills SET sort_order = ?1 WHERE tag_group_id = ?2 AND skill_id = ?3",
                rusqlite::params![i as i32, tag_group_id, skill_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Enable or disable a tool for a skill in a tag group.
    pub fn set_tag_group_skill_tool_enabled(
        &self,
        tag_group_id: &str,
        skill_id: &str,
        tool: &str,
        enabled: bool,
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO tag_group_skill_tools (tag_group_id, skill_id, tool, enabled, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(tag_group_id, skill_id, tool)
             DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at",
            rusqlite::params![tag_group_id, skill_id, tool, enabled, now],
        )?;
        Ok(())
    }

    /// Get all tool toggle records for a skill in a tag group.
    pub fn get_tag_group_skill_tool_toggles(
        &self,
        tag_group_id: &str,
        skill_id: &str,
    ) -> Result<Vec<ToolToggleRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT tag_group_id, skill_id, tool, enabled, updated_at FROM tag_group_skill_tools
             WHERE tag_group_id = ?1 AND skill_id = ?2 ORDER BY tool",
        )?;
        let rows = stmt.query_map(rusqlite::params![tag_group_id, skill_id], |row| {
            Ok(ToolToggleRecord {
                tag_group_id: row.get(0)?,
                skill_id: row.get(1)?,
                tool: row.get(2)?,
                enabled: row.get::<_, i32>(3)? != 0,
                updated_at: row.get(4)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get enabled tool keys for a skill in a tag group.
    pub fn get_enabled_tools_for_tag_group_skill(
        &self,
        tag_group_id: &str,
        skill_id: &str,
    ) -> Result<Vec<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT tool FROM tag_group_skill_tools WHERE tag_group_id = ?1 AND skill_id = ?2 AND enabled = 1",
        )?;
        let rows = stmt.query_map(rusqlite::params![tag_group_id, skill_id], |row| {
            row.get::<_, String>(0)
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get tag group IDs for a skill.
    pub fn get_tag_groups_for_skill(&self, skill_id: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare("SELECT tag_group_id FROM tag_group_skills WHERE skill_id = ?1")?;
        let rows = stmt.query_map(rusqlite::params![skill_id], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // Project-TagGroup binding

    /// Set the tag groups bound to a project (replaces existing).
    pub fn set_project_tag_groups(&self, project_id: &str, tag_group_ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM project_tag_groups WHERE project_id = ?1", rusqlite::params![project_id])?;
        for tg_id in tag_group_ids {
            tx.execute(
                "INSERT OR IGNORE INTO project_tag_groups (project_id, tag_group_id, added_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![project_id, tg_id, chrono::Utc::now().timestamp_millis()],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Get tag group IDs bound to a project.
    pub fn get_project_tag_groups(&self, project_id: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare("SELECT tag_group_id FROM project_tag_groups WHERE project_id = ?1")?;
        let rows = stmt.query_map(rusqlite::params![project_id], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get total skill counts for all projects that have tag group bindings.
    pub fn get_all_project_skill_counts(&self) -> Result<Vec<(String, i64)>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT ptg.project_id, COUNT(*) FROM project_tag_groups ptg INNER JOIN tag_group_skills tgs
             ON ptg.tag_group_id = tgs.tag_group_id GROUP BY ptg.project_id",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Add a tag group binding to a project.
    pub fn add_project_tag_group(&self, project_id: &str, tag_group_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute(
            "INSERT OR IGNORE INTO project_tag_groups (project_id, tag_group_id, added_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![project_id, tag_group_id, chrono::Utc::now().timestamp_millis()],
        )?;
        Ok(())
    }

    /// Remove a tag group binding from a project.
    pub fn remove_project_tag_group(&self, project_id: &str, tag_group_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute(
            "DELETE FROM project_tag_groups WHERE project_id = ?1 AND tag_group_id = ?2",
            rusqlite::params![project_id, tag_group_id],
        )?;
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Prompts
    // ═══════════════════════════════════════════════════════════════════════

    /// Insert a new prompt.
    pub fn insert_prompt(&self, prompt: &PromptRecord) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let tags_json = serde_json::to_string(&prompt.tags).unwrap_or_else(|_| "[]".to_string());
        let variables_json = serde_json::to_string(&prompt.variables).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO prompts (id, name, description, content, slash, tags_json, scope, project_id,
             variables_json, kind, favorite, usage_count, last_used_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            rusqlite::params![
                prompt.id, prompt.name, prompt.description, prompt.content, prompt.slash,
                tags_json, prompt.scope, prompt.project_id, variables_json, prompt.kind,
                i32::from(prompt.favorite), prompt.usage_count, prompt.last_used_at,
                prompt.created_at, prompt.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Get all prompts ordered by updated_at descending.
    pub fn get_all_prompts(&self) -> Result<Vec<PromptRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, content, slash, tags_json, scope, project_id, variables_json,
             kind, favorite, usage_count, last_used_at, created_at, updated_at FROM prompts ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], map_prompt_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get a prompt by its ID.
    pub fn get_prompt_by_id(&self, id: &str) -> Result<Option<PromptRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, content, slash, tags_json, scope, project_id, variables_json,
             kind, favorite, usage_count, last_used_at, created_at, updated_at FROM prompts WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![id], map_prompt_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Get prompts filtered by kind ('prompt' or 'command').
    pub fn get_prompts_by_kind(&self, kind: &str) -> Result<Vec<PromptRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, content, slash, tags_json, scope, project_id, variables_json,
             kind, favorite, usage_count, last_used_at, created_at, updated_at FROM prompts WHERE kind = ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![kind], map_prompt_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get a prompt by its slash command (project scope takes priority).
    pub fn get_prompt_by_slash(
        &self,
        slash: &str,
        project_id: Option<&str>,
    ) -> Result<Option<PromptRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, content, slash, tags_json, scope, project_id, variables_json,
             kind, favorite, usage_count, last_used_at, created_at, updated_at FROM prompts
             WHERE slash = ?1 AND ((scope = 'project' AND project_id = ?2) OR scope = 'global')
             ORDER BY scope DESC",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![slash, project_id], map_prompt_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Update all fields of a prompt.
    pub fn update_prompt(&self, prompt: &PromptRecord) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        let tags_json = serde_json::to_string(&prompt.tags).unwrap_or_else(|_| "[]".to_string());
        let variables_json = serde_json::to_string(&prompt.variables).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE prompts SET name = ?1, description = ?2, content = ?3, slash = ?4, tags_json = ?5,
             scope = ?6, project_id = ?7, variables_json = ?8, kind = ?9, favorite = ?10,
             usage_count = ?11, last_used_at = ?12, updated_at = ?13 WHERE id = ?14",
            rusqlite::params![
                prompt.name, prompt.description, prompt.content, prompt.slash, tags_json,
                prompt.scope, prompt.project_id, variables_json, prompt.kind, i32::from(prompt.favorite),
                prompt.usage_count, prompt.last_used_at, now, prompt.id,
            ],
        )?;
        Ok(())
    }

    /// Delete a prompt by ID.
    pub fn delete_prompt(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute("DELETE FROM prompts WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    /// Increment usage count and update last_used_at.
    pub fn record_prompt_usage(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE prompts SET usage_count = usage_count + 1, last_used_at = ?1, updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, id],
        )?;
        Ok(())
    }

    /// Get all unique tag names across all prompts.
    pub fn get_all_prompt_tags(&self) -> Result<Vec<String>> {
        let prompts = self.get_all_prompts()?;
        let mut tags = std::collections::BTreeSet::new();
        for p in &prompts {
            for t in &p.tags {
                let trimmed = t.trim();
                if !trimmed.is_empty() {
                    tags.insert(trimmed.to_string());
                }
            }
        }
        Ok(tags.into_iter().collect())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MCP Servers
    // ═══════════════════════════════════════════════════════════════════════

    /// Insert a new MCP server.
    pub fn insert_mcp_server(&self, server: &McpServerRecord) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let tags_json = serde_json::to_string(&server.tags).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO mcp_servers (id, name, description, command, url, args_json, env_json,
             transport, scope, project_id, source_registry, source_ref, tags_json, enabled,
             usage_count, last_used_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            rusqlite::params![
                server.id, server.name, server.description, server.command, server.url,
                server.args_json, server.env_json, server.transport, server.scope, server.project_id,
                server.source_registry, server.source_ref, tags_json,
                i32::from(server.enabled), server.usage_count, server.last_used_at,
                server.created_at, server.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Get all MCP servers ordered by name.
    pub fn get_all_mcp_servers(&self) -> Result<Vec<McpServerRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, command, url, args_json, env_json, transport, scope,
             project_id, source_registry, source_ref, tags_json, enabled, usage_count,
             last_used_at, created_at, updated_at FROM mcp_servers ORDER BY name",
        )?;
        let rows = stmt.query_map([], map_mcp_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get an MCP server by its ID.
    pub fn get_mcp_server_by_id(&self, id: &str) -> Result<Option<McpServerRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, command, url, args_json, env_json, transport, scope,
             project_id, source_registry, source_ref, tags_json, enabled, usage_count,
             last_used_at, created_at, updated_at FROM mcp_servers WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![id], map_mcp_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Update all fields of an MCP server.
    pub fn update_mcp_server(&self, server: &McpServerRecord) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        let tags_json = serde_json::to_string(&server.tags).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE mcp_servers SET name = ?1, description = ?2, command = ?3, url = ?4,
             args_json = ?5, env_json = ?6, transport = ?7, scope = ?8, project_id = ?9,
             source_registry = ?10, source_ref = ?11, tags_json = ?12, enabled = ?13,
             usage_count = ?14, last_used_at = ?15, updated_at = ?16 WHERE id = ?17",
            rusqlite::params![
                server.name, server.description, server.command, server.url,
                server.args_json, server.env_json, server.transport, server.scope, server.project_id,
                server.source_registry, server.source_ref, tags_json,
                i32::from(server.enabled), server.usage_count, server.last_used_at,
                now, server.id,
            ],
        )?;
        Ok(())
    }

    /// Delete an MCP server by ID.
    pub fn delete_mcp_server(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute("DELETE FROM mcp_servers WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Settings & Cache
    // ═══════════════════════════════════════════════════════════════════════

    /// Get a setting value by key.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(rusqlite::params![key], |row| row.get::<_, String>(0))?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Set a setting value.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }

    /// Get cached data by key if within TTL.
    pub fn get_cache(&self, key: &str, ttl_secs: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare("SELECT data, fetched_at FROM skillssh_cache WHERE cache_key = ?1")?;
        let mut rows = stmt.query_map(rusqlite::params![key], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        if let Some(row) = rows.next() {
            let (data, fetched_at) = row?;
            let now = chrono::Utc::now().timestamp_millis();
            let age_secs = (now - fetched_at) / 1000;
            if age_secs < ttl_secs {
                return Ok(Some(data));
            }
        }
        Ok(None)
    }

    /// Cache data with a key.
    pub fn set_cache(&self, key: &str, data: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO skillssh_cache (cache_key, data, fetched_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at",
            rusqlite::params![key, data, now],
        )?;
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Agent Plugins (custom)
    // ═══════════════════════════════════════════════════════════════════════

    /// Insert a custom agent plugin.
    #[allow(clippy::too_many_arguments)]
    pub fn insert_agent_plugin(
        &self,
        id: &str,
        name: &str,
        icon: Option<&str>,
        description: Option<&str>,
        version: &str,
        is_builtin: bool,
        execution_json: &str,
        configuration_json: &str,
        capabilities_json: &str,
        paths_json: &str,
        lifecycle_json: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO agent_plugins (id, name, icon, description, version, is_builtin, enabled,
             execution_json, configuration_json, capabilities_json, paths_json, lifecycle_json,
             created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
            rusqlite::params![
                id, name, icon, description, version, i32::from(is_builtin),
                execution_json, configuration_json, capabilities_json, paths_json,
                lifecycle_json, now,
            ],
        )?;
        Ok(())
    }

    /// Get all custom (non-built-in) agent plugins.
    pub fn get_custom_agent_plugins(&self) -> Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, icon, description, version, is_builtin, enabled,
             execution_json, configuration_json, capabilities_json, paths_json, lifecycle_json,
             created_at, updated_at
             FROM agent_plugins WHERE is_builtin = 0 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let icon: Option<String> = row.get(2)?;
            let description: Option<String> = row.get(3)?;
            let version: String = row.get(4)?;
            let is_builtin: bool = row.get::<_, i32>(5)? != 0;
            let enabled: bool = row.get::<_, i32>(6)? != 0;
            let execution_json: String = row.get(7)?;
            let configuration_json: String = row.get(8)?;
            let capabilities_json: String = row.get(9)?;
            let paths_json: String = row.get(10)?;
            let lifecycle_json: Option<String> = row.get(11)?;
            let created_at: i64 = row.get(12)?;
            let updated_at: i64 = row.get(13)?;
            Ok(serde_json::json!({
                "id": id, "name": name, "icon": icon, "description": description,
                "version": version, "is_builtin": is_builtin, "enabled": enabled,
                "execution": serde_json::from_str::<serde_json::Value>(&execution_json).unwrap_or_default(),
                "configuration": serde_json::from_str::<serde_json::Value>(&configuration_json).unwrap_or_default(),
                "capabilities": serde_json::from_str::<serde_json::Value>(&capabilities_json).unwrap_or_default(),
                "paths": serde_json::from_str::<serde_json::Value>(&paths_json).unwrap_or_default(),
                "lifecycle": lifecycle_json.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
                "created_at": created_at, "updated_at": updated_at,
            }))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get a custom agent plugin by ID.
    pub fn get_custom_agent_plugin_by_id(&self, id: &str) -> Result<Option<serde_json::Value>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, icon, description, version, is_builtin, enabled,
             execution_json, configuration_json, capabilities_json, paths_json, lifecycle_json,
             created_at, updated_at
             FROM agent_plugins WHERE is_builtin = 0 AND id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![id], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let icon: Option<String> = row.get(2)?;
            let description: Option<String> = row.get(3)?;
            let version: String = row.get(4)?;
            let is_builtin: bool = row.get::<_, i32>(5)? != 0;
            let enabled: bool = row.get::<_, i32>(6)? != 0;
            let execution_json: String = row.get(7)?;
            let configuration_json: String = row.get(8)?;
            let capabilities_json: String = row.get(9)?;
            let paths_json: String = row.get(10)?;
            let lifecycle_json: Option<String> = row.get(11)?;
            let created_at: i64 = row.get(12)?;
            let updated_at: i64 = row.get(13)?;
            Ok(serde_json::json!({
                "id": id, "name": name, "icon": icon, "description": description,
                "version": version, "is_builtin": is_builtin, "enabled": enabled,
                "execution": serde_json::from_str::<serde_json::Value>(&execution_json).unwrap_or_default(),
                "configuration": serde_json::from_str::<serde_json::Value>(&configuration_json).unwrap_or_default(),
                "capabilities": serde_json::from_str::<serde_json::Value>(&capabilities_json).unwrap_or_default(),
                "paths": serde_json::from_str::<serde_json::Value>(&paths_json).unwrap_or_default(),
                "lifecycle": lifecycle_json.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
                "created_at": created_at, "updated_at": updated_at,
            }))
        })?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Delete a custom agent plugin by ID.
    pub fn delete_custom_agent_plugin(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute("DELETE FROM agent_plugins WHERE id = ?1 AND is_builtin = 0", rusqlite::params![id])?;
        Ok(())
    }

    /// Get all project tag group counts.
    pub fn get_all_project_tag_group_counts(&self) -> Result<Vec<(String, i64)>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare("SELECT project_id, COUNT(*) FROM project_tag_groups GROUP BY project_id")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MCP Tag Groups
    // ═══════════════════════════════════════════════════════════════════════

    /// Insert a new MCP tag group.
    pub fn insert_mcp_tag_group(&self, group: &McpTagGroupRecord) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute(
            "INSERT INTO mcp_tag_groups (id, name, description, icon, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![group.id, group.name, group.description, group.icon, group.sort_order, group.created_at, group.updated_at],
        )?;
        Ok(())
    }

    /// Get all MCP tag groups.
    pub fn get_all_mcp_tag_groups(&self) -> Result<Vec<McpTagGroupRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, icon, sort_order, created_at, updated_at FROM mcp_tag_groups ORDER BY sort_order, created_at",
        )?;
        let rows = stmt.query_map([], map_mcp_tag_group_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get an MCP tag group by ID.
    pub fn get_mcp_tag_group_by_id(&self, id: &str) -> Result<Option<McpTagGroupRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, icon, sort_order, created_at, updated_at FROM mcp_tag_groups WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![id], map_mcp_tag_group_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Update an MCP tag group.
    pub fn update_mcp_tag_group(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        icon: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE mcp_tag_groups SET name = ?1, description = ?2, icon = ?3, updated_at = ?4 WHERE id = ?5",
            rusqlite::params![name, description, icon, now, id],
        )?;
        Ok(())
    }

    /// Delete an MCP tag group.
    pub fn delete_mcp_tag_group(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute("DELETE FROM mcp_tag_groups WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    /// Reorder MCP tag groups.
    pub fn reorder_mcp_tag_groups(&self, ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let tx = conn.unchecked_transaction()?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE mcp_tag_groups SET sort_order = ?1 WHERE id = ?2",
                rusqlite::params![i as i32, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Get server IDs for an MCP tag group.
    pub fn get_servers_for_mcp_tag_group(&self, tag_group_id: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare("SELECT server_id FROM mcp_tag_group_servers WHERE tag_group_id = ?1")?;
        let rows = stmt.query_map(rusqlite::params![tag_group_id], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Add a server to an MCP tag group.
    pub fn add_server_to_mcp_tag_group(&self, tag_group_id: &str, server_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR IGNORE INTO mcp_tag_group_servers (tag_group_id, server_id, added_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![tag_group_id, server_id, now],
        )?;
        Ok(())
    }

    /// Remove a server from an MCP tag group.
    pub fn remove_server_from_mcp_tag_group(&self, tag_group_id: &str, server_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute(
            "DELETE FROM mcp_tag_group_servers WHERE tag_group_id = ?1 AND server_id = ?2",
            rusqlite::params![tag_group_id, server_id],
        )?;
        Ok(())
    }

    /// Set the enabled toggle for a server in a tag group for a specific agent.
    pub fn set_mcp_server_agent_toggle(
        &self,
        tag_group_id: &str,
        server_id: &str,
        agent_id: &str,
        enabled: bool,
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO mcp_tag_group_server_agents (tag_group_id, server_id, agent_id, enabled, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(tag_group_id, server_id, agent_id)
             DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at",
            rusqlite::params![tag_group_id, server_id, agent_id, enabled, now],
        )?;
        Ok(())
    }

    /// Get tag group IDs for an MCP server.
    pub fn get_tag_groups_for_mcp_server(&self, server_id: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare("SELECT tag_group_id FROM mcp_tag_group_servers WHERE server_id = ?1")?;
        let rows = stmt.query_map(rusqlite::params![server_id], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Insert a deployment target record.
    pub fn insert_mcp_server_target(&self, target: &McpServerTargetRecord) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute(
            "INSERT INTO mcp_server_targets (id, server_id, agent_id, target_path, status, deployed_at, last_error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![target.id, target.server_id, target.agent_id, target.target_path, target.status, target.deployed_at, target.last_error],
        )?;
        Ok(())
    }

    /// Get all deployment targets for a server.
    pub fn get_mcp_server_targets(&self, server_id: &str) -> Result<Vec<McpServerTargetRecord>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, server_id, agent_id, target_path, status, deployed_at, last_error FROM mcp_server_targets WHERE server_id = ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![server_id], map_mcp_server_target_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Delete a deployment target.
    pub fn delete_mcp_server_target(&self, server_id: &str, agent_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute(
            "DELETE FROM mcp_server_targets WHERE server_id = ?1 AND agent_id = ?2",
            rusqlite::params![server_id, agent_id],
        )?;
        Ok(())
    }

    /// Insert a project MCP tag group binding.
    pub fn insert_project_mcp_tag_group(&self, project_id: &str, tag_group_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR IGNORE INTO project_mcp_tag_groups (project_id, tag_group_id, added_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![project_id, tag_group_id, now],
        )?;
        Ok(())
    }

    /// Delete a project MCP tag group binding.
    pub fn delete_project_mcp_tag_group(&self, project_id: &str, tag_group_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        conn.execute(
            "DELETE FROM project_mcp_tag_groups WHERE project_id = ?1 AND tag_group_id = ?2",
            rusqlite::params![project_id, tag_group_id],
        )?;
        Ok(())
    }

    /// Get all tag group IDs bound to a project.
    pub fn get_project_mcp_tag_groups(&self, project_id: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare("SELECT tag_group_id FROM project_mcp_tag_groups WHERE project_id = ?1")?;
        let rows = stmt.query_map(rusqlite::params![project_id], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Atomically replace all tag group bindings for a project.
    pub fn set_project_mcp_tag_groups(&self, project_id: &str, tag_group_ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM project_mcp_tag_groups WHERE project_id = ?1", rusqlite::params![project_id])?;
        for tg_id in tag_group_ids {
            tx.execute(
                "INSERT OR IGNORE INTO project_mcp_tag_groups (project_id, tag_group_id, added_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![project_id, tg_id, chrono::Utc::now().timestamp_millis()],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Get per-project MCP tag group counts.
    pub fn get_all_project_mcp_tag_group_counts(&self) -> Result<Vec<(String, i64)>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT project_id, COUNT(*) FROM project_mcp_tag_groups GROUP BY project_id",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get all agent toggles for a server in a tag group.
    pub fn get_mcp_tag_group_agent_toggles(
        &self,
        tag_group_id: &str,
        server_id: &str,
    ) -> Result<Vec<(String, bool)>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT agent_id, enabled FROM mcp_tag_group_server_agents WHERE tag_group_id = ?1 AND server_id = ?2",
        )?;
        let rows = stmt.query_map(rusqlite::params![tag_group_id, server_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)? != 0))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

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

    /// Record MCP server usage.
    pub fn record_mcp_server_usage(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE mcp_servers SET usage_count = usage_count + 1, last_used_at = ?1, updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, id],
        )?;
        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Row Mappers
// ═══════════════════════════════════════════════════════════════════════════

use rusqlite::Connection;

fn map_skill_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SkillRecord> {
    Ok(SkillRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        source_type: row.get(3)?,
        source_ref: row.get(4)?,
        source_ref_resolved: row.get(5)?,
        source_subpath: row.get(6)?,
        source_branch: row.get(7)?,
        source_revision: row.get(8)?,
        remote_revision: row.get(9)?,
        central_path: row.get(10)?,
        content_hash: row.get(11)?,
        enabled: row.get::<_, i32>(12)? != 0,
        status: row.get(13)?,
        update_status: row.get(14)?,
        last_checked_at: row.get(15)?,
        last_check_error: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

fn map_target_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SkillTargetRecord> {
    Ok(SkillTargetRecord {
        id: row.get(0)?,
        skill_id: row.get(1)?,
        tool: row.get(2)?,
        target_path: row.get(3)?,
        mode: row.get(4)?,
        status: row.get(5)?,
        synced_at: row.get(6)?,
        last_error: row.get(7)?,
    })
}

fn map_tag_group_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TagGroupRecord> {
    Ok(TagGroupRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        icon: row.get(3)?,
        sort_order: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn map_tool_toggle_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ToolToggleRecord> {
    Ok(ToolToggleRecord {
        tag_group_id: row.get(0)?,
        skill_id: row.get(1)?,
        tool: row.get(2)?,
        enabled: row.get::<_, i32>(3)? != 0,
        updated_at: row.get(4)?,
    })
}

fn map_prompt_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PromptRecord> {
    let tags_json: String = row.get(5)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let variables_json: String = row.get(8)?;
    let variables: Vec<PromptVariableRecord> = serde_json::from_str(&variables_json).unwrap_or_default();
    Ok(PromptRecord {
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
        favorite: row.get::<_, i32>(10)? != 0,
        usage_count: row.get(11)?,
        last_used_at: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

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
        enabled: row.get::<_, i32>(13)? != 0,
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
    fn open_in_memory_and_migrate() {
        let store = LibraryStore::open_in_memory().unwrap();
        store.set_setting("test_key", "test_value").unwrap();
        let val = store.get_setting("test_key").unwrap();
        assert_eq!(val, Some("test_value".to_string()));
    }

    #[test]
    fn all_methods_accessible() {
        let store = LibraryStore::open_in_memory().unwrap();

        // Skills CRUD
        let skill = SkillRecord {
            id: "s1".into(),
            name: "test-skill".into(),
            description: None,
            source_type: "git".into(),
            source_ref: "https://example.com".into(),
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: "/tmp/skill".into(),
            content_hash: None,
            enabled: true,
            status: "ok".into(),
            update_status: "unknown".into(),
            last_checked_at: None,
            last_check_error: None,
            created_at: 1,
            updated_at: 1,
        };
        store.insert_skill(&skill).unwrap();
        assert_eq!(store.get_all_skills().unwrap().len(), 1);
        assert!(store.get_skill_by_id("s1").unwrap().is_some());
        store.delete_skill("s1").unwrap();
        assert_eq!(store.get_all_skills().unwrap().len(), 0);

        // Prompts
        let prompt = PromptRecord {
            id: "p1".into(),
            name: "test-prompt".into(),
            description: None,
            content: "test content".into(),
            slash: None,
            tags: vec![],
            scope: "global".into(),
            project_id: None,
            variables: vec![],
            kind: "prompt".into(),
            favorite: false,
            usage_count: 0,
            last_used_at: None,
            created_at: 1,
            updated_at: 1,
        };
        store.insert_prompt(&prompt).unwrap();
        assert_eq!(store.get_all_prompts().unwrap().len(), 1);
        store.delete_prompt("p1").unwrap();

        // MCP Servers
        let server = McpServerRecord {
            id: "m1".into(),
            name: "test-mcp".into(),
            description: None,
            command: "echo".into(),
            url: None,
            args_json: "[]".into(),
            env_json: "{}".into(),
            transport: "stdio".into(),
            scope: "global".into(),
            project_id: None,
            source_registry: None,
            source_ref: None,
            tags: vec![],
            enabled: true,
            usage_count: 0,
            last_used_at: None,
            created_at: 1,
            updated_at: 1,
        };
        store.insert_mcp_server(&server).unwrap();
        assert_eq!(store.get_all_mcp_servers().unwrap().len(), 1);
        store.delete_mcp_server("m1").unwrap();
    }
}
