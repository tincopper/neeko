//! Tauri commands for skill CRUD, installation, tag groups, marketplace, and syncing.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;
use tauri::State;

use super::skill_store::SkillStore;
#[allow(clippy::wildcard_imports)]
use super::types::*;
use crate::common::runtime::{run_blocking, run_blocking_result};
use crate::AppError;

/// Managed skill DTO returned to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct ManagedSkillDtoOut {
    /// Unique skill identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Source type ("local", "git", "skillssh").
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
    /// Associated tags.
    pub tags: Vec<String>,
    /// Timestamp of last update check.
    pub last_checked_at: Option<i64>,
    /// Creation timestamp.
    pub created_at: i64,
    /// Last update timestamp.
    pub updated_at: i64,
}

/// A skill found in an agent's skills directory on disk.
#[derive(Debug, Clone, Serialize)]
pub struct AgentDiskSkillDto {
    /// Skill name derived from directory name.
    pub name: String,
    /// Optional description from SKILL.md frontmatter.
    pub description: Option<String>,
    /// Absolute path on disk.
    pub path: String,
    /// Whether this skill is managed in the central library.
    pub managed: bool,
    /// If managed, the library skill ID.
    pub skill_id: Option<String>,
}

/// Agent skill group DTO — skills found in an agent's skills directory.
#[derive(Debug, Clone, Serialize)]
pub struct AgentSkillGroupDto {
    /// Agent ID (matches `AgentConfig.id` / `SkillTargetRecord.tool`).
    pub agent_id: String,
    /// Human-readable agent name.
    pub agent_name: String,
    /// Optional icon identifier.
    pub agent_icon: Option<String>,
    /// Whether the agent is enabled.
    pub agent_enabled: bool,
    /// Absolute path to the agent's skills directory on disk, if any.
    pub agent_skill_path: Option<String>,
    /// Skills found in the agent's skills directory.
    pub skills: Vec<AgentDiskSkillDto>,
}

/// Tag group DTO returned to the frontend.
#[derive(Debug, Serialize)]
pub struct TagGroupDtoOut {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional icon identifier.
    pub icon: Option<String>,
    /// UI sort order.
    pub sort_order: i32,
    /// Number of skills in the group.
    pub skill_count: i64,
    /// Creation timestamp.
    pub created_at: i64,
    /// Last update timestamp.
    pub updated_at: i64,
}

/// Skill document content DTO returned to the frontend.
#[derive(Debug, Serialize)]
pub struct SkillDocumentDtoOut {
    /// Raw markdown content of the skill document.
    pub content: String,
}

/// Re-parse SKILL.md when DB description is empty; persist if found.
fn enrich_skill_description(store: &SkillStore, mut s: SkillRecord) -> SkillRecord {
    let needs_desc = s
        .description
        .as_ref()
        .map(|d| d.trim().is_empty())
        .unwrap_or(true);
    if !needs_desc {
        return s;
    }
    let path = PathBuf::from(&s.central_path);
    if !path.is_dir() {
        return s;
    }
    let meta = super::skill_metadata::parse_skill_md(&path);
    if let Some(desc) = meta.description {
        if !desc.trim().is_empty() {
            s.description = Some(desc);
            let _ = store.update_skill(&s);
        }
    }
    s
}

fn skill_to_dto(s: SkillRecord, tags: Vec<String>) -> ManagedSkillDtoOut {
    ManagedSkillDtoOut {
        tags,
        id: s.id,
        name: s.name,
        description: s.description,
        source_type: s.source_type,
        source_ref: s.source_ref,
        source_ref_resolved: s.source_ref_resolved,
        source_subpath: s.source_subpath,
        source_branch: s.source_branch,
        source_revision: s.source_revision,
        remote_revision: s.remote_revision,
        central_path: s.central_path,
        enabled: s.enabled,
        status: s.status,
        update_status: s.update_status,
        last_checked_at: s.last_checked_at,
        created_at: s.created_at,
        updated_at: s.updated_at,
    }
}

/// Get all managed skills with their associated tags.
///
/// If a skill row has no description, re-parse SKILL.md from `central_path`
/// and backfill the DB so the library card can show text.
#[tauri::command]
pub async fn get_managed_skills(
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<ManagedSkillDtoOut>, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let skills = store.get_all_skills().map_err(AppError::from)?;
        let tags_map = store.get_tags_map().map_err(AppError::from)?;
        Ok(skills
            .into_iter()
            .map(|s| {
                let s = enrich_skill_description(&store, s);
                let tags = tags_map.get(&s.id).cloned().unwrap_or_default();
                skill_to_dto(s, tags)
            })
            .collect())
    })
    .await
}

/// Get the documentation content (SKILL.md) for a skill.
#[tauri::command]
pub async fn get_skill_document(
    skill_id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<SkillDocumentDtoOut, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let skill = store
            .get_skill_by_id(&skill_id)
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::NotFound("Skill not found".to_string()))?;
        let central = PathBuf::from(&skill.central_path);
        let candidates = [
            "SKILL.md",
            "skill.md",
            "CLAUDE.md",
            "README.md",
            "readme.md",
        ];
        for name in &candidates {
            let path = central.join(name);
            if path.exists() {
                let content = std::fs::read_to_string(&path).map_err(AppError::from)?;
                return Ok(SkillDocumentDtoOut { content });
            }
        }
        Err(AppError::NotFound(
            "No documentation file found".to_string(),
        ))
    }).await
}

