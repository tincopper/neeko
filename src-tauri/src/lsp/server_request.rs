//! Handling of server → client LSP requests.
//!
//! Language servers (especially gopls) send requests that the client must

#![allow(clippy::unwrap_used, clippy::expect_used)]
//! answer. Silently ignoring them can stall the server (e.g. gopls waits on
//! `window/workDoneProgress/create` and never answers hover/definition).

use lsp_server::{ErrorCode, Request, Response};
use serde_json::{json, Value};

use super::transport::LspTransport;

/// 回答服务端请求所需的会话侧上下文。
///
/// 之所以收成一个结构：`respond_to_server_request` 要保持"每个请求必定被应答"
/// 这一不变量在**一个**可脱离 Tauri 运行时测试的纯单元里（transport 是 trait，
/// 测试传桩即可）。把 forwarding 挪到 instance.rs 会把这份不变量拆散到 reader 线程里。
#[derive(Clone, Copy)]
pub struct ServerRequestCtx<'a> {
    /// 工作区根 URI（`workspace/workspaceFolders` 用）。
    pub workspace_folder_uri: Option<&'a str>,
    /// 会话所属项目路径（事件名拼接用）。
    pub project_path: &'a str,
    /// 语言 ID（前端按语言分流用）。
    pub language_id: &'a str,
    /// 转发面 —— 只有它碰 Tauri 运行时。
    pub transport: &'a dyn LspTransport,
}

