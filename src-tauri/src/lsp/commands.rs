use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::lsp::symbol::UnifiedLocation;
use crate::lsp::types::LspSessionInfo;
use crate::AppError;
use crate::AppStateWrapper;

/// Run blocking session-creation work on Tauri's async blocking thread pool
/// so it never occupies a tokio worker thread.
async fn ensure_session_async(
    manager: Arc<crate::lsp::LspManager>,
    project_path: &str,
    language_id: &str,
) -> Result<(), AppError> {
    let pp = project_path.to_string();
    let lid = language_id.to_string();
    tokio::task::spawn_blocking(move || manager.get_or_create_session(&pp, &lid))
        .await
        .map_err(|e| AppError::Lsp(format!("spawn_blocking join error: {}", e)))?
        .map(|_| ())
}

// ═══════════════════════════════════════════════════════════════════════
// Core LSP commands
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lsp_request(
    project_path: String,
    language_id: String,
    method: String,
    params: Value,
    state: State<'_, AppStateWrapper>,
) -> Result<Value, AppError> {
    ensure_session_async(Arc::clone(&state.lsp_manager), &project_path, &language_id).await?;

    // Ensure the document is known by the server before sending a document request.
    if let Some(uri) = params.pointer("/textDocument/uri").and_then(|v| v.as_str()) {
        if !state
            .lsp_manager
            .is_document_open(&project_path, &language_id, uri)
        {
            let file_path = uri.trim_start_matches("file://");
            log::debug!(
                "[LSP] Auto-opening document for {}: uri={}, file_path={}",
                method,
                uri,
                file_path
            );
            if let Ok(text) = std::fs::read_to_string(file_path) {
                let open_params = serde_json::json!({
                    "textDocument": {
                        "uri": uri,
                        "languageId": &language_id,
                        "version": 1,
                        "text": text,
                    }
                });
                let _ = state.lsp_manager.send_notification(
                    &project_path,
                    &language_id,
                    "textDocument/didOpen",
                    open_params,
                );
            } else {
                log::warn!("[LSP] Could not read file for didOpen: {}", file_path);
            }
        }
    } else {
        log::warn!(
            "[LSP] No textDocument/uri found in params for method={}",
            method
        );
    }

    state
        .lsp_manager
        .send_request_async(&project_path, &language_id, &method, params)
        .await
}

#[tauri::command]
pub fn lsp_notification(
    project_path: String,
    language_id: String,
    method: String,
    params: Value,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .lsp_manager
        .get_or_create_session(&project_path, &language_id)?;
    state
        .lsp_manager
        .send_notification(&project_path, &language_id, &method, params)
}

#[tauri::command]
pub fn lsp_open_document(
    project_path: String,
    language_id: String,
    uri: String,
    text: String,
    version: i64,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .lsp_manager
        .get_or_create_session(&project_path, &language_id)?;

    state
        .lsp_manager
        .register_open_document(&project_path, &language_id, &uri, &text, version);

    let params = serde_json::json!({
        "textDocument": {
            "uri": uri,
            "languageId": language_id,
            "version": version,
            "text": text,
        }
    });

    state
        .lsp_manager
        .send_notification(&project_path, &language_id, "textDocument/didOpen", params)
}

#[tauri::command]
pub fn lsp_change_document(
    project_path: String,
    language_id: String,
    uri: String,
    version: i64,
    changes: Value,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let params = serde_json::json!({
        "textDocument": {
            "uri": uri,
            "version": version,
        },
        "contentChanges": changes,
    });

    state.lsp_manager.send_notification(
        &project_path,
        &language_id,
        "textDocument/didChange",
        params,
    )
}

#[tauri::command]
pub fn lsp_close_document(
    project_path: String,
    language_id: String,
    uri: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .lsp_manager
        .unregister_open_document(&project_path, &language_id, &uri);

    let params = serde_json::json!({
        "textDocument": {
            "uri": uri,
        }
    });

    state.lsp_manager.send_notification(
        &project_path,
        &language_id,
        "textDocument/didClose",
        params,
    )
}

#[tauri::command]
pub fn lsp_close_session(
    project_path: String,
    language_id: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state.lsp_manager.close_session(&project_path, &language_id)
}

#[tauri::command]
pub fn lsp_list_sessions(state: State<AppStateWrapper>) -> Result<Vec<LspSessionInfo>, AppError> {
    Ok(state.lsp_manager.list_sessions())
}

// ═══════════════════════════════════════════════════════════════════════
// JSON-RPC Transport Proxy (for @codemirror/lsp-client)
// ═══════════════════════════════════════════════════════════════════════

