//! Load and expand `.neeko/launch.json` and `.neeko/breakpoints.json`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::types::{BreakpointSpec, LaunchConfig, LaunchFile};
use crate::AppError;

/// Path to launch config under a project root.
pub fn launch_json_path(project_path: &Path) -> PathBuf {
    project_path.join(".neeko").join("launch.json")
}

/// Path to persisted breakpoints under a project root.
pub fn breakpoints_json_path(project_path: &Path) -> PathBuf {
    project_path.join(".neeko").join("breakpoints.json")
}

/// On-disk breakpoints file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BreakpointsFile {
    #[serde(default = "default_bp_version")]
    pub version: String,
    #[serde(default)]
    pub breakpoints: Vec<BreakpointSpec>,
}

fn default_bp_version() -> String {
    "0.1.0".into()
}

/// Load breakpoints; missing file → empty list.
pub fn load_breakpoints_file(project_path: &Path) -> Result<Vec<BreakpointSpec>, AppError> {
    let path = breakpoints_json_path(project_path);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| {
        AppError::Dap(format!("Failed to read {}: {e}", path.display()))
    })?;
    let file: BreakpointsFile = serde_json::from_str(&text).map_err(|e| {
        AppError::Dap(format!("Invalid breakpoints.json at {}: {e}", path.display()))
    })?;
    Ok(file.breakpoints)
}

/// Persist breakpoints (creates `.neeko/` if needed).
pub fn save_breakpoints_file(
    project_path: &Path,
    breakpoints: &[BreakpointSpec],
) -> Result<(), AppError> {
    let dir = project_path.join(".neeko");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Io(e.to_string()))?;
    let path = breakpoints_json_path(project_path);
    let file = BreakpointsFile {
        version: default_bp_version(),
        breakpoints: breakpoints.to_vec(),
    };
    let text = serde_json::to_string_pretty(&file).map_err(|e| AppError::Dap(e.to_string()))?;
    std::fs::write(&path, text).map_err(|e| AppError::Io(e.to_string()))
}

/// Read launch file; missing file → empty config list (not an error).
pub fn load_launch_file(project_path: &Path) -> Result<LaunchFile, AppError> {
    let path = launch_json_path(project_path);
    if !path.exists() {
        return Ok(LaunchFile::default());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| {
        AppError::Dap(format!("Failed to read {}: {e}", path.display()))
    })?;
    serde_json::from_str(&text).map_err(|e| {
        AppError::Dap(format!("Invalid launch.json at {}: {e}", path.display()))
    })
}

/// Write launch file (creates `.neeko/` if needed).
pub fn save_launch_file(project_path: &Path, file: &LaunchFile) -> Result<(), AppError> {
    let dir = project_path.join(".neeko");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Io(e.to_string()))?;
    let path = launch_json_path(project_path);
    let text = serde_json::to_string_pretty(file).map_err(|e| AppError::Dap(e.to_string()))?;
    std::fs::write(&path, text).map_err(|e| AppError::Io(e.to_string()))
}

/// Expand `${workspaceFolder}` style placeholders.
pub fn expand_variables(
    s: &str,
    workspace: &Path,
    current_file: Option<&str>,
) -> String {
    let ws = workspace.to_string_lossy();
    let basename = workspace
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project");
    let mut out = s
        .replace("${workspaceFolder}", &ws)
        .replace("${workspaceRoot}", &ws)
        .replace("${workspaceFolderBasename}", basename);

    if let Some(file) = current_file {
        let file_path = Path::new(file);
        let file_base = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(file);
        let no_ext = file_path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or(file_base);
        let file_dir = file_path
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| ws.to_string());
        out = out
            .replace("${file}", file)
            .replace("${fileBasename}", file_base)
            .replace("${fileBasenameNoExtension}", no_ext)
            .replace("${fileDirname}", &file_dir);
    }
    out
}

/// Expand all string fields in a launch config.
pub fn expand_config(
    cfg: &LaunchConfig,
    workspace: &Path,
    current_file: Option<&str>,
) -> LaunchConfig {
    let expand = |s: &str| expand_variables(s, workspace, current_file);
    LaunchConfig {
        name: cfg.name.clone(),
        type_: cfg.type_.clone(),
        request: cfg.request.clone(),
        program: cfg.program.as_ref().map(|p| expand(p)),
        cwd: cfg.cwd.as_ref().map(|p| expand(p)),
        args: cfg.args.iter().map(|a| expand(a)).collect(),
        mode: cfg.mode.clone(),
        pre_launch_task: cfg.pre_launch_task.as_ref().map(|p| expand(p)),
        stop_on_entry: cfg.stop_on_entry,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn should_expand_workspace_folder() {
        let ws = PathBuf::from("/proj/neeko");
        assert_eq!(
            expand_variables("${workspaceFolder}/target/debug/app", &ws, None),
            "/proj/neeko/target/debug/app"
        );
        assert_eq!(
            expand_variables("${workspaceFolderBasename}", &ws, None),
            "neeko"
        );
    }

    #[test]
    fn should_expand_file_placeholders() {
        let ws = PathBuf::from("/proj");
        let r = expand_variables(
            "${fileBasenameNoExtension}",
            &ws,
            Some("/proj/src/main.rs"),
        );
        assert_eq!(r, "main");
        assert_eq!(
            expand_variables("${fileDirname}", &ws, Some("/proj/cmd/agent/main.go")),
            "/proj/cmd/agent"
        );
    }
}
