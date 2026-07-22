//! Persistent storage for sessions, configs, and VCS settings.

use crate::project::types::Project;
use crate::session::types::{ProjectSession, SessionStore};
use anyhow::Result;
use chrono::Local;
use std::fs;
use std::path::{Path, PathBuf};

/// Manages persistent storage for sessions, configs, and VCS settings.
#[derive(Clone)]
pub struct StorageManager {
    config_dir: PathBuf,
}

impl StorageManager {
    /// Creates a StorageManager with the default `~/.neeko` config directory.
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

    /// Creates a StorageManager with a custom config directory.
    pub fn with_dir(config_dir: PathBuf) -> Result<Self> {
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir)?;
        }
        Ok(Self { config_dir })
    }

    /// Returns the path to the config directory.
    pub fn get_config_dir(&self) -> &Path {
        &self.config_dir
    }

    /// Persists VCS settings for a project.
    pub fn save_vcs_settings(&self, project_id: &str, settings: &serde_json::Value) -> Result<()> {
        let file = self.config_dir.join(format!("vcs_{}.json", project_id));
        let json = serde_json::to_string_pretty(settings)?;
        fs::write(&file, json)?;
        Ok(())
    }

    /// Loads previously saved VCS settings for a project.
    pub fn load_vcs_settings(&self, project_id: &str) -> Result<serde_json::Value> {
        let file = self.config_dir.join(format!("vcs_{}.json", project_id));
        if file.exists() {
            let content = fs::read_to_string(&file)?;
            Ok(serde_json::from_str(&content)?)
        } else {
            Ok(serde_json::Value::Object(serde_json::Map::new()))
        }
    }

    /// Persists the full session store to disk.
    pub fn save_session(&self, session: &SessionStore) -> Result<()> {
        let session_file = self.config_dir.join("sessions.json");
        let mut session = session.clone();
        session.last_updated = Local::now().to_rfc3339();

        let json = serde_json::to_string_pretty(&session)?;
        fs::write(session_file, json)?;
        Ok(())
    }

    /// Loads the session store from disk, migrating old formats.
    pub fn load_session(&self) -> Result<SessionStore> {
        let session_file = self.config_dir.join("sessions.json");

        let mut session = if session_file.exists() {
            let json = fs::read_to_string(&session_file)?;
            serde_json::from_str::<SessionStore>(&json)?
        } else {
            SessionStore::new()
        };

        // 扁平化旧格式：wsl_entries / remote_entries → 统一的 projects 列表
        let had_old_format = !session.wsl_entries.is_empty() || !session.remote_entries.is_empty();
        session.flatten_old_format();

        // 迁移后立即保存统一格式
        if had_old_format {
            if let Err(e) = self.save_session(&session) {
                log::error!("Failed to save migrated session: {}", e);
            }
        }

        Ok(session)
    }

    /// Builds a SessionStore from the current project list.
    pub fn create_session_from_projects(
        &self,
        projects: &[Project],
        sidebar_width: Option<u32>,
    ) -> SessionStore {
        let project_sessions = projects
            .iter()
            .map(|p| ProjectSession {
                id: p.id.clone(),
                name: p.name.clone(),
                path: p.path.clone(),
                environment: p.environment.clone(),
                selected_agents: p.selected_agents.clone(),
                selected_ide: p.selected_ide.clone(),
                terminal_history: p.terminal.history.clone(),
                last_status: p.terminal.status.clone(),
                collapsed: p.collapsed,
                avatar_color: p.avatar_color.clone(),
                primary_language: p.primary_language.clone(),
            })
            .collect();

        SessionStore {
            projects: project_sessions,
            active_project_id: None,
            last_updated: Local::now().to_rfc3339(),
            wsl_entries: Vec::new(),
            remote_entries: Vec::new(),
            sidebar_width,
            worktree_state: std::collections::HashMap::new(),
        }
    }

    /// Persists user configuration to disk.
    pub fn save_config(&self, config: &serde_json::Value) -> Result<()> {
        let config_file = self.config_dir.join("config.json");
        let json = serde_json::to_string_pretty(config)?;
        fs::write(config_file, json)?;
        Ok(())
    }

    /// Loads previously saved user configuration.
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
