//! Real MCP connectivity probe.
//!
//! Unlike a PATH/config check, this module performs an actual MCP `initialize`
//! handshake over each transport (stdio / streamable-http / legacy SSE) and
//! reports whether the server answered like a working MCP endpoint.

use std::collections::HashMap;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

use crate::common::error::AppError;
use crate::common::executor::factory::{create_executor, ExecTarget};
use crate::common::executor::SpawnOptions;

/// MCP protocol version advertised in the initialize handshake.
pub const PROTOCOL_VERSION: &str = "2025-06-18";
/// Timeout for stdio handshakes (server startup can be slow).
pub const STDIO_TIMEOUT: Duration = Duration::from_secs(5);
/// Timeout for remote http/sse handshakes.
pub const REMOTE_TIMEOUT: Duration = Duration::from_secs(10);

/// Result of a connectivity probe.
#[derive(Debug, Clone)]
pub struct McpProbeOutcome {
    /// Whether the initialize handshake completed successfully.
    pub ok: bool,
    /// Server name reported by `serverInfo` (when available).
    pub server_name: Option<String>,
    /// Server version reported by `serverInfo` (when available).
    pub server_version: Option<String>,
    /// Human-readable result / failure message.
    pub message: String,
}

impl McpProbeOutcome {
    fn success(server_name: Option<String>, server_version: Option<String>) -> Self {
        let label = match (&server_name, &server_version) {
            (Some(n), Some(v)) => format!("{n} v{v}"),
            (Some(n), None) => n.clone(),
            _ => "MCP server".to_string(),
        };
        Self {
            ok: true,
            server_name,
            server_version,
            message: format!("{label} responded to the initialize handshake"),
        }
    }

    fn failure(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            server_name: None,
            server_version: None,
            message: message.into(),
        }
    }
}

/// Executes MCP `initialize` handshakes against real servers.
pub struct McpProbe;

impl McpProbe {
    /// Probe a stdio server by launching the command via the unified executor
    /// and performing a newline-delimited JSON-RPC initialize handshake.
    pub async fn probe_stdio(
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> McpProbeOutcome {
        if command.trim().is_empty() {
            return McpProbeOutcome::failure(
                "Command is empty — stdio transport requires an executable command",
            );
        }

        let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
        let env_pairs: Vec<(&str, &str)> =
            env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();

        let opts = SpawnOptions::new(command, &args_ref).with_env(&env_pairs);
        let mut child = match create_executor(&ExecTarget::Local).spawn_with(opts).await {
            Ok(c) => c,
            Err(e) => {
                return McpProbeOutcome::failure(format!(
                    "Failed to launch '{command}': {e} — is it installed?"
                ));
            }
        };

        let mut stdin = match child.stdin.take() {
            Some(s) => s,
            None => {
                return McpProbeOutcome::failure(format!("Failed to open stdin for '{command}'"));
            }
        };
        let mut stdout = match child.stdout.take() {
            Some(s) => s,
            None => {
                return McpProbeOutcome::failure(format!("Failed to open stdout for '{command}'"));
            }
        };
        let stderr = child.stderr.take();

        let request = initialize_request(1);
        if let Err(e) = stdin.write_all(request.as_bytes()).await {
            return McpProbeOutcome::failure(format!("Failed to write to '{command}' stdin: {e}"));
        }
        if let Err(e) = stdin.write_all(b"\n").await {
            return McpProbeOutcome::failure(format!("Failed to write to '{command}' stdin: {e}"));
        }
        let _ = stdin.flush().await;
        drop(stdin);

        // Drain stderr on a separate task so it never blocks the handshake.
        let stderr_task = tokio::spawn(async move {
            let mut diag = String::new();
            if let Some(err) = stderr {
                let mut reader = tokio::io::BufReader::new(err);
                let mut buf = String::new();
                loop {
                    buf.clear();
                    match reader.read_line(&mut buf).await {
                        Ok(0) => break,
                        Ok(_) => {
                            let trimmed = buf.trim();
                            if !trimmed.is_empty() {
                                diag.push_str(trimmed);
                                diag.push(' ');
                            }
                        }
                        Err(_) => break,
                    }
                }
            }
            diag
        });

        let mut reader = tokio::io::BufReader::new(&mut stdout);
        let mut line = String::new();
        let start = tokio::time::Instant::now();
        loop {
            if start.elapsed() > STDIO_TIMEOUT {
                let _ = child.kill().await;
                let diag = stderr_task.await.unwrap_or_default();
                let detail = if diag.is_empty() {
                    String::new()
                } else {
                    format!(" (stderr: {diag})")
                };
                return McpProbeOutcome::failure(format!(
                    "Timed out waiting for '{command}' to respond{detail}"
                ));
            }

            line.clear();
            match tokio::time::timeout(STDIO_TIMEOUT - start.elapsed(), reader.read_line(&mut line))
                .await
            {
                Ok(Ok(0)) => break,
                Ok(Ok(_)) => {
                    let trimmed = line.trim();
                    if !trimmed.is_empty()
                        && (trimmed.contains("\"result\"") || trimmed.contains("\"error\""))
                    {
                        let _ = child.kill().await;
                        let _ = stderr_task.await;
                        return parse_initialize_response(trimmed).unwrap_or_else(|e| {
                            McpProbeOutcome::failure(format!(
                                "'{command}' returned an unparseable response: {e}"
                            ))
                        });
                    }
                }
                Ok(Err(_)) => break,
                Err(_) => {
                    let _ = child.kill().await;
                    let diag = stderr_task.await.unwrap_or_default();
                    let detail = if diag.is_empty() {
                        String::new()
                    } else {
                        format!(" (stderr: {diag})")
                    };
                    return McpProbeOutcome::failure(format!(
                        "Timed out waiting for '{command}' to respond{detail}"
                    ));
                }
            }
        }

        let _ = child.kill().await;
        let diag = stderr_task.await.unwrap_or_default();
        if diag.is_empty() {
            McpProbeOutcome::failure(format!(
                "'{command}' did not answer the initialize request (no response)"
            ))
        } else {
            McpProbeOutcome::failure(format!(
                "'{command}' did not answer the initialize request (stderr: {diag})"
            ))
        }
    }

    /// Probe a streamable-http server by POSTing an initialize request.
    pub async fn probe_http(url: &str) -> McpProbeOutcome {
        let url = match normalize_remote_url(url) {
            Ok(u) => u,
            Err(msg) => return McpProbeOutcome::failure(msg),
        };

        let client = match reqwest::Client::builder().timeout(REMOTE_TIMEOUT).build() {
            Ok(c) => c,
            Err(e) => return McpProbeOutcome::failure(format!("Failed to build HTTP client: {e}")),
        };

        let resp = match client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .body(initialize_request(1))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                return McpProbeOutcome::failure(format!("Could not reach '{url}': {e}"));
            }
        };

