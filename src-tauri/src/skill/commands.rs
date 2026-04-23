use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;
use tauri::State;

use super::skill_store::SkillStore;
use super::tool_adapters;
use super::types::*;
use crate::AppError;

#[macro_export]
macro_rules! skill_commands {
    () => {
        $crate::skill::commands::get_managed_skills,
        $crate::skill::commands::get_skill_document,
        $crate::skill::commands::delete_managed_skill,
        $crate::skill::commands::get_tool_status,
        $crate::skill::commands::get_tag_groups,
        $crate::skill::commands::create_tag_group,
        $crate::skill::commands::delete_tag_group_cmd,
        $crate::skill::commands::install_local_skill,
        $crate::skill::commands::scan_local_skills,
        $crate::skill::commands::import_discovered_skill,
        $crate::skill::commands::preview_git_install,
        $crate::skill::commands::confirm_git_install,
        $crate::skill::commands::cancel_git_preview,
        $crate::skill::commands::check_skill_update,
        $crate::skill::commands::update_skill,
        $crate::skill::commands::update_tag_group_cmd,
        $crate::skill::commands::reorder_tag_groups_cmd,
        $crate::skill::commands::add_skill_to_tag_group_cmd,
        $crate::skill::commands::remove_skill_from_tag_group_cmd,
        $crate::skill::commands::get_skills_for_tag_group_cmd,
        $crate::skill::commands::get_all_tags_cmd,
        $crate::skill::commands::set_skill_tags_cmd,
        $crate::skill::commands::set_skill_tool_toggle_cmd,
        $crate::skill::commands::sync_tag_group_cmd,
        $crate::skill::commands::unsync_tag_group_cmd,
        $crate::skill::commands::get_project_tag_groups_cmd,
        $crate::skill::commands::set_project_tag_groups_cmd,
        $crate::skill::commands::add_project_tag_group_cmd,
        $crate::skill::commands::remove_project_tag_group_cmd,
        $crate::skill::commands::create_skill,
    };
}