/// Build a client Response for a server-initiated LSP request.
///
/// Always returns a Response — never drop a request without answering.
#[must_use]
pub fn respond_to_server_request(req: &Request, ctx: &ServerRequestCtx<'_>) -> Response {
    match req.method.as_str() {
        "window/workDoneProgress/create" => Response::new_ok(req.id.clone(), Value::Null),
        "client/registerCapability" | "client/unregisterCapability" => {
            Response::new_ok(req.id.clone(), Value::Null)
        }
        "workspace/configuration" => {
            let n = req
                .params
                .get("items")
                .and_then(|i| i.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let configs: Vec<Value> = (0..n).map(|_| json!({})).collect();
            Response::new_ok(req.id.clone(), configs)
        }
        // 服务端请客户端落一个 WorkspaceEdit（典型来源：codeAction 的 command 执行后、
        // 或 source.organizeImports）。转发给前端编辑，**不能**回 MethodNotFound ——
        // 那是"功能缺失"而非"不支持"，且会让部分服务器停在这一步。
        //
        // 回执用乐观 `applied: true`：`push_apply_edit` 返回 `()`，感知不到 emit 是否
        // 成功，而"等前端 ack"需要新命令 + 关联 id + 超时，一旦前端不应答就会重演
        // 「服务端卡住」——正是本模块存在的理由。代价是极端情况下 applied 为真而编辑
        // 未落地（静默无操作），优于整个会话停滞。
        "workspace/applyEdit" => {
            let edit = req.params.get("edit").cloned().unwrap_or(Value::Null);
            ctx.transport
                .push_apply_edit(ctx.project_path, ctx.language_id, &edit);
            Response::new_ok(req.id.clone(), json!({ "applied": true }))
        }
        "workspace/workspaceFolders" => {
            let folders = ctx
                .workspace_folder_uri
                .map(|uri| {
                    json!([{
                        "uri": uri,
                        "name": folder_name_from_uri(uri),
                    }])
                })
                .unwrap_or(Value::Null);
            Response::new_ok(req.id.clone(), folders)
        }
        "window/showMessageRequest" => {
            // No UI action — accept default (null = dismissed).
            Response::new_ok(req.id.clone(), Value::Null)
        }
        _ => Response::new_err(
            req.id.clone(),
            ErrorCode::MethodNotFound as i32,
            format!("Method not found: {}", req.method),
        ),
    }
}

fn folder_name_from_uri(uri: &str) -> String {
    let path = uri.strip_prefix("file://").unwrap_or(uri);
    let trimmed = path.trim_end_matches('/');
    trimmed
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("workspace")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use lsp_server::RequestId;
    use parking_lot::Mutex;
    use serde_json::json;

    fn req(method: &str, params: Value) -> Request {
        Request {
            id: RequestId::from(1i32),
            method: method.to_string(),
            params,
        }
    }

    /// 只捕获 `push_apply_edit` 的桩（其余走 trait 默认空实现）。
    /// `LspTransport: Send + Sync`，故用 `parking_lot::Mutex`（与 `RecordingTransport` 同款）。
    #[derive(Default)]
    struct CapturingTransport {
        apply_edits: Mutex<Vec<Value>>,
    }

    impl CapturingTransport {
        fn take_apply_edits(&self) -> Vec<Value> {
            self.apply_edits.lock().clone()
        }
    }

    impl LspTransport for CapturingTransport {
        fn push_diagnostics(&self, _: &str, _: &str, _: Value) {}
        fn push_apply_edit(&self, _project_path: &str, _language_id: &str, edit: &Value) {
            self.apply_edits.lock().push(edit.clone());
        }
    }

    fn ctx<'a>(
        transport: &'a dyn LspTransport,
        workspace_folder_uri: Option<&'a str>,
    ) -> ServerRequestCtx<'a> {
        ServerRequestCtx {
            workspace_folder_uri,
            project_path: "/proj",
            language_id: "go",
            transport,
        }
    }

    #[test]
    fn should_return_null_ok_when_work_done_progress_create() {
        let t = CapturingTransport::default();
        let r = req("window/workDoneProgress/create", json!({"token": "t1"}));
        let resp = respond_to_server_request(&r, &ctx(&t, None));

        assert_eq!(resp.id, RequestId::from(1i32));
        assert!(resp.error.is_none());
        assert_eq!(resp.result, Some(Value::Null));
    }

    #[test]
    fn should_return_method_not_found_when_unknown_server_request() {
        let t = CapturingTransport::default();
        let r = req("foo/bar", json!({}));
        let resp = respond_to_server_request(&r, &ctx(&t, None));

        assert!(resp.result.is_none());
        let err = resp.error.expect("expected MethodNotFound error");
        assert_eq!(err.code, ErrorCode::MethodNotFound as i32);
        assert!(err.message.contains("foo/bar"));
    }

    #[test]
    fn should_forward_apply_edit_to_transport_and_reply_applied_true() {
        let t = CapturingTransport::default();
        let edit = json!({
            "changes": {
                "file:///proj/main.go": [{
                    "range": {"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 0}},
                    "newText": "import \"fmt\"\n"
                }]
            }
        });
        let r = req(
            "workspace/applyEdit",
            json!({"label": "Add import", "edit": edit.clone()}),
        );

        let resp = respond_to_server_request(&r, &ctx(&t, None));

        // ① 必须应答（否则服务端停在这一步）
        assert!(resp.error.is_none());
        assert_eq!(resp.result, Some(json!({ "applied": true })));
        // ② 原始 WorkspaceEdit 原样转发
        let forwarded = t.take_apply_edits();
        assert_eq!(forwarded.len(), 1);
        assert_eq!(forwarded[0], edit);
    }

    #[test]
    fn should_reply_applied_true_even_when_edit_missing() {
        // 畸形请求也要应答：宁可"编辑为空"也不能不回
        let t = CapturingTransport::default();
        let r = req("workspace/applyEdit", json!({}));

        let resp = respond_to_server_request(&r, &ctx(&t, None));

        assert!(resp.error.is_none());
        assert_eq!(resp.result, Some(json!({ "applied": true })));
        assert_eq!(t.take_apply_edits(), vec![Value::Null]);
    }

    #[test]
    fn should_return_empty_configs_matching_items_when_workspace_configuration() {
        let t = CapturingTransport::default();
        let r = req(
            "workspace/configuration",
            json!({"items": [{"section": "gopls"}, {"section": "go"}]}),
        );
        let resp = respond_to_server_request(&r, &ctx(&t, None));

        assert!(resp.error.is_none());
        let result = resp.result.expect("ok result");
        let arr = result.as_array().expect("array of configs");
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0], json!({}));
        assert_eq!(arr[1], json!({}));
    }

    #[test]
    fn should_return_null_ok_when_register_capability() {
        let t = CapturingTransport::default();
        let r = req("client/registerCapability", json!({"registrations": []}));
        let resp = respond_to_server_request(&r, &ctx(&t, None));

        assert!(resp.error.is_none());
        assert_eq!(resp.result, Some(Value::Null));
    }

    #[test]
    fn should_return_workspace_folder_when_uri_provided() {
        let t = CapturingTransport::default();
        let r = req("workspace/workspaceFolders", json!(null));
        let resp = respond_to_server_request(
            &r,
            &ctx(&t, Some("file:///Users/tomgs/workspaces/go_space/codeant")),
        );

        assert!(resp.error.is_none());
        let result = resp.result.expect("ok result");
        assert_eq!(
            result,
            json!([{
                "uri": "file:///Users/tomgs/workspaces/go_space/codeant",
                "name": "codeant",
            }])
        );
    }

    #[test]
    fn should_return_null_workspace_folders_when_no_uri() {
        let t = CapturingTransport::default();
        let r = req("workspace/workspaceFolders", json!(null));
        let resp = respond_to_server_request(&r, &ctx(&t, None));

        assert!(resp.error.is_none());
        assert_eq!(resp.result, Some(Value::Null));
    }
}
