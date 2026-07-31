//! Auto-install language servers in a project [`ExecTarget`].

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};

use serde::Serialize;
use tauri::Emitter;

use crate::common::executor::factory::ExecTarget;
use crate::lsp::plugin::LspPlugin;
use crate::lsp::process::run_command_blocking;

/// Track in-progress installs to avoid concurrent attempts per language.
static INSTALL_IN_PROGRESS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));
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
#[must_use]
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
#[must_use]
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
        let mut in_progress = INSTALL_IN_PROGRESS.lock().map_err(|e| {
            log::warn!("[LSP] Install lock poisoned: {}", e);
            e.to_string()
        })?;
        if in_progress.contains(language_id) {
            log::info!("[LSP] Install already in progress for: {}", language_id);
            return Err("Install already in progress".to_string());
        }
        in_progress.insert(language_id.to_string());
    }

    let result = install_plugin_server_impl(plugin, app_handle, target);

    {
        let mut in_progress = INSTALL_IN_PROGRESS.lock().map_err(|e| {
            log::warn!("[LSP] Install lock poisoned: {}", e);
            e.to_string()
        })?;
        in_progress.remove(language_id);
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

    let (code, stdout, stderr) =
        run_command_blocking(target, install.prerequisite, install.command)
            .map_err(|e| format!("Install command failed: {}", e))?;

    if code != 0 {
        let msg = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        emit_progress(
            app_handle,
            language_id,
            "error",
            &format!("Install failed: {}", msg),
        );
        return Err(format!("Install failed with code {}: {}", code, msg));
    }

    emit_progress(
        app_handle,
        language_id,
        "done",
        &format!("{} installed", bin),
    );
    Ok(true)
}
