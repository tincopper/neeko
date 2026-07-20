//! Server → client notification handlers (diagnostics, progress).

use serde_json::Value;

use super::super::diag_bus::{DiagnosticBus, DiagnosticEvent};
use super::super::transport::{LspTransport, ProgressKind};


pub(super) fn handle_diagnostics_notification(
    params: &Value,
    project_path: &str,
    language_id: &str,
    diag_bus: &DiagnosticBus,
) {
    let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");

    // Pass the raw diagnostics JSON array through without parsing —
    // avoids a serialize→parse→serialize round-trip.
    let diagnostics = params
        .get("diagnostics")
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));

    diag_bus.publish(DiagnosticEvent {
        project_path: project_path.to_string(),
        uri: uri.to_string(),
        language_id: language_id.to_string(),
        diagnostics,
    });
}

pub(super) fn handle_progress_notification(
    params: &Value,
    project_path: &str,
    language_id: &str,
    transport: &dyn LspTransport,
) {
    let token = params.get("token").and_then(|v| v.as_str()).unwrap_or("");
    let value = params.get("value");
    let kind = value.and_then(|v| v.get("kind").and_then(|k| k.as_str()));

    match kind {
        Some("begin") => {
            let msg = value
                .and_then(|v| v.get("title"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            log::info!(
                "[LSP] Progress begin [{}] {} for project {}",
                token,
                msg,
                project_path
            );
            transport.push_session_event(project_path, language_id, "indexing", Some(msg), None);
            transport.push_progress(
                project_path,
                language_id,
                token,
                ProgressKind::Begin,
                Some(msg),
                None,
            );
        }
        Some("report") => {
            let msg = value
                .and_then(|v| v.get("message"))
                .and_then(|m| m.as_str());
            let pct = value
                .and_then(|v| v.get("percentage"))
                .and_then(|p| p.as_u64())
                .and_then(|p| u32::try_from(p).ok());
            log::info!(
                "[LSP] Progress report [{}]: {:?} ({:?}%) for project {}",
                token,
                msg,
                pct,
                project_path
            );
            transport.push_progress(
                project_path,
                language_id,
                token,
                ProgressKind::Report,
                msg,
                pct,
            );
            transport.push_session_event(project_path, language_id, "indexing", msg, pct);
        }
        Some("end") => {
            log::info!(
                "[LSP] Progress end [{}] for project {}",
                token,
                project_path
            );
            transport.push_session_event(project_path, language_id, "ready", None, None);
            transport.push_progress(
                project_path,
                language_id,
                token,
                ProgressKind::End,
                None,
                None,
            );
        }
        _ => {}
    }
}