        let status = resp.status();
        let body = match resp.text().await {
            Ok(b) => b,
            Err(e) => {
                return McpProbeOutcome::failure(format!(
                    "Could not read response from '{url}': {e}"
                ));
            }
        };

        if !status.is_success() {
            return McpProbeOutcome::failure(format!(
                "HTTP {status} from '{url}': {}",
                first_line(&body)
            ));
        }

        parse_initialize_response(&body).unwrap_or_else(|e| {
            McpProbeOutcome::failure(format!(
                "'{url}' returned an unparseable initialize response: {e}"
            ))
        })
    }

    /// Probe a legacy SSE server: discover the message endpoint from the
    /// `event: endpoint` stream, then POST an initialize request to it.
    pub async fn probe_sse(url: &str) -> McpProbeOutcome {
        use futures::StreamExt;
        use tokio::time::timeout;

        let url = match normalize_remote_url(url) {
            Ok(u) => u,
            Err(msg) => return McpProbeOutcome::failure(msg),
        };

        let client = match reqwest::Client::builder().timeout(REMOTE_TIMEOUT).build() {
            Ok(c) => c,
            Err(e) => return McpProbeOutcome::failure(format!("Failed to build HTTP client: {e}")),
        };

        let resp = match client
            .get(&url)
            .header("Accept", "text/event-stream")
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                return McpProbeOutcome::failure(format!(
                    "Could not reach SSE stream '{url}': {e}"
                ));
            }
        };

        if !resp.status().is_success() {
            return McpProbeOutcome::failure(format!(
                "SSE stream returned HTTP {} from '{url}'",
                resp.status()
            ));
        }

        let mut stream = resp.bytes_stream();
        let mut event = String::new();
        let mut data = String::new();
        let mut endpoint: Option<String> = None;

        let deadline = tokio::time::Instant::now() + REMOTE_TIMEOUT;
        while tokio::time::Instant::now() < deadline {
            let chunk = match timeout(deadline - tokio::time::Instant::now(), stream.next()).await {
                Ok(Some(Ok(chunk))) => chunk,
                Ok(Some(Err(e))) => {
                    return McpProbeOutcome::failure(format!(
                        "Error reading SSE stream from '{url}': {e}"
                    ));
                }
                Ok(None) => break,
                Err(_) => {
                    return McpProbeOutcome::failure(format!(
                        "Timed out reading SSE stream from '{url}' (no endpoint advertised within {}s)",
                        REMOTE_TIMEOUT.as_secs()
                    ));
                }
            };

            let text = match std::str::from_utf8(&chunk) {
                Ok(t) => t.to_string(),
                Err(_) => continue,
            };

            for line in text.lines() {
                let line = line.trim();
                if let Some(value) = line.strip_prefix("event:") {
                    event = value.trim().to_string();
                } else if let Some(value) = line.strip_prefix("data:") {
                    data.push_str(value.trim());
                } else if line.is_empty() {
                    if event == "endpoint" && !data.is_empty() {
                        endpoint = Some(data.clone());
                        break;
                    }
                    event.clear();
                    data.clear();
                }
            }
            if endpoint.is_some() {
                break;
            }
        }

        let endpoint = match endpoint {
            Some(e) => e,
            None => {
                return McpProbeOutcome::failure(format!(
                    "SSE stream from '{url}' did not advertise an endpoint"
                ));
            }
        };

        let message_url = resolve_endpoint_url(&url, &endpoint);
        let outcome = Self::probe_http(&message_url).await;
        match outcome {
            McpProbeOutcome {
                ok: false, message, ..
            } => McpProbeOutcome::failure(format!(
                "SSE endpoint '{message_url}' failed the initialize handshake: {message}"
            )),
            ok => ok,
        }
    }
}