/// Re-parse every managed skill's SKILL.md and write descriptions back to DB.
///
/// Returns how many skills received a non-empty description update.
#[tauri::command]
pub async fn refresh_skill_metadata(
    store: State<'_, Arc<SkillStore>>,
) -> Result<u32, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let skills = store.get_all_skills().map_err(AppError::from)?;
        let mut updated = 0u32;
        for mut s in skills {
            let path = PathBuf::from(&s.central_path);
            if !path.is_dir() {
                continue;
            }
            let meta = super::skill_metadata::parse_skill_md(&path);
            let mut dirty = false;
            if let Some(desc) = meta.description {
                if !desc.trim().is_empty() && s.description.as_deref() != Some(desc.as_str()) {
                    s.description = Some(desc);
                    dirty = true;
                }
            }
            if let Some(name) = meta.name {
                if let Some(sanitized) = super::skill_metadata::sanitize_skill_name(&name) {
                    if !sanitized.is_empty() && s.name != sanitized {
                        // keep directory name as id path; only update display name if empty-ish
                        if s.name.trim().is_empty() {
                            s.name = sanitized;
                            dirty = true;
                        }
                    }
                }
            }
            if dirty {
                store.update_skill(&s).map_err(AppError::from)?;
                updated += 1;
            }
        }
        Ok(updated)
    })
    .await
}

/// Delete all managed skills and wipe the central skills directory (keeps tag groups).
#[tauri::command]
pub async fn clear_all_managed_skills(
    store: State<'_, Arc<SkillStore>>,
) -> Result<u32, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let skills = store.get_all_skills().map_err(AppError::from)?;
        let n = skills.len() as u32;
        for s in &skills {
            let path = PathBuf::from(&s.central_path);
            if path.is_dir() && path.starts_with(super::central_repo::skills_dir()) {
                let _ = std::fs::remove_dir_all(&path);
            }
            store.delete_skill(&s.id).map_err(AppError::from)?;
        }
        // Ensure central dir exists after wipe
        let _ = super::central_repo::ensure_central_repo();
        Ok(n)
    })
    .await
}

/// Delete a managed skill and its central directory.
#[tauri::command]
pub async fn delete_managed_skill(
    skill_id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let skill = store
            .get_skill_by_id(&skill_id)
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::NotFound("Skill not found".to_string()))?;
        let central = PathBuf::from(&skill.central_path);
        if central.exists() {
            std::fs::remove_dir_all(&central).ok();
        }
        store.delete_skill(&skill_id).map_err(AppError::from)
    }).await
}

/// Get all tag groups with skill counts.
#[tauri::command]
pub async fn get_tag_groups(
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<TagGroupDtoOut>, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let groups = store.get_all_tag_groups().map_err(AppError::from)?;
        Ok(groups
            .into_iter()
            .map(|g| {
                let count = store.count_skills_for_tag_group(&g.id).unwrap_or(0);
                TagGroupDtoOut {
                    id: g.id,
                    name: g.name,
                    description: g.description,
                    icon: g.icon,
                    sort_order: g.sort_order,
                    skill_count: count,
                    created_at: g.created_at,
                    updated_at: g.updated_at,
                }
            })
            .collect())
    }).await
}

/// Create a new tag group.
#[tauri::command]
pub async fn create_tag_group(
    name: String,
    description: Option<String>,
    icon: Option<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<TagGroupDtoOut, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let now = chrono::Utc::now().timestamp_millis();
        let id = uuid::Uuid::new_v4().to_string();
        let tg = TagGroupRecord {
            id: id.clone(),
            name: name.clone(),
            description: description.clone(),
            icon: icon.clone(),
            sort_order: 999,
            created_at: now,
            updated_at: now,
        };
        store.insert_tag_group(&tg).map_err(AppError::from)?;
        Ok(TagGroupDtoOut {
            id,
            name,
            description,
            icon,
            sort_order: 999,
            skill_count: 0,
            created_at: now,
            updated_at: now,
        })
    }).await
}

/// Delete a tag group by ID.
#[tauri::command]
pub async fn delete_tag_group_cmd(
    id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store.delete_tag_group(&id).map_err(AppError::from)
    }).await
}

/// Install a skill from a local filesystem path.
#[tauri::command]
pub async fn install_local_skill(
    source_path: String,
    name: Option<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<ManagedSkillDtoOut, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let path = std::path::PathBuf::from(&source_path);
        let result =
            super::installer::install_from_local(&path, name.as_deref()).map_err(AppError::from)?;
        let now = chrono::Utc::now().timestamp_millis();
        let id = uuid::Uuid::new_v4().to_string();
        let skill = super::types::SkillRecord {
            id: id.clone(),
            name: result.name.clone(),
            description: result.description.clone(),
            source_type: "local".to_string(),
            source_ref: Some(source_path),
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: result.central_path.to_string_lossy().to_string(),
            content_hash: Some(result.content_hash),
            enabled: true,
            status: "ok".to_string(),
            update_status: "unknown".to_string(),
            last_checked_at: None,
            last_check_error: None,
            created_at: now,
            updated_at: now,
        };
        store.insert_skill(&skill).map_err(AppError::from)?;
        Ok(ManagedSkillDtoOut {
            id,
            name: result.name,
            description: result.description,
            source_type: "local".to_string(),
            source_ref: None,
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: result.central_path.to_string_lossy().to_string(),
            enabled: true,
            status: "ok".to_string(),
            update_status: "unknown".to_string(),
            last_checked_at: None,
            tags: vec![],
            created_at: now,
            updated_at: now,
        })
    }).await
}

/// A discovered unmanaged skill from tool directory scanning.
#[derive(Debug, serde::Serialize)]
pub struct DiscoveredSkillDto {
    /// Unique identifier for the discovered skill.
    pub id: String,
    /// Source tool key.
    pub tool: String,
    /// Absolute path where the skill was found.
    pub found_path: String,
    /// Inferred name from the directory.
    pub name_guess: Option<String>,
}

