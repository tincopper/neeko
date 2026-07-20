//! High-level skill store wrapping the repository with CRUD, tags, cache, and settings.

use anyhow::Result;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use super::repository::SkillRepository;
#[allow(clippy::wildcard_imports)]
use super::types::*;

/// Thread-safe facade over [`SkillRepository`] for all skill data operations.
pub struct SkillStore {
    repo: Arc<SkillRepository>,
}

impl SkillStore {
    /// Open or create a skill store backed by a SQLite file at `db_path`.
    pub fn new(db_path: &PathBuf) -> Result<Self> {
        Ok(Self {
            repo: Arc::new(SkillRepository::open(db_path)?),
        })
    }

    /// Create an in-memory skill store (for testing).
    pub fn new_in_memory() -> Result<Self> {
        Ok(Self {
            repo: Arc::new(SkillRepository::open_in_memory()?),
        })
    }

    // Skills CRUD

    /// Insert a new skill record.
    pub fn insert_skill(&self, skill: &SkillRecord) -> Result<()> {
        self.repo.insert_skill(skill)
    }

    /// Get all skill records ordered by name.
    pub fn get_all_skills(&self) -> Result<Vec<SkillRecord>> {
        self.repo.get_all_skills()
    }

    /// Get a skill by its ID.
    pub fn get_skill_by_id(&self, id: &str) -> Result<Option<SkillRecord>> {
        self.repo.get_skill_by_id(id)
    }

    /// Get a skill by its central repository path.
    pub fn get_skill_by_central_path(&self, central_path: &str) -> Result<Option<SkillRecord>> {
        self.repo.get_skill_by_central_path(central_path)
    }

    /// Update a skill record.
    pub fn update_skill(&self, skill: &SkillRecord) -> Result<()> {
        self.repo.update_skill(skill)
    }

