use crate::state::{ProjectSession, RemoteEntrySession, SessionStore, WSLEntrySession};
use anyhow::Result;
use chrono::Local;
use std::fs;
use std::path::{Path, PathBuf};

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

    pub fn get_config_dir(&self) -> &Path {
        &self.config_dir
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
            let _ = self.save_session(&session);
        }

        Ok(session)
    }

    pub fn create_session_from_projects(
        &self,
        projects: &[crate::state::Project],
        wsl_entries: Option<&[WSLEntrySession]>,
        remote_entries: Option<&[RemoteEntrySession]>,
        sidebar_width: Option<u32>,
        side_terminal_width: Option<u32>,
    ) -> SessionStore {
        let project_sessions = projects
            .iter()
            .map(|p| ProjectSession {
                id: p.id.clone(),
                name: p.name.clone(),
                path: p.path.clone(),
                selected_agent: p.selected_agent.clone(),
                selected_ide: p.selected_ide.clone(),
                terminal_history: p.terminal.history.clone(),
                last_status: p.terminal.status.clone(),
                collapsed: p.collapsed,
            })
            .collect();

        // None 表示"从已有 session 读取"，Some 表示"使用传入的数据"
        let existing = self.load_session().unwrap_or_else(|_| SessionStore::new());

        SessionStore {
            projects: project_sessions,
            active_project_id: None,
            last_updated: Local::now().to_rfc3339(),
            wsl_entries: wsl_entries
                .map(|v| v.to_vec())
                .unwrap_or(existing.wsl_entries),
            remote_entries: remote_entries
                .map(|v| v.to_vec())
                .unwrap_or(existing.remote_entries),
            sidebar_width: sidebar_width.or(existing.sidebar_width),
            side_terminal_width: side_terminal_width.or(existing.side_terminal_width),
        }
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
