//! Data types and DTOs for skill management.

use serde::{Deserialize, Serialize};

// -- Skill Record --

/// A managed skill record stored in the SQLite database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRecord {
    /// Unique skill identifier.
    pub id: String,
    /// Display name of the skill.
    pub name: String,
    /// Optional description extracted from SKILL.md frontmatter.
    pub description: Option<String>,
    /// Source type: "local", "git", or "skillssh".
    pub source_type: String,
    /// Original source reference (path, URL, or GitHub shorthand).
    pub source_ref: Option<String>,
    /// Resolved absolute path after source processing.
    pub source_ref_resolved: Option<String>,
    /// Optional subpath within the source repository.
    pub source_subpath: Option<String>,
    /// Git branch name.
    pub source_branch: Option<String>,
    /// Git commit revision.
    pub source_revision: Option<String>,
    /// Latest remote revision from last update check.
    pub remote_revision: Option<String>,
    /// Absolute path to the skill directory in the central repo.
    pub central_path: String,
    /// SHA-256 content hash of the skill directory.
    pub content_hash: Option<String>,
    /// Whether the skill is enabled.
    pub enabled: bool,
    /// Current status ("ok", "error", etc.).
    pub status: String,
    /// Update status ("unknown", "up_to_date", "update_available").
    pub update_status: String,
    /// Timestamp of the last update check.
    pub last_checked_at: Option<i64>,
    /// Error message from the last check, if any.
    pub last_check_error: Option<String>,
    /// Creation timestamp in milliseconds.
    pub created_at: i64,
    /// Last update timestamp in milliseconds.
    pub updated_at: i64,
}

// -- Skill Target Record --

/// A record of a skill deployed to an agent tool directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillTargetRecord {
    /// Unique target record identifier.
    pub id: String,
    /// ID of the deployed skill.
    pub skill_id: String,
    /// Target tool key (e.g. "cursor", "claude_code").
    pub tool: String,
    /// Filesystem path of the deployed skill.
    pub target_path: String,
    /// Sync mode used ("copy" or "symlink").
    pub mode: String,
    /// Deployment status ("ok", "error").
    pub status: String,
    /// Timestamp of the last successful sync.
    pub synced_at: Option<i64>,
    /// Error message from the last sync attempt.
    pub last_error: Option<String>,
}

// -- Tag Group --

/// A tag group (e.g. "designer", "backend-architect") - conceptually similar
/// to skills-manager's Scenario, but with project-level binding.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagGroupRecord {
    /// Unique tag group identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional icon identifier.
    pub icon: Option<String>,
    /// Sort order for UI display.
    pub sort_order: i32,
    /// Creation timestamp in milliseconds.
    pub created_at: i64,
    /// Last update timestamp in milliseconds.
    pub updated_at: i64,
}

/// Per-skill per-tool toggle within a tag group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolToggleRecord {
    /// Parent tag group identifier.
    pub tag_group_id: String,
    /// Skill identifier.
    pub skill_id: String,
    /// Target tool key.
    pub tool: String,
    /// Whether the tool is enabled for this skill in this group.
    pub enabled: bool,
    /// Last update timestamp.
    pub updated_at: i64,
}

// -- Skill Metadata --

/// Parsed metadata from a SKILL.md file (frontmatter).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMetadata {
    /// Skill name from frontmatter.
    pub name: Option<String>,
    /// Skill description from frontmatter.
    pub description: Option<String>,
}

// -- DTOs (Data Transfer Objects) --

/// Managed skill DTO sent to the frontend (includes tags).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedSkillDto {
    /// Unique skill identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Source type.
    pub source_type: String,
    /// Original source reference.
    pub source_ref: Option<String>,
    /// Resolved source reference (e.g. full git URL after shorthand expansion).
    pub source_ref_resolved: Option<String>,
    /// Optional subpath within the source repository.
    pub source_subpath: Option<String>,
    /// Git branch name.
    pub source_branch: Option<String>,
    /// Current local git revision.
    pub source_revision: Option<String>,
    /// Latest remote revision from last update check.
    pub remote_revision: Option<String>,
    /// Absolute path in the central repository.
    pub central_path: String,
    /// Whether the skill is enabled.
    pub enabled: bool,
    /// Current status.
    pub status: String,
    /// Update status.
    pub update_status: String,
    /// Associated tag names.
    pub tags: Vec<String>,
    /// Timestamp of last update check.
    pub last_checked_at: Option<i64>,
    /// Creation timestamp.
    pub created_at: i64,
    /// Last update timestamp.
    pub updated_at: i64,
}

/// Tag group DTO sent to the frontend (includes skill_count).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagGroupDto {
    /// Unique tag group identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional icon identifier.
    pub icon: Option<String>,
    /// UI sort order.
    pub sort_order: i32,
    /// Number of skills in this group.
    pub skill_count: i64,
    /// Creation timestamp.
    pub created_at: i64,
    /// Last update timestamp.
    pub updated_at: i64,
}

/// Document content of a SKILL.md file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDocumentDto {
    /// Raw markdown content of the document.
    pub content: String,
}

/// Update status for a skill
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum UpdateStatus {
    /// Skill is up to date with its source.
    UpToDate,
    /// A newer version is available at the given remote revision.
    UpdateAvailable {
        /// Remote revision identifier.
        remote_revision: String,
    },
    /// Update checks are not supported for this source type.
    Unsupported,
    /// Update status could not be determined.
    Unknown,
}