/// Scan all tool directories for unmanaged skills.
#[tauri::command]
pub async fn scan_local_skills(
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
    state: tauri::State<'_, crate::AppStateWrapper>,
) -> Result<Vec<DiscoveredSkillDto>, AppError> {
    let store = store.inner().clone();
    let (custom_tool_paths_str, custom_tools_str) = {
        let config = state
            .storage_manager
            .load_config()
            .map_err(|e| AppError::Storage(format!("Failed to load config: {e}")))?;
        let paths = config
            .get("customToolPathOverrides")
            .map(|v| v.to_string())
            .unwrap_or_default();
        let tools = config
            .get("customToolAdapters")
            .map(|v| v.to_string())
            .unwrap_or_default();
        (paths, tools)
    };
    run_blocking_result(move || {
        let skills = store.get_all_skills().map_err(AppError::from)?;
        let managed_paths: Vec<String> = skills.iter().map(|s| s.central_path.clone()).collect();
        let adapters =
            super::tool_adapters::all_tool_adapters(&custom_tool_paths_str, &custom_tools_str);
        let discovered =
            super::scanner::scan_local_skills(&managed_paths, &adapters).map_err(AppError::from)?;
        Ok(discovered
            .into_iter()
            .map(|d| DiscoveredSkillDto {
                id: d.id,
                tool: d.tool,
                found_path: d.found_path,
                name_guess: d.name_guess,
            })
            .collect())
    })
    .await
}

/// Import a discovered skill into the central repository.
#[tauri::command]
pub async fn import_discovered_skill(
    discovered_path: String,
    name: Option<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<ManagedSkillDtoOut, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let src = std::path::PathBuf::from(&discovered_path);
        let result =
            super::installer::install_from_local(&src, name.as_deref()).map_err(AppError::from)?;
        let now = chrono::Utc::now().timestamp_millis();
        let id = uuid::Uuid::new_v4().to_string();
        let skill = super::types::SkillRecord {
            id: id.clone(),
            name: result.name.clone(),
            description: result.description.clone(),
            source_type: "local".to_string(),
            source_ref: Some(discovered_path.clone()),
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: result.central_path.to_string_lossy().to_string(),
            content_hash: Some(result.content_hash),
            enabled: true,
            status: "ok".to_string(),
            update_status: "unknown".to_string(),
            last_checked_at: None,
            last_check_error: None,
            created_at: now,
            updated_at: now,
        };
        store.insert_skill(&skill).map_err(AppError::from)?;
        Ok(ManagedSkillDtoOut {
            id,
            name: skill.name.clone(),
            description: skill.description.clone(),
            source_type: "local".to_string(),
            source_ref: Some(discovered_path.clone()),
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: skill.central_path.clone(),
            enabled: true,
            status: "ok".to_string(),
            update_status: "unknown".to_string(),
            last_checked_at: None,
            tags: vec![],
            created_at: now,
            updated_at: now,
        })
    }).await
}

/// Git installation preview: cloned repo info and available skill directories.
#[derive(Debug, serde::Serialize)]
pub struct GitSkillPreviewDto {
    /// Preview identifier.
    pub id: String,
    /// Cloned git URL.
    pub clone_url: String,
    /// Branch used for cloning.
    pub branch: Option<String>,
    /// Skill directories found in the repository.
    pub available_skills: Vec<super::installer::GitSkillInfo>,
}

/// Normalize user input to a cloneable git URL (`owner/repo` → GitHub HTTPS).
fn normalize_git_clone_url(input: &str) -> String {
    let t = input.trim();
    if t.starts_with("http://")
        || t.starts_with("https://")
        || t.starts_with("git@")
        || t.starts_with("ssh://")
    {
        return t.to_string();
    }
    // GitHub shorthand: owner/repo or owner/repo.git
    let bare = t.trim_end_matches(".git");
    if bare.chars().filter(|c| *c == '/').count() == 1
        && !bare.contains(' ')
        && !bare.contains(':')
    {
        return format!("https://github.com/{}.git", bare);
    }
    t.to_string()
}

/// Preview a git repository to see what skills are available for installation.
#[tauri::command]
pub async fn preview_git_install(
    clone_url: String,
    branch: Option<String>,
    subpath: Option<String>,
) -> Result<GitSkillPreviewDto, AppError> {
    let normalized = normalize_git_clone_url(&clone_url);
    let preview_id =
        super::installer::preview_git_install(&normalized, branch.as_deref(), subpath.as_deref())
            .map_err(AppError::from)?;
    let preview = super::installer::get_preview(&preview_id)
        .ok_or_else(|| AppError::NotFound("Preview not found".to_string()))?;
    Ok(GitSkillPreviewDto {
        id: preview.id,
        clone_url: preview.clone_url,
        branch: preview.branch,
        available_skills: preview.available_skills,
    })
}

/// Input for confirming a git-based skill installation.
#[derive(Debug, serde::Deserialize)]
pub struct ConfirmGitInstallInput {
    /// Preview ID from preview_git_install.
    pub preview_id: String,
    /// Selected skill path within the cloned repo.
    pub selected_path: String,
    /// Optional custom name for the skill.
    pub name: Option<String>,
}