/// Build a JSON-RPC 2.0 initialize request body.
fn initialize_request(id: i64) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": "neeko",
                "version": env!("CARGO_PKG_VERSION"),
            },
        },
    })
    .to_string()
}

/// Parse a JSON-RPC initialize response. Accepts a plain JSON body or a
/// server-sent-events body (`event: message` / `data: <json>`).
fn parse_initialize_response(body: &str) -> Result<McpProbeOutcome, AppError> {
    let body = body.trim();
    if body.is_empty() {
        return Err(AppError::InvalidInput("empty response body".to_string()));
    }

    // Prefer SSE `data:` payloads when present; otherwise treat the body as raw JSON.
    let payload = if body.contains("\ndata:") || body.starts_with("data:") {
        body.lines()
            .filter_map(|l| l.trim().strip_prefix("data:"))
            .map(str::trim)
            .collect::<Vec<_>>()
            .join("")
    } else {
        body.to_string()
    };

    let value: Value = serde_json::from_str(&payload).map_err(|e| {
        AppError::InvalidInput(format!(
            "response is not valid JSON-RPC: {e} (body: {})",
            first_line(body)
        ))
    })?;

    if let Some(err) = value.get("error").and_then(|e| e.as_object()) {
        let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or_default();
        let message = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        return Ok(McpProbeOutcome::failure(format!(
            "server returned JSON-RPC error {code}: {message}"
        )));
    }

    if let Some(result) = value.get("result") {
        let info = result.get("serverInfo").and_then(|i| i.as_object());
        let server_name = info
            .and_then(|i| i.get("name"))
            .and_then(|n| n.as_str())
            .map(str::to_string);
        let server_version = info
            .and_then(|i| i.get("version"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        return Ok(McpProbeOutcome::success(server_name, server_version));
    }

    Err(AppError::InvalidInput(format!(
        "response has neither `result` nor `error` (body: {})",
        first_line(body)
    )))
}

/// Validate and normalize a remote endpoint URL (must be http(s)).
fn normalize_remote_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("URL is required for remote transport".to_string());
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("URL must start with http:// or https://: {url}"));
    }
    Ok(url.to_string())
}

/// Resolve an SSE `endpoint` (relative or absolute) against the base URL.
fn resolve_endpoint_url(base: &str, endpoint: &str) -> String {
    if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
        return endpoint.to_string();
    }
    if endpoint.starts_with('/') {
        // Absolute path — replace the base path component.
        let base = base.trim_end_matches('/');
        let base = match base.rfind('/') {
            Some(idx) if idx > 8 => &base[..idx],
            _ => base,
        };
        format!("{base}{endpoint}")
    } else {
        let base = base.trim_end_matches('/');
        format!("{base}/{endpoint}")
    }
}

