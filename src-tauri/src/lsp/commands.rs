use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::lsp::symbol::UnifiedLocation;
use crate::lsp::types::{LspSessionInfo, MAX_AUTO_OPEN_FILE_SIZE};
use crate::AppError;
use crate::AppStateWrapper;

/// Extract the LSP `textDocument/uri` field from a request/notification params.
///
/// The same JSON pointer is read in several commands; centralising it keeps the
/// lookup string in one spot and makes future LSP-schema drift local.
fn text_document_uri(params: &serde_json::Value) -> Option<&str> {
    params.pointer("/textDocument/uri").and_then(|v| v.as_str())
}

/// Resolve project execution environment and record it on the LSP manager
/// before any session spawn / binary check.
fn bind_project_exec_target(state: &AppStateWrapper, project_path: &str) -> Result<(), AppError> {
    let env = state.environment_for_project_path(project_path)?;
    state
        .lsp_manager
        .set_project_exec_target(project_path, env.to_exec_target());
    Ok(())
}

/// Run blocking session-creation work on the business AppRuntime pool
/// so it never occupies a tokio worker thread (and is safe without a current Handle).
async fn ensure_session_async(
    state: &AppStateWrapper,
    project_path: &str,
    language_id: &str,
    document_uri: Option<&str>,
) -> Result<(), AppError> {
    bind_project_exec_target(state, project_path)?;
    let manager = Arc::clone(&state.lsp_manager);
    // Own the URI before entering `spawn_blocking` so the closure captures an
    // `Option<String>` directly — avoids an extra per-call `.to_string()` inside
    // the blocking closure and keeps the move list explicit.
    let doc = document_uri.map(str::to_string);
    let runtime = manager.runtime();
    let pp = project_path.to_string();
    let lid = language_id.to_string();
    runtime
        .spawn_blocking(move || manager.get_or_create_session(&pp, &lid, doc.as_deref()))
        .await
        .map_err(|e| AppError::Lsp(format!("spawn_blocking join error: {}", e)))?
        .map(|_| ())
}

