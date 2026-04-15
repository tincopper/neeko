use serde::{Deserialize, Serialize};

// -- Skill Record --

/// A managed skill record stored in the SQLite database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub source_type: String,
    pub source_ref: Option<String>,
    pub source_ref_resolved: Option<String>,
    pub source_subpath: Option<String>,
    pub source_branch: Option<String>,
    pub source_revision: Option<String>,
    pub remote_revision: Option<String>,
    pub central_path: String,
    pub content_hash: Option<String>,
    pub enabled: bool,
    pub status: String,
    pub update_status: String,
    pub last_checked_at: Option<i64>,
    pub last_check_error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

// -- Skill Target Record --

/// A record of a skill deployed to an agent tool directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillTargetRecord {
    pub id: String,
    pub skill_id: String,
    pub tool: String,
    pub target_path: String,
    pub mode: String,
    pub status: String,
    pub synced_at: Option<i64>,
    pub last_error: Option<String>,
}

// -- Tag Group --

/// A tag group (e.g. "designer", "backend-architect") - conceptually similar
/// to skills-manager's Scenario, but with project-level binding.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagGroupRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Per-skill per-tool toggle within a tag group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolToggleRecord {
    pub tag_group_id: String,
    pub skill_id: String,
    pub tool: String,
    pub enabled: bool,
    pub updated_at: i64,
}

// -- Skill Metadata --

/// Parsed metadata from a SKILL.md file (frontmatter).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMetadata {
    pub name: Option<String>,
    pub description: Option<String>,
}

// -- DTOs (Data Transfer Objects) --

/// Managed skill DTO sent to the frontend (includes tags).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedSkillDto {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub source_type: String,
    pub source_ref: Option<String>,
    pub central_path: String,
    pub enabled: bool,
    pub status: String,
    pub update_status: String,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Tag group DTO sent to the frontend (includes skill_count).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagGroupDto {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i32,
    pub skill_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Tool status DTO sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolStatusDto {
    pub key: String,
    pub display_name: String,
    pub installed: bool,
    pub has_override: bool,
    pub is_custom: bool,
}

/// Skill tool toggle DTO sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillToolToggleDto {
    pub tool: String,
    pub display_name: String,
    pub enabled: bool,
    pub installed: bool,
}

/// Document content of a SKILL.md file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDocumentDto {
    pub content: String,
}
