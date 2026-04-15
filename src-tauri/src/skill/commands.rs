use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

use super::tool_adapters;
use super::types::*;
use super::skill_store::SkillStore;

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
) -> Result<Vec<ManagedSkillDtoOut>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skills = store.get_all_skills().map_err(|e| e.to_string())?;
        let tags_map = store.get_tags_map().map_err(|e| e.to_string())?;
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
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_skill_document(
    skill_id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<SkillDocumentDtoOut, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skill = store.get_skill_by_id(&skill_id).map_err(|e| e.to_string())?
            .ok_or_else(|| "Skill not found".to_string())?;
        let central = PathBuf::from(&skill.central_path);
        let candidates = ["SKILL.md", "skill.md", "CLAUDE.md", "README.md", "readme.md"];
        for name in &candidates {
            let path = central.join(name);
            if path.exists() {
                let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
                return Ok(SkillDocumentDtoOut { content });
            }
        }
        Err("No documentation file found".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_managed_skill(
    skill_id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skill = store.get_skill_by_id(&skill_id).map_err(|e| e.to_string())?
            .ok_or_else(|| "Skill not found".to_string())?;
        let central = PathBuf::from(&skill.central_path);
        if central.exists() { std::fs::remove_dir_all(&central).ok(); }
        store.delete_skill(&skill_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_tool_status(
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<ToolStatusDtoOut>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let custom_tool_paths = store.get_setting("custom_tool_paths").ok().flatten().unwrap_or_default();
        let custom_tools = store.get_setting("custom_tools").ok().flatten().unwrap_or_default();
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
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_tag_groups(
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<TagGroupDtoOut>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let groups = store.get_all_tag_groups().map_err(|e| e.to_string())?;
        Ok(groups.into_iter().map(|g| {
            let count = store.count_skills_for_tag_group(&g.id).unwrap_or(0);
            TagGroupDtoOut { id: g.id, name: g.name, description: g.description, icon: g.icon, sort_order: g.sort_order, skill_count: count, created_at: g.created_at, updated_at: g.updated_at }
        }).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_tag_group(
    name: String,
    description: Option<String>,
    icon: Option<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<TagGroupDtoOut, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let now = chrono::Utc::now().timestamp_millis();
        let id = uuid::Uuid::new_v4().to_string();
        let tg = TagGroupRecord { id: id.clone(), name: name.clone(), description: description.clone(), icon: icon.clone(), sort_order: 999, created_at: now, updated_at: now };
        store.insert_tag_group(&tg).map_err(|e| e.to_string())?;
        Ok(TagGroupDtoOut { id, name, description, icon, sort_order: 999, skill_count: 0, created_at: now, updated_at: now })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_tag_group_cmd(
    id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.delete_tag_group(&id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn install_local_skill(
    source_path: String,
    name: Option<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<ManagedSkillDtoOut, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::path::PathBuf::from(&source_path);
        let result = super::installer::install_from_local(&path, name.as_deref()).map_err(|e| e.to_string())?;
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
        store.insert_skill(&skill).map_err(|e| e.to_string())?;
        Ok(ManagedSkillDtoOut {
            id, name: result.name, description: result.description,
            source_type: "local".to_string(), source_ref: None,
            central_path: result.central_path.to_string_lossy().to_string(),
            enabled: true, status: "ok".to_string(), update_status: "unknown".to_string(),
            tags: vec![], created_at: now, updated_at: now,
        })
    }).await.map_err(|e| e.to_string())?
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
) -> Result<Vec<DiscoveredSkillDto>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skills = store.get_all_skills().map_err(|e| e.to_string())?;
        let managed_paths: Vec<String> = skills.iter().map(|s| s.central_path.clone()).collect();
        let discovered = super::scanner::scan_local_skills(&managed_paths).map_err(|e| e.to_string())?;
        Ok(discovered.into_iter().map(|d| DiscoveredSkillDto {
            id: d.id, tool: d.tool, found_path: d.found_path, name_guess: d.name_guess,
        }).collect())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_discovered_skill(
    discovered_path: String,
    name: Option<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<ManagedSkillDtoOut, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let src = std::path::PathBuf::from(&discovered_path);
        let result = super::installer::install_from_local(&src, name.as_deref()).map_err(|e| e.to_string())?;
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
            enabled: true, status: "ok".to_string(), update_status: "unknown".to_string(),
            last_checked_at: None, last_check_error: None,
            created_at: now, updated_at: now,
        };
        store.insert_skill(&skill).map_err(|e| e.to_string())?;
        Ok(ManagedSkillDtoOut {
            id, name: result.name, description: result.description,
            source_type: "local".to_string(), source_ref: None,
            central_path: result.central_path.to_string_lossy().to_string(),
            enabled: true, status: "ok".to_string(), update_status: "unknown".to_string(),
            tags: vec![], created_at: now, updated_at: now,
        })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_tag_group_cmd(
    id: String,
    name: String,
    description: Option<String>,
    icon: Option<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.update_tag_group(&id, &name, description.as_deref(), icon.as_deref()).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn reorder_tag_groups_cmd(
    ids: Vec<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.reorder_tag_groups(&ids).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn add_skill_to_tag_group_cmd(
    tag_group_id: String,
    skill_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.add_skill_to_tag_group(&tag_group_id, &skill_id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_skill_from_tag_group_cmd(
    tag_group_id: String,
    skill_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.remove_skill_from_tag_group(&tag_group_id, &skill_id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_skills_for_tag_group_cmd(
    tag_group_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<Vec<ManagedSkillDtoOut>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skills = store.get_skills_for_tag_group(&tag_group_id).map_err(|e| e.to_string())?;
        let tags_map = store.get_tags_map().map_err(|e| e.to_string())?;
        Ok(skills.into_iter().map(|s| ManagedSkillDtoOut {
            tags: tags_map.get(&s.id).cloned().unwrap_or_default(),
            id: s.id, name: s.name, description: s.description,
            source_type: s.source_type, source_ref: s.source_ref,
            central_path: s.central_path, enabled: s.enabled,
            status: s.status, update_status: s.update_status,
            created_at: s.created_at, updated_at: s.updated_at,
        }).collect())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_all_tags_cmd(
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<Vec<String>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.get_all_tags().map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_skill_tags_cmd(
    skill_id: String,
    tags: Vec<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.set_tags_for_skill(&skill_id, &tags).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_skill_tool_toggle_cmd(
    tag_group_id: String,
    skill_id: String,
    tool: String,
    enabled: bool,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.set_tag_group_skill_tool_enabled(&tag_group_id, &skill_id, &tool, enabled).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sync_tag_group_cmd(
    tag_group_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skills = store.get_skills_for_tag_group(&tag_group_id).map_err(|e| e.to_string())?;
        let configured_mode = store.get_setting("sync_mode").map_err(|e| e.to_string())?;
        for skill in &skills {
            let source = std::path::PathBuf::from(&skill.central_path);
            if !source.exists() { continue; }
            let adapter_keys: Vec<String> = super::tool_adapters::default_tool_adapters()
                .iter().map(|a| a.key.clone()).collect();
            for tool_key in &adapter_keys {
                let toggle = store.get_enabled_tools_for_tag_group_skill(&tag_group_id, &skill.id)
                    .map_err(|e| e.to_string())?;
                if !toggle.contains(tool_key) { continue; }
                let adapter = super::tool_adapters::default_tool_adapters()
                    .into_iter().find(|a| a.key == *tool_key);
                if let Some(a) = adapter {
                    let target = a.skills_dir().join(&skill.name);
                    let mode = super::sync_engine::sync_mode_for_tool(tool_key, configured_mode.as_deref());
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
                            log::warn!("Failed to sync skill {} to {}: {e}", skill.id, target.display());
                        }
                    }
                }
            }
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn unsync_tag_group_cmd(
    tag_group_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skill_ids = store.get_skills_for_tag_group(&tag_group_id).map_err(|e| e.to_string())?;
        for skill in &skill_ids {
            let targets = store.get_targets_for_skill(&skill.id).unwrap_or_default();
            for target in &targets {
                let path = std::path::PathBuf::from(&target.target_path);
                let _ = super::sync_engine::remove_target(&path);
                let _ = store.delete_target(&skill.id, &target.tool);
            }
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_project_tag_groups_cmd(
    project_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<Vec<TagGroupDtoOut>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let tg_ids = store.get_project_tag_groups(&project_id).map_err(|e| e.to_string())?;
        let all_groups = store.get_all_tag_groups().map_err(|e| e.to_string())?;
        Ok(all_groups.into_iter()
            .filter(|g| tg_ids.contains(&g.id))
            .map(|g| {
                let count = store.count_skills_for_tag_group(&g.id).unwrap_or(0);
                TagGroupDtoOut { id: g.id, name: g.name, description: g.description, icon: g.icon, sort_order: g.sort_order, skill_count: count, created_at: g.created_at, updated_at: g.updated_at }
            }).collect())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_project_tag_groups_cmd(
    project_id: String,
    tag_group_ids: Vec<String>,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.set_project_tag_groups(&project_id, &tag_group_ids).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn add_project_tag_group_cmd(
    project_id: String,
    tag_group_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.add_project_tag_group(&project_id, &tag_group_id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_project_tag_group_cmd(
    project_id: String,
    tag_group_id: String,
    store: tauri::State<'_, std::sync::Arc<super::skill_store::SkillStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.remove_project_tag_group(&project_id, &tag_group_id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}
