use std::sync::Mutex;

use crate::common::utils::command::local::cmd_from_path;

use serde::Serialize;
use tauri::Emitter;

/// Language server binary name for each language.
fn server_binary(language_id: &str) -> Option<&'static str> {
    match language_id {
        "rust" => Some("rust-analyzer"),
        "go" => Some("gopls"),
        "typescript" | "javascript" => Some("typescript-language-server"),
        "python" => Some("pyright-langserver"),
        "java" => Some("jdtls"),
        _ => None,
    }
}

/// Install command for each language.
/// Returns (prerequisite_tool, install_command_and_args).
fn install_command(language_id: &str) -> Option<(&'static str, &'static [&'static str])> {
    match language_id {
        "rust" => Some(("rustup", &["rustup", "component", "add", "rust-analyzer"])),
        "go" => Some(("go", &["go", "install", "golang.org/x/tools/gopls@latest"])),
        "typescript" | "javascript" => Some((
            "npm",
            &["npm", "install", "-g", "typescript-language-server"],
        )),
        "python" => Some(("npm", &["npm", "install", "-g", "pyright"])),
        "java" => Some(("npm", &["npm", "install", "-g", "@eclipse-wtp/jdtls"])),
        _ => None,
    }
}

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

/// Check whether the server binary for the given language ID exists on PATH.
pub fn check_server_installed(language_id: &str) -> bool {
    let binary = match server_binary(language_id) {
        Some(b) => b,
        None => {
            log::debug!(
                "[LSP][installer] No binary mapping for language={}",
                language_id
            );
            return false;
        }
    };
    let found = crate::common::utils::command::local::check_command_exists(binary);
    log::info!(
        "[LSP][installer] check_server_installed: language={} binary={} found={}",
        language_id,
        binary,
        found,
    );
    found
}

/// Try to auto-install the LSP server for the given language.
/// Returns Ok(true) if installed successfully, Ok(false) if auto-install is
/// not supported for this language, Err if installation was attempted but failed.
pub fn install_server(language_id: &str, app_handle: &tauri::AppHandle) -> Result<bool, String> {
    // Claim install lock; release on every exit path
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

    let result = install_server_impl(language_id, app_handle);

    // Release install lock
    {
        let mut in_progress = INSTALL_IN_PROGRESS.lock().expect("infallible");
        *in_progress = None;
    }

    result
}

fn install_server_impl(language_id: &str, app_handle: &tauri::AppHandle) -> Result<bool, String> {
    let bin = match server_binary(language_id) {
        Some(b) => b,
        None => return Ok(false),
    };

    let (prerequisite, cmd_and_args) = match install_command(language_id) {
        Some(c) => c,
        None => return Ok(false),
    };

    emit_progress(
        app_handle,
        language_id,
        "installing",
        &format!("Installing {}...", bin),
    );

    // Check prerequisite tool exists
    if !crate::common::utils::command::local::check_command_exists(prerequisite) {
        let msg = format!(
            "Cannot install {}: '{}' not found on PATH. Install it first.",
            bin, prerequisite
        );
        log::warn!("[LSP] {}", msg);
        emit_progress(app_handle, language_id, "error", &msg);
        return Err(msg);
    }

    log::info!("[LSP] Installing {} via: {:?}", bin, cmd_and_args);

    let result = cmd_from_path(cmd_and_args[0])
        .args(&cmd_and_args[1..])
        .output();

    match result {
        Ok(output) if output.status.success() => {
            let msg = format!("{} installed successfully", bin);
            log::info!("[LSP] {}", msg);
            emit_progress(app_handle, language_id, "done", &msg);
            Ok(true)
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let msg = format!("Failed to install {}: {}", bin, stderr);
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
