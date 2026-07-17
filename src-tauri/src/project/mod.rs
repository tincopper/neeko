pub mod commands;
pub mod commands_ide;
pub mod types;

pub use commands_ide::*;

use crate::common::terminal::types::{TerminalSession, TerminalStatus};
use crate::git;
use crate::project::types::{Project, ProjectEnvironment, ViewMode};
use crate::session::types::ProjectSession;
use anyhow::Result;
use std::path::PathBuf;
use uuid::Uuid;

pub struct ProjectManager {
    projects: Vec<Project>,
    persist: Box<dyn Fn(&[Project]) + Send>,
}

impl ProjectManager {
    pub fn new(persist: impl Fn(&[Project]) + Send + 'static) -> Self {
        Self {
            projects: Vec::new(),
            persist: Box::new(persist),
        }
    }

    fn notify_persist(&self) {
        (self.persist)(&self.projects);
    }

    pub fn add_project(
        &mut self,
        path: PathBuf,
        agent_id: Option<String>,
        ide: Option<String>,
        avatar_color: Option<String>,
    ) -> Result<Project> {
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
            environment: ProjectEnvironment::Local,
            git_info,
            terminal: terminal_session,
            selected_agent: agent_id,
            selected_ide: ide,
            active_view: ViewMode::Terminal,
            collapsed: true,
            avatar_color,
            primary_language: None,
        };

        self.projects.push(project.clone());
        self.notify_persist();
        Ok(project)
    }

    pub fn add_project_from_session(&mut self, session: &ProjectSession) -> Result<Project> {
        let name = session
            .path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| session.name.clone());

        // 只有 Local 项目需要检查路径是否存在
        if matches!(session.environment, ProjectEnvironment::Local) && !session.path.exists() {
            anyhow::bail!("Project path does not exist: {}", session.path.display());
        }

        let terminal_session = TerminalSession {
            id: Uuid::new_v4().to_string(),
            pid: None,
            status: TerminalStatus::Idle,
            history: session.terminal_history.clone(),
            agent: None,
        };
        let project = Project {
            id: session.id.clone(),
            name,
            path: session.path.clone(),
            environment: session.environment.clone(),
            git_info: None,
            terminal: terminal_session,
            selected_agent: session.selected_agent.clone(),
            selected_ide: session.selected_ide.clone(),
            active_view: ViewMode::Terminal,
            collapsed: session.collapsed,
            avatar_color: session.avatar_color.clone(),
            primary_language: session.primary_language.clone(),
        };
        self.projects.push(project.clone());
        Ok(project)
    }

    pub fn set_selected_ide(&mut self, project_id: &str, ide: Option<String>) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.selected_ide = ide;
        }
        self.notify_persist();
    }

    pub fn set_primary_language(&mut self, project_id: &str, language: Option<String>) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.primary_language = language.and_then(|s| {
                let t = s.trim().to_string();
                if t.is_empty() {
                    None
                } else {
                    Some(t)
                }
            });
        }
        self.notify_persist();
    }

    pub fn rename_project(&mut self, project_id: &str, new_name: &str) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.name = new_name.to_string();
        }
        self.notify_persist();
    }

    pub fn change_path(&mut self, project_id: &str, new_path: &str) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.path = PathBuf::from(new_path);
            project.git_info = None;
        }
        self.notify_persist();
    }

    pub fn remove_project(&mut self, project_id: &str) {
        self.projects.retain(|p| p.id != project_id);
        self.notify_persist();
    }

    pub fn get_project(&self, project_id: &str) -> Option<&Project> {
        self.projects.iter().find(|p| p.id == project_id)
    }

    pub fn list_projects(&self) -> Vec<Project> {
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

    pub fn set_selected_agent(&mut self, project_id: &str, agent_id: Option<String>) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.selected_agent = agent_id;
        }
        self.notify_persist();
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
        self.notify_persist();
    }

    pub fn set_avatar_color(&mut self, project_id: &str, color: Option<String>) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.avatar_color = color;
        }
        self.notify_persist();
    }

    pub fn reorder_projects(&mut self, ordered_ids: &[String]) {
        let mut ordered: Vec<Project> = Vec::with_capacity(self.projects.len());
        for id in ordered_ids {
            if let Some(pos) = self.projects.iter().position(|p| p.id == *id) {
                ordered.push(self.projects.remove(pos));
            }
        }
        ordered.append(&mut self.projects);
        self.projects = ordered;
        self.notify_persist();
    }

    fn set_active_view(&mut self, project_id: &str, view: ViewMode) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.active_view = view;
        }
    }
}
