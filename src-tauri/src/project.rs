use crate::git;
use crate::state::{Project, TerminalSession, TerminalStatus, ViewMode};
use anyhow::Result;
use std::path::PathBuf;
use uuid::Uuid;

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
    ) -> Result<Project> {
        if !path.exists() {
            anyhow::bail!("Project path does not exist: {}", path.display());
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
            id,
            name,
            path,
            git_info,
            terminal: terminal_session,
            selected_agent: agent_id,
            selected_ide: ide,
            active_view: ViewMode::Terminal,
        };
        self.projects.push(project.clone());
        Ok(project)
    }

    pub fn set_selected_ide(&mut self, project_id: &str, ide: Option<String>) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.selected_ide = ide;
        }
    }

    pub fn remove_project(&mut self, project_id: &str) {
        self.projects.retain(|p| p.id != project_id);
    }

    pub fn get_project(&self, project_id: &str) -> Option<&Project> {
        self.projects.iter().find(|p| p.id == project_id)
    }

    pub fn get_project_mut(&mut self, project_id: &str) -> Option<&mut Project> {
        self.projects.iter_mut().find(|p| p.id == project_id)
    }

    pub fn list_projects(&self) -> Vec<Project> {
        self.projects.clone()
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

    pub fn update_terminal_status(&mut self, project_id: &str, status: TerminalStatus) {
        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.terminal.status = status;
        }
    }

    pub fn set_view_terminal(&mut self, project_id: &str) {
        self.set_active_view(project_id, ViewMode::Terminal);
    }

    pub fn set_view_diff(&mut self, project_id: &str, file_path: PathBuf) {
        self.set_active_view(project_id, ViewMode::Diff { file_path });
    }
}
