use tauri::Emitter;

use super::types::LspDiagnostic;

/// Trait for delivering LSP-originated data to the frontend.
///
/// Current implementation uses Tauri IPC events. A future WebSocket
/// implementation would swap in a `WebSocketTransport` without changing
/// any LSP session logic.
pub trait LspTransport: Send + Sync {
    /// Push diagnostics for a specific file URI to the frontend.
    fn push_diagnostics(
        &self,
        project_path: &str,
        uri: &str,
        diagnostics: Vec<LspDiagnostic>,
    );

    /// Push a work-done progress notification to the frontend.
    fn push_progress(
        &self,
        _project_path: &str,
        _language_id: &str,
        _token: &str,
        _kind: ProgressKind,
        _message: Option<&str>,
        _percentage: Option<u32>,
    ) {
        // Default: no-op (not all backends need progress reporting)
        // Implementations override as needed.
    }
}

/// Kind of LSP progress update.
#[derive(Debug, Clone)]
pub enum ProgressKind {
    Begin,
    Report,
    End,
}

// ═══════════════════════════════════════════════════════════════════════
// IPC Transport (current default)
// ═══════════════════════════════════════════════════════════════════════

/// Transports LSP data via Tauri event emissions.
pub struct IpcTransport {
    app_handle: tauri::AppHandle,
}

impl IpcTransport {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl LspTransport for IpcTransport {
    fn push_diagnostics(
        &self,
        project_path: &str,
        uri: &str,
        diagnostics: Vec<LspDiagnostic>,
    ) {
        let event_name = format!("lsp-diagnostics-{}", project_path);
        let payload = serde_json::json!({
            "uri": uri,
            "diagnostics": diagnostics,
        });

        if let Err(e) = self.app_handle.emit(&event_name, payload) {
            log::error!("[LSP] Failed to emit diagnostics event '{}': {}", event_name, e);
        }
    }

    fn push_progress(
        &self,
        project_path: &str,
        language_id: &str,
        token: &str,
        kind: ProgressKind,
        message: Option<&str>,
        percentage: Option<u32>,
    ) {
        let event_name = format!("lsp-progress-{}", project_path);
        let kind_str = match kind {
            ProgressKind::Begin => "begin",
            ProgressKind::Report => "report",
            ProgressKind::End => "end",
        };
        let payload = serde_json::json!({
            "languageId": language_id,
            "token": token,
            "kind": kind_str,
            "message": message,
            "percentage": percentage,
        });

        if let Err(e) = self.app_handle.emit(&event_name, payload) {
            log::error!("[LSP] Failed to emit progress event '{}': {}", event_name, e);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// WebSocket Transport (reserved for future phase)
// ═══════════════════════════════════════════════════════════════════════

/// Placeholder for future WebSocket-based transport.
///
/// When activated, this would:
/// 1. Run a local tokio-tungstenite server on a random port
/// 2. Return the port to the frontend via a Tauri command
/// 3. Frontend connects via `new WebSocket("ws://127.0.0.1:{port}")`
/// 4. All LSP messages stream bidirectionally over this socket
///
/// ```ignore
/// pub struct WebSocketTransport {
///     tx: tokio::sync::broadcast::Sender<WsMessage>,
///     port: u16,
/// }
///
/// impl LspTransport for WebSocketTransport { ... }
/// ```
#[allow(dead_code)]
pub struct WebSocketTransportPlaceholder;