/// Raw JSON-RPC transport proxy.
///
/// Receives a JSON-RPC message string from the frontend
/// (via @codemirror/lsp-client), routes it to the LSP server,
/// and returns the raw JSON-RPC response string.
///
/// Special handling:
/// - `initialize`: returns cached capabilities (already negotiated by Rust)
/// - `initialized`: acknowledged without forwarding (already sent by Rust)
/// - All other requests/notifications: forwarded to LSP server
#[tauri::command]
pub async fn lsp_transport(
    project_path: String,
    language_id: String,
    message: String,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    let parsed: Value = serde_json::from_str(&message)
        .map_err(|e| AppError::Lsp(format!("Invalid JSON-RPC: {}", e)))?;

    let method = parsed["method"]
        .as_str()
        .ok_or_else(|| AppError::Lsp("Missing method in JSON-RPC message".into()))?;
    let params = parsed.get("params").cloned().unwrap_or(Value::Null);
    let id = parsed.get("id").cloned();

    // Ensure session exists (handles LSP process spawn + Rust-side init handshake)
    ensure_session_async(Arc::clone(&state.lsp_manager), &project_path, &language_id).await?;

    // ── initialize: return cached capabilities ─────────────────────────
    if method == "initialize" {
        let caps = state
            .lsp_manager
            .get_capabilities(&project_path, &language_id)
            .unwrap_or_else(|| serde_json::json!({}));
        return Ok(serde_json::to_string(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": caps,
        }))
        .unwrap());
    }

    // ── initialized: already sent by Rust, no-op ──────────────────────
    if method == "initialized" {
        return Ok(serde_json::to_string(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {},
        }))
        .unwrap());
    }

    // ── shutdown / exit: handled gracefully ──────────────────────────
    if method == "shutdown" {
        return Ok(serde_json::to_string(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": null,
        }))
        .unwrap());
    }

    // ── Request (has id): forward to LSP server, return response ─────
    if id.is_some() && !id.as_ref().map(|v| v.is_null()).unwrap_or(false) {
        let result = state
            .lsp_manager
            .send_request_async(&project_path, &language_id, method, params)
            .await?;
        return Ok(serde_json::to_string(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        }))
        .unwrap());
    }

    // ── Notification (no id): track document lifecycle, then forward ──
    match method {
        "textDocument/didOpen" => {
            if let (Some(uri), Some(text), Some(version)) = (
                params.pointer("/textDocument/uri").and_then(|v| v.as_str()),
                params
                    .pointer("/textDocument/text")
                    .and_then(|v| v.as_str()),
                params
                    .pointer("/textDocument/version")
                    .and_then(|v| v.as_i64()),
            ) {
                state.lsp_manager.register_open_document(
                    &project_path,
                    &language_id,
                    uri,
                    text,
                    version,
                );
            }
        }
        "textDocument/didClose" => {
            if let Some(uri) = params.pointer("/textDocument/uri").and_then(|v| v.as_str()) {
                state
                    .lsp_manager
                    .unregister_open_document(&project_path, &language_id, uri);
            }
        }
        _ => {}
    }

    state
        .lsp_manager
        .send_notification(&project_path, &language_id, method, params)?;
    Ok("{}".into())
}

/// Optimized go-to-definition: returns the LSP result plus preloaded target file content
/// so the frontend avoids a second `readFileContent` IPC round trip.
#[tauri::command]
pub async fn lsp_go_to_definition(
    project_path: String,
    language_id: String,
    uri: String,
    line: u32,
    character: u32,
    state: State<'_, AppStateWrapper>,
) -> Result<serde_json::Value, AppError> {
    let t0 = std::time::Instant::now();

    ensure_session_async(Arc::clone(&state.lsp_manager), &project_path, &language_id).await?;
    let t1 = t0.elapsed();
    log::info!("[perf] lsp_go_to_definition: session ready in {:?}", t1);

    // Auto-didOpen if the document is not yet registered
    if !state
        .lsp_manager
        .is_document_open(&project_path, &language_id, &uri)
    {
        let file_path = uri.trim_start_matches("file://");
        if let Ok(text) = std::fs::read_to_string(file_path) {
            let open_params = serde_json::json!({
                "textDocument": {
                    "uri": &uri,
                    "languageId": &language_id,
                    "version": 1,
                    "text": text,
                }
            });
            let _ = state.lsp_manager.send_notification(
                &project_path,
                &language_id,
                "textDocument/didOpen",
                open_params,
            );
        }
    }

    let params = serde_json::json!({
        "textDocument": { "uri": &uri },
        "position": { "line": line, "character": character },
    });

    let lsp_result = state
        .lsp_manager
        .send_request_async(
            &project_path,
            &language_id,
            "textDocument/definition",
            params,
        )
        .await?;
    let t2 = t0.elapsed();
    log::info!(
        "[perf] lsp_go_to_definition: LSP responded in {:?} (request took {:?})",
        t2,
        t2 - t1,
    );

    // Preload target file content using UnifiedLocation
    let file_content = UnifiedLocation::first_target_uri(&lsp_result).and_then(|target_uri| {
        let path = target_uri.trim_start_matches("file://");
        std::fs::read_to_string(path).ok()
    });
    let t3 = t0.elapsed();
    log::info!(
        "[perf] lsp_go_to_definition: total {:?} (file read {:?})",
        t3,
        t3 - t2,
    );

    Ok(serde_json::json!({
        "lspResult": lsp_result,
        "fileContent": file_content,
    }))
}
