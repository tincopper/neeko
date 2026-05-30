use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A single task configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub scope: String, // "project" | "app"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
}

/// Container for storing task configs as JSON.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct TaskConfigFile {
    tasks: Vec<TaskConfig>,
}

/// Get the app-level tasks file path: ~/.neeko/tasks.json
fn app_tasks_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".neeko").join("tasks.json"))
}

/// Get the project-level tasks file path: <project_path>/.neeko/tasks.json
fn project_tasks_path(project_path: &str) -> PathBuf {
    PathBuf::from(project_path)
        .join(".neeko")
        .join("tasks.json")
}

/// Load tasks from a given JSON file path.
fn load_tasks_from_file(path: &PathBuf) -> Vec<TaskConfig> {
    match std::fs::read_to_string(path) {
        Ok(content) => serde_json::from_str::<TaskConfigFile>(&content)
            .map(|f| f.tasks)
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// Save tasks to a given JSON file path, creating parent dirs if needed.
fn save_tasks_to_file(path: &PathBuf, tasks: &[TaskConfig]) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = TaskConfigFile {
        tasks: tasks.to_vec(),
    };
    let json = serde_json::to_string_pretty(&file).map_err(std::io::Error::other)?;
    std::fs::write(path, json)
}

/// Get all task configs (app-level + project-level).
pub fn get_all_task_configs(project_path: Option<&str>) -> Vec<TaskConfig> {
    let mut tasks = Vec::new();

    // Load app-level tasks
    if let Some(app_path) = app_tasks_path() {
        tasks.extend(load_tasks_from_file(&app_path));
    }

    // Load project-level tasks
    if let Some(pp) = project_path {
        let proj_path = project_tasks_path(pp);
        tasks.extend(load_tasks_from_file(&proj_path));
    }

    tasks
}

/// Save a task config to the appropriate file.
pub fn save_task(config: &TaskConfig, project_path: Option<&str>) -> Result<(), std::io::Error> {
    let file_path = if config.scope == "project" {
        let pp = project_path.ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "project_path required for project-scope tasks",
            )
        })?;
        project_tasks_path(pp)
    } else {
        app_tasks_path().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Cannot determine home directory",
            )
        })?
    };

    let mut tasks = load_tasks_from_file(&file_path);

    // Update if exists, otherwise push
    if let Some(existing) = tasks.iter_mut().find(|t| t.id == config.id) {
        *existing = config.clone();
    } else {
        tasks.push(config.clone());
    }

    save_tasks_to_file(&file_path, &tasks)
}

/// Delete a task config by id from the appropriate file.
pub fn delete_task(
    id: &str,
    scope: &str,
    project_path: Option<&str>,
) -> Result<(), std::io::Error> {
    let file_path = if scope == "project" {
        let pp = project_path.ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "project_path required for project-scope tasks",
            )
        })?;
        project_tasks_path(pp)
    } else {
        app_tasks_path().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Cannot determine home directory",
            )
        })?
    };

    let mut tasks = load_tasks_from_file(&file_path);
    tasks.retain(|t| t.id != id);
    save_tasks_to_file(&file_path, &tasks)
}
