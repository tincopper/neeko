//! macOS IDE 启动:直接 spawn + LaunchServices 降级。

use crate::common::executor::factory::ExecTarget;
use crate::core::exec::{collect_blocking, spawn_detached};
use crate::AppError;
use anyhow::Result;

/// macOS IDE 启动:直接 spawn。
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

/// macOS IDE 启动(含 LaunchServices 降级):命令未找到时走 `open -a`。
pub fn launch_ide_with_fallback(
    exe: &str,
    extra_args: &[String],
    project_path: &str,
    mac_app_name: Option<&str>,
) -> Result<(), AppError> {
    let mut launch_args = extra_args.to_vec();
    launch_args.push(project_path.to_string());
    let arg_refs: Vec<&str> = launch_args.iter().map(String::as_str).collect();

    match spawn_detached(&ExecTarget::Local, exe, &arg_refs) {
        Ok(()) => Ok(()),
        Err(err) => {
            // macOS fallback：用户从 .dmg 装的 GUI 应用（GoLand/IntelliJ 等）
            // 没生成 Toolbox shell shim 时，裸命令不在 PATH。
            // 走 LaunchServices `open -a <app>` 按 app name 查找 /Applications/*.app。
            // 优先用前端传过来的 macAppName（CFBundleName），命中不到再 fallback 到裸命令名——
            // 后者只对 bundle name == command 的产品（GoLand/PyCharm/Zed 等）有效，
            // IntelliJ IDEA 这类 bundle name "IntelliJ IDEA" ≠ command "idea" 的产品必须走 macAppName。
            if matches!(&err, crate::common::executor::ExecError::Io(io) if io.kind() == std::io::ErrorKind::NotFound)
                && !exe.contains('/')
            {
                let target = mac_app_name.unwrap_or(exe);
                open_via_launch_services(target, extra_args, project_path)
            } else {
                Err(format!("Failed to launch '{}': {}", exe, err).into())
            }
        }
    }
}

fn open_via_launch_services(
    app_name: &str,
    extra_args: &[String],
    project_path: &str,
) -> Result<(), AppError> {
    let mut args: Vec<&str> = vec!["-a", app_name, project_path];
    if !extra_args.is_empty() {
        args.push("--args");
        for a in extra_args {
            args.push(a);
        }
    }
    let output = collect_blocking(&ExecTarget::Local, "open", &args).map_err(|e| {
        format!(
            "Failed to launch '{}' via LaunchServices: {}. Install the app under /Applications or set the IDE command to the full executable path in Settings.",
            app_name, e
        )
    })?;
    if output.exit_code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "LaunchServices could not find '{}': {}. Install the app under /Applications or set the IDE command to the full executable path in Settings.",
            app_name,
            if stderr.is_empty() { "no such application".to_string() } else { stderr }
        )
        .into());
    }
    Ok(())
}