/// Confirm and complete a git-based skill installation (preview stays open for multi-install).
#[tauri::command]
pub async fn confirm_git_install(
    input: ConfirmGitInstallInput,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<ManagedSkillDtoOut, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let confirmed = super::installer::confirm_git_install(
            &input.preview_id,
            &input.selected_path,
            input.name.as_deref(),
        )
        .map_err(AppError::from)?;
        let result = confirmed.install;
        let now = chrono::Utc::now().timestamp_millis();
        let id = uuid::Uuid::new_v4().to_string();
        let skill = super::types::SkillRecord {
            id: id.clone(),
            name: result.name.clone(),
            description: result.description.clone(),
            source_type: "git".to_string(),
            source_ref: Some(confirmed.clone_url.clone()),
            source_ref_resolved: Some(confirmed.clone_url.clone()),
            source_subpath: confirmed.source_subpath.clone(),
            source_branch: confirmed.branch.clone(),
            source_revision: confirmed.source_revision.clone(),
            remote_revision: confirmed.source_revision.clone(),
            central_path: result.central_path.to_string_lossy().to_string(),
            content_hash: Some(result.content_hash),
            enabled: true,
            status: "ok".to_string(),
            update_status: "unknown".to_string(),
            last_checked_at: None,
            last_check_error: None,
            created_at: now,
            updated_at: now,
        };
        store.insert_skill(&skill).map_err(AppError::from)?;
        Ok(ManagedSkillDtoOut {
            id,
            name: result.name,
            description: result.description,
            source_type: "git".to_string(),
            source_ref: Some(confirmed.clone_url.clone()),
            source_ref_resolved: Some(confirmed.clone_url.clone()),
            source_subpath: confirmed.source_subpath.clone(),
            source_branch: confirmed.branch.clone(),
            source_revision: None,
            remote_revision: None,
            central_path: result.central_path.to_string_lossy().to_string(),
            enabled: true,
            status: "ok".to_string(),
            update_status: "unknown".to_string(),
            last_checked_at: None,
            tags: vec![],
            created_at: now,
            updated_at: now,
        })
    })
    .await
}

/// Cancel a git installation preview and clean up the cloned repository.
#[tauri::command]
pub async fn cancel_git_preview(preview_id: String) -> Result<(), AppError> {
    super::installer::cancel_git_preview(&preview_id).map_err(AppError::from)
}

/// Result of a skill update check.
#[derive(Debug, serde::Serialize)]
pub struct CheckUpdateResult {
    /// Update status string.
    pub status: String,
    /// Remote revision if an update is available.
    pub remote_revision: Option<String>,
}

/// Check if a skill has updates available from its source.
#[tauri::command]
pub async fn check_skill_update(
    skill_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<CheckUpdateResult, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let skill = store
            .get_skill_by_id(&skill_id)
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::NotFound("Skill not found".to_string()))?;
        let status = super::installer::check_skill_update(&skill).map_err(AppError::from)?;
        match &status {
            super::types::UpdateStatus::UpToDate => Ok(CheckUpdateResult {
                status: "up_to_date".to_string(),
                remote_revision: None,
            }),
            super::types::UpdateStatus::UpdateAvailable { remote_revision } => {
                Ok(CheckUpdateResult {
                    status: "update_available".to_string(),
                    remote_revision: Some(remote_revision.clone()),
                })
            }
            super::types::UpdateStatus::Unsupported => Ok(CheckUpdateResult {
                status: "unsupported".to_string(),
                remote_revision: None,
            }),
            super::types::UpdateStatus::Unknown => Ok(CheckUpdateResult {
                status: "unknown".to_string(),
                remote_revision: None,
            }),
        }
    }).await
}

/// Update a skill by re-installing from its source.
#[tauri::command]
pub async fn update_skill(
    skill_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<ManagedSkillDtoOut, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let skill = store
            .get_skill_by_id(&skill_id)
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::NotFound("Skill not found".to_string()))?;
        let updated = super::installer::update_skill(&skill).map_err(AppError::from)?;
        store.update_skill(&updated).map_err(AppError::from)?;
        Ok(ManagedSkillDtoOut {
            id: updated.id,
            name: updated.name,
            description: updated.description,
            source_type: updated.source_type,
            source_ref: updated.source_ref,
            source_ref_resolved: updated.source_ref_resolved,
            source_subpath: updated.source_subpath,
            source_branch: updated.source_branch,
            source_revision: updated.source_revision,
            remote_revision: updated.remote_revision,
            central_path: updated.central_path,
            enabled: updated.enabled,
            status: updated.status,
            update_status: updated.update_status,
            last_checked_at: updated.last_checked_at,
            tags: vec![],
            created_at: updated.created_at,
            updated_at: updated.updated_at,
        })
    }).await
}

/// Update a tag group's name, description, and icon.
#[tauri::command]
pub async fn update_tag_group_cmd(
    id: String,
    name: String,
    description: Option<String>,
    icon: Option<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .update_tag_group(&id, &name, description.as_deref(), icon.as_deref())
            .map_err(AppError::from)
    }).await
}

/// Reorder tag groups by providing a sorted list of IDs.
#[tauri::command]
pub async fn reorder_tag_groups_cmd(
    ids: Vec<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store.reorder_tag_groups(&ids).map_err(AppError::from)
    }).await
}

/// Add a skill to a tag group.
#[tauri::command]
pub async fn add_skill_to_tag_group_cmd(
    tag_group_id: String,
    skill_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .add_skill_to_tag_group(&tag_group_id, &skill_id)
            .map_err(AppError::from)
    }).await
}

/// Remove a skill from a tag group.
#[tauri::command]
pub async fn remove_skill_from_tag_group_cmd(
    tag_group_id: String,
    skill_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .remove_skill_from_tag_group(&tag_group_id, &skill_id)
            .map_err(AppError::from)
    }).await
}

/// Get all skills belonging to a tag group.
#[tauri::command]
pub async fn get_skills_for_tag_group_cmd(
    tag_group_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<Vec<ManagedSkillDtoOut>, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let skills = store
            .get_skills_for_tag_group(&tag_group_id)
            .map_err(AppError::from)?;
        let tags_map = store.get_tags_map().map_err(AppError::from)?;
        Ok(skills
            .into_iter()
            .map(|s| {
                let s = enrich_skill_description(&store, s);
                let tags = tags_map.get(&s.id).cloned().unwrap_or_default();
                skill_to_dto(s, tags)
            })
            .collect())
    }).await
}

/// Get all unique tag names across all skills.
#[tauri::command]
pub async fn get_all_tags_cmd(
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<Vec<String>, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || store.get_all_tags().map_err(AppError::from)).await
}

