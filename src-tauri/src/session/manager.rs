use crate::project::types::Project;
use crate::session::types::{
    ProjectSession, RemoteEntrySession, RemoteProjectSession, SessionStore, WSLEntrySession,
};
use anyhow::Result;
use chrono::Local;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct StorageManager {
    config_dir: PathBuf,
}

impl StorageManager {
    pub fn new() -> Result<Self> {
        let home_dir =
            dirs::home_dir().ok_or_else(|| anyhow::anyhow!("Failed to get home directory"))?;
        let config_dir = home_dir.join(".neeko");

        // 确保配置目录存在
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir)?;
        }

        Ok(Self { config_dir })
    }

    pub fn with_dir(config_dir: PathBuf) -> Result<Self> {
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir)?;
        }
        Ok(Self { config_dir })
    }

    pub fn get_config_dir(&self) -> &Path {
        &self.config_dir
    }

    pub fn save_vcs_settings(&self, project_id: &str, settings: &serde_json::Value) -> Result<()> {
        let file = self.config_dir.join(format!("vcs_{}.json", project_id));
        let json = serde_json::to_string_pretty(settings)?;
        fs::write(&file, json)?;
        Ok(())
    }

    pub fn load_vcs_settings(&self, project_id: &str) -> Result<serde_json::Value> {
        let file = self.config_dir.join(format!("vcs_{}.json", project_id));
        if file.exists() {
            let content = fs::read_to_string(&file)?;
            Ok(serde_json::from_str(&content)?)
        } else {
            Ok(serde_json::Value::Object(serde_json::Map::new()))
        }
    }

    pub fn save_session(&self, session: &SessionStore) -> Result<()> {
        let session_file = self.config_dir.join("sessions.json");
        let mut session = session.clone();
        session.last_updated = Local::now().to_rfc3339();

        let json = serde_json::to_string_pretty(&session)?;
        fs::write(session_file, json)?;
        Ok(())
    }

    pub fn load_session(&self) -> Result<SessionStore> {
        let session_file = self.config_dir.join("sessions.json");

        let mut session = if session_file.exists() {
            let json = fs::read_to_string(&session_file)?;
            serde_json::from_str::<SessionStore>(&json)?
        } else {
            SessionStore::new()
        };

        // 迁移旧的独立文件到统一 sessions.json
        let mut migrated = false;

        if session.wsl_entries.is_empty() {
            let old_wsl_file = self.config_dir.join("wsl_entries.json");
            if old_wsl_file.exists() {
                if let Ok(json) = fs::read_to_string(&old_wsl_file) {
                    if let Ok(entries) = serde_json::from_str::<Vec<WSLEntrySession>>(&json) {
                        // 过滤历史脏数据
                        session.wsl_entries = entries
                            .into_iter()
                            .filter(|e| !e.distro.contains('\0'))
                            .map(|mut e| {
                                e.projects.retain(|p| !p.distro.contains('\0'));
                                e
                            })
                            .collect();
                        migrated = true;
                    }
                }
                let _ = fs::remove_file(&old_wsl_file);
            }
        }

        if session.remote_entries.is_empty() {
            let old_remote_file = self.config_dir.join("remote_entries.json");
            if old_remote_file.exists() {
                if let Ok(json) = fs::read_to_string(&old_remote_file) {
                    if let Ok(entries) = serde_json::from_str::<Vec<RemoteEntrySession>>(&json) {
                        session.remote_entries = entries;
                        migrated = true;
                    }
                }
                let _ = fs::remove_file(&old_remote_file);
            }
        }

        // 迁移后立即保存统一格式
        if migrated {
            if let Err(e) = self.save_session(&session) {
                log::error!("Failed to save migrated session: {}", e);
            }
        }

        Ok(session)
    }

    pub fn create_session_from_projects(
        &self,
        projects: &[Project],
        wsl_entries: Option<&[WSLEntrySession]>,
        remote_entries: Option<&[RemoteEntrySession]>,
        sidebar_width: Option<u32>,
    ) -> SessionStore {
        use crate::core::ProjectEnvironment;

        let project_sessions = projects
            .iter()
            .filter(|p| matches!(p.environment, ProjectEnvironment::Local))
            .map(|p| ProjectSession {
                id: p.id.clone(),
                name: p.name.clone(),
                path: p.path.clone(),
                selected_agent: p.selected_agent.clone(),
                selected_ide: p.selected_ide.clone(),
                terminal_history: p.terminal.history.clone(),
                last_status: p.terminal.status.clone(),
                collapsed: p.collapsed,
                avatar_color: p.avatar_color.clone(),
            })
            .collect();

        // 优先使用传入的 wsl/remote entries；None 时从 projects 列表自动推导
        let wsl = wsl_entries
            .map(|v| v.to_vec())
            .unwrap_or_else(|| Self::collect_wsl_projects(projects));
        let remote = remote_entries
            .map(|v| v.to_vec())
            .unwrap_or_else(|| Self::collect_remote_projects(projects));

        SessionStore {
            projects: project_sessions,
            active_project_id: None,
            last_updated: Local::now().to_rfc3339(),
            wsl_entries: wsl,
            remote_entries: remote,
            sidebar_width,
            worktree_state: std::collections::HashMap::new(),
        }
    }

    /// 从 Project 列表中提取 WSL 项目，按 distro 分组为 WSLEntrySession。
    pub fn collect_wsl_projects(projects: &[Project]) -> Vec<WSLEntrySession> {
        #[cfg(target_os = "windows")]
        {
            use crate::core::ProjectEnvironment;
            use crate::session::types::WSLProjectSession;
            use std::collections::HashMap;
            let mut map: HashMap<String, WSLEntrySession> = HashMap::new();
            for p in projects {
                if let ProjectEnvironment::Wsl { distro } = &p.environment {
                    let entry = map
                        .entry(distro.clone())
                        .or_insert_with(|| WSLEntrySession {
                            id: format!("wsl-distro-{distro}"),
                            distro: distro.clone(),
                            projects: Vec::new(),
                        });
                    entry.projects.push(WSLProjectSession {
                        id: p.id.clone(),
                        name: p.name.clone(),
                        path: p.path.to_string_lossy().to_string(),
                        distro: distro.clone(),
                        entry_id: entry.id.clone(),
                        selected_agent: p.selected_agent.clone(),
                        selected_ide: p.selected_ide.clone(),
                        avatar_color: p.avatar_color.clone(),
                    });
                }
            }
            map.into_values().collect()
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = projects;
            Vec::new()
        }
    }

    /// 从 Project 列表中提取 Remote 项目，按 host 分组为 RemoteEntrySession。
    pub fn collect_remote_projects(projects: &[Project]) -> Vec<RemoteEntrySession> {
        use crate::core::ProjectEnvironment;
        use base64::Engine;
        use std::collections::HashMap;

        let mut map: HashMap<String, RemoteEntrySession> = HashMap::new();
        for p in projects {
            if let ProjectEnvironment::Remote {
                host,
                port,
                username,
                auth,
            } = &p.environment
            {
                let key = format!("{host}:{port}:{username}");
                let entry = map.entry(key).or_insert_with(|| {
                    let auth_json = serde_json::to_value(auth).unwrap_or_default();
                    let auth_bytes = serde_json::to_string(&auth_json)
                        .unwrap_or_default()
                        .into_bytes();
                    let saved_auth =
                        Some(base64::engine::general_purpose::STANDARD.encode(&auth_bytes));
                    RemoteEntrySession {
                        id: format!("remote-{host}"),
                        host: host.clone(),
                        port: *port,
                        username: username.clone(),
                        projects: Vec::new(),
                        saved_auth,
                    }
                });
                entry.projects.push(RemoteProjectSession {
                    id: p.id.clone(),
                    name: p.name.clone(),
                    path: p.path.to_string_lossy().to_string(),
                    entry_id: entry.id.clone(),
                    selected_agent: p.selected_agent.clone(),
                    selected_ide: p.selected_ide.clone(),
                    avatar_color: p.avatar_color.clone(),
                });
            }
        }
        map.into_values().collect()
    }

    // 保存用户配置
    pub fn save_config(&self, config: &serde_json::Value) -> Result<()> {
        let config_file = self.config_dir.join("config.json");
        let json = serde_json::to_string_pretty(config)?;
        fs::write(config_file, json)?;
        Ok(())
    }

    pub fn load_config(&self) -> Result<serde_json::Value> {
        let config_file = self.config_dir.join("config.json");

        if !config_file.exists() {
            return Ok(serde_json::json!({}));
        }

        let json = fs::read_to_string(config_file)?;
        let config: serde_json::Value = serde_json::from_str(&json)?;
        Ok(config)
    }
}
