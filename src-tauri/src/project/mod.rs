pub mod commands;
pub mod commands_ide;
pub mod types;

pub use commands_ide::*;

use crate::git;
use crate::project::types::Project;
use crate::project::types::ViewMode;
use crate::terminal::types::{TerminalSession, TerminalStatus};
use anyhow::Result;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Clone)]
pub struct ProjectManager {
    projects: Vec<Project>,
}

impl ProjectManager {
    pub fn new() -> Self {
        Self {
            projects: Vec::new(),
        }
    }

    pub fn add_project(
        &mut self,
        path: PathBuf,
        agent_id: Option<String>,
        ide: Option<String>,
        avatar_color: Option<String>,
    ) -> Result<Project> {
        // 检查路径是否存在
        if !path.exists() {
            anyhow::bail!("Project path does not exist");
        }

        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let git_info = if git::is_git_repo(&path) {
            git::get_git_info(&path).ok()
        } else {
            None
        };

        let terminal_session = TerminalSession {
            id: Uuid::new_v4().to_string(),
            pid: None,
            status: TerminalStatus::Idle,
            history: Vec::new(),
            agent: None,
        };

        let project = Project {
            id: Uuid::new_v4().to_string(),
            name,
            path: path.clone(),
            git_info,
            terminal: terminal_session,
            selected_agent: agent_id,
            selected_ide: ide,
            active_view: ViewMode::Terminal,
            collapsed: true,
            avatar_color,
        };

        self.projects.push(project.clone());
        Ok(project)
    }

    pub fn add_project_from_session(
        &mut self,
        id: String,
        path: PathBuf,
        agent_id: Option<String>,
        ide: Option<String>,
        collapsed: bool,
        avatar_color: Option<String>,
    ) -> Result<Project> {
        if !path.exists() {
            anyhow::bail!("Project path does not exist: {}", path.display());
        }
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        // Skip git_info on startup - will be refreshed lazily via refresh_git_info command
        let terminal_session = TerminalSession {
            id: Uuid::new_v4().to_string(),
            pid: None,
            status: TerminalStatus::Idle,
            history: Vec::new(),
            agent: None,
        };
        let project = Project {
            id,
            name,
            path,
            git_info: None,
            terminal: terminal_session,
            selected_agent: agent_id,
            selected_ide: ide,
            active_view: ViewMode::Terminal,
            collapsed,
            avatar_color,
        };
        self.projects.push(project.clone());
        Ok(project)
    }

    pub fn set_selected_ide(&mut self, project_id: &str, ide: Option<String>) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.selected_ide = ide;
        }
    }

    pub fn rename_project(&mut self, project_id: &str, new_name: &str) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.name = new_name.to_string();
        }
    }

    pub fn change_path(&mut self, project_id: &str, new_path: &str) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.path = PathBuf::from(new_path);
            project.git_info = None;
        }
    }

    pub fn remove_project(&mut self, project_id: &str) {
        self.projects.retain(|p| p.id != project_id);
    }

    pub fn get_project(&self, project_id: &str) -> Option<&Project> {
        self.projects.iter().find(|p| p.id == project_id)
    }

    pub fn list_projects(&self) -> Vec<Project> {
        // 返回轻量版项目数据，changed_files 置空
        // changed_files 由 watcher/handleRefreshGit 维护，不需要在 list_projects 中返回
        self.projects
            .iter()
            .map(|p| {
                let mut project = p.clone();
                if let Some(ref mut git_info) = project.git_info {
                    git_info.changed_files.clear();
                }
                project
            })
            .collect()
    }

    pub fn refresh_git_info(&mut self, project_id: &str) -> Result<()> {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            if git::is_git_repo(&project.path) {
                project.git_info = git::get_git_info(&project.path).ok();
            }
        }
        Ok(())
    }

    pub fn set_active_view(&mut self, project_id: &str, view: ViewMode) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.active_view = view;
        }
    }

    pub fn set_selected_agent(&mut self, project_id: &str, agent_id: Option<String>) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.selected_agent = agent_id;
        }
    }

    pub fn set_view_terminal(&mut self, project_id: &str) {
        self.set_active_view(project_id, ViewMode::Terminal);
    }

    pub fn set_view_diff(&mut self, project_id: &str, file_path: PathBuf) {
        self.set_active_view(project_id, ViewMode::Diff { file_path });
    }

    pub fn set_collapsed(&mut self, project_id: &str, collapsed: bool) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.collapsed = collapsed;
        }
    }

    pub fn set_avatar_color(&mut self, project_id: &str, color: Option<String>) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.avatar_color = color;
        }
    }

    /// Reorder projects based on a list of project IDs in the desired order.
    /// Projects not in the list will be appended at the end.
    pub fn reorder_projects(&mut self, ordered_ids: &[String]) {
        let mut ordered: Vec<Project> = Vec::with_capacity(self.projects.len());
        for id in ordered_ids {
            if let Some(pos) = self.projects.iter().position(|p| p.id == *id) {
                ordered.push(self.projects.remove(pos));
            }
        }
        // Append any projects that weren't in the ordered list
        ordered.append(&mut self.projects);
        self.projects = ordered;
    }
}