/// Read a file on the OS blocking pool — async commands must never call
/// `std::fs` directly on a tokio worker thread.
///
// ═══════════════════════════════════════════════════════════════════════
// Core LSP commands
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
/// Send an LSP request asynchronously, auto-opening the document if needed.
pub async fn lsp_request(
    project_path: String,
    language_id: String,
    method: String,
    params: Value,
    state: State<'_, AppStateWrapper>,
) -> Result<Value, AppError> {
    // Auto-open the document if needed — resolve the URI first so a fresh
    // TypeScript session can be rooted at the document's own project.
    let doc_uri = text_document_uri(&params);
    ensure_session_async(&state, &project_path, &language_id, doc_uri).await?;

    // Ensure the document is known by the server before sending a document request.
    if let Some(uri) = doc_uri {
        if !state
            .lsp_manager
            .is_document_open(&project_path, &language_id, uri)
        {
            let file_path = uri.strip_prefix("file://").unwrap_or(uri);
            log::debug!(
                "[LSP] Auto-opening document for {}: uri={}, file_path={}",
                method,
                uri,
                file_path
            );
            if let Ok(text) = crate::common::file::reader::read_file(
                crate::common::file::reader::FileAccessScope::Trusted,
                crate::common::file::reader::FileReadRequest {
                    target: crate::common::executor::factory::ExecTarget::Local,
                    base: String::new(),
                    path: file_path.to_string(),
                    // didOpen 全文发送给 server，不设大小上限（与既有行为一致）
                    max_bytes: None,
                    detect_binary: false,
                },
            )
            .await
            {
                let text = text.content;
                if text.len() > MAX_AUTO_OPEN_FILE_SIZE {
                    log::warn!(
                        "[LSP] File too large for auto-open: {} ({} bytes)",
                        file_path,
                        text.len()
                    );
                } else {
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
                }
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
        .send_request_async(&project_path, &language_id, &method, params, false)
        .await
}

#[tauri::command]
/// Send an LSP notification, creating the session if needed.
pub async fn lsp_notification(
    project_path: String,
    language_id: String,
    method: String,
    params: Value,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let doc_uri = text_document_uri(&params);
    ensure_session_async(&state, &project_path, &language_id, doc_uri).await?;
    state
        .lsp_manager
        .send_notification(&project_path, &language_id, &method, params)
}

#[tauri::command]
/// Open a document in an LSP session.
pub fn lsp_open_document(
    project_path: String,
    language_id: String,
    uri: String,
    text: String,
    version: i64,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    bind_project_exec_target(&state, &project_path)?;
    state
        .lsp_manager
        .get_or_create_session(&project_path, &language_id, Some(&uri))?;

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
/// Send a didChange notification for an open document.
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
/// Close a document in an LSP session.
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
/// Close an LSP session.
pub fn lsp_close_session(
    project_path: String,
    language_id: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state.lsp_manager.close_session(&project_path, &language_id)
}

#[tauri::command]
/// List all active LSP sessions.
pub fn lsp_list_sessions(state: State<AppStateWrapper>) -> Result<Vec<LspSessionInfo>, AppError> {
    Ok(state.lsp_manager.list_sessions())
}

// ═══════════════════════════════════════════════════════════════════════
// LSP Session Lifecycle
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
/// Restart an LSP session for a project and language.
pub async fn lsp_restart_session(
    project_path: String,
    language_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<LspSessionInfo, AppError> {
    // Close existing session (sends shutdown + kills child)
    let _ = state.lsp_manager.close_session(&project_path, &language_id);

    bind_project_exec_target(&state, &project_path)?;
    // Re-create session (triggers lazy init + reopen docs on next request)
    let key = state
        .lsp_manager
        .get_or_create_session(&project_path, &language_id, None)?;

    let sessions = state.lsp_manager.list_sessions();
    sessions
        .into_iter()
        .find(|s| {
            let expected = format!("{}:{}", project_path, language_id);
            format!("{}:{}", s.project_path, s.language_id) == expected
        })
        .ok_or_else(|| AppError::Lsp(format!("Failed to restart session: {}", key)))
}

#[tauri::command]
/// Stop an LSP session.
pub fn lsp_stop_session(
    project_path: String,
    language_id: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state.lsp_manager.close_session(&project_path, &language_id)
}

#[tauri::command]
/// Runtime metadata for a session (version/commit/date + memory snapshot).
pub fn lsp_get_server_info(
    project_path: String,
    language_id: String,
    state: State<AppStateWrapper>,
) -> Result<crate::lsp::types::LspServerInfo, AppError> {
    state
        .lsp_manager
        .get_server_info(&project_path, &language_id)
}

#[tauri::command]
/// Recent stderr log lines for a session (for Console View Logs).
pub fn lsp_get_server_logs(
    project_path: String,
    language_id: String,
    limit: Option<usize>,
    state: State<AppStateWrapper>,
) -> Result<Vec<crate::lsp::types::LspServerLogEntry>, AppError> {
    state
        .lsp_manager
        .get_server_logs(&project_path, &language_id, limit)
}

#[tauri::command]
/// Stop every active LSP session for a project.
pub fn lsp_stop_all_sessions(
    project_path: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .lsp_manager
        .stop_all_sessions_for_project(&project_path);
    Ok(())
}

#[tauri::command]
/// Restart every active LSP session for a project.
pub async fn lsp_restart_all_sessions(
    project_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    bind_project_exec_target(&state, &project_path)?;
    let languages = state
        .lsp_manager
        .session_language_ids_for_project(&project_path);
    for language_id in languages {
        let _ = state.lsp_manager.close_session(&project_path, &language_id);
        ensure_session_async(&state, &project_path, &language_id, None).await?;
    }
    Ok(())
}

/// Detect project languages from root markers (no server spawn).
/// Uses the project's `primary_language` override when the path matches a known project.
#[tauri::command]
pub fn lsp_detect_project_profile(
    project_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<crate::lsp::ProjectLanguageProfile, AppError> {
    let env = state.environment_for_project_path(&project_path)?;
    let primary_override = state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .list_projects()
        .into_iter()
        .find(|p| p.path.to_string_lossy() == project_path)
        .and_then(|p| p.primary_language);
    state
        .lsp_manager
        .set_project_exec_target(&project_path, env.to_exec_target());
    Ok(state
        .lsp_manager
        .activate_project(&project_path, primary_override.as_deref()))
}

/// Soft-warm check: whether the language server binary is available in the
/// project's execution environment (Local / WSL / SSH). Does not spawn the server.
///
/// `project_path` resolves Local/WSL/SSH; when omitted, uses the active project.
#[tauri::command]
pub async fn lsp_check_server_installed(
    language_id: String,
    project_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<bool, AppError> {
    let env = match project_path.as_deref() {
        Some(path) => state.environment_for_project_path(path)?,
        None => state.active_project_environment()?,
    };
    let target = env.to_exec_target();
    if let Some(path) = project_path.as_deref() {
        state
            .lsp_manager
            .set_project_exec_target(path, target.clone());
    }
    // Resolve binary name from the live plugin registry (not a hard-coded map).
    let binary = state
        .lsp_manager
        .plugin_server_binary(&language_id)
        .ok_or_else(|| {
            AppError::Lsp(format!(
                "No LSP plugin registered for language: {language_id}"
            ))
        })?;
    // check_binary_installed 内部对 WSL/SSH 走同步命令执行（command_exists_blocking），
    // 必须放入 blocking 线程池，避免在 async driver 线程内构建 runtime 导致 panic。
    let target = target.clone();
    let binary = binary.to_string();
    crate::common::runtime::run_blocking(move || {
        Ok::<_, AppError>(crate::lsp::installer::check_binary_installed(
            &binary, &target,
        ))
    })
    .await?
}

/// Full extension → language map (built-in + custom) for the frontend router.
#[tauri::command]
pub fn lsp_get_extension_map(
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<crate::lsp::LspExtensionMapEntry>, AppError> {
    Ok(state.lsp_manager.extension_map())
}

/// Extensions claimed by more than one language server (winner = last registration).
#[tauri::command]
pub fn lsp_get_extension_conflicts(
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<crate::lsp::LspExtensionConflict>, AppError> {
    Ok(state.lsp_manager.extension_conflicts())
}

/// Apply LSP settings from the full app config (reads `config.lsp`).
#[tauri::command]
pub fn lsp_apply_settings(
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<crate::lsp::LspExtensionMapEntry>, AppError> {
    let config = state
        .storage_manager
        .load_config()
        .map_err(AppError::from)?;
    state.lsp_manager.apply_settings_from_json(&config);
    Ok(state.lsp_manager.extension_map())
}

/// Resolve language id for a file path using the live registry (custom first).
#[tauri::command]
#[must_use]
pub fn lsp_resolve_language(
    file_path: String,
    state: State<'_, AppStateWrapper>,
) -> Option<String> {
    state.lsp_manager.resolve_language_for_path(&file_path)
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
    let doc_uri = text_document_uri(&params);
    ensure_session_async(&state, &project_path, &language_id, doc_uri).await?;

    // ── initialize: return cached capabilities ─────────────────────────
    if method == "initialize" {
        let caps = state
            .lsp_manager
            .get_capabilities(&project_path, &language_id)
            .unwrap_or_else(|| serde_json::json!({}));
        return serde_json::to_string(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": caps,
        }))
        .map_err(AppError::from);
    }

    // ── initialized: already sent by Rust, no-op ──────────────────────
    if method == "initialized" {
        return Ok("{}".into());
    }

    // ── shutdown / exit: handled gracefully ──────────────────────────
    if method == "shutdown" {
        return serde_json::to_string(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": null,
        }))
        .map_err(AppError::from);
    }

    // ── Request (has id): forward to LSP server, return response ─────
    if id.is_some() && !id.as_ref().map(|v| v.is_null()).unwrap_or(false) {
        let result = state
            .lsp_manager
            .send_request_async(&project_path, &language_id, method, params, false)
            .await?;
        return serde_json::to_string(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        }))
        .map_err(AppError::from);
    }

    // ── Notification (no id): track document lifecycle, then forward ──
    match method {
        "textDocument/didOpen" => {
            if let (Some(uri), Some(text), Some(version)) = (
                text_document_uri(&params),
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
            if let Some(uri) = text_document_uri(&params) {
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
///
/// `probe` distinguishes best-effort decoration lookups (the Cmd/Ctrl+hover
/// link-highlight) from explicit user jumps: probes are single-flight among
/// themselves but can never cancel a real jump.
#[tauri::command]
pub async fn lsp_go_to_definition(
    project_path: String,
    language_id: String,
    uri: String,
    line: u32,
    character: u32,
    probe: bool,
    state: State<'_, AppStateWrapper>,
) -> Result<serde_json::Value, AppError> {
    let t0 = std::time::Instant::now();

    ensure_session_async(&state, &project_path, &language_id, Some(&uri)).await?;
    let t1 = t0.elapsed();
    log::info!("[perf] lsp_go_to_definition: session ready in {:?}", t1);

    // Auto-didOpen if the document is not yet registered
    if !state
        .lsp_manager
        .is_document_open(&project_path, &language_id, &uri)
    {
        let file_path = uri.strip_prefix("file://").unwrap_or(&uri);
        if let Ok(text) = crate::common::file::reader::read_file(
            crate::common::file::reader::FileAccessScope::Trusted,
            crate::common::file::reader::FileReadRequest {
                target: crate::common::executor::factory::ExecTarget::Local,
                base: String::new(),
                path: file_path.to_string(),
                // didOpen 全文发送给 server，不设大小上限（与既有行为一致）
                max_bytes: None,
                detect_binary: false,
            },
        )
        .await
        {
            let text = text.content;
            let open_params = serde_json::json!({
                "textDocument": {
                    "uri": &uri,
                    "languageId": &language_id,
                    "version": 1,
                    "text": &text,
                }
            });
            let _ = state.lsp_manager.send_notification(
                &project_path,
                &language_id,
                "textDocument/didOpen",
                open_params,
            );
            state
                .lsp_manager
                .register_open_document(&project_path, &language_id, &uri, &text, 1);
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
            probe,
        )
        .await?;
    let t2 = t0.elapsed();
    log::info!(
        "[perf] lsp_go_to_definition: LSP responded in {:?} (request took {:?})",
        t2,
        t2 - t1,
    );

    // 记录全部目标 uri 为预授权（供 lsp_read_preauthorized_file 读取项目外定义）
    let target_uris: Vec<String> = UnifiedLocation::from_definition_response(&lsp_result)
        .into_iter()
        .map(|loc| loc.uri)
        .collect();
    state
        .lsp_manager
        .record_definition_targets(&project_path, &language_id, &target_uris);

    // Preload target file content using UnifiedLocation
    let file_content = match UnifiedLocation::first_target_uri(&lsp_result) {
        Some(target_uri) => {
            crate::common::file::reader::read_file(
                crate::common::file::reader::FileAccessScope::Trusted,
                crate::common::file::reader::FileReadRequest {
                    target: crate::common::executor::factory::ExecTarget::Local,
                    base: String::new(),
                    path: target_uri
                        .strip_prefix("file://")
                        .unwrap_or(&target_uri)
                        .to_string(),
                    // 预读内容随响应返回，512KB 对齐前端只读查看上限
                    max_bytes: Some(512 * 1024),
                    detect_binary: false,
                },
            )
            .await
            .ok()
        }
        None => None,
    };
    let t3 = t0.elapsed();
    log::info!(
        "[perf] lsp_go_to_definition: total {:?} (file read {:?})",
        t3,
        t3 - t2,
    );

    // fileContent 契约为纯文本（string | null）：组装逻辑抽为纯函数，契约由单元测试锁定
    Ok(definition_response(lsp_result, file_content))
}

/// Assemble the go-to-definition IPC response (pure, unit-testable).
///
/// `fileContent` 契约必须为纯文本（`string | null`）：前端 `lspApi.ts` 按此声明
/// 类型并直供 CodeMirror doc —— 整个 `FileContent` 对象误传会令 react-codemirror
/// 渲染崩溃。该契约由文件底部单元测试锁定。
fn definition_response(
    lsp_result: Value,
    file_content: Option<crate::common::types::FileContent>,
) -> Value {
    serde_json::json!({
        "lspResult": lsp_result,
        "fileContent": file_content.map(|f| f.content),
    })
}

/// Read a file that was returned as a go-to-definition target, even when it
/// lives outside the project root (monorepo deps, installed sources).
///
/// 授权模型：uri 必须出现在该会话最近一次 definition 响应中（`preauth` 表），
/// 前端无法伪造任意路径；读取前仍做 canonicalize + 大小上限防御。
#[tauri::command]
pub async fn lsp_read_preauthorized_file(
    project_path: String,
    language_id: String,
    uri: String,
    state: State<'_, AppStateWrapper>,
) -> Result<crate::common::types::FileContent, AppError> {
    if !state
        .lsp_manager
        .is_preauthorized(&project_path, &language_id, &uri)
    {
        return Err(AppError::InvalidInput(
            "uri is not a pre-authorized definition target".to_string(),
        ));
    }

    let raw_path = uri.strip_prefix("file://").unwrap_or(&uri).to_string();
    // 通道按项目执行环境分发（Local fs / WSL+Remote shell）——与文件读取
    // 统一核心一致，不再有本地-only 特例
    let target = state
        .lsp_manager
        .project_exec_target(&project_path)
        .unwrap_or(crate::common::executor::factory::ExecTarget::Local);

    crate::common::file::reader::read_file(
        crate::common::file::reader::FileAccessScope::Trusted,
        crate::common::file::reader::FileReadRequest {
            target,
            base: String::new(),
            path: raw_path,
            max_bytes: Some(super::preauth::MAX_PREAUTH_READ_BYTES),
            detect_binary: false,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn definition_response_file_content_is_plain_text() {
        let resp = definition_response(
            serde_json::json!([{ "uri": "file:///repo/src/lib.rs" }]),
            Some(crate::common::types::FileContent {
                path: "/repo/src/lib.rs".into(),
                content: "pub fn target() {}\n".into(),
                size: 19,
                is_binary: false,
            }),
        );
        assert_eq!(
            resp["fileContent"],
            serde_json::Value::String("pub fn target() {}\n".into()),
            "fileContent 必须是纯文本字符串而非 FileContent 对象（对象会让 CodeMirror 渲染崩溃）"
        );
        assert_eq!(
            resp["lspResult"],
            serde_json::json!([{ "uri": "file:///repo/src/lib.rs" }])
        );
    }

    #[test]
    fn definition_response_without_target_is_null() {
        let resp = definition_response(serde_json::json!([]), None);
        assert!(
            resp["fileContent"].is_null(),
            "无预读目标时 fileContent 必须为 null 而非缺失或对象"
        );
        assert_eq!(resp["lspResult"], serde_json::json!([]));
    }
}
