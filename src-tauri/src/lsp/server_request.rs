//! Handling of server → client LSP requests.
//!
//! Language servers (especially gopls) send requests that the client must
//! answer. Silently ignoring them can stall the server (e.g. gopls waits on
//! `window/workDoneProgress/create` and never answers hover/definition).

use lsp_server::{ErrorCode, Request, Response};
use serde_json::{json, Value};

/// Build a client Response for a server-initiated LSP request.
///
/// Always returns a Response — never drop a request without answering.
pub fn respond_to_server_request(req: &Request, workspace_folder_uri: Option<&str>) -> Response {
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
        "workspace/workspaceFolders" => {
            let folders = workspace_folder_uri
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
    use serde_json::json;

    fn req(method: &str, params: Value) -> Request {
        Request {
            id: RequestId::from(1i32),
            method: method.to_string(),
            params,
        }
    }

    #[test]
    fn should_return_null_ok_when_work_done_progress_create() {
        let r = req("window/workDoneProgress/create", json!({"token": "t1"}));
        let resp = respond_to_server_request(&r, None);

        assert_eq!(resp.id, RequestId::from(1i32));
        assert!(resp.error.is_none());
        assert_eq!(resp.result, Some(Value::Null));
    }

    #[test]
    fn should_return_method_not_found_when_unknown_server_request() {
        let r = req("foo/bar", json!({}));
        let resp = respond_to_server_request(&r, None);

        assert!(resp.result.is_none());
        let err = resp.error.expect("expected MethodNotFound error");
        assert_eq!(err.code, ErrorCode::MethodNotFound as i32);
        assert!(err.message.contains("foo/bar"));
    }

    #[test]
    fn should_return_empty_configs_matching_items_when_workspace_configuration() {
        let r = req(
            "workspace/configuration",
            json!({"items": [{"section": "gopls"}, {"section": "go"}]}),
        );
        let resp = respond_to_server_request(&r, None);

        assert!(resp.error.is_none());
        let result = resp.result.expect("ok result");
        let arr = result.as_array().expect("array of configs");
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0], json!({}));
        assert_eq!(arr[1], json!({}));
    }

    #[test]
    fn should_return_null_ok_when_register_capability() {
        let r = req("client/registerCapability", json!({"registrations": []}));
        let resp = respond_to_server_request(&r, None);

        assert!(resp.error.is_none());
        assert_eq!(resp.result, Some(Value::Null));
    }

    #[test]
    fn should_return_workspace_folder_when_uri_provided() {
        let r = req("workspace/workspaceFolders", json!(null));
        let resp =
            respond_to_server_request(&r, Some("file:///Users/tomgs/workspaces/go_space/codeant"));

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
        let r = req("workspace/workspaceFolders", json!(null));
        let resp = respond_to_server_request(&r, None);

        assert!(resp.error.is_none());
        assert_eq!(resp.result, Some(Value::Null));
    }
}