/// First non-empty line of a body, truncated for diagnostics.
fn first_line(body: &str) -> String {
    body.lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .chars()
        .take(200)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── pure function tests ────────────────────────────────────────────────

    #[test]
    fn initialize_request_has_required_fields() {
        let req = initialize_request(1);
        let value: Value = serde_json::from_str(&req).unwrap();
        assert_eq!(value["jsonrpc"], "2.0");
        assert_eq!(value["method"], "initialize");
        assert_eq!(value["id"], 1);
        assert_eq!(value["params"]["protocolVersion"], PROTOCOL_VERSION);
        assert!(value["params"]["clientInfo"]["name"].is_string());
    }

    #[test]
    fn parse_plain_json_success() {
        let body = r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"fs-mcp","version":"1.2.3"}}}"#;
        let outcome = parse_initialize_response(body).unwrap();
        assert!(outcome.ok);
        assert_eq!(outcome.server_name.as_deref(), Some("fs-mcp"));
        assert_eq!(outcome.server_version.as_deref(), Some("1.2.3"));
        assert!(outcome.message.contains("fs-mcp v1.2.3"));
    }

    #[test]
    fn parse_plain_json_error() {
        let body =
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}"#;
        let outcome = parse_initialize_response(body).unwrap();
        assert!(!outcome.ok);
        assert!(outcome.message.contains("-32601"));
        assert!(outcome.message.contains("Method not found"));
    }

    #[test]
    fn parse_sse_event_payload() {
        let body = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"serverInfo\":{\"name\":\"sse-server\"}}}\n\n";
        let outcome = parse_initialize_response(body).unwrap();
        assert!(outcome.ok);
        assert_eq!(outcome.server_name.as_deref(), Some("sse-server"));
    }

    #[test]
    fn parse_garbage_errors() {
        assert!(parse_initialize_response("not json at all").is_err());
        assert!(parse_initialize_response("").is_err());
        assert!(parse_initialize_response(r#"{"jsonrpc":"2.0","id":1}"#).is_err());
    }

    #[test]
    fn normalize_url_validation() {
        assert_eq!(
            normalize_remote_url("https://example.com/mcp").unwrap(),
            "https://example.com/mcp"
        );
        assert!(normalize_remote_url("").is_err());
        assert!(normalize_remote_url("ftp://example.com").is_err());
    }

    #[test]
    fn resolve_endpoint_url_handles_relative_and_absolute() {
        assert_eq!(
            resolve_endpoint_url("https://x.com/sse", "/mcp"),
            "https://x.com/mcp"
        );
        assert_eq!(
            resolve_endpoint_url("https://x.com/sse", "https://y.com/mcp"),
            "https://y.com/mcp"
        );
    }

    // ── stdio integration test ─────────────────────────────────────────────

    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "flaky in CI due to std::process::Command + spawn_blocking interaction"]
    async fn probe_stdio_handshake_with_fake_server() {
        let outcome = McpProbe::probe_stdio("/bin/echo", &[String::from("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"serverInfo\":{\"name\":\"fake-mcp\",\"version\":\"3.0.0\"}}}")], &HashMap::new()).await;
        assert!(outcome.ok, "{}", outcome.message);
        assert_eq!(outcome.server_name.as_deref(), Some("fake-mcp"));
        assert_eq!(outcome.server_version.as_deref(), Some("3.0.0"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn probe_stdio_missing_command_returns_failure() {
        let outcome =
            McpProbe::probe_stdio("__neeko_nonexistent_cmd__", &[], &HashMap::new()).await;
        assert!(!outcome.ok);
        assert!(
            outcome.message.contains("not found") || outcome.message.contains("Failed to launch")
        );
    }

    // ── http integration test ──────────────────────────────────────────────

    #[tokio::test]
    async fn probe_http_handshake_with_fake_server() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{addr}/mcp");

        let handle = tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

            let (mut sock, _) = listener.accept().await.unwrap();
            let mut reader = tokio::io::BufReader::new(&mut sock);
            let mut head = String::new();

            loop {
                let mut line = String::new();
                match reader.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            break;
                        }
                        head.push_str(trimmed);
                        head.push('\n');
                    }
                    Err(_) => break,
                }
            }

            let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"serverInfo\":{\"name\":\"http-mcp\",\"version\":\"1.2.3\"}}}";
            sock.write_all(response.as_bytes()).await.unwrap();
            sock.flush().await.unwrap();
            let _ = sock.shutdown().await;
        });

        let outcome = McpProbe::probe_http(&url).await;
        handle.await.unwrap();
        assert!(outcome.ok, "{}", outcome.message);
        assert_eq!(outcome.server_name.as_deref(), Some("http-mcp"));
        assert_eq!(outcome.server_version.as_deref(), Some("1.2.3"));
    }

    #[tokio::test]
    async fn probe_http_unreachable_url_returns_failure() {
        let outcome = McpProbe::probe_http("http://127.0.0.1:1/mcp").await;
        assert!(!outcome.ok);
    }
}