/// Set tags for a specific skill.
#[tauri::command]
pub async fn set_skill_tags_cmd(
    skill_id: String,
    tags: Vec<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .set_tags_for_skill(&skill_id, &tags)
            .map_err(AppError::from)
    }).await
}

/// Enable or disable a tool for a skill within a tag group.
#[tauri::command]
pub async fn set_skill_tool_toggle_cmd(
    tag_group_id: String,
    skill_id: String,
    tool: String,
    enabled: bool,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .set_tag_group_skill_tool_enabled(&tag_group_id, &skill_id, &tool, enabled)
            .map_err(AppError::from)
    }).await
}

/// Collect skill deploy targets from AgentManager (preferred) with adapter fallback.
fn resolve_sync_targets(state: &crate::AppStateWrapper) -> Vec<super::tool_adapters::SkillTargetDir> {
    let agent_triples: Vec<(String, bool, Option<String>)> = state
        .agent_manager
        .lock()
        .map(|am| {
            am.get_agents()
                .iter()
                .map(|a| (a.id.clone(), a.enabled, a.skill_path.clone()))
                .collect()
        })
        .unwrap_or_default();

    let mut targets = super::tool_adapters::skill_targets_from_agents(&agent_triples);
    if targets.is_empty() {
        // Fallback when agents not yet loaded: Neeko agent adapters only
        const FALLBACK_KEYS: &[&str] = &[
            "opencode",
            "claude-code",
            "gemini",
            "codex",
            "qoder",
            "codebuddy",
            "pi",
            "omp",
            "reasonix",
        ];
        targets = super::tool_adapters::default_tool_adapters()
            .into_iter()
            .filter(|a| FALLBACK_KEYS.contains(&a.key.as_str()))
            .map(|a| {
                let dir = a.skills_dir();
                super::tool_adapters::SkillTargetDir { key: a.key, dir }
            })
            .collect();
    }
    targets
}

/// Deploy a list of skills to all resolved agent skill directories (install-only, no remove).
fn sync_skills_to_targets(
    store: &SkillStore,
    skills: &[SkillRecord],
    targets: &[super::tool_adapters::SkillTargetDir],
    configured_mode: Option<&str>,
) {
    for skill in skills {
        if !skill.enabled {
            continue;
        }
        let source = PathBuf::from(&skill.central_path);
        if !source.exists() {
            log::warn!(
                "Skill central path missing, skip sync: {} ({})",
                skill.name,
                skill.central_path
            );
            continue;
        }
        for target in targets {
            let dest = target.dir.join(&skill.name);
            let mode =
                super::sync_engine::sync_mode_for_tool(&target.key, configured_mode);
            match super::sync_engine::sync_skill(&source, &dest, mode) {
                Ok(actual_mode) => {
                    let now = chrono::Utc::now().timestamp_millis();
                    let rec = SkillTargetRecord {
                        id: uuid::Uuid::new_v4().to_string(),
                        skill_id: skill.id.clone(),
                        tool: target.key.clone(),
                        target_path: dest.to_string_lossy().to_string(),
                        mode: actual_mode.as_str().to_string(),
                        status: "ok".to_string(),
                        synced_at: Some(now),
                        last_error: None,
                    };
                    let _ = store.delete_target(&skill.id, &target.key);
                    let _ = store.insert_target(&rec);
                }
                Err(e) => {
                    log::warn!(
                        "Failed to sync skill {} to {}: {e}",
                        skill.id,
                        dest.display()
                    );
                }
            }
        }
    }
}

/// Deploy all skills in a tag group to agent skill directories.
///
/// Sync strategy: **install only** (symlink/copy). Does not remove other skills.
/// Targets come from enabled agents' `skill_path` (aligned with AgentManager).
#[tauri::command]
pub async fn sync_tag_group_cmd(
    tag_group_id: String,
    state: State<'_, crate::AppStateWrapper>,
) -> Result<(), AppError> {
    let store = state.skill_store.clone();
    let targets = resolve_sync_targets(state.inner());
    run_blocking_result(move || {
        let skills = store
            .get_skills_for_tag_group(&tag_group_id)
            .map_err(AppError::from)?;
        let configured_mode = store.get_setting("sync_mode").map_err(AppError::from)?;
        sync_skills_to_targets(&store, &skills, &targets, configured_mode.as_deref());
        Ok(())
    })
    .await
}

/// Apply all tag groups bound to a project: incremental sync (install only, no unsync).
///
/// When the user selects a project, call this to ensure bound skills are present in
/// agent skill directories. Skills not in the binding are left untouched.
#[tauri::command]
pub async fn apply_project_skills_cmd(
    project_id: String,
    state: State<'_, crate::AppStateWrapper>,
) -> Result<(), AppError> {
    let store = state.skill_store.clone();
    let targets = resolve_sync_targets(state.inner());
    run_blocking_result(move || {
        let tg_ids = store
            .get_project_tag_groups(&project_id)
            .map_err(AppError::from)?;
        if tg_ids.is_empty() {
            return Ok(());
        }
        let configured_mode = store.get_setting("sync_mode").map_err(AppError::from)?;
        // Deduplicate skills across multiple tag groups
        let mut seen = std::collections::HashSet::new();
        let mut skills = Vec::new();
        for tg_id in &tg_ids {
            for skill in store
                .get_skills_for_tag_group(tg_id)
                .map_err(AppError::from)?
            {
                if seen.insert(skill.id.clone()) {
                    skills.push(skill);
                }
            }
        }
        sync_skills_to_targets(&store, &skills, &targets, configured_mode.as_deref());
        Ok(())
    })
    .await
}

