//! Linux IDE 启动:直接 spawn(无 LaunchServices 降级)。

use crate::common::executor::factory::ExecTarget;
use crate::core::exec::spawn_detached;
use crate::AppError;
use anyhow::Result;

/// Linux IDE 启动:直接 spawn。
pub fn spawn_ide_process(exe: &str, args: &[String]) -> Result<()> {
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    spawn_detached(&ExecTarget::Local, exe, &arg_refs).map_err(|e| {
        anyhow::anyhow!(
            "Failed to launch '{}': {}. Make sure it's installed and in PATH.",
            exe,
            e
        )
    })?;
    Ok(())
}

/// Linux IDE 启动(无 LaunchServices 降级)。
pub fn launch_ide_with_fallback(
    exe: &str,
    extra_args: &[String],
    project_path: &str,
    _mac_app_name: Option<&str>,
) -> Result<(), AppError> {
    let mut launch_args = extra_args.to_vec();
    launch_args.push(project_path.to_string());
    let arg_refs: Vec<&str> = launch_args.iter().map(String::as_str).collect();

    spawn_detached(&ExecTarget::Local, exe, &arg_refs)
        .map_err(|e| format!("Failed to launch '{}': {}", exe, e).into())
}
