//! Auto-install language servers in a project [`ExecTarget`].
//!
//! Binary names and install recipes come from [`LspPlugin`] — this module does
//! not maintain a second language → command map.

use std::sync::Mutex;

use serde::Serialize;
use tauri::Emitter;

use crate::common::executor::factory::ExecTarget;
use crate::lsp::plugin::LspPlugin;
use crate::lsp::process::run_command_blocking;

/// Track in-progress installs to avoid concurrent attempts.
static INSTALL_IN_PROGRESS: Mutex<Option<String>> = Mutex::new(None);

/// Progress event emitted to the frontend.
#[derive(Debug, Clone, Serialize)]
struct LspInstallProgress {
    language_id: String,
    phase: String,
    message: String,
}

fn emit_progress(app_handle: &tauri::AppHandle, language_id: &str, phase: &str, message: &str) {
    let payload = LspInstallProgress {
        language_id: language_id.to_string(),
        phase: phase.to_string(),
        message: message.to_string(),
    };
    if let Err(e) = app_handle.emit("lsp-install-progress", payload) {
        log::error!("[LSP] Failed to emit install progress: {}", e);
    }
}

/// Whether `binary` exists in the project execution environment.
pub fn check_binary_installed(binary: &str, target: &ExecTarget) -> bool {
    let found = crate::core::exec::command_exists_blocking(target, binary);
    log::info!(
        "[LSP][installer] check binary={} target={:?} found={}",
        binary,
        std::mem::discriminant(target),
        found,
    );
    found
}

/// Check whether the plugin's language server binary exists on `target`.
pub fn check_plugin_installed(plugin: &LspPlugin, target: &ExecTarget) -> bool {
    if plugin.server_binary.is_empty() {
        return false;
    }
    check_binary_installed(&plugin.server_binary, target)
}

/// Try to auto-install the plugin's server **in the project's environment**.
///
/// Returns `Ok(true)` if install ran successfully, `Ok(false)` if the plugin
/// has no install recipe, `Err` on failure.
pub fn install_plugin_server(
    plugin: &LspPlugin,
    app_handle: &tauri::AppHandle,
    target: &ExecTarget,
) -> Result<bool, String> {
    let language_id = plugin.language_id.as_str();
    {
        let mut in_progress = INSTALL_IN_PROGRESS.lock().expect("infallible");
        if let Some(ref current) = *in_progress {
            if current == language_id {
                log::info!("[LSP] Install already in progress for: {}", language_id);
                return Err("Install already in progress".to_string());
            }
        }
        *in_progress = Some(language_id.to_string());
    }

    let result = install_plugin_server_impl(plugin, app_handle, target);

    {
        let mut in_progress = INSTALL_IN_PROGRESS.lock().expect("infallible");
        *in_progress = None;
    }

    result
}

fn install_plugin_server_impl(
    plugin: &LspPlugin,
    app_handle: &tauri::AppHandle,
    target: &ExecTarget,
) -> Result<bool, String> {
    let language_id = plugin.language_id.as_str();
    let bin = plugin.server_binary.as_str();
    if bin.is_empty() {
        return Ok(false);
    }

    let Some(install) = plugin.install.as_ref() else {
        return Ok(false);
    };

    emit_progress(
        app_handle,
        language_id,
        "installing",
        &format!("Installing {}...", bin),
    );

    if !crate::core::exec::command_exists_blocking(target, install.prerequisite) {
        let msg = format!(
            "Cannot install {}: '{}' not found on project PATH. Install it first.",
            bin, install.prerequisite
        );
        log::warn!("[LSP] {}", msg);
        emit_progress(app_handle, language_id, "error", &msg);
        return Err(msg);
    }

    let cmd_and_args = install.command;
    if cmd_and_args.is_empty() {
        return Ok(false);
    }

    log::info!(
        "[LSP] Installing {} via {:?} in project env: {:?}",
        bin,
        cmd_and_args,
        std::mem::discriminant(target)
    );

    let program = cmd_and_args[0];
    let args: Vec<&str> = cmd_and_args[1..].to_vec();
    match run_command_blocking(target, program, &args) {
        Ok((0, _, _)) => {
            let msg = format!("{} installed successfully", bin);
            log::info!("[LSP] {}", msg);
            emit_progress(app_handle, language_id, "done", &msg);
            Ok(true)
        }
        Ok((code, stdout, stderr)) => {
            let detail = if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else {
                stdout.trim().to_string()
            };
            let msg = format!("Failed to install {} (exit {}): {}", bin, code, detail);
            log::error!("[LSP] {}", msg);
            emit_progress(app_handle, language_id, "error", &msg);
            Err(msg)
        }
        Err(e) => {
            let msg = format!("Failed to run install command for {}: {}", bin, e);
            log::error!("[LSP] {}", msg);
            emit_progress(app_handle, language_id, "error", &msg);
            Err(msg)
        }
    }
}