/// Remove all deployed skill targets for a tag group.
#[tauri::command]
pub async fn unsync_tag_group_cmd(
    tag_group_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let skill_ids = store
            .get_skills_for_tag_group(&tag_group_id)
            .map_err(AppError::from)?;
        for skill in &skill_ids {
            let targets = store.get_targets_for_skill(&skill.id).unwrap_or_default();
            for target in &targets {
                let path = std::path::PathBuf::from(&target.target_path);
                let _ = super::sync_engine::remove_target(&path);
                let _ = store.delete_target(&skill.id, &target.tool);
            }
        }
        Ok(())
    }).await
}

/// Get tag groups bound to a specific project.
#[tauri::command]
pub async fn get_project_tag_groups_cmd(
    project_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<Vec<TagGroupDtoOut>, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let tg_ids = store
            .get_project_tag_groups(&project_id)
            .map_err(AppError::from)?;
        let all_groups = store.get_all_tag_groups().map_err(AppError::from)?;
        Ok(all_groups
            .into_iter()
            .filter(|g| tg_ids.contains(&g.id))
            .map(|g| {
                let count = store.count_skills_for_tag_group(&g.id).unwrap_or(0);
                TagGroupDtoOut {
                    id: g.id,
                    name: g.name,
                    description: g.description,
                    icon: g.icon,
                    sort_order: g.sort_order,
                    skill_count: count,
                    created_at: g.created_at,
                    updated_at: g.updated_at,
                }
            })
            .collect())
    }).await
}

/// Set which tag groups are bound to a project.
#[tauri::command]
pub async fn set_project_tag_groups_cmd(
    project_id: String,
    tag_group_ids: Vec<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .set_project_tag_groups(&project_id, &tag_group_ids)
            .map_err(AppError::from)
    }).await
}

/// Bind a tag group to a project.
#[tauri::command]
pub async fn add_project_tag_group_cmd(
    project_id: String,
    tag_group_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .add_project_tag_group(&project_id, &tag_group_id)
            .map_err(AppError::from)
    }).await
}

/// Remove a tag group binding from a project.
#[tauri::command]
pub async fn remove_project_tag_group_cmd(
    project_id: String,
    tag_group_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .remove_project_tag_group(&project_id, &tag_group_id)
            .map_err(AppError::from)
    }).await
}

/// Get skills found in each agent's skills directory, grouped by agent.
///
/// Scans each enabled agent's `skill_path` on disk for skill directories.
/// Skills that are symlinks to the central repository are marked as managed.
#[tauri::command]
pub async fn get_agent_skills_cmd(
    state: State<'_, crate::AppStateWrapper>,
) -> Result<Vec<AgentSkillGroupDto>, AppError> {
    let agent_info: Vec<(String, String, Option<String>, bool, Option<String>)> = state
        .agent_manager
        .lock()
        .map_err(AppError::from)?
        .get_agents()
        .iter()
        .map(|a| {
            (
                a.id.clone(),
                a.name.clone(),
                a.icon.clone(),
                a.enabled,
                a.skill_path.clone(),
            )
        })
        .collect();

    let store = state.skill_store.clone();
    let central = super::central_repo::skills_dir();

    run_blocking_result(move || {
        let managed_skills = store.get_all_skills().map_err(AppError::from)?;
        // Build a map: central_path -> skill_id for quick lookups
        let central_map: std::collections::HashMap<String, String> = managed_skills
            .iter()
            .map(|s| (s.central_path.clone(), s.id.clone()))
            .collect();

        let mut result: Vec<AgentSkillGroupDto> = Vec::new();

        for (id, name, icon, enabled, skill_path) in &agent_info {
            let Some(sp) = skill_path.as_ref() else {
                result.push(AgentSkillGroupDto {
                    agent_id: id.clone(),
                    agent_name: name.clone(),
                    agent_icon: icon.clone(),
                    agent_enabled: *enabled,
                    agent_skill_path: None,
                    skills: Vec::new(),
                });
                continue;
            };

            let skills_dir = std::path::PathBuf::from(super::tool_adapters::expand_skill_path(sp));
            let path_str = skills_dir.to_string_lossy().to_string();

            let mut skills: Vec<AgentDiskSkillDto> = Vec::new();

            if skills_dir.exists() && skills_dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&skills_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if !path.is_dir() {
                            continue;
                        }
                        if !super::skill_metadata::is_valid_skill_dir(&path) {
                            continue;
                        }

                        let name_guess = super::skill_metadata::infer_skill_name(&path);
                        let description =
                            super::skill_metadata::parse_skill_md(&path).description;

                        let path_abs = path.to_string_lossy().to_string();

                        // Check if symlink to central repository
                        let (managed, skill_id) = if let Ok(target) = std::fs::read_link(&path) {
                            if target.starts_with(&central) {
                                let id = central_map.get(&target.to_string_lossy().to_string());
                                (true, id.cloned())
                            } else {
                                (false, None)
                            }
                        } else {
                            (false, None)
                        };

                        skills.push(AgentDiskSkillDto {
                            name: name_guess,
                            description,
                            path: path_abs,
                            managed,
                            skill_id,
                        });
                    }
                }
            }

            // Sort: managed skills first, then by name
            skills.sort_by(|a, b| {
                b.managed
                    .cmp(&a.managed)
                    .then(a.name.cmp(&b.name))
            });

            result.push(AgentSkillGroupDto {
                agent_id: id.clone(),
                agent_name: name.clone(),
                agent_icon: icon.clone(),
                agent_enabled: *enabled,
                agent_skill_path: Some(path_str),
                skills,
            });
        }

        // Sort: enabled agents first, then by name
        result.sort_by(|a, b| {
            b.agent_enabled
                .cmp(&a.agent_enabled)
                .then(a.agent_name.cmp(&b.agent_name))
        });

        Ok(result)
    })
    .await
}

