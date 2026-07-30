//! SQLite-backed repository for skill records, targets, tag groups, and caching.

use anyhow::Result;
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use super::types::{
    PromptRecord, PromptVariableRecord, SkillRecord, SkillTargetRecord, TagGroupRecord,
    ToolToggleRecord,
};

/// SQLite data access layer for all skill-related persistence.
pub struct SkillRepository {
    conn: Mutex<Connection>,
}

impl SkillRepository {
    /// Open or create a skill database at the given path.
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

    /// Get the inner database connection (for migration usage).
    #[allow(dead_code, clippy::expect_used)]
    pub fn get_conn_inner(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn
            .lock()
            .expect("infallible: database lock should not be poisoned")
    }

    // Skills CRUD

    /// Insert a new skill record.
    pub fn insert_skill(&self, skill: &SkillRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "INSERT INTO skills (id, name, description, source_type, source_ref, source_ref_resolved, source_subpath, source_branch, source_revision, remote_revision, central_path, content_hash, enabled, status, update_status, last_checked_at, last_check_error, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![skill.id, skill.name, skill.description, skill.source_type, skill.source_ref, skill.source_ref_resolved, skill.source_subpath, skill.source_branch, skill.source_revision, skill.remote_revision, skill.central_path, skill.content_hash, skill.enabled, skill.status, skill.update_status, skill.last_checked_at, skill.last_check_error, skill.created_at, skill.updated_at],
        )?;
        Ok(())
    }

    /// Get all skill records ordered by name.
    pub fn get_all_skills(&self) -> Result<Vec<SkillRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare("SELECT id, name, description, source_type, source_ref, source_ref_resolved, source_subpath, source_branch, source_revision, remote_revision, central_path, content_hash, enabled, status, update_status, last_checked_at, last_check_error, created_at, updated_at FROM skills ORDER BY name")?;
        let rows = stmt.query_map([], map_skill_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get a skill by its ID.
    pub fn get_skill_by_id(&self, id: &str) -> Result<Option<SkillRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare("SELECT id, name, description, source_type, source_ref, source_ref_resolved, source_subpath, source_branch, source_revision, remote_revision, central_path, content_hash, enabled, status, update_status, last_checked_at, last_check_error, created_at, updated_at FROM skills WHERE id = ?1")?;
        let mut rows = stmt.query_map(params![id], map_skill_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Get a skill by its central repository path.
    pub fn get_skill_by_central_path(&self, central_path: &str) -> Result<Option<SkillRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare("SELECT id, name, description, source_type, source_ref, source_ref_resolved, source_subpath, source_branch, source_revision, remote_revision, central_path, content_hash, enabled, status, update_status, last_checked_at, last_check_error, created_at, updated_at FROM skills WHERE central_path = ?1")?;
        let mut rows = stmt.query_map(params![central_path], map_skill_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Update all fields of a skill record.
    pub fn update_skill(&self, skill: &SkillRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE skills SET name = ?1, description = ?2, source_type = ?3, source_ref = ?4, source_ref_resolved = ?5, source_subpath = ?6, source_branch = ?7, source_revision = ?8, remote_revision = ?9, central_path = ?10, content_hash = ?11, enabled = ?12, status = ?13, update_status = ?14, last_checked_at = ?15, last_check_error = ?16, updated_at = ?17 WHERE id = ?18",
            params![skill.name, skill.description, skill.source_type, skill.source_ref, skill.source_ref_resolved, skill.source_subpath, skill.source_branch, skill.source_revision, skill.remote_revision, skill.central_path, skill.content_hash, skill.enabled, skill.status, skill.update_status, skill.last_checked_at, skill.last_check_error, now, skill.id],
        )?;
        Ok(())
    }

    /// Update a skill's name, description, revisions, and hash after re-install.
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
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute("UPDATE skills SET name = ?1, description = ?2, source_revision = ?3, remote_revision = ?4, content_hash = ?5, updated_at = ?6, update_status = ?7, last_checked_at = ?6, last_check_error = NULL WHERE id = ?8", params![name, description, source_revision, remote_revision, content_hash, now, update_status, id])?;
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
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute("UPDATE skills SET remote_revision = ?1, update_status = ?2, last_checked_at = ?3, last_check_error = ?4 WHERE id = ?5", params![remote_revision, update_status, now, last_check_error, id])?;
        Ok(())
    }

    /// Delete a skill by ID.
    pub fn delete_skill(&self, id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute("DELETE FROM skills WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Targets

    /// Insert a skill target (deployment) record.
    pub fn insert_target(&self, target: &SkillTargetRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute("INSERT OR REPLACE INTO skill_targets (id, skill_id, tool, target_path, mode, status, synced_at, last_error) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)", params![target.id, target.skill_id, target.tool, target.target_path, target.mode, target.status, target.synced_at, target.last_error])?;
        Ok(())
    }

    /// Get all target records for a skill.
    pub fn get_targets_for_skill(&self, skill_id: &str) -> Result<Vec<SkillTargetRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare("SELECT id, skill_id, tool, target_path, mode, status, synced_at, last_error FROM skill_targets WHERE skill_id = ?1")?;
        let rows = stmt.query_map(params![skill_id], map_target_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get all target records across all skills.
    pub fn get_all_targets(&self) -> Result<Vec<SkillTargetRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare("SELECT id, skill_id, tool, target_path, mode, status, synced_at, last_error FROM skill_targets")?;
        let rows = stmt.query_map([], map_target_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Delete a target record by skill ID and tool key.
    pub fn delete_target(&self, skill_id: &str, tool: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "DELETE FROM skill_targets WHERE skill_id = ?1 AND tool = ?2",
            params![skill_id, tool],
        )?;
        Ok(())
    }

    // Skill Tags

    /// Get all unique tag names across all skills.
    pub fn get_all_tags(&self) -> Result<Vec<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare("SELECT DISTINCT tag FROM skill_tags ORDER BY tag")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Set tags for a skill (replaces existing tags).
    pub fn set_tags_for_skill(&self, skill_id: &str, tags: &[String]) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "DELETE FROM skill_tags WHERE skill_id = ?1",
            params![skill_id],
        )?;
        for tag in tags {
            let trimmed = tag.trim();
            if !trimmed.is_empty() {
                conn.execute(
                    "INSERT OR IGNORE INTO skill_tags (skill_id, tag) VALUES (?1, ?2)",
                    params![skill_id, trimmed],
                )?;
            }
        }
        Ok(())
    }

    /// Get a map of skill ID to its list of tag names.
    pub fn get_tags_map(&self) -> Result<HashMap<String, Vec<String>>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
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

    // Tag Groups

    /// Insert a new tag group.
    pub fn insert_tag_group(&self, tg: &TagGroupRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute("INSERT INTO tag_groups (id, name, description, icon, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)", params![tg.id, tg.name, tg.description, tg.icon, tg.sort_order, tg.created_at, tg.updated_at])?;
        Ok(())
    }

    /// Get all tag groups ordered by sort_order and creation time.
    pub fn get_all_tag_groups(&self) -> Result<Vec<TagGroupRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare("SELECT id, name, description, icon, sort_order, created_at, updated_at FROM tag_groups ORDER BY sort_order, created_at")?;
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
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute("UPDATE tag_groups SET name = ?1, description = ?2, icon = ?3, updated_at = ?4 WHERE id = ?5", params![name, description, icon, now, id])?;
        Ok(())
    }

    /// Delete a tag group by ID.
    pub fn delete_tag_group(&self, id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute("DELETE FROM tag_groups WHERE id = ?1", params![id])?;
        Ok(())
    }

    #[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
    /// Reorder tag groups by setting sort_order from the provided ID list.
    pub fn reorder_tag_groups(&self, ids: &[String]) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let tx = conn.unchecked_transaction()?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE tag_groups SET sort_order = ?1 WHERE id = ?2",
                params![i as i32, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // TagGroup-Skill mapping

    /// Add a skill to a tag group.
    pub fn add_skill_to_tag_group(&self, tag_group_id: &str, skill_id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute("INSERT OR IGNORE INTO tag_group_skills (tag_group_id, skill_id, added_at) VALUES (?1, ?2, ?3)", params![tag_group_id, skill_id, now])?;
        Ok(())
    }

    /// Remove a skill from a tag group.
    pub fn remove_skill_from_tag_group(&self, tag_group_id: &str, skill_id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "DELETE FROM tag_group_skills WHERE tag_group_id = ?1 AND skill_id = ?2",
            params![tag_group_id, skill_id],
        )?;
        Ok(())
    }

    /// Get all skills belonging to a tag group.
    pub fn get_skills_for_tag_group(&self, tag_group_id: &str) -> Result<Vec<SkillRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare("SELECT s.id, s.name, s.description, s.source_type, s.source_ref, s.source_ref_resolved, s.source_subpath, s.source_branch, s.source_revision, s.remote_revision, s.central_path, s.content_hash, s.enabled, s.status, s.update_status, s.last_checked_at, s.last_check_error, s.created_at, s.updated_at FROM skills s INNER JOIN tag_group_skills tgs ON s.id = tgs.skill_id WHERE tgs.tag_group_id = ?1 ORDER BY tgs.sort_order, s.name")?;
        let rows = stmt.query_map(params![tag_group_id], map_skill_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Count **enabled** skills in a tag group (disabled library skills excluded).
    pub fn count_skills_for_tag_group(&self, tag_group_id: &str) -> Result<i64> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tag_group_skills tgs
             INNER JOIN skills s ON s.id = tgs.skill_id
             WHERE tgs.tag_group_id = ?1 AND s.enabled = 1",
            params![tag_group_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Reorder skills within a tag group.
    pub fn reorder_tag_group_skills(&self, tag_group_id: &str, skill_ids: &[String]) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let tx = conn.unchecked_transaction()?;
        for (i, skill_id) in skill_ids.iter().enumerate() {
            #[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
            tx.execute(
                "UPDATE tag_group_skills SET sort_order = ?1 WHERE tag_group_id = ?2 AND skill_id = ?3",
                params![i as i32, tag_group_id, skill_id],
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
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO tag_group_skill_tools (tag_group_id, skill_id, tool, enabled, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(tag_group_id, skill_id, tool)
             DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at",
            params![tag_group_id, skill_id, tool, enabled, now],
        )?;
        Ok(())
    }

    /// Get all tool toggle records for a skill in a tag group.
    pub fn get_tag_group_skill_tool_toggles(
        &self,
        tag_group_id: &str,
        skill_id: &str,
    ) -> Result<Vec<ToolToggleRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT tag_group_id, skill_id, tool, enabled, updated_at
             FROM tag_group_skill_tools
             WHERE tag_group_id = ?1 AND skill_id = ?2 ORDER BY tool",
        )?;
        let rows = stmt.query_map(params![tag_group_id, skill_id], |row| {
            Ok(ToolToggleRecord {
                tag_group_id: row.get(0)?,
                skill_id: row.get(1)?,
                tool: row.get(2)?,
                enabled: row.get::<_, i32>(3)? != 0,
                updated_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Get enabled tool keys for a skill in a tag group.
    pub fn get_enabled_tools_for_tag_group_skill(
        &self,
        tag_group_id: &str,
        skill_id: &str,
    ) -> Result<Vec<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT tool FROM tag_group_skill_tools
             WHERE tag_group_id = ?1 AND skill_id = ?2 AND enabled = 1",
        )?;
        let rows = stmt.query_map(params![tag_group_id, skill_id], |row| {
            row.get::<_, String>(0)
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Get tag group IDs that a skill belongs to.
    pub fn get_tag_groups_for_skill(&self, skill_id: &str) -> Result<Vec<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt =
            conn.prepare("SELECT tag_group_id FROM tag_group_skills WHERE skill_id = ?1")?;
        let rows = stmt.query_map(params![skill_id], |row| row.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // Project-TagGroup binding

    /// Set the tag groups bound to a project (replaces existing).
    pub fn set_project_tag_groups(&self, project_id: &str, tag_group_ids: &[String]) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM project_tag_groups WHERE project_id = ?1",
            params![project_id],
        )?;
        let now = chrono::Utc::now().timestamp_millis();
        for tg_id in tag_group_ids {
            tx.execute(
                "INSERT OR IGNORE INTO project_tag_groups (project_id, tag_group_id, added_at) VALUES (?1, ?2, ?3)",
                params![project_id, tg_id, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Get tag group IDs bound to a project.
    pub fn get_project_tag_groups(&self, project_id: &str) -> Result<Vec<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT tag_group_id FROM project_tag_groups WHERE project_id = ?1 ORDER BY added_at",
        )?;
        let rows = stmt.query_map(params![project_id], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Add a tag group binding to a project.
    pub fn add_project_tag_group(&self, project_id: &str, tag_group_id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR IGNORE INTO project_tag_groups (project_id, tag_group_id, added_at) VALUES (?1, ?2, ?3)",
            params![project_id, tag_group_id, now],
        )?;
        Ok(())
    }

    /// Remove a tag group binding from a project.
    pub fn remove_project_tag_group(&self, project_id: &str, tag_group_id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "DELETE FROM project_tag_groups WHERE project_id = ?1 AND tag_group_id = ?2",
            params![project_id, tag_group_id],
        )?;
        Ok(())
    }

    /// Get total skill counts for all projects that have tag group bindings.
    ///
    /// Returns `(project_id, total_skill_count)` pairs by joining
    /// `project_tag_groups` with `tag_group_skills`.
    pub fn get_all_project_skill_counts(&self) -> Result<Vec<(String, i64)>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT ptg.project_id, COUNT(tgs.skill_id)
             FROM project_tag_groups ptg
             LEFT JOIN tag_group_skills tgs ON tgs.tag_group_id = ptg.tag_group_id
             GROUP BY ptg.project_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Bound tag-group counts for all projects.
    ///
    /// Returns `(project_id, bound_group_count)` from `project_tag_groups`.
    /// Projects with zero bindings are omitted (caller treats missing as 0).
    pub fn get_all_project_tag_group_counts(&self) -> Result<Vec<(String, i64)>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT project_id, COUNT(*)
             FROM project_tag_groups
             GROUP BY project_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // Settings

    /// Get a setting value by key.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Set a setting value.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    // Cache methods

    /// Get cached data by key if within TTL.
    pub fn get_cache(&self, key: &str, ttl_secs: i64) -> Result<Option<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        let cutoff = now - (ttl_secs * 1000);

        let mut stmt = conn
            .prepare("SELECT data FROM skillssh_cache WHERE cache_key = ?1 AND fetched_at > ?2")?;
        let mut rows = stmt.query_map(params![key, cutoff], |row: &rusqlite::Row| {
            row.get::<_, String>(0)
        })?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Cache data with a key.
    pub fn set_cache(&self, key: &str, data: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR REPLACE INTO skillssh_cache (cache_key, data, fetched_at) VALUES (?1, ?2, ?3)",
            params![key, data, now],
        )?;
        Ok(())
    }

    /// Clear a specific cache entry.
    pub fn clear_cache(&self, key: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "DELETE FROM skillssh_cache WHERE cache_key = ?1",
            params![key],
        )?;
        Ok(())
    }

    /// Clear all cache entries.
    pub fn clear_all_cache(&self) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute("DELETE FROM skillssh_cache", [])?;
        Ok(())
    }

    // ── Prompts ───────────────────────────────────────────────────────────

    /// Insert a new prompt.
    pub fn insert_prompt(&self, prompt: &PromptRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let tags_json = serde_json::to_string(&prompt.tags).unwrap_or_else(|_| "[]".to_string());
        let variables_json =
            serde_json::to_string(&prompt.variables).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO prompts (id, name, description, content, slash, tags_json, scope, project_id, variables_json, kind, favorite, usage_count, last_used_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                prompt.id,
                prompt.name,
                prompt.description,
                prompt.content,
                prompt.slash,
                tags_json,
                prompt.scope,
                prompt.project_id,
                variables_json,
                prompt.kind,
                prompt.favorite as i32,
                prompt.usage_count,
                prompt.last_used_at,
                prompt.created_at,
                prompt.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Get all prompts ordered by updated_at descending.
    pub fn get_all_prompts(&self) -> Result<Vec<PromptRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, content, slash, tags_json, scope, project_id, variables_json, kind, favorite, usage_count, last_used_at, created_at, updated_at FROM prompts ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], map_prompt_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get prompts filtered by kind ('prompt' or 'command').
    pub fn get_prompts_by_kind(&self, kind: &str) -> Result<Vec<PromptRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, content, slash, tags_json, scope, project_id, variables_json, kind, favorite, usage_count, last_used_at, created_at, updated_at FROM prompts WHERE kind = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(params![kind], map_prompt_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get a prompt by its ID.
    pub fn get_prompt_by_id(&self, id: &str) -> Result<Option<PromptRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, content, slash, tags_json, scope, project_id, variables_json, kind, favorite, usage_count, last_used_at, created_at, updated_at FROM prompts WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], map_prompt_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Get a prompt by its slash command (project scope takes priority).
    ///
    /// Returns the project-scoped prompt when `project_id` matches, otherwise
    /// the global-scoped prompt. Used by the slash resolver.
    pub fn get_prompt_by_slash(
        &self,
        slash: &str,
        project_id: Option<&str>,
    ) -> Result<Option<PromptRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        // Project scope first (override), then global.
        let mut stmt = conn.prepare(
            "SELECT id, name, description, content, slash, tags_json, scope, project_id, variables_json, kind, favorite, usage_count, last_used_at, created_at, updated_at
             FROM prompts
             WHERE slash = ?1
             ORDER BY CASE scope WHEN 'project' THEN 0 ELSE 1 END, updated_at DESC
             LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![slash], map_prompt_row)?;
        let found = rows.next().and_then(|r| r.ok());
        // When a project id is provided, prefer a project-scoped match.
        if let Some(pid) = project_id {
            if let Some(ref p) = found {
                if p.scope == "project" && p.project_id.as_deref() == Some(pid) {
                    return Ok(found);
                }
            }
            // Re-query for project-scoped specifically.
            let mut stmt2 = conn.prepare(
                "SELECT id, name, description, content, slash, tags_json, scope, project_id, variables_json, kind, favorite, usage_count, last_used_at, created_at, updated_at
                 FROM prompts
                 WHERE slash = ?1 AND scope = 'project' AND project_id = ?2
                 LIMIT 1",
            )?;
            let mut rows2 = stmt2.query_map(params![slash, pid], map_prompt_row)?;
            if let Some(proj_match) = rows2.next().and_then(|r| r.ok()) {
                return Ok(Some(proj_match));
            }
        }
        Ok(found)
    }

    /// Update all fields of a prompt.
    pub fn update_prompt(&self, prompt: &PromptRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        let tags_json = serde_json::to_string(&prompt.tags).unwrap_or_else(|_| "[]".to_string());
        let variables_json =
            serde_json::to_string(&prompt.variables).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE prompts SET name = ?1, description = ?2, content = ?3, slash = ?4, tags_json = ?5, scope = ?6, project_id = ?7, variables_json = ?8, kind = ?9, favorite = ?10, usage_count = ?11, last_used_at = ?12, updated_at = ?13 WHERE id = ?14",
            params![
                prompt.name,
                prompt.description,
                prompt.content,
                prompt.slash,
                tags_json,
                prompt.scope,
                prompt.project_id,
                variables_json,
                prompt.kind,
                prompt.favorite as i32,
                prompt.usage_count,
                prompt.last_used_at,
                now,
                prompt.id,
            ],
        )?;
        Ok(())
    }

    /// Delete a prompt by ID.
    pub fn delete_prompt(&self, id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute("DELETE FROM prompts WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Increment usage count and update last_used_at.
    pub fn record_prompt_usage(&self, id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE prompts SET usage_count = usage_count + 1, last_used_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
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

    // ── Actions ───────────────────────────────────────────────────────────

    /// Insert a new action.
    pub fn insert_action(&self, action: &super::types::ActionRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let tags_json = serde_json::to_string(&action.tags).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO actions (id, name, description, \"group\", payload_json, shortcut, tags_json, enabled, usage_count, last_used_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                action.id,
                action.name,
                action.description,
                action.group,
                action.payload_json,
                action.shortcut,
                tags_json,
                i32::from(action.enabled),
                action.usage_count,
                action.last_used_at,
                action.created_at,
                action.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Get all actions ordered by updated_at descending.
    pub fn get_all_actions(&self) -> Result<Vec<super::types::ActionRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, \"group\", payload_json, shortcut, tags_json, enabled, usage_count, last_used_at, created_at, updated_at FROM actions ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], map_action_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get an action by its ID.
    pub fn get_action_by_id(&self, id: &str) -> Result<Option<super::types::ActionRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, \"group\", payload_json, shortcut, tags_json, enabled, usage_count, last_used_at, created_at, updated_at FROM actions WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], map_action_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Update all fields of an action.
    pub fn update_action(&self, action: &super::types::ActionRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        let tags_json = serde_json::to_string(&action.tags).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE actions SET name = ?1, description = ?2, \"group\" = ?3, payload_json = ?4, shortcut = ?5, tags_json = ?6, enabled = ?7, usage_count = ?8, last_used_at = ?9, updated_at = ?10 WHERE id = ?11",
            params![
                action.name,
                action.description,
                action.group,
                action.payload_json,
                action.shortcut,
                tags_json,
                i32::from(action.enabled),
                action.usage_count,
                action.last_used_at,
                now,
                action.id,
            ],
        )?;
        Ok(())
    }

    /// Delete an action by ID.
    pub fn delete_action(&self, id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute("DELETE FROM actions WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Increment usage count and update last_used_at.
    pub fn record_action_usage(&self, id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE actions SET usage_count = usage_count + 1, last_used_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    /// Get all unique tag names across all actions.
    pub fn get_all_action_tags(&self) -> Result<Vec<String>> {
        let actions = self.get_all_actions()?;
        let mut tags = std::collections::BTreeSet::new();
        for a in &actions {
            for t in &a.tags {
                let trimmed = t.trim();
                if !trimmed.is_empty() {
                    tags.insert(trimmed.to_string());
                }
            }
        }
        Ok(tags.into_iter().collect())
    }

    // ── MCP Servers ───────────────────────────────────────────────────────

    /// Insert a new MCP server record.
    pub fn insert_mcp_server(&self, server: &crate::skill::types::McpServerRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let tags_json = serde_json::to_string(&server.tags).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO mcp_servers (id, name, description, command, args_json, env_json,
             transport, scope, project_id, tags_json, enabled, usage_count, last_used_at,
             created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                server.id,
                server.name,
                server.description,
                server.command,
                server.args_json,
                server.env_json,
                server.transport,
                server.scope,
                server.project_id,
                tags_json,
                i32::from(server.enabled),
                server.usage_count,
                server.last_used_at,
                server.created_at,
                server.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Get all MCP servers ordered by name.
    pub fn get_all_mcp_servers(&self) -> Result<Vec<crate::skill::types::McpServerRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, command, args_json, env_json, transport, scope,
             project_id, tags_json, enabled, usage_count, last_used_at, created_at, updated_at
             FROM mcp_servers ORDER BY name",
        )?;
        let rows = stmt.query_map([], map_mcp_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get an MCP server by its ID.
    pub fn get_mcp_server_by_id(
        &self,
        id: &str,
    ) -> Result<Option<crate::skill::types::McpServerRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, command, args_json, env_json, transport, scope,
             project_id, tags_json, enabled, usage_count, last_used_at, created_at, updated_at
             FROM mcp_servers WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], map_mcp_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Update all fields of an MCP server record.
    pub fn update_mcp_server(&self, server: &crate::skill::types::McpServerRecord) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        let tags_json = serde_json::to_string(&server.tags).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE mcp_servers SET name = ?1, description = ?2, command = ?3, args_json = ?4,
             env_json = ?5, transport = ?6, scope = ?7, project_id = ?8, tags_json = ?9,
             enabled = ?10, usage_count = ?11, last_used_at = ?12, updated_at = ?13 WHERE id = ?14",
            params![
                server.name,
                server.description,
                server.command,
                server.args_json,
                server.env_json,
                server.transport,
                server.scope,
                server.project_id,
                tags_json,
                i32::from(server.enabled),
                server.usage_count,
                server.last_used_at,
                now,
                server.id,
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

    /// Increment usage count and update last_used_at for an MCP server.
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

    // ── Agent Plugins (custom) ─────────────────────────────────────────────

    /// Insert a custom agent plugin into the `agent_plugins` table.
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
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO agent_plugins (id, name, icon, description, version, is_builtin, enabled,
             execution_json, configuration_json, capabilities_json, paths_json, lifecycle_json,
             created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
            params![
                id,
                name,
                icon,
                description,
                version,
                i32::from(is_builtin),
                execution_json,
                configuration_json,
                capabilities_json,
                paths_json,
                lifecycle_json,
                now,
            ],
        )?;
        Ok(())
    }

    /// Get all custom (non-built-in) agent plugins.
    pub fn get_custom_agent_plugins(&self) -> Result<Vec<serde_json::Value>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
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
                "id": id,
                "name": name,
                "icon": icon,
                "description": description,
                "version": version,
                "is_builtin": is_builtin,
                "enabled": enabled,
                "execution": serde_json::from_str::<serde_json::Value>(&execution_json).unwrap_or_default(),
                "configuration": serde_json::from_str::<serde_json::Value>(&configuration_json).unwrap_or_default(),
                "capabilities": serde_json::from_str::<serde_json::Value>(&capabilities_json).unwrap_or_default(),
                "paths": serde_json::from_str::<serde_json::Value>(&paths_json).unwrap_or_default(),
                "lifecycle": lifecycle_json.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
                "created_at": created_at,
                "updated_at": updated_at,
            }))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get a custom agent plugin by ID.
    pub fn get_custom_agent_plugin_by_id(&self, id: &str) -> Result<Option<serde_json::Value>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, icon, description, version, is_builtin, enabled,
             execution_json, configuration_json, capabilities_json, paths_json, lifecycle_json,
             created_at, updated_at
             FROM agent_plugins WHERE is_builtin = 0 AND id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
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
                "id": id,
                "name": name,
                "icon": icon,
                "description": description,
                "version": version,
                "is_builtin": is_builtin,
                "enabled": enabled,
                "execution": serde_json::from_str::<serde_json::Value>(&execution_json).unwrap_or_default(),
                "configuration": serde_json::from_str::<serde_json::Value>(&configuration_json).unwrap_or_default(),
                "capabilities": serde_json::from_str::<serde_json::Value>(&capabilities_json).unwrap_or_default(),
                "paths": serde_json::from_str::<serde_json::Value>(&paths_json).unwrap_or_default(),
                "lifecycle": lifecycle_json.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
                "created_at": created_at,
                "updated_at": updated_at,
            }))
        })?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    /// Delete a custom agent plugin by ID. Built-in plugins cannot be deleted.
    pub fn delete_custom_agent_plugin(&self, id: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))?;
        conn.execute(
            "DELETE FROM agent_plugins WHERE id = ?1 AND is_builtin = 0",
            params![id],
        )?;
        Ok(())
    }
}

// Row Mappers

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

fn map_mcp_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<crate::skill::types::McpServerRecord> {
    let tags_json: String = row.get(9)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(crate::skill::types::McpServerRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        command: row.get(3)?,
        args_json: row.get(4)?,
        env_json: row.get(5)?,
        transport: row.get(6)?,
        scope: row.get(7)?,
        project_id: row.get(8)?,
        tags,
        enabled: row.get::<_, i32>(10)? != 0,
        usage_count: row.get(11)?,
        last_used_at: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn map_action_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<super::types::ActionRecord> {
    let tags_json: String = row.get(6)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(super::types::ActionRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        group: row.get(3)?,
        payload_json: row.get(4)?,
        shortcut: row.get(5)?,
        tags,
        enabled: row.get::<_, i32>(7)? != 0,
        usage_count: row.get(8)?,
        last_used_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn map_prompt_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PromptRecord> {
    let tags_json: String = row.get(5)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let variables_json: String = row.get(8)?;
    let variables: Vec<PromptVariableRecord> =
        serde_json::from_str(&variables_json).unwrap_or_default();
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
        kind: row.get::<_, String>(9)?,
        favorite: row.get::<_, i32>(10)? != 0,
        usage_count: row.get(11)?,
        last_used_at: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_group(id: &str, name: &str) -> TagGroupRecord {
        TagGroupRecord {
            id: id.to_string(),
            name: name.to_string(),
            description: None,
            icon: None,
            sort_order: 0,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn get_all_project_tag_group_counts_groups_by_project() {
        let repo = SkillRepository::open_in_memory().unwrap();
        repo.insert_tag_group(&sample_group("tg-a", "Backend"))
            .unwrap();
        repo.insert_tag_group(&sample_group("tg-b", "Frontend"))
            .unwrap();
        repo.insert_tag_group(&sample_group("tg-c", "Review"))
            .unwrap();

        repo.set_project_tag_groups("proj-1", &["tg-a".into(), "tg-b".into()])
            .unwrap();
        repo.set_project_tag_groups("proj-2", &["tg-c".into()])
            .unwrap();

        let mut counts = repo.get_all_project_tag_group_counts().unwrap();
        counts.sort_by(|a, b| a.0.cmp(&b.0));

        assert_eq!(counts, vec![("proj-1".into(), 2), ("proj-2".into(), 1)]);
    }

    #[test]
    fn get_all_project_tag_group_counts_empty_when_no_bindings() {
        let repo = SkillRepository::open_in_memory().unwrap();
        repo.insert_tag_group(&sample_group("tg-a", "Backend"))
            .unwrap();
        let counts = repo.get_all_project_tag_group_counts().unwrap();
        assert!(counts.is_empty());
    }

    // ── MCP server tests ──────────────────────────────────────────────────

    fn sample_mcp(id: &str, name: &str) -> crate::skill::types::McpServerRecord {
        crate::skill::types::McpServerRecord {
            id: id.to_string(),
            name: name.to_string(),
            description: Some("test mcp".to_string()),
            command: "npx".to_string(),
            args_json: r#"["-y","fs-mcp"]"#.to_string(),
            env_json: "{}".to_string(),
            transport: "stdio".to_string(),
            scope: "global".to_string(),
            project_id: None,
            tags: vec!["fs".to_string()],
            enabled: true,
            usage_count: 0,
            last_used_at: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn mcp_server_round_trip() {
        let repo = SkillRepository::open_in_memory().unwrap();
        let server = sample_mcp("mcp-1", "fs-server");
        repo.insert_mcp_server(&server).unwrap();

        let loaded = repo.get_mcp_server_by_id("mcp-1").unwrap();
        assert!(loaded.is_some());
        let loaded = loaded.unwrap();
        assert_eq!(loaded.name, "fs-server");
        assert_eq!(loaded.command, "npx");
        assert_eq!(loaded.transport, "stdio");

        let all = repo.get_all_mcp_servers().unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn mcp_server_delete_then_not_found() {
        let repo = SkillRepository::open_in_memory().unwrap();
        repo.insert_mcp_server(&sample_mcp("mcp-1", "fs")).unwrap();
        repo.delete_mcp_server("mcp-1").unwrap();
        assert!(repo.get_mcp_server_by_id("mcp-1").unwrap().is_none());
    }

    #[test]
    fn mcp_server_usage_increment() {
        let repo = SkillRepository::open_in_memory().unwrap();
        repo.insert_mcp_server(&sample_mcp("mcp-1", "fs")).unwrap();
        repo.record_mcp_server_usage("mcp-1").unwrap();
        repo.record_mcp_server_usage("mcp-1").unwrap();
        let loaded = repo.get_mcp_server_by_id("mcp-1").unwrap().unwrap();
        assert_eq!(loaded.usage_count, 2);
        assert!(loaded.last_used_at.is_some());
    }

    // ── Prompts kind tests ────────────────────────────────────────────────

    fn sample_prompt(id: &str, kind: &str) -> crate::skill::types::PromptRecord {
        crate::skill::types::PromptRecord {
            id: id.to_string(),
            name: format!("prompt-{id}"),
            description: None,
            content: "body".to_string(),
            slash: Some("review".to_string()),
            tags: vec![],
            scope: "global".to_string(),
            project_id: None,
            variables: vec![],
            kind: kind.to_string(),
            favorite: false,
            usage_count: 0,
            last_used_at: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn get_prompts_by_kind_filters() {
        let repo = SkillRepository::open_in_memory().unwrap();
        repo.insert_prompt(&sample_prompt("p1", "prompt")).unwrap();
        repo.insert_prompt(&sample_prompt("p2", "command")).unwrap();
        repo.insert_prompt(&sample_prompt("p3", "command")).unwrap();

        let commands = repo.get_prompts_by_kind("command").unwrap();
        assert_eq!(commands.len(), 2);
        let prompts = repo.get_prompts_by_kind("prompt").unwrap();
        assert_eq!(prompts.len(), 1);
    }
}
