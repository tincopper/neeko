use anyhow::Result;
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use super::types::*;

pub struct SkillStore {
    conn: Mutex<Connection>,
}

impl SkillStore {
    pub fn new(db_path: &PathBuf) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        super::migrations::run_migrations(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn new_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        super::migrations::run_migrations(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    // Skills CRUD

    pub fn insert_skill(&self, skill: &SkillRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO skills (id, name, description, source_type, source_ref, source_ref_resolved, source_subpath, source_branch, source_revision, remote_revision, central_path, content_hash, enabled, status, update_status, last_checked_at, last_check_error, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![skill.id, skill.name, skill.description, skill.source_type, skill.source_ref, skill.source_ref_resolved, skill.source_subpath, skill.source_branch, skill.source_revision, skill.remote_revision, skill.central_path, skill.content_hash, skill.enabled, skill.status, skill.update_status, skill.last_checked_at, skill.last_check_error, skill.created_at, skill.updated_at],
        )?;
        Ok(())
    }

    pub fn get_all_skills(&self) -> Result<Vec<SkillRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, description, source_type, source_ref, source_ref_resolved, source_subpath, source_branch, source_revision, remote_revision, central_path, content_hash, enabled, status, update_status, last_checked_at, last_check_error, created_at, updated_at FROM skills ORDER BY name")?;
        let rows = stmt.query_map([], map_skill_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get_skill_by_id(&self, id: &str) -> Result<Option<SkillRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, description, source_type, source_ref, source_ref_resolved, source_subpath, source_branch, source_revision, remote_revision, central_path, content_hash, enabled, status, update_status, last_checked_at, last_check_error, created_at, updated_at FROM skills WHERE id = ?1")?;
        let mut rows = stmt.query_map(params![id], map_skill_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    pub fn get_skill_by_central_path(&self, central_path: &str) -> Result<Option<SkillRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, description, source_type, source_ref, source_ref_resolved, source_subpath, source_branch, source_revision, remote_revision, central_path, content_hash, enabled, status, update_status, last_checked_at, last_check_error, created_at, updated_at FROM skills WHERE central_path = ?1")?;
        let mut rows = stmt.query_map(params![central_path], map_skill_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    pub fn update_skill(&self, skill: &SkillRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE skills SET name = ?1, description = ?2, source_type = ?3, source_ref = ?4, source_ref_resolved = ?5, source_subpath = ?6, source_branch = ?7, source_revision = ?8, remote_revision = ?9, central_path = ?10, content_hash = ?11, enabled = ?12, status = ?13, update_status = ?14, last_checked_at = ?15, last_check_error = ?16, updated_at = ?17 WHERE id = ?18",
            params![skill.name, skill.description, skill.source_type, skill.source_ref, skill.source_ref_resolved, skill.source_subpath, skill.source_branch, skill.source_revision, skill.remote_revision, skill.central_path, skill.content_hash, skill.enabled, skill.status, skill.update_status, skill.last_checked_at, skill.last_check_error, now, skill.id],
        )?;
        Ok(())
    }

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
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute("UPDATE skills SET name = ?1, description = ?2, source_revision = ?3, remote_revision = ?4, content_hash = ?5, updated_at = ?6, update_status = ?7, last_checked_at = ?6, last_check_error = NULL WHERE id = ?8", params![name, description, source_revision, remote_revision, content_hash, now, update_status, id])?;
        Ok(())
    }

    pub fn update_skill_check_state(
        &self,
        id: &str,
        remote_revision: Option<&str>,
        update_status: &str,
        last_check_error: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute("UPDATE skills SET remote_revision = ?1, update_status = ?2, last_checked_at = ?3, last_check_error = ?4 WHERE id = ?5", params![remote_revision, update_status, now, last_check_error, id])?;
        Ok(())
    }

    pub fn delete_skill(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM skills WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Targets

    pub fn insert_target(&self, target: &SkillTargetRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("INSERT OR REPLACE INTO skill_targets (id, skill_id, tool, target_path, mode, status, synced_at, last_error) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)", params![target.id, target.skill_id, target.tool, target.target_path, target.mode, target.status, target.synced_at, target.last_error])?;
        Ok(())
    }

    pub fn get_targets_for_skill(&self, skill_id: &str) -> Result<Vec<SkillTargetRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, skill_id, tool, target_path, mode, status, synced_at, last_error FROM skill_targets WHERE skill_id = ?1")?;
        let rows = stmt.query_map(params![skill_id], map_target_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get_all_targets(&self) -> Result<Vec<SkillTargetRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, skill_id, tool, target_path, mode, status, synced_at, last_error FROM skill_targets")?;
        let rows = stmt.query_map([], map_target_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn delete_target(&self, skill_id: &str, tool: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM skill_targets WHERE skill_id = ?1 AND tool = ?2",
            params![skill_id, tool],
        )?;
        Ok(())
    }

    // Skill Tags

    pub fn get_all_tags(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT DISTINCT tag FROM skill_tags ORDER BY tag")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn set_tags_for_skill(&self, skill_id: &str, tags: &[String]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
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

    pub fn get_tags_map(&self) -> Result<HashMap<String, Vec<String>>> {
        let conn = self.conn.lock().unwrap();
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

    pub fn insert_tag_group(&self, tg: &TagGroupRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("INSERT INTO tag_groups (id, name, description, icon, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)", params![tg.id, tg.name, tg.description, tg.icon, tg.sort_order, tg.created_at, tg.updated_at])?;
        Ok(())
    }

    pub fn get_all_tag_groups(&self) -> Result<Vec<TagGroupRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, description, icon, sort_order, created_at, updated_at FROM tag_groups ORDER BY sort_order, created_at")?;
        let rows = stmt.query_map([], map_tag_group_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn update_tag_group(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        icon: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute("UPDATE tag_groups SET name = ?1, description = ?2, icon = ?3, updated_at = ?4 WHERE id = ?5", params![name, description, icon, now, id])?;
        Ok(())
    }

    pub fn delete_tag_group(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM tag_groups WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn reorder_tag_groups(&self, ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
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

    pub fn add_skill_to_tag_group(&self, tag_group_id: &str, skill_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute("INSERT OR IGNORE INTO tag_group_skills (tag_group_id, skill_id, added_at) VALUES (?1, ?2, ?3)", params![tag_group_id, skill_id, now])?;
        Ok(())
    }

    pub fn remove_skill_from_tag_group(&self, tag_group_id: &str, skill_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM tag_group_skills WHERE tag_group_id = ?1 AND skill_id = ?2",
            params![tag_group_id, skill_id],
        )?;
        Ok(())
    }

    pub fn get_skills_for_tag_group(&self, tag_group_id: &str) -> Result<Vec<SkillRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT s.id, s.name, s.description, s.source_type, s.source_ref, s.source_ref_resolved, s.source_subpath, s.source_branch, s.source_revision, s.remote_revision, s.central_path, s.content_hash, s.enabled, s.status, s.update_status, s.last_checked_at, s.last_check_error, s.created_at, s.updated_at FROM skills s INNER JOIN tag_group_skills tgs ON s.id = tgs.skill_id WHERE tgs.tag_group_id = ?1 ORDER BY tgs.sort_order, s.name")?;
        let rows = stmt.query_map(params![tag_group_id], map_skill_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn count_skills_for_tag_group(&self, tag_group_id: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tag_group_skills WHERE tag_group_id = ?1",
            params![tag_group_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    pub fn reorder_tag_group_skills(&self, tag_group_id: &str, skill_ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        for (i, skill_id) in skill_ids.iter().enumerate() {
            tx.execute("UPDATE tag_group_skills SET sort_order = ?1 WHERE tag_group_id = ?2 AND skill_id = ?3", params![i as i32, tag_group_id, skill_id])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn set_tag_group_skill_tool_enabled(
        &self,
        tag_group_id: &str,
        skill_id: &str,
        tool: &str,
        enabled: bool,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
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

    pub fn get_tag_group_skill_tool_toggles(
        &self,
        tag_group_id: &str,
        skill_id: &str,
    ) -> Result<Vec<ToolToggleRecord>> {
        let conn = self.conn.lock().unwrap();
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

    pub fn get_enabled_tools_for_tag_group_skill(
        &self,
        tag_group_id: &str,
        skill_id: &str,
    ) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT tool FROM tag_group_skill_tools
             WHERE tag_group_id = ?1 AND skill_id = ?2 AND enabled = 1",
        )?;
        let rows = stmt.query_map(params![tag_group_id, skill_id], |row| {
            row.get::<_, String>(0)
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_tag_groups_for_skill(&self, skill_id: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT tag_group_id FROM tag_group_skills WHERE skill_id = ?1")?;
        let rows = stmt.query_map(params![skill_id], |row| row.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // Project-TagGroup binding

    pub fn set_project_tag_groups(&self, project_id: &str, tag_group_ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
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

    pub fn get_project_tag_groups(&self, project_id: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT tag_group_id FROM project_tag_groups WHERE project_id = ?1 ORDER BY added_at",
        )?;
        let rows = stmt.query_map(params![project_id], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn add_project_tag_group(&self, project_id: &str, tag_group_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR IGNORE INTO project_tag_groups (project_id, tag_group_id, added_at) VALUES (?1, ?2, ?3)",
            params![project_id, tag_group_id, now],
        )?;
        Ok(())
    }

    pub fn remove_project_tag_group(&self, project_id: &str, tag_group_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM project_tag_groups WHERE project_id = ?1 AND tag_group_id = ?2",
            params![project_id, tag_group_id],
        )?;
        Ok(())
    }

    // Settings

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store() -> SkillStore {
        SkillStore::new_in_memory().unwrap()
    }

    fn sample_skill(name: &str) -> SkillRecord {
        let now = chrono::Utc::now().timestamp_millis();
        SkillRecord {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            description: Some("test skill".to_string()),
            source_type: "local".to_string(),
            source_ref: None,
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: format!("/tmp/skills/{name}"),
            content_hash: Some("abc123".to_string()),
            enabled: true,
            status: "ok".to_string(),
            update_status: "unknown".to_string(),
            last_checked_at: None,
            last_check_error: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn insert_and_get_all_skills() {
        let store = test_store();
        let s = sample_skill("test-skill");
        store.insert_skill(&s).unwrap();
        let all = store.get_all_skills().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "test-skill");
    }

    #[test]
    fn get_skill_by_id_found() {
        let store = test_store();
        let s = sample_skill("my-skill");
        let id = s.id.clone();
        store.insert_skill(&s).unwrap();
        let found = store.get_skill_by_id(&id).unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "my-skill");
    }

    #[test]
    fn get_skill_by_id_not_found() {
        let store = test_store();
        let result = store.get_skill_by_id("nonexistent").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn get_skill_by_central_path() {
        let store = test_store();
        let s = sample_skill("path-test");
        let path = s.central_path.clone();
        store.insert_skill(&s).unwrap();
        let found = store.get_skill_by_central_path(&path).unwrap();
        assert!(found.is_some());
    }

    #[test]
    fn delete_skill_cascades() {
        let store = test_store();
        let s = sample_skill("delete-me");
        let id = s.id.clone();
        store.insert_skill(&s).unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        store
            .insert_target(&SkillTargetRecord {
                id: uuid::Uuid::new_v4().to_string(),
                skill_id: id.clone(),
                tool: "cursor".to_string(),
                target_path: "/tmp/target".to_string(),
                mode: "copy".to_string(),
                status: "ok".to_string(),
                synced_at: Some(now),
                last_error: None,
            })
            .unwrap();
        store.set_tags_for_skill(&id, &["tag1".into()]).unwrap();
        store.delete_skill(&id).unwrap();
        assert!(store.get_skill_by_id(&id).unwrap().is_none());
        assert!(store.get_targets_for_skill(&id).unwrap().is_empty());
    }

    #[test]
    fn update_skill_after_install() {
        let store = test_store();
        let s = sample_skill("update-test");
        let id = s.id.clone();
        store.insert_skill(&s).unwrap();
        store
            .update_skill_after_install(
                &id,
                "new-name",
                Some("new-desc"),
                Some("abc"),
                Some("def"),
                Some("hash123"),
                "up_to_date",
            )
            .unwrap();
        let updated = store.get_skill_by_id(&id).unwrap().unwrap();
        assert_eq!(updated.name, "new-name");
        assert_eq!(updated.content_hash.as_deref(), Some("hash123"));
        assert_eq!(updated.update_status, "up_to_date");
    }

    #[test]
    fn targets_round_trip() {
        let store = test_store();
        let s = sample_skill("target-test");
        let skill_id = s.id.clone();
        store.insert_skill(&s).unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        store
            .insert_target(&SkillTargetRecord {
                id: uuid::Uuid::new_v4().to_string(),
                skill_id: skill_id.clone(),
                tool: "cursor".to_string(),
                target_path: "/tmp/cursor-skills/test".to_string(),
                mode: "copy".to_string(),
                status: "ok".to_string(),
                synced_at: Some(now),
                last_error: None,
            })
            .unwrap();
        let targets = store.get_targets_for_skill(&skill_id).unwrap();
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].tool, "cursor");
        assert_eq!(store.get_all_targets().unwrap().len(), 1);
    }

    #[test]
    fn skill_tags_round_trip() {
        let store = test_store();
        let s = sample_skill("tag-test");
        let id = s.id.clone();
        store.insert_skill(&s).unwrap();
        store
            .set_tags_for_skill(&id, &["react".into(), "ui".into()])
            .unwrap();
        let map = store.get_tags_map().unwrap();
        assert_eq!(map[&id].len(), 2);
        let all_tags = store.get_all_tags().unwrap();
        assert_eq!(all_tags.len(), 2);
    }

    #[test]
    fn tag_group_crud() {
        let store = test_store();
        let now = chrono::Utc::now().timestamp_millis();
        let tg = TagGroupRecord {
            id: "tg1".into(),
            name: "Designer".into(),
            description: None,
            icon: None,
            sort_order: 0,
            created_at: now,
            updated_at: now,
        };
        store.insert_tag_group(&tg).unwrap();
        assert_eq!(store.get_all_tag_groups().unwrap().len(), 1);
        store
            .update_tag_group("tg1", "Designer Updated", None, None)
            .unwrap();
        assert_eq!(
            store.get_all_tag_groups().unwrap()[0].name,
            "Designer Updated"
        );
        store.delete_tag_group("tg1").unwrap();
        assert!(store.get_all_tag_groups().unwrap().is_empty());
    }

    #[test]
    fn tag_group_skill_mapping() {
        let store = test_store();
        let now = chrono::Utc::now().timestamp_millis();
        let tg = TagGroupRecord {
            id: "tg1".into(),
            name: "Backend".into(),
            description: None,
            icon: None,
            sort_order: 0,
            created_at: now,
            updated_at: now,
        };
        store.insert_tag_group(&tg).unwrap();
        let s1 = sample_skill("s1");
        let s2 = sample_skill("s2");
        store.insert_skill(&s1).unwrap();
        store.insert_skill(&s2).unwrap();
        store.add_skill_to_tag_group("tg1", &s1.id).unwrap();
        store.add_skill_to_tag_group("tg1", &s2.id).unwrap();
        assert_eq!(store.count_skills_for_tag_group("tg1").unwrap(), 2);
        assert_eq!(store.get_skills_for_tag_group("tg1").unwrap().len(), 2);
        store.remove_skill_from_tag_group("tg1", &s1.id).unwrap();
        assert_eq!(store.count_skills_for_tag_group("tg1").unwrap(), 1);
    }

    #[test]
    fn settings_round_trip() {
        let store = test_store();
        store.set_setting("sync_mode", "copy").unwrap();
        assert_eq!(
            store.get_setting("sync_mode").unwrap().as_deref(),
            Some("copy")
        );
        store.set_setting("sync_mode", "symlink").unwrap();
        assert_eq!(
            store.get_setting("sync_mode").unwrap().as_deref(),
            Some("symlink")
        );
        assert!(store.get_setting("nonexistent").unwrap().is_none());
    }
}