/// Deploy a managed skill from the central library to an agent's skills directory.
///
/// Creates a symlink in the agent's `skill_path` pointing to the skill's
/// central repository path. Records the deployment in the `skill_targets` table.
#[tauri::command]
pub async fn import_skill_to_agent_cmd(
    skill_id: String,
    agent_id: String,
    state: State<'_, crate::AppStateWrapper>,
) -> Result<(), AppError> {
    let store = state.skill_store.clone();

    let agent_skill_path = state
        .agent_manager
        .lock()
        .map_err(AppError::from)?
        .get_agent(&agent_id)
        .and_then(|a| a.skill_path.clone())
        .ok_or_else(|| AppError::NotFound(format!("Agent '{}' has no skill path", agent_id)))?;

    run_blocking_result(move || {
        let skill = store
            .get_skill_by_id(&skill_id)
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::NotFound(format!("Skill '{}' not found", skill_id)))?;

        let source = std::path::PathBuf::from(&skill.central_path);
        if !source.exists() {
            return Err(AppError::NotFound(format!(
                "Skill directory not found: {}",
                skill.central_path
            )));
        }

        let agent_skills_dir =
            std::path::PathBuf::from(super::tool_adapters::expand_skill_path(&agent_skill_path));
        let target = agent_skills_dir.join(&skill.name);

        // Create parent directory if needed
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::from)?;
        }

        // Remove existing if stale symlink
        if target.exists() || target.is_symlink() {
            let _ = std::fs::remove_file(&target);
        }

        // Create symlink
        #[cfg(unix)]
        std::os::unix::fs::symlink(&source, &target).map_err(AppError::from)?;
        #[cfg(not(unix))]
        {
            // Fallback: copy directory recursively
            super::sync_engine::copy_dir_recursive(&source, &target)
                .map_err(AppError::from)?;
        }

        // Record in skill_targets
        let target_rec = super::types::SkillTargetRecord {
            id: uuid::Uuid::new_v4().to_string(),
            skill_id: skill.id.clone(),
            tool: agent_id.clone(),
            target_path: target.to_string_lossy().to_string(),
            mode: "symlink".to_string(),
            status: "ok".to_string(),
            synced_at: Some(chrono::Utc::now().timestamp_millis()),
            last_error: None,
        };
        store.insert_target(&target_rec).map_err(AppError::from)?;

        Ok(())
    })
    .await
}

/// Create a new skill by writing a SKILL.md file in the central repository.
#[tauri::command]
pub async fn create_skill(
    name: String,
    skill_content: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<ManagedSkillDtoOut, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let sanitized = super::skill_metadata::sanitize_skill_name(&name)
            .ok_or_else(|| AppError::InvalidInput(format!("Invalid skill name: {}", name)))?;

        let dest = super::central_repo::skills_dir().join(&sanitized);
        if dest.exists() {
            return Err(AppError::InvalidInput(format!(
                "Skill directory already exists: {}",
                sanitized
            )));
        }

        std::fs::create_dir_all(&dest).map_err(AppError::from)?;
        std::fs::write(dest.join("SKILL.md"), &skill_content).map_err(AppError::from)?;

        // Extract description from frontmatter if present
        let metadata = super::skill_metadata::parse_skill_md(&dest);
        let description = metadata.description;

        let hash = super::content_hash::hash_directory(&dest).map_err(AppError::from)?;

        let now = chrono::Utc::now().timestamp_millis();
        let id = uuid::Uuid::new_v4().to_string();
        let skill = super::types::SkillRecord {
            id: id.clone(),
            name: sanitized.clone(),
            description: description.clone(),
            source_type: "local".to_string(),
            source_ref: None,
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: dest.to_string_lossy().to_string(),
            content_hash: Some(hash),
            enabled: true,
            status: "ok".to_string(),
            update_status: "unknown".to_string(),
            last_checked_at: None,
            last_check_error: None,
            created_at: now,
            updated_at: now,
        };
        store.insert_skill(&skill).map_err(AppError::from)?;

        Ok(ManagedSkillDtoOut {
            id,
            name: skill.name.clone(),
            description: skill.description.clone(),
            source_type: "local".to_string(),
            source_ref: None,
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: skill.central_path.clone(),
            enabled: true,
            status: "ok".to_string(),
            update_status: "unknown".to_string(),
            last_checked_at: None,
            tags: vec![],
            created_at: now,
            updated_at: now,
        })
    }).await
}

// --- Marketplace Commands ---

/// Skills.sh marketplace skill DTO.
#[derive(Debug, Serialize, Deserialize)]
pub struct SkillsShSkillDto {
    /// Composite identifier (source/skill_id).
    pub id: String,
    /// Skill identifier on skills.sh.
    pub skill_id: String,
    /// Display name.
    pub name: String,
    /// GitHub source (owner/repo).
    pub source: String,
    /// Number of installations.
    pub installs: u64,
}