#[derive(Debug, Serialize)]
pub struct ManagedSkillDtoOut {
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

#[derive(Debug, Serialize)]
pub struct TagGroupDtoOut {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i32,
    pub skill_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
pub struct ToolStatusDtoOut {
    pub key: String,
    pub display_name: String,
    pub installed: bool,
    pub has_override: bool,
    pub is_custom: bool,
}

#[derive(Debug, Serialize)]
pub struct SkillDocumentDtoOut {
    pub content: String,
}

#[tauri::command]
pub async fn get_managed_skills(
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<ManagedSkillDtoOut>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skills = store.get_all_skills().map_err(AppError::from)?;
        let tags_map = store.get_tags_map().map_err(AppError::from)?;
        Ok(skills
            .into_iter()
            .map(|s| ManagedSkillDtoOut {
                tags: tags_map.get(&s.id).cloned().unwrap_or_default(),
                id: s.id,
                name: s.name,
                description: s.description,
                source_type: s.source_type,
                source_ref: s.source_ref,
                central_path: s.central_path,
                enabled: s.enabled,
                status: s.status,
                update_status: s.update_status,
                created_at: s.created_at,
                updated_at: s.updated_at,
            })
            .collect())
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn get_skill_document(
    skill_id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<SkillDocumentDtoOut, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn delete_managed_skill(
    skill_id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skill = store
            .get_skill_by_id(&skill_id)
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::NotFound("Skill not found".to_string()))?;
        let central = PathBuf::from(&skill.central_path);
        if central.exists() {
            std::fs::remove_dir_all(&central).ok();
        }
        store.delete_skill(&skill_id).map_err(AppError::from)
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn get_tool_status(
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<ToolStatusDtoOut>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let custom_tool_paths = store
            .get_setting("custom_tool_paths")
            .ok()
            .flatten()
            .unwrap_or_default();
        let custom_tools = store
            .get_setting("custom_tools")
            .ok()
            .flatten()
            .unwrap_or_default();
        let adapters = tool_adapters::all_tool_adapters(&custom_tool_paths, &custom_tools);
        Ok(adapters
            .into_iter()
            .map(|a| ToolStatusDtoOut {
                installed: a.is_installed(),
                has_override: a.has_path_override(),
                is_custom: a.is_custom,
                key: a.key,
                display_name: a.display_name,
            })
            .collect())
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn get_tag_groups(
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<TagGroupDtoOut>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn create_tag_group(
    name: String,
    description: Option<String>,
    icon: Option<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<TagGroupDtoOut, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn delete_tag_group_cmd(
    id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.delete_tag_group(&id).map_err(AppError::from)
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn install_local_skill(
    source_path: String,
    name: Option<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<ManagedSkillDtoOut, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
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
            central_path: result.central_path.to_string_lossy().to_string(),
            enabled: true,
            status: "ok".to_string(),
            update_status: "unknown".to_string(),
            tags: vec![],
            created_at: now,
            updated_at: now,
        })
    })
    .await
    .map_err(AppError::from)?
}

#[derive(Debug, serde::Serialize)]
pub struct DiscoveredSkillDto {
    pub id: String,
    pub tool: String,
    pub found_path: String,
    pub name_guess: Option<String>,
}

#[tauri::command]
pub async fn scan_local_skills(
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<Vec<DiscoveredSkillDto>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skills = store.get_all_skills().map_err(AppError::from)?;
        let managed_paths: Vec<String> = skills.iter().map(|s| s.central_path.clone()).collect();
        let discovered =
            super::scanner::scan_local_skills(&managed_paths).map_err(AppError::from)?;
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
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn import_discovered_skill(
    discovered_path: String,
    name: Option<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<ManagedSkillDtoOut, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
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
            source_ref: Some(discovered_path),
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
            central_path: result.central_path.to_string_lossy().to_string(),
            enabled: true,
            status: "ok".to_string(),
            update_status: "unknown".to_string(),
            tags: vec![],
            created_at: now,
            updated_at: now,
        })
    })
    .await
    .map_err(AppError::from)?
}

#[derive(Debug, serde::Serialize)]
pub struct GitSkillPreviewDto {
    pub id: String,
    pub clone_url: String,
    pub branch: Option<String>,
    pub available_skills: Vec<super::installer::GitSkillInfo>,
}

#[tauri::command]
pub async fn preview_git_install(
    clone_url: String,
    branch: Option<String>,
    subpath: Option<String>,
) -> Result<GitSkillPreviewDto, AppError> {
    let preview_id =
        super::installer::preview_git_install(&clone_url, branch.as_deref(), subpath.as_deref())
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

#[derive(Debug, serde::Deserialize)]
pub struct ConfirmGitInstallInput {
    pub preview_id: String,
    pub selected_path: String,
    pub name: Option<String>,
}

#[tauri::command]
pub async fn confirm_git_install(
    input: ConfirmGitInstallInput,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<ManagedSkillDtoOut, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = super::installer::confirm_git_install(
            &input.preview_id,
            &input.selected_path,
            input.name.as_deref(),
        )
        .map_err(AppError::from)?;
        let now = chrono::Utc::now().timestamp_millis();
        let id = uuid::Uuid::new_v4().to_string();
        let skill = super::types::SkillRecord {
            id: id.clone(),
            name: result.name.clone(),
            description: result.description.clone(),
            source_type: "git".to_string(),
            source_ref: Some(input.selected_path),
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
            source_type: "git".to_string(),
            source_ref: None,
            central_path: result.central_path.to_string_lossy().to_string(),
            enabled: true,
            status: "ok".to_string(),
            update_status: "unknown".to_string(),
            tags: vec![],
            created_at: now,
            updated_at: now,
        })
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn cancel_git_preview(preview_id: String) -> Result<(), AppError> {
    super::installer::cancel_git_preview(&preview_id).map_err(AppError::from)
}

#[derive(Debug, serde::Serialize)]
pub struct CheckUpdateResult {
    pub status: String,
    pub remote_revision: Option<String>,
}

#[tauri::command]
pub async fn check_skill_update(
    skill_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<CheckUpdateResult, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn update_skill(
    skill_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<ManagedSkillDtoOut, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
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
            central_path: updated.central_path,
            enabled: updated.enabled,
            status: updated.status,
            update_status: updated.update_status,
            tags: vec![],
            created_at: updated.created_at,
            updated_at: updated.updated_at,
        })
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn update_tag_group_cmd(
    id: String,
    name: String,
    description: Option<String>,
    icon: Option<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .update_tag_group(&id, &name, description.as_deref(), icon.as_deref())
            .map_err(AppError::from)
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn reorder_tag_groups_cmd(
    ids: Vec<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.reorder_tag_groups(&ids).map_err(AppError::from)
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn add_skill_to_tag_group_cmd(
    tag_group_id: String,
    skill_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .add_skill_to_tag_group(&tag_group_id, &skill_id)
            .map_err(AppError::from)
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn remove_skill_from_tag_group_cmd(
    tag_group_id: String,
    skill_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .remove_skill_from_tag_group(&tag_group_id, &skill_id)
            .map_err(AppError::from)
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn get_skills_for_tag_group_cmd(
    tag_group_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<Vec<ManagedSkillDtoOut>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skills = store
            .get_skills_for_tag_group(&tag_group_id)
            .map_err(AppError::from)?;
        let tags_map = store.get_tags_map().map_err(AppError::from)?;
        Ok(skills
            .into_iter()
            .map(|s| ManagedSkillDtoOut {
                tags: tags_map.get(&s.id).cloned().unwrap_or_default(),
                id: s.id,
                name: s.name,
                description: s.description,
                source_type: s.source_type,
                source_ref: s.source_ref,
                central_path: s.central_path,
                enabled: s.enabled,
                status: s.status,
                update_status: s.update_status,
                created_at: s.created_at,
                updated_at: s.updated_at,
            })
            .collect())
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn get_all_tags_cmd(
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<Vec<String>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.get_all_tags().map_err(AppError::from))
        .await
        .map_err(AppError::from)?
}

#[tauri::command]
pub async fn set_skill_tags_cmd(
    skill_id: String,
    tags: Vec<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .set_tags_for_skill(&skill_id, &tags)
            .map_err(AppError::from)
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn set_skill_tool_toggle_cmd(
    tag_group_id: String,
    skill_id: String,
    tool: String,
    enabled: bool,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .set_tag_group_skill_tool_enabled(&tag_group_id, &skill_id, &tool, enabled)
            .map_err(AppError::from)
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn sync_tag_group_cmd(
    tag_group_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skills = store
            .get_skills_for_tag_group(&tag_group_id)
            .map_err(AppError::from)?;
        let configured_mode = store.get_setting("sync_mode").map_err(AppError::from)?;
        for skill in &skills {
            let source = std::path::PathBuf::from(&skill.central_path);
            if !source.exists() {
                continue;
            }
            let adapter_keys: Vec<String> = super::tool_adapters::default_tool_adapters()
                .iter()
                .map(|a| a.key.clone())
                .collect();
            for tool_key in &adapter_keys {
                let toggle = store
                    .get_enabled_tools_for_tag_group_skill(&tag_group_id, &skill.id)
                    .map_err(AppError::from)?;
                if !toggle.contains(tool_key) {
                    continue;
                }
                let adapter = super::tool_adapters::default_tool_adapters()
                    .into_iter()
                    .find(|a| a.key == *tool_key);
                if let Some(a) = adapter {
                    let target = a.skills_dir().join(&skill.name);
                    let mode = super::sync_engine::sync_mode_for_tool(
                        tool_key,
                        configured_mode.as_deref(),
                    );
                    match super::sync_engine::sync_skill(&source, &target, mode) {
                        Ok(actual_mode) => {
                            let now = chrono::Utc::now().timestamp_millis();
                            let rec = super::types::SkillTargetRecord {
                                id: uuid::Uuid::new_v4().to_string(),
                                skill_id: skill.id.clone(),
                                tool: tool_key.clone(),
                                target_path: target.to_string_lossy().to_string(),
                                mode: actual_mode.as_str().to_string(),
                                status: "ok".to_string(),
                                synced_at: Some(now),
                                last_error: None,
                            };
                            let _ = store.insert_target(&rec);
                        }
                        Err(e) => {
                            log::warn!(
                                "Failed to sync skill {} to {}: {e}",
                                skill.id,
                                target.display()
                            );
                        }
                    }
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn unsync_tag_group_cmd(
    tag_group_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn get_project_tag_groups_cmd(
    project_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<Vec<TagGroupDtoOut>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn set_project_tag_groups_cmd(
    project_id: String,
    tag_group_ids: Vec<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .set_project_tag_groups(&project_id, &tag_group_ids)
            .map_err(AppError::from)
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn add_project_tag_group_cmd(
    project_id: String,
    tag_group_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .add_project_tag_group(&project_id, &tag_group_id)
            .map_err(AppError::from)
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn remove_project_tag_group_cmd(
    project_id: String,
    tag_group_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .remove_project_tag_group(&project_id, &tag_group_id)
            .map_err(AppError::from)
    })
    .await
    .map_err(AppError::from)?
}

#[tauri::command]
pub async fn create_skill(
    name: String,
    skill_content: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<ManagedSkillDtoOut, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
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
            name: sanitized,
            description,
            source_type: "local".to_string(),
            source_ref: None,
            central_path: dest.to_string_lossy().to_string(),
            enabled: true,
            status: "ok".to_string(),
            update_status: "unknown".to_string(),
            tags: vec![],
            created_at: now,
            updated_at: now,
        })
    })
    .await
    .map_err(AppError::from)?
}

// --- Marketplace Commands ---

#[derive(Debug, Serialize, Deserialize)]
pub struct SkillsShSkillDto {
    pub id: String,
    pub skill_id: String,
    pub name: String,
    pub source: String,
    pub installs: u64,
}

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

    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| e.to_string())?
}

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

    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn install_from_skillssh(
    source: String,
    skill_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
    app_handle: tauri::AppHandle,
) -> Result<ManagedSkillDtoOut, String> {
    let store = store.inner().clone();
    let app_handle = app_handle.clone();

    tauri::async_runtime::spawn_blocking(move || {
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

        // Find the skill directory
        let skill_dir = repo_path.join(&skill_id);
        if !skill_dir.exists() {
            // Try looking in common subdirectories
            let common_paths = ["skills", "packages"];
            let mut found = false;
            for prefix in common_paths {
                let alt_path = repo_path.join(prefix).join(&skill_id);
                if alt_path.exists() {
                    // Install from alternative path
                    let result = super::installer::install_from_local(&alt_path, Some(&skill_id))
                        .map_err(|e| e.to_string())?;
                    found = true;

                    // Get revision
                    let revision = super::git_fetcher::get_head_revision(&repo_path).ok();

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
                        source_subpath: Some(format!("{}/{}", prefix, skill_id)),
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

                    return Ok(ManagedSkillDtoOut {
                        id,
                        name: result.name,
                        description: result.description,
                        source_type: "skillssh".to_string(),
                        source_ref: Some(git_url),
                        central_path: result.central_path.to_string_lossy().to_string(),
                        enabled: true,
                        status: "ok".to_string(),
                        update_status: "up_to_date".to_string(),
                        tags: vec![],
                        created_at: now,
                        updated_at: now,
                    });
                }
            }
            if !found {
                super::git_fetcher::cleanup_temp(&repo_path);
                return Err(format!("Skill '{}' not found in repository", skill_id));
            }
        }

        // Install from direct path
        let result = super::installer::install_from_local(&skill_dir, Some(&skill_id))
            .map_err(|e| e.to_string())?;

        // Get revision
        let revision = super::git_fetcher::get_head_revision(&repo_path).ok();

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
            source_subpath: Some(skill_id.clone()),
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
            central_path: result.central_path.to_string_lossy().to_string(),
            enabled: true,
            status: "ok".to_string(),
            update_status: "up_to_date".to_string(),
            tags: vec![],
            created_at: now,
            updated_at: now,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