    /// Update a skill's metadata after re-installation.
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
        self.repo.update_skill_after_install(
            id,
            name,
            description,
            source_revision,
            remote_revision,
            content_hash,
            update_status,
        )
    }

    /// Update a skill's update-check state (revision, status, error).
    pub fn update_skill_check_state(
        &self,
        id: &str,
        remote_revision: Option<&str>,
        update_status: &str,
        last_check_error: Option<&str>,
    ) -> Result<()> {
        self.repo
            .update_skill_check_state(id, remote_revision, update_status, last_check_error)
    }

    /// Delete a skill and its associated targets and tags.
    pub fn delete_skill(&self, id: &str) -> Result<()> {
        self.repo.delete_skill(id)
    }

    // Targets

    /// Insert a skill target (deployment) record.
    pub fn insert_target(&self, target: &SkillTargetRecord) -> Result<()> {
        self.repo.insert_target(target)
    }

    /// Get all targets for a skill.
    pub fn get_targets_for_skill(&self, skill_id: &str) -> Result<Vec<SkillTargetRecord>> {
        self.repo.get_targets_for_skill(skill_id)
    }

    /// Get all target records across all skills.
    pub fn get_all_targets(&self) -> Result<Vec<SkillTargetRecord>> {
        self.repo.get_all_targets()
    }

    /// Delete a target record for a specific skill and tool.
    pub fn delete_target(&self, skill_id: &str, tool: &str) -> Result<()> {
        self.repo.delete_target(skill_id, tool)
    }

    // Skill Tags

    /// Get all unique tag names across all skills.
    pub fn get_all_tags(&self) -> Result<Vec<String>> {
        self.repo.get_all_tags()
    }

    /// Set tags for a skill (replaces existing).
    pub fn set_tags_for_skill(&self, skill_id: &str, tags: &[String]) -> Result<()> {
        self.repo.set_tags_for_skill(skill_id, tags)
    }

    /// Get a map of skill ID to its list of tags.
    pub fn get_tags_map(&self) -> Result<HashMap<String, Vec<String>>> {
        self.repo.get_tags_map()
    }

    // Tag Groups

    /// Insert a new tag group.
    pub fn insert_tag_group(&self, tg: &TagGroupRecord) -> Result<()> {
        self.repo.insert_tag_group(tg)
    }

    /// Get all tag groups ordered by sort_order.
    pub fn get_all_tag_groups(&self) -> Result<Vec<TagGroupRecord>> {
        self.repo.get_all_tag_groups()
    }

    /// Update a tag group's name, description, and icon.
    pub fn update_tag_group(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        icon: Option<&str>,
    ) -> Result<()> {
        self.repo.update_tag_group(id, name, description, icon)
    }

    /// Delete a tag group.
    pub fn delete_tag_group(&self, id: &str) -> Result<()> {
        self.repo.delete_tag_group(id)
    }

    /// Reorder tag groups by providing a sorted list of IDs.
    pub fn reorder_tag_groups(&self, ids: &[String]) -> Result<()> {
        self.repo.reorder_tag_groups(ids)
    }

    // TagGroup-Skill mapping

    /// Add a skill to a tag group.
    pub fn add_skill_to_tag_group(&self, tag_group_id: &str, skill_id: &str) -> Result<()> {
        self.repo.add_skill_to_tag_group(tag_group_id, skill_id)
    }

    /// Remove a skill from a tag group.
    pub fn remove_skill_from_tag_group(&self, tag_group_id: &str, skill_id: &str) -> Result<()> {
        self.repo
            .remove_skill_from_tag_group(tag_group_id, skill_id)
    }

    /// Get all skills belonging to a tag group.
    pub fn get_skills_for_tag_group(&self, tag_group_id: &str) -> Result<Vec<SkillRecord>> {
        self.repo.get_skills_for_tag_group(tag_group_id)
    }

    /// Count the number of skills in a tag group.
    pub fn count_skills_for_tag_group(&self, tag_group_id: &str) -> Result<i64> {
        self.repo.count_skills_for_tag_group(tag_group_id)
    }

    /// Reorder skills within a tag group.
    pub fn reorder_tag_group_skills(&self, tag_group_id: &str, skill_ids: &[String]) -> Result<()> {
        self.repo.reorder_tag_group_skills(tag_group_id, skill_ids)
    }

    /// Enable or disable a tool for a skill in a tag group.
    pub fn set_tag_group_skill_tool_enabled(
        &self,
        tag_group_id: &str,
        skill_id: &str,
        tool: &str,
        enabled: bool,
    ) -> Result<()> {
        self.repo
            .set_tag_group_skill_tool_enabled(tag_group_id, skill_id, tool, enabled)
    }

    /// Get all tool toggle records for a skill in a tag group.
    pub fn get_tag_group_skill_tool_toggles(
        &self,
        tag_group_id: &str,
        skill_id: &str,
    ) -> Result<Vec<ToolToggleRecord>> {
        self.repo
            .get_tag_group_skill_tool_toggles(tag_group_id, skill_id)
    }

    /// Get enabled tool keys for a skill in a tag group.
    pub fn get_enabled_tools_for_tag_group_skill(
        &self,
        tag_group_id: &str,
        skill_id: &str,
    ) -> Result<Vec<String>> {
        self.repo
            .get_enabled_tools_for_tag_group_skill(tag_group_id, skill_id)
    }

    /// Get tag group IDs for a skill.
    pub fn get_tag_groups_for_skill(&self, skill_id: &str) -> Result<Vec<String>> {
        self.repo.get_tag_groups_for_skill(skill_id)
    }

    // Project-TagGroup binding

    /// Set the tag groups bound to a project (replaces existing).
    pub fn set_project_tag_groups(&self, project_id: &str, tag_group_ids: &[String]) -> Result<()> {
        self.repo.set_project_tag_groups(project_id, tag_group_ids)
    }

    /// Get tag group IDs bound to a project.
    pub fn get_project_tag_groups(&self, project_id: &str) -> Result<Vec<String>> {
        self.repo.get_project_tag_groups(project_id)
    }

    /// Add a tag group binding to a project.
    pub fn add_project_tag_group(&self, project_id: &str, tag_group_id: &str) -> Result<()> {
        self.repo.add_project_tag_group(project_id, tag_group_id)
    }

    /// Remove a tag group binding from a project.
    pub fn remove_project_tag_group(&self, project_id: &str, tag_group_id: &str) -> Result<()> {
        self.repo.remove_project_tag_group(project_id, tag_group_id)
    }

    // Settings

    /// Get a setting value by key.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        self.repo.get_setting(key)
    }

    /// Set a setting value.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.repo.set_setting(key, value)
    }

    // Cache methods

    /// Get cached data by key if within TTL.
    pub fn get_cache(&self, key: &str, ttl_secs: i64) -> Result<Option<String>> {
        self.repo.get_cache(key, ttl_secs)
    }

    /// Cache data with a key.
    pub fn set_cache(&self, key: &str, data: &str) -> Result<()> {
        self.repo.set_cache(key, data)
    }

    /// Clear a specific cache entry.
    pub fn clear_cache(&self, key: &str) -> Result<()> {
        self.repo.clear_cache(key)
    }

    /// Clear all cache entries.
    pub fn clear_all_cache(&self) -> Result<()> {
        self.repo.clear_all_cache()
    }
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

    #[test]
    fn cache_round_trip() {
        let store = test_store();
        store.set_cache("test_key", "test_data").unwrap();
        let cached = store.get_cache("test_key", 300).unwrap();
        assert_eq!(cached.as_deref(), Some("test_data"));

        // Clear cache
        store.clear_cache("test_key").unwrap();
        let cleared = store.get_cache("test_key", 300).unwrap();
        assert!(cleared.is_none());
    }
}
