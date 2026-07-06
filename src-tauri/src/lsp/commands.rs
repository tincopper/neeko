use serde_json::Value;
use tauri::State;

use crate::lsp::types::LspSessionInfo;
use crate::AppError;
use crate::AppStateWrapper;

#[tauri::command]
pub fn lsp_request(
    project_path: String,
    language_id: String,
    method: String,
    params: Value,
    state: State<AppStateWrapper>,
) -> Result<Value, AppError> {
    state
        .lsp_manager
        .get_or_create_session(&project_path, &language_id)?;

    // Ensure the document is known by the server before sending a document request.
    if let Some(uri) = params.pointer("/textDocument/uri").and_then(|v| v.as_str()) {
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
            log::warn!(
                "[LSP] Could not read file for didOpen: {}",
                file_path
            );
        }
    } else {
        log::warn!(
            "[LSP] No textDocument/uri found in params for method={}",
            method
        );
    }

    state
        .lsp_manager
        .send_request(&project_path, &language_id, &method, params)
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

    state.lsp_manager.register_open_document(
        &project_path,
        &language_id,
        &uri,
        &text,
        version,
    );

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
    state.lsp_manager.unregister_open_document(
        &project_path,
        &language_id,
        &uri,
    );

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
