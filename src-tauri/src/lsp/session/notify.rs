//! Server → client notification handlers (diagnostics, progress).

use std::collections::HashSet;
use std::sync::Mutex;

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
        version: params.get("version").and_then(serde_json::Value::as_i64),
    });
}

/// 维护会话的**在途 progress token** 集合并转发进度事件。
///
/// `begin` 加入、`end` 移除、`report` 只更新（不改集合）—— 集合是
/// 「该会话是否仍在导入/索引」的**唯一事实源**（供 Java debug 能力探测的
/// `Warming` 判据使用；只转发事件而不保留状态会让该判据无法实现）。
pub(super) fn handle_progress_notification(
    params: &Value,
    project_path: &str,
    language_id: &str,
    transport: &dyn LspTransport,
    in_flight: &Mutex<HashSet<String>>,
) {
    let token = params.get("token").and_then(|v| v.as_str()).unwrap_or("");
    let value = params.get("value");
    let kind = value.and_then(|v| v.get("kind").and_then(|k| k.as_str()));

    // token 为空（非法/匿名进度）不参与"在途"判定，避免把无条件结束的匿名
    // 进度误当成导入仍在进行。
    if !token.is_empty() {
        match kind {
            Some("begin") => {
                if let Ok(mut set) = in_flight.lock() {
                    set.insert(token.to_string());
                }
            }
            Some("end") => {
                if let Ok(mut set) = in_flight.lock() {
                    set.remove(token);
                }
            }
            _ => {}
        }
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    /// 只需实现 `push_diagnostics`（其余方法有默认空实现）。
    struct NullTransport;
    impl LspTransport for NullTransport {
        fn push_diagnostics(
            &self,
            _project_path: &str,
            _uri: &str,
            _diagnostics: Value,
            _version: Option<i64>,
        ) {
        }
    }

    fn progress(kind: &str, token: &Value) -> Value {
        serde_json::json!({ "token": token, "value": { "kind": kind } })
    }

    fn snapshot(state: &Mutex<HashSet<String>>) -> Vec<String> {
        let mut v: Vec<String> = state.lock().expect("lock").iter().cloned().collect();
        v.sort();
        v
    }

    /// begin 加入 → end 移除；report 只更新、不改变在途集合。
    #[test]
    fn begin_and_end_track_in_flight_tokens() {
        let t = NullTransport;
        let s = Mutex::new(HashSet::new());

        handle_progress_notification(
            &progress("begin", &serde_json::json!("java-import")),
            "/p",
            "java",
            &t,
            &s,
        );
        assert_eq!(snapshot(&s), vec!["java-import"]);

        handle_progress_notification(
            &progress("report", &serde_json::json!("java-import")),
            "/p",
            "java",
            &t,
            &s,
        );
        assert_eq!(snapshot(&s), vec!["java-import"], "report 不得改变在途集合");

        handle_progress_notification(
            &progress("end", &serde_json::json!("java-import")),
            "/p",
            "java",
            &t,
            &s,
        );
        assert!(snapshot(&s).is_empty(), "end 必须移除该 token");
    }

    /// 多个 token 各自独立：一个结束不影响另一个仍在途。
    #[test]
    fn multiple_tokens_tracked_independently() {
        let t = NullTransport;
        let s = Mutex::new(HashSet::new());
        for token in ["a", "b"] {
            handle_progress_notification(
                &progress("begin", &serde_json::json!(token)),
                "/p",
                "java",
                &t,
                &s,
            );
        }
        handle_progress_notification(
            &progress("end", &serde_json::json!("a")),
            "/p",
            "java",
            &t,
            &s,
        );
        assert_eq!(snapshot(&s), vec!["b"]);
    }

    /// 空 / 缺失 / 非字符串 token 一律忽略 —— 否则一个匿名进度会把"在途"永久点亮。
    #[test]
    fn empty_or_non_string_token_is_ignored() {
        let t = NullTransport;
        let s = Mutex::new(HashSet::new());
        for token in [
            serde_json::json!(""),
            serde_json::Value::Null,
            serde_json::json!(7),
        ] {
            handle_progress_notification(&progress("begin", &token), "/p", "java", &t, &s);
        }
        assert!(snapshot(&s).is_empty());
    }

    /// 无 `kind` 的进度载荷不改变集合（防御畸形通知）。
    #[test]
    fn malformed_payload_does_not_touch_state() {
        let t = NullTransport;
        let s = Mutex::new(HashSet::new());
        handle_progress_notification(&serde_json::json!({ "token": "x" }), "/p", "java", &t, &s);
        assert!(snapshot(&s).is_empty());
    }

    /// `version` 必须原样带到 DiagnosticBus：前端据此让 lsp-client 的版本门生效
    /// （缺它会把旧版本的诊断按当前文本坐标套用 → 波浪线偏移，2026-09-21 实测）。
    #[test]
    fn diagnostics_notification_forwards_document_version_to_bus() {
        let captured = std::sync::Arc::new(Mutex::new(None::<DiagnosticEvent>));
        let sink = std::sync::Arc::clone(&captured);
        let bus = DiagnosticBus::new();
        let _sub = bus.subscribe(move |event| {
            *sink.lock().expect("sink lock") = Some(event.clone());
        });

        handle_diagnostics_notification(
            &serde_json::json!({ "uri": "file:///p/a.rs", "version": 14, "diagnostics": [] }),
            "/p",
            "rust",
            &bus,
        );
        assert_eq!(
            captured
                .lock()
                .expect("sink")
                .as_ref()
                .expect("event")
                .version,
            Some(14)
        );

        handle_diagnostics_notification(
            &serde_json::json!({ "uri": "file:///p/a.rs", "diagnostics": [] }),
            "/p",
            "rust",
            &bus,
        );
        assert_eq!(
            captured
                .lock()
                .expect("sink")
                .as_ref()
                .expect("event")
                .version,
            None,
            "服务器未声明版本时为 None（前端据此退回「不拦截」）"
        );
    }

    /// 诊断通知直传原始 JSON（避免 serialize→parse→serialize 往返）：
    /// `code`（number|string）必须原样到达 DiagnosticBus —— Problems 面板
    /// 的 `(UndeclaredName)` 段依赖它；任何中途解析丢弃都是回归。
    #[test]
    fn diagnostics_notification_forwards_code_field_to_bus() {
        let captured = std::sync::Arc::new(Mutex::new(None::<DiagnosticEvent>));
        let sink = std::sync::Arc::clone(&captured);
        let bus = DiagnosticBus::new();
        let _sub = bus.subscribe(move |event| {
            *sink.lock().expect("sink lock") = Some(event.clone());
        });

        let params = serde_json::json!({
            "uri": "file:///p/main_test.go",
            "version": 14,
            "diagnostics": [
                {
                    "range": {
                        "start": { "line": 55, "character": 12 },
                        "end": { "line": 55, "character": 15 }
                    },
                    "severity": 1,
                    "message": "undefined: fmt",
                    "source": "compiler",
                    "code": "UndeclaredName"
                },
                {
                    "range": {
                        "start": { "line": 3, "character": 0 },
                        "end": { "line": 3, "character": 1 }
                    },
                    "severity": 2,
                    "message": "unused variable",
                    "code": 1234
                }
            ]
        });

        handle_diagnostics_notification(&params, "/p", "go", &bus);

        let event = captured
            .lock()
            .expect("captured lock")
            .clone()
            .expect("bus event published");
        assert_eq!(event.uri, "file:///p/main_test.go");
        let diags = event.diagnostics.as_array().expect("diagnostics array");
        assert_eq!(diags[0]["code"], "UndeclaredName");
        assert_eq!(diags[1]["code"], 1234);
    }
}