/// Fetch the skills.sh leaderboard (all-time, trending, or hot).
#[tauri::command]
pub async fn fetch_leaderboard(
    board: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<Vec<SkillsShSkillDto>, String> {
    let store = store.inner().clone();
    let cache_key = format!("leaderboard_{}", board);

    // Try cache first (5 minute TTL)
    if let Ok(Some(cached)) = store.get_cache(&cache_key, 300) {
        if let Ok(skills) = serde_json::from_str::<Vec<SkillsShSkillDto>>(&cached) {
            return Ok(skills);
        }
    }

    run_blocking(move || {
        let board_type = super::skillssh_api::LeaderboardType::from_str(&board);
        let proxy_url = store.get_setting("proxy_url").ok().flatten();
        let skills = super::skillssh_api::fetch_leaderboard(board_type, proxy_url.as_deref())
            .map_err(|e| e.to_string())?;

        let dtos: Vec<SkillsShSkillDto> = skills
            .into_iter()
            .map(|s| SkillsShSkillDto {
                id: s.id,
                skill_id: s.skill_id,
                name: s.name,
                source: s.source,
                installs: s.installs,
            })
            .collect();

        // Cache the result
        if let Ok(json) = serde_json::to_string(&dtos) {
            let _ = store.set_cache(&cache_key, &json);
        }

        Ok(dtos)
    }).await.map_err(|e| e.to_string())?
}

/// Search skills.sh marketplace for skills matching a query.
#[tauri::command]
pub async fn search_skillssh(
    query: String,
    limit: Option<usize>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<Vec<SkillsShSkillDto>, String> {
    let store = store.inner().clone();
    let cache_key = format!("search_{}_{}", query, limit.unwrap_or(20));

    // Try cache first (5 minute TTL)
    if let Ok(Some(cached)) = store.get_cache(&cache_key, 300) {
        if let Ok(skills) = serde_json::from_str::<Vec<SkillsShSkillDto>>(&cached) {
            return Ok(skills);
        }
    }

    run_blocking(move || {
        let proxy_url = store.get_setting("proxy_url").ok().flatten();
        let skills =
            super::skillssh_api::search_skills(&query, limit.unwrap_or(20), proxy_url.as_deref())
                .map_err(|e| e.to_string())?;

        let dtos: Vec<SkillsShSkillDto> = skills
            .into_iter()
            .map(|s| SkillsShSkillDto {
                id: s.id,
                skill_id: s.skill_id,
                name: s.name,
                source: s.source,
                installs: s.installs,
            })
            .collect();

        // Cache the result
        if let Ok(json) = serde_json::to_string(&dtos) {
            let _ = store.set_cache(&cache_key, &json);
        }

        Ok(dtos)
    }).await.map_err(|e| e.to_string())?
}

/// Install a skill from skills.sh by cloning its GitHub repository.
#[tauri::command]
pub async fn install_from_skillssh(
    source: String,
    skill_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
    app_handle: tauri::AppHandle,
) -> Result<ManagedSkillDtoOut, String> {
    let store = store.inner().clone();
    let app_handle = app_handle.clone();

    run_blocking(move || {
        // Emit progress: cloning
        let _ = app_handle.emit(
            "install-progress",
            serde_json::json!({
                "skill_id": skill_id,
                "phase": "cloning"
            }),
        );

        // Construct GitHub URL
        let git_url = super::git_fetcher::construct_github_url(&source);

        // Clone the repository
        let proxy_url = store.get_setting("proxy_url").ok().flatten();
        let repo_path =
            super::git_fetcher::clone_repo_ref(&git_url, None, None, proxy_url.as_deref())
                .map_err(|e| e.to_string())?;

        // Emit progress: installing
        let _ = app_handle.emit(
            "install-progress",
            serde_json::json!({
                "skill_id": skill_id,
                "phase": "installing"
            }),
        );

        // Resolve skill directory (root or common monorepo layouts)
        let skill_dir = {
            let direct = repo_path.join(&skill_id);
            if direct.exists() {
                direct
            } else {
                let mut resolved = None;
                for prefix in ["skills", "packages", ".agents/skills"] {
                    let alt = repo_path.join(prefix).join(&skill_id);
                    if alt.exists() {
                        resolved = Some(alt);
                        break;
                    }
                }
                // Single-skill repo: root itself is the skill
                if resolved.is_none()
                    && super::skill_metadata::is_valid_skill_dir(&repo_path)
                {
                    resolved = Some(repo_path.clone());
                }
                match resolved {
                    Some(p) => p,
                    None => {
                        super::git_fetcher::cleanup_temp(&repo_path);
                        return Err(format!("Skill '{}' not found in repository", skill_id));
                    }
                }
            }
        };

        let result = super::installer::install_from_local(&skill_dir, Some(&skill_id))
            .map_err(|e| e.to_string())?;

        // Get revision
        let revision = super::git_fetcher::get_head_revision(&repo_path).ok();

        // Compute relative subpath from repo root
        let source_subpath = skill_dir
            .strip_prefix(&repo_path)
            .ok()
            .filter(|p| !p.as_os_str().is_empty())
            .map(|p| p.to_string_lossy().to_string());

        // Insert skill record
        let now = chrono::Utc::now().timestamp_millis();
        let id = uuid::Uuid::new_v4().to_string();
        let skill = super::types::SkillRecord {
            id: id.clone(),
            name: result.name.clone(),
            description: result.description.clone(),
            source_type: "skillssh".to_string(),
            source_ref: Some(git_url.clone()),
            source_ref_resolved: None,
            source_subpath: source_subpath.clone(),
            source_branch: None,
            source_revision: revision,
            remote_revision: None,
            central_path: result.central_path.to_string_lossy().to_string(),
            content_hash: Some(result.content_hash),
            enabled: true,
            status: "ok".to_string(),
            update_status: "up_to_date".to_string(),
            last_checked_at: Some(now),
            last_check_error: None,
            created_at: now,
            updated_at: now,
        };
        store.insert_skill(&skill).map_err(|e| e.to_string())?;

        // Cleanup
        super::git_fetcher::cleanup_temp(&repo_path);

        // Emit progress: done
        let _ = app_handle.emit(
            "install-progress",
            serde_json::json!({
                "skill_id": skill_id,
                "phase": "done"
            }),
        );

        Ok(ManagedSkillDtoOut {
            id,
            name: result.name,
            description: result.description,
            source_type: "skillssh".to_string(),
            source_ref: Some(git_url),
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: result.central_path.to_string_lossy().to_string(),
            enabled: true,
            status: "ok".to_string(),
            update_status: "up_to_date".to_string(),
            last_checked_at: None,
            tags: vec![],
            created_at: now,
            updated_at: now,
        })
    }).await.map_err(|e| e.to_string())?
}
