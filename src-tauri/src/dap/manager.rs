//! DAP session manager.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use super::config::{
    expand_config, load_breakpoints_file, load_launch_file, save_breakpoints_file, save_launch_file,
};
use super::discover::{discover_entries, entry_to_launch_config, EntryPoint};
use super::session::DapSession;
use super::types::{BreakpointSpec, DapSessionInfo, LaunchConfig, LaunchFile};
use crate::AppError;
use crate::AppStateWrapper;

pub struct DapManager {
    /// Active sessions by session_id.
    sessions: Mutex<HashMap<String, Arc<DapSession>>>,
    /// Breakpoints keyed by project_id → file → lines.
    breakpoints: Mutex<HashMap<String, HashMap<String, Vec<u32>>>>,
    /// Projects whose breakpoints were loaded from disk this process.
    bp_loaded: Mutex<HashSet<String>>,
}

impl Default for DapManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DapManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            breakpoints: Mutex::new(HashMap::new()),
            bp_loaded: Mutex::new(HashSet::new()),
        }
    }

    pub fn list_configs(
        state: &AppStateWrapper,
        project_id: &str,
    ) -> Result<Vec<LaunchConfig>, AppError> {
        let path = project_path(state, project_id)?;
        Ok(load_launch_file(&path)?.configurations)
    }

    /// List configs; if empty, discover entry points and auto-write launch.json.
    pub fn list_or_discover_configs(
        state: &AppStateWrapper,
        project_id: &str,
    ) -> Result<Vec<LaunchConfig>, AppError> {
        let path = project_path(state, project_id)?;
        let existing = load_launch_file(&path)?.configurations;
        if !existing.is_empty() {
            return Ok(existing);
        }
        let entries = discover_entries(&path);
        if entries.is_empty() {
            return Ok(Vec::new());
        }
        let configurations: Vec<LaunchConfig> =
            entries.iter().map(entry_to_launch_config).collect();
        let file = LaunchFile {
            version: "0.1.0".into(),
            configurations: configurations.clone(),
        };
        // Best-effort persist so next open keeps them.
        let _ = save_launch_file(&path, &file);
        Ok(configurations)
    }

    pub fn save_configs(
        state: &AppStateWrapper,
        project_id: &str,
        configurations: Vec<LaunchConfig>,
    ) -> Result<(), AppError> {
        let path = project_path(state, project_id)?;
        let file = LaunchFile {
            version: "0.1.0".into(),
            configurations,
        };
        save_launch_file(&path, &file)
    }

    pub fn discover_entries(
        state: &AppStateWrapper,
        project_id: &str,
    ) -> Result<Vec<EntryPoint>, AppError> {
        let path = project_path(state, project_id)?;
        Ok(discover_entries(&path))
    }

    /// Ensure disk breakpoints are in memory for this project.
    async fn ensure_breakpoints_loaded(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
    ) -> Result<(), AppError> {
        {
            let loaded = self.bp_loaded.lock().await;
            if loaded.contains(project_id) {
                return Ok(());
            }
        }
        let path = project_path(state, project_id)?;
        let list = load_breakpoints_file(&path).unwrap_or_default();
        {
            let mut map = self.breakpoints.lock().await;
            let project = map.entry(project_id.to_string()).or_default();
            for b in list {
                project
                    .entry(b.file_path)
                    .or_default()
                    .push(b.line);
            }
            for lines in project.values_mut() {
                lines.sort_unstable();
                lines.dedup();
            }
        }
        self.bp_loaded.lock().await.insert(project_id.to_string());
        Ok(())
    }

    async fn persist_breakpoints(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
    ) -> Result<(), AppError> {
        let path = project_path(state, project_id)?;
        let list = self.get_breakpoints_memory(project_id).await;
        save_breakpoints_file(&path, &list)
    }

    async fn get_breakpoints_memory(&self, project_id: &str) -> Vec<BreakpointSpec> {
        let map = self.breakpoints.lock().await;
        let Some(project) = map.get(project_id) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for (file, lines) in project {
            for line in lines {
                out.push(BreakpointSpec {
                    file_path: file.clone(),
                    line: *line,
                    verified: false,
                });
            }
        }
        out.sort_by(|a, b| {
            a.file_path
                .cmp(&b.file_path)
                .then(a.line.cmp(&b.line))
        });
        out
    }

    pub async fn set_breakpoints(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
        file_path: &str,
        lines: Vec<u32>,
        active_session_id: Option<&str>,
    ) -> Result<Vec<BreakpointSpec>, AppError> {
        self.ensure_breakpoints_loaded(state, project_id).await?;
        {
            let mut map = self.breakpoints.lock().await;
            let project = map.entry(project_id.to_string()).or_default();
            if lines.is_empty() {
                project.remove(file_path);
            } else {
                project.insert(file_path.to_string(), lines.clone());
            }
        }
        // Persist even if adapter set fails — UI state is source of truth offline.
        if let Err(e) = self.persist_breakpoints(state, project_id).await {
            log::warn!("[DAP] failed to persist breakpoints: {e}");
        }

        if let Some(sid) = active_session_id {
            let session = {
                let sessions = self.sessions.lock().await;
                sessions.get(sid).cloned()
            };
            if let Some(session) = session {
                return session.set_breakpoints_for_file(file_path, &lines).await;
            }
        }

        Ok(lines
            .into_iter()
            .map(|line| BreakpointSpec {
                file_path: file_path.to_string(),
                line,
                verified: false,
            })
            .collect())
    }

    pub async fn get_breakpoints(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
    ) -> Result<Vec<BreakpointSpec>, AppError> {
        self.ensure_breakpoints_loaded(state, project_id).await?;
        Ok(self.get_breakpoints_memory(project_id).await)
    }

    pub async fn start_session(
        &self,
        state: &AppStateWrapper,
        app: tauri::AppHandle,
        project_id: &str,
        config_name: Option<String>,
        current_file: Option<String>,
    ) -> Result<DapSessionInfo, AppError> {
        // Stop existing session for this project
        self.stop_project_sessions(project_id).await;

        let path = project_path(state, project_id)?;
        let env = state.project_environment(project_id)?;
        let target = env.to_exec_target();

        // Prefer existing launch.json; if empty, discover and materialize.
        let mut file = load_launch_file(&path)?;
        if file.configurations.is_empty() {
            let entries = discover_entries(&path);
            if !entries.is_empty() {
                file.configurations = entries.iter().map(entry_to_launch_config).collect();
                let _ = save_launch_file(&path, &file);
            }
        }

        let raw = if let Some(name) = config_name {
            file.configurations
                .into_iter()
                .find(|c| c.name == name)
                .ok_or_else(|| AppError::NotFound(format!("Launch config not found: {name}")))?
        } else {
            // Prefer config matching current file's package if possible.
            let configs = file.configurations;
            pick_config_for_file(&configs, current_file.as_deref(), &path)
                .or_else(|| configs.into_iter().next())
                .ok_or_else(|| {
                    AppError::Dap(
                        "No launch configurations and no entry points found \
                         (expected Go cmd/*/main.go or Rust src/main.rs)."
                            .into(),
                    )
                })?
        };

        let config = expand_config(&raw, &path, current_file.as_deref());
        let bps = self.get_breakpoints(state, project_id).await?;

        let session = DapSession::start(
            app,
            project_id.to_string(),
            path.to_string_lossy().to_string(),
            target,
            config,
            bps,
        )
        .await?;

        let info = session.info().await;
        self.sessions
            .lock()
            .await
            .insert(session.session_id.clone(), session);
        Ok(info)
    }

    pub async fn stop_session(&self, session_id: &str) -> Result<(), AppError> {
        let session = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(session_id)
        };
        if let Some(s) = session {
            s.stop().await;
            Ok(())
        } else {
            Err(AppError::NotFound(format!("Session not found: {session_id}")))
        }
    }

    pub async fn stop_project_sessions(&self, project_id: &str) {
        let to_stop: Vec<Arc<DapSession>> = {
            let mut sessions = self.sessions.lock().await;
            let ids: Vec<String> = sessions
                .iter()
                .filter(|(_, s)| s.project_id == project_id)
                .map(|(id, _)| id.clone())
                .collect();
            ids.into_iter()
                .filter_map(|id| sessions.remove(&id))
                .collect()
        };
        for s in to_stop {
            s.stop().await;
        }
    }

    pub async fn get_session(&self, session_id: &str) -> Option<Arc<DapSession>> {
        self.sessions.lock().await.get(session_id).cloned()
    }

    pub async fn active_for_project(&self, project_id: &str) -> Option<DapSessionInfo> {
        let sessions = self.sessions.lock().await;
        for s in sessions.values() {
            if s.project_id == project_id {
                return Some(s.info().await);
            }
        }
        None
    }

    pub async fn list_sessions(&self) -> Vec<DapSessionInfo> {
        let sessions = self.sessions.lock().await;
        let mut out = Vec::new();
        for s in sessions.values() {
            out.push(s.info().await);
        }
        out
    }
}

/// Prefer a launch config whose program path is a parent of the current file.
fn pick_config_for_file(
    configs: &[LaunchConfig],
    current_file: Option<&str>,
    workspace: &std::path::Path,
) -> Option<LaunchConfig> {
    let file = current_file?;
    let file_path = std::path::Path::new(file);
    let mut best: Option<(usize, LaunchConfig)> = None;
    for cfg in configs {
        let Some(prog) = cfg.program.as_ref() else {
            continue;
        };
        let expanded = super::config::expand_variables(prog, workspace, current_file);
        let prog_path = std::path::Path::new(&expanded);
        if file_path.starts_with(prog_path) {
            let score = expanded.len();
            if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                best = Some((score, cfg.clone()));
            }
        }
    }
    best.map(|(_, c)| c)
}

fn project_path(state: &AppStateWrapper, project_id: &str) -> Result<PathBuf, AppError> {
    let pm = state.project_manager.lock().map_err(AppError::from)?;
    let project = pm
        .get_project(project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {project_id}")))?;
    Ok(project.path.clone())
}
