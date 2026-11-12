//! Server → client notification handlers (diagnostics, progress).

use std::collections::HashSet;
use std::sync::Mutex;

use serde_json::Value;

use super::super::diag_bus::{DiagnosticBus, DiagnosticEvent};
use super::super::transport::{LspTransport, ProgressKind};
use super::lifecycle::Lifecycle;
use super::publish_status;
use super::status::LspSessionStatus;

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

/// rust-analyzer 的就绪通知方法（能力门控：仅声明 `experimental.serverStatusNotification`
/// 的插件会收到；声明见 `plugin/builtins/rust_lang.rs`，红线 14 的消费点即本模块）。
pub(super) const SERVER_STATUS_METHOD: &str = "experimental/serverStatus";

/// `experimental/serverStatus` 的合成 token 名：前端只认「token 非空 ⇒ busy」，
/// 复用既有进度投影（session 事件 + lsp-progress 事件），**前端零改动**。
const SERVER_STATUS_TOKEN: &str = "experimental/serverStatus";

/// 维护会话的**在途 progress token** 集合并转发进度事件。
///
/// `begin` 加入、`end` 移除、`report` 只更新（不改集合）—— 集合是
/// 「该会话是否仍在导入/索引」的**唯一事实源**（供 Java debug 能力探测的
/// `Warming` 判据使用；只转发事件而不保留状态会让该判据无法实现）。
pub(super) fn handle_progress_notification(
    params: &Value,
    project_path: &str,
    language_id: &str,
    lifecycle: &Lifecycle,
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
            // `indexing` 是**服务端进度**的投影，不是直推事件：必经 `publish_status`
            // （相位 + 事件同一写点）。终态（关闭 / 崩溃）后迟到的 `begin` 不得
            // 复活状态标 chip —— 该取舍由 `publish_status` 的终态门统一给出。
            publish_status(
                lifecycle,
                transport,
                project_path,
                language_id,
                LspSessionStatus::Indexing,
                Some(msg),
                None,
            );
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
            // 同 `begin`：经 lifecycle 单写点（终态后不再推）。
            publish_status(
                lifecycle,
                transport,
                project_path,
                language_id,
                LspSessionStatus::Indexing,
                msg,
                pct,
            );
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

/// 处理 rust-analyzer 的 `experimental/serverStatus`（就绪语义）。
///
/// 第一性原理：「Running」必须止于**服务器自述就绪**，而不是客户端握手完成 ——
/// RA 的 cachePriming / flycheck 等 token 结束后、到真正答得快之间还有一段**无信号
/// 尾巴**（2026-10-11 实测：token 全结束后 definition 仍需 18–19s）。RA 的
/// `quiescent` 正是这段的官方信号，本函数把它翻译成既有的合成 token：
/// `quiescent=false` → `begin`（busy/Indexing），`quiescent=true` → `end`（回 ready）。
///
/// 形态不符（缺 `quiescent` / 非布尔）一律忽略：不改变任何状态（防御畸形通知）。
pub(super) fn handle_server_status_notification(
    params: &Value,
    project_path: &str,
    language_id: &str,
    lifecycle: &Lifecycle,
    transport: &dyn LspTransport,
    in_flight: &Mutex<HashSet<String>>,
) {
    let Some(quiescent) = params.get("quiescent").and_then(Value::as_bool) else {
        return;
    };
    let value = if quiescent {
        serde_json::json!({ "kind": "end" })
    } else {
        let mut value = serde_json::json!({ "kind": "begin" });
        if let Some(message) = params.get("message").and_then(Value::as_str) {
            value["title"] = Value::String(message.to_string());
        }
        value
    };
    // 翻译成标准进度形态，复用 token 记账 / 会话事件 / 前端进度事件的全套既有逻辑。
    handle_progress_notification(
        &serde_json::json!({ "token": SERVER_STATUS_TOKEN, "value": value }),
        project_path,
        language_id,
        lifecycle,
        transport,
        in_flight,
    );
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
        let lc = Lifecycle::new();

        handle_progress_notification(
            &progress("begin", &serde_json::json!("java-import")),
            "/p",
            "java",
            &lc,
            &t,
            &s,
        );
        assert_eq!(snapshot(&s), vec!["java-import"]);

        handle_progress_notification(
            &progress("report", &serde_json::json!("java-import")),
            "/p",
            "java",
            &lc,
            &t,
            &s,
        );
        assert_eq!(snapshot(&s), vec!["java-import"], "report 不得改变在途集合");

        handle_progress_notification(
            &progress("end", &serde_json::json!("java-import")),
            "/p",
            "java",
            &lc,
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
        let lc = Lifecycle::new();
        for token in ["a", "b"] {
            handle_progress_notification(
                &progress("begin", &serde_json::json!(token)),
                "/p",
                "java",
                &lc,
                &t,
                &s,
            );
        }
        handle_progress_notification(
            &progress("end", &serde_json::json!("a")),
            "/p",
            "java",
            &lc,
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
        let lc = Lifecycle::new();
        for token in [
            serde_json::json!(""),
            serde_json::Value::Null,
            serde_json::json!(7),
        ] {
            handle_progress_notification(&progress("begin", &token), "/p", "java", &lc, &t, &s);
        }
        assert!(snapshot(&s).is_empty());
    }

    /// 无 `kind` 的进度载荷不改变集合（防御畸形通知）。
    #[test]
    fn malformed_payload_does_not_touch_state() {
        let t = NullTransport;
        let s = Mutex::new(HashSet::new());
        let lc = Lifecycle::new();
        handle_progress_notification(
            &serde_json::json!({ "token": "x" }),
            "/p",
            "java",
            &lc,
            &t,
            &s,
        );
        assert!(snapshot(&s).is_empty());
    }

    /// 关闭后迟到的 `$/progress begin` 不得产生 `indexing` 事件（AC3）。
    ///
    /// 事故形态：`begin` 曾绕过 `publish_status` 直推事件 —— 会话已关闭（lifecycle
    /// 终态）时迟到通知仍会推 `indexing`，状态标 chip 被“复活”；而 `snapshot()`
    /// 读 lifecycle 报 `stopped` —— 同一事实两份记录。本用例同时钉住两个方向：
    /// 终态前 `indexing` 照发，终态后（含 `report`）一条不发。
    #[test]
    fn indexing_event_is_gated_by_terminal_phase() {
        let transport = crate::lsp::session::testing::RecordingTransport::default();
        let s = Mutex::new(HashSet::new());
        let lc = Lifecycle::new();
        lc.set(&LspSessionStatus::Ready);

        // 终态前：`indexing` 照发，且相位由 lifecycle 单写点推进。
        handle_progress_notification(
            &serde_json::json!({ "token": "t1", "value": { "kind": "begin", "title": "indexing" } }),
            "/p",
            "rust",
            &lc,
            &transport,
            &s,
        );
        // `RecordingTransport::take()` 返回**累积**快照（不是 drain），所以下面
        // 用「迟到通知前后快照完全相等」作为「一条新事件都没发」的判据。
        let before_close = transport.take();
        assert_eq!(
            before_close.len(),
            1,
            "终态前的 begin 必须发一条 indexing: {before_close:?}"
        );
        assert_eq!(before_close[0].2, "indexing");

        // 关闭：相位落终态，迟到通知不得再复活 chip。
        lc.close();

        for value in [
            serde_json::json!({ "kind": "begin", "title": "indexing" }),
            serde_json::json!({ "kind": "report", "message": "still busy", "percentage": 40 }),
        ] {
            handle_progress_notification(
                &serde_json::json!({ "token": "late", "value": value }),
                "/p",
                "rust",
                &lc,
                &transport,
                &s,
            );
        }

        let events = transport.take();
        assert_eq!(
            events, before_close,
            "关闭后迟到的进度通知不得产生任何会话事件（chip 不得复活）: {events:?}"
        );
        assert_eq!(
            lc.status("rust-analyzer"),
            LspSessionStatus::Stopped,
            "终态不得被迟到通知覆盖（相位与事件必须同源）"
        );
    }

    // ── rust-analyzer 就绪语义（experimental/serverStatus，能力门控）────────

    /// `quiescent=false` → 合成 busy token + `indexing` 会话事件（「Running」不再早于
    /// 服务器自述就绪）；`quiescent=true` → 摘除 token + `ready`。重复通知幂等。
    #[test]
    fn server_status_tracks_quiescent_as_synthetic_token() {
        let transport = crate::lsp::session::testing::RecordingTransport::default();
        let s = Mutex::new(HashSet::new());
        let lc = Lifecycle::new();

        // 加载中（含 message）：合成 begin，并把 message 作为进度标题透传。
        handle_server_status_notification(
            &serde_json::json!({ "health": "ok", "quiescent": false, "message": "workspace loading" }),
            "/p",
            "rust",
            &lc,
            &transport,
            &s,
        );
        assert_eq!(snapshot(&s), vec![SERVER_STATUS_TOKEN]);
        let events = transport.take();
        assert!(
            events.iter().any(|(pp, lid, status, msg, _)| pp == "/p"
                && lid == "rust"
                && status == "indexing"
                && msg.as_deref() == Some("workspace loading")),
            "加载中必须合成 busy 事件（含 RA 的 message）: {events:?}"
        );

        // 重复的 false 通知不得产生重复 token。
        handle_server_status_notification(
            &serde_json::json!({ "quiescent": false }),
            "/p",
            "rust",
            &lc,
            &transport,
            &s,
        );
        assert_eq!(snapshot(&s), vec![SERVER_STATUS_TOKEN]);

        // quiescent=true：摘除 token 并回 ready（前端据此清 busy）。
        handle_server_status_notification(
            &serde_json::json!({ "health": "ok", "quiescent": true, "message": null }),
            "/p",
            "rust",
            &lc,
            &transport,
            &s,
        );
        assert!(snapshot(&s).is_empty(), "quiescent 后必须摘除合成 token");
        assert!(
            transport.has("/p", "rust", "ready"),
            "quiescent=true 必须回 ready: {:?}",
            transport.take()
        );
    }

    /// 形态不符（缺 `quiescent` / 非布尔 / 非对象）一律忽略：不改变任何状态。
    #[test]
    fn server_status_malformed_payload_is_ignored() {
        let transport = crate::lsp::session::testing::RecordingTransport::default();
        let s = Mutex::new(HashSet::new());
        let lc = Lifecycle::new();

        for params in [
            serde_json::json!({}),
            serde_json::json!({ "quiescent": "yes" }),
            serde_json::json!({ "quiescent": null }),
            serde_json::Value::Null,
        ] {
            handle_server_status_notification(&params, "/p", "rust", &lc, &transport, &s);
        }

        assert!(snapshot(&s).is_empty(), "畸形通知不得改变在途集合");
        assert!(transport.take().is_empty(), "畸形通知不得产生任何事件");
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
