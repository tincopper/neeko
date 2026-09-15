//! Load and expand `.neeko/launch.json` and `.neeko/breakpoints.json`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::types::{BreakpointSpec, LaunchConfig, LaunchFile};
use crate::AppError;

/// Path to launch config under a project root.
#[must_use]
pub fn launch_json_path(project_path: &Path) -> PathBuf {
    project_path.join(".neeko").join("launch.json")
}

/// Path to persisted breakpoints under a project root.
#[must_use]
pub fn breakpoints_json_path(project_path: &Path) -> PathBuf {
    project_path.join(".neeko").join("breakpoints.json")
}

/// On-disk breakpoints file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BreakpointsFile {
    /// Breakpoints file format version.
    #[serde(default = "default_bp_version")]
    pub version: String,
    /// Persisted breakpoint list.
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
    let text = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Dap(format!("Failed to read {}: {e}", path.display())))?;
    let file: BreakpointsFile = serde_json::from_str(&text).map_err(|e| {
        AppError::Dap(format!(
            "Invalid breakpoints.json at {}: {e}",
            path.display()
        ))
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
    let text = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Dap(format!("Failed to read {}: {e}", path.display())))?;
    serde_json::from_str(&text)
        .map_err(|e| AppError::Dap(format!("Invalid launch.json at {}: {e}", path.display())))
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
#[must_use]
pub fn expand_variables(s: &str, workspace: &Path, current_file: Option<&str>) -> String {
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
///
/// 只列出**需要变量展开**的字段；其余字段经 struct-update 原样保留 —— 新增字段
/// 不会再因"忘加一行拷贝"而在到达适配器前丢值（历史上漏传 main_class 直接报
/// `Java launch requires "mainClass"`）。
#[must_use]
pub fn expand_config(
    cfg: &LaunchConfig,
    workspace: &Path,
    current_file: Option<&str>,
) -> LaunchConfig {
    let expand = |s: &str| expand_variables(s, workspace, current_file);
    LaunchConfig {
        program: cfg.program.as_ref().map(|p| expand(p)),
        cwd: cfg.cwd.as_ref().map(|p| expand(p)),
        args: cfg.args.iter().map(|a| expand(a)).collect(),
        pre_launch_task: cfg.pre_launch_task.as_ref().map(|p| expand(p)),
        ..cfg.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// **回归**：`expand_config` 经 struct-update 保留未展开字段 —— Java 传输字段
    /// （`main_class` / `project_name` / `module_paths`）必须一起传播。
    ///
    /// 曾经的 bug：逐字段拷贝时把它们写成 `None`/空，于是 B' 的 launch 载荷在
    /// `expand_config` 处丢掉 `mainClass`，适配器报 `Java launch requires "mainClass"`
    /// （现场即此错）。现实现只列需展开字段 + `..cfg.clone()`，漏传在结构上不可能。
    #[test]
    fn expand_config_propagates_java_transport_fields() {
        let cfg = super::super::types::LaunchConfig {
            name: "Debug test: testAdd".into(),
            type_: "java".into(),
            request: "launch".into(),
            program: None,
            cwd: Some("${workspaceFolder}".into()),
            args: vec!["-m".into(), "com.example.CalcTest#testAdd".into()],
            mode: None,
            port: None,
            pre_launch_task: None,
            stop_on_entry: Some(false),
            classpath: vec!["/abs/target/test-classes".into()],
            main_class: Some("org.junit.platform.console.ConsoleLauncher".into()),
            project_name: Some("s0-demo".into()),
            module_paths: vec!["/abs/target/classes".into()],
        };
        let ws = PathBuf::from("/proj");
        let out = expand_config(&cfg, &ws, None);

        assert_eq!(
            out.main_class.as_deref(),
            Some("org.junit.platform.console.ConsoleLauncher"),
            "main_class 必须在展开后保留（否则 launch 载荷报 requires mainClass）"
        );
        assert_eq!(out.project_name.as_deref(), Some("s0-demo"));
        assert_eq!(out.module_paths, vec!["/abs/target/classes".to_string()]);
        // 路径类字段仍按既有语义展开。
        assert_eq!(out.cwd.as_deref(), Some("/proj"));
    }

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
        let r = expand_variables("${fileBasenameNoExtension}", &ws, Some("/proj/src/main.rs"));
        assert_eq!(r, "main");
        assert_eq!(
            expand_variables("${fileDirname}", &ws, Some("/proj/cmd/agent/main.go")),
            "/proj/cmd/agent"
        );
    }
}
