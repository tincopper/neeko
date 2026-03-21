use crate::state::{ProjectSession, SessionStore};
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

        if !session_file.exists() {
            return Ok(SessionStore::new());
        }

        let json = fs::read_to_string(session_file)?;
        let session: SessionStore = serde_json::from_str(&json)?;
        Ok(session)
    }

    pub fn create_session_from_projects(&self, projects: &[crate::state::Project]) -> SessionStore {
        let project_sessions = projects
            .iter()
            .map(|p| ProjectSession {
                id: p.id.clone(),
                name: p.name.clone(),
                path: p.path.clone(),
                selected_agent: p.selected_agent.clone(),
                terminal_history: p.terminal.history.clone(),
                last_status: p.terminal.status.clone(),
            })
            .collect();

        SessionStore {
            projects: project_sessions,
            active_project_id: None,
            last_updated: Local::now().to_rfc3339(),
        }
    }

    pub fn delete_session(&self) -> Result<()> {
        let session_file = self.config_dir.join("sessions.json");
        if session_file.exists() {
            fs::remove_file(session_file)?;
        }
        Ok(())
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
