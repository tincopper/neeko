//! mockAgent — in-process mock ACP agent (dev/test tool).
//!
//! Speaks the Agent Client Protocol (ACP) over JSON-RPC stdio framing,
//! exactly like the real DeepSeek Harness ACP bridge, but runs **in-process**:
//! `run_mock_loop` drives any `AsyncRead`/`AsyncWrite` pair, so `AcpAdapter`
//! can feed it a `tokio::io::duplex()` pipe instead of spawning a child
//! process. Simulates the full lifecycle: text stream, a permission request
//! (Gate), the approval reply, turn end, and cancel handling.
//!
//! Frame format (LSP-style): `Content-Length: <n>\r\n\r\n<json body>`.

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};

const SESSION_ID: &str = "mock-s1";

/// Drive the mock ACP server over `reader` / `writer` until EOF or cancel.
pub async fn run_mock_loop<R, W>(reader: R, writer: W)
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut reader = BufReader::new(reader);
    let mut writer = writer;
    while let Some(body) = read_frame(&mut reader).await {
        let Ok(msg) = serde_json::from_str::<Value>(&body) else {
            continue;
        };
        if !handle_request(&msg, &mut reader, &mut writer).await {
            break;
        }
    }
}

/// Read one Content-Length framed message. `None` on EOF.
async fn read_frame<R: AsyncRead + Unpin>(reader: &mut BufReader<R>) -> Option<String> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).await.ok()?;
        if n == 0 {
            return None; // EOF
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break; // end of headers
        }
        if let Some(v) = trimmed.strip_prefix("Content-Length:") {
            content_length = v.trim().parse().ok();
        }
    }
    let len = content_length?;
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).await.ok()?;
    String::from_utf8(body).ok()
}

async fn send<W: AsyncWrite + Unpin>(writer: &mut W, v: &Value) {
    let body = v.to_string();
    let frame = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
    let _ = writer.write_all(frame.as_bytes()).await;
    let _ = writer.flush().await;
}

/// Handle one client request. Returns `false` when the session should exit.
async fn handle_request<R, W>(msg: &Value, reader: &mut BufReader<R>, writer: &mut W) -> bool
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = msg.get("id").and_then(|i| i.as_i64()).unwrap_or(0);
    match method {
        "initialize" => {
            send(
                writer,
                &json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "protocolVersion": 1,
                        "agentInfo": { "name": "mockAgent", "version": "0.1.0" },
                        "agentCapabilities": {
                            "promptCapabilities": { "image": false, "audio": false, "embeddedContext": false }
                        },
                        "authMethods": []
                    }
                }),
            )
            .await;
        }
        "session/new" => {
            send(
                writer,
                &json!({ "jsonrpc": "2.0", "id": id, "result": { "sessionId": SESSION_ID } }),
            )
            .await;
        }
        "session/prompt" => {
            // ── Simulated turn: 先输出意图 → 再执行工具 → 工具完成后输出文本 ──
            // 真实 agent 的流式语义：文本与工具调用按到达顺序穿插，每次工具调用
            // 前先输出意图（text_delta），工具执行完后再输出结果文本。

            // 1. Opening: announce the plan（先输出总体意图）
            update_chunk(
                writer,
                "你好，让我先读取几个关键文件，然后进行一些修改。\n\n",
            )
            .await;

            // 2. 先输出意图：声明要读取 adapter.rs
            update_chunk(writer, "让我先读取 adapter.rs 文件。\n\n").await;

            // 3. 再执行工具：read_file
            tool_call(
                writer,
                "tc_1",
                "read_file",
                "src-tauri/src/agent/chat/adapter.rs",
                "running",
            )
            .await;
            tool_output(
                writer,
                "tc_1",
                "use async_trait::async_trait;\nuse tokio::sync::mpsc;\n\nuse crate::agent::chat::events::{SessionRequest, StreamEvent};\n// ... adapter implementation ...",
            )
            .await;
            tool_end(writer, "tc_1", "done").await;

            // 4. 工具完成后输出文本
            update_chunk(writer, "已读取 adapter.rs。现在准备修改它。\n\n").await;

            // 5. 再执行下一个工具：edit_file（触发审批门）
            tool_call(
                writer,
                "tc_2",
                "edit_file",
                "src-tauri/src/agent/chat/adapter.rs",
                "running",
            )
            .await;

            // 5b. 审批门：请求修改权限（带 diff 预览）
            let diff_content = r#"@@ -15,7 +15,9 @@ use crate::agent::chat::events::{SessionRequest, StreamEvent};
 pub trait AgentAdapter: Send + Sync {
     /// Returns the agent kind this adapter handles.
     fn kind(&self) -> AgentKind;
-    /// Create a session bound to `ctx`.
+    /// Create a session bound to `ctx`. Spawns or connects internally.
+    /// Returns a boxed session that can be driven by the bridge.
     async fn create(&self, ctx: &AgentContext) -> Result<Box<dyn AgentSession>, AppError>;
+    /// Returns the capabilities declared by this agent.
+    fn capabilities(&self) -> Capabilities;
 }"#;

            send(
                writer,
                &json!({
                    "jsonrpc": "2.0",
                    "id": 100,
                    "method": "session/request_permission",
                    "params": {
                        "sessionId": SESSION_ID,
                        "toolCall": { "toolCallId": "tc_2", "toolName": "edit_file" },
                        "title": "src-tauri/src/agent/chat/adapter.rs",
                        "explanation": "mockAgent 请求修改 adapter.rs：为 AgentAdapter trait 添加 capabilities 方法",
                        "diff": diff_content,
                        "options": [
                            { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
                            { "optionId": "reject-once", "name": "Reject", "kind": "reject_once" }
                        ]
                    }
                }),
            )
            .await;

            let mut approved = false;
            if let Some(resp) = read_frame(reader).await {
                if let Ok(v) = serde_json::from_str::<Value>(&resp) {
                    let outcome = v
                        .get("result")
                        .and_then(|r| r.get("outcome"))
                        .and_then(|o| o.as_str())
                        .unwrap_or("");
                    approved = outcome == "allow-once";
                }
            }

            if approved {
                tool_output(
                    writer,
                    "tc_2",
                    &format!(
                        "Successfully applied edit to src-tauri/src/agent/chat/adapter.rs\n\n{}",
                        diff_content
                    ),
                )
                .await;
                tool_end(writer, "tc_2", "done").await;
                // 6. 工具完成后输出文本：审批结果 + 下一条意图合并为一条 text_delta
                update_chunk(
                    writer,
                    "✅ 已允许。修改已应用到 adapter.rs。现在执行一条命令来验证修改。\n\n",
                )
                .await;
            } else {
                tool_output(writer, "tc_2", "Edit rejected by user").await;
                tool_end(writer, "tc_2", "failed").await;
                update_chunk(writer, "❌ 已拒绝该修改，跳过此步骤。\n\n").await;
            }

            // 7. Command execution
            command_run(
                writer,
                "cmd_1",
                "/Users/tomgs/RustroverProjects/neeko",
                "cargo check --message-format=json",
            )
            .await;

            // 7b. 审批门：请求运行命令权限
            send(
                writer,
                &json!({
                    "jsonrpc": "2.0",
                    "id": 101,
                    "method": "session/request_permission",
                    "params": {
                        "sessionId": SESSION_ID,
                        "toolCall": { "toolCallId": "tc_3", "toolName": "run_command" },
                        "title": "cargo check",
                        "explanation": "mockAgent 请求运行 cargo check 验证编译是否通过",
                        "options": [
                            { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
                            { "optionId": "reject-once", "name": "Reject", "kind": "reject_once" }
                        ]
                    }
                }),
            )
            .await;

            let mut cmd_approved = false;
            if let Some(resp) = read_frame(reader).await {
                if let Ok(v) = serde_json::from_str::<Value>(&resp) {
                    let outcome = v
                        .get("result")
                        .and_then(|r| r.get("outcome"))
                        .and_then(|o| o.as_str())
                        .unwrap_or("");
                    cmd_approved = outcome == "allow-once";
                }
            }

            if cmd_approved {
                // 命令执行结果走 tool_output/tool_end —— 前端以 Codex 风格终端块展示
                tool_output(
                    writer,
                    "cmd_1",
                    "Compiling neeko v1.0.6 (debug)\n   Finished `dev` profile [optimized] target(s) in 8.99s",
                )
                .await;
                tool_end(writer, "cmd_1", "done").await;
                // 8. 最终总结：编译结果 + 流程回顾合并为一条 text_delta
                update_chunk(
                    writer,
                    "✅ 编译通过。本轮处理完成！以上就是 mockAgent 的完整模拟流程，包括：文件读取、文件编辑（带 diff 审批）、命令执行。你可以继续发送消息进行多轮对话。\n\n",
                )
                .await;
            } else {
                tool_end(writer, "cmd_1", "failed").await;
                update_chunk(writer, "❌ 命令执行被拒绝。\n\n").await;
            }

            // 9. Turn end
            send(
                writer,
                &json!({
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {
                        "sessionId": SESSION_ID,
                        "update": {
                            "sessionUpdate": "turn_end",
                            "turnId": "t1",
                            "reason": { "kind": "completed" }
                        }
                    }
                }),
            )
            .await;
        }
        "session/cancel" => {
            send(writer, &json!({ "jsonrpc": "2.0", "id": id, "result": {} })).await;
            return false;
        }
        _ => {
            // Unknown method: respond with a JSON-RPC error so the client
            // does not hang waiting.
            send(
                writer,
                &json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": { "error": { "code": -32601, "message": format!("method not found: {method}") } }
                }),
            )
            .await;
        }
    }
    true
}

async fn update_chunk<W: AsyncWrite + Unpin>(writer: &mut W, text: &str) {
    // 追加换行：真实 Agent（opencode / claude-code 等）的文本流按行/段落分隔，
    // mock 必须保持一致，否则前端把整段粘成一行，命令执行内容无法单独成行。
    let mut chunk = text.to_string();
    if !chunk.ends_with('\n') {
        chunk.push('\n');
    }
    send(
        writer,
        &json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": SESSION_ID,
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": { "type": "text", "text": chunk }
                }
            }
        }),
    )
    .await;
}

/// Emit a `tool_call` notification (tool start).
async fn tool_call<W: AsyncWrite + Unpin>(
    writer: &mut W,
    call_id: &str,
    name: &str,
    title: &str,
    status: &str,
) {
    send(
        writer,
        &json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": SESSION_ID,
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": call_id,
                    "toolName": name,
                    "title": title,
                    "status": status
                }
            }
        }),
    )
    .await;
}

/// Emit a `tool_output` notification (incremental tool output).
async fn tool_output<W: AsyncWrite + Unpin>(writer: &mut W, call_id: &str, output: &str) {
    send(
        writer,
        &json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": SESSION_ID,
                "update": {
                    "sessionUpdate": "tool_output",
                    "toolCallId": call_id,
                    "output": output
                }
            }
        }),
    )
    .await;
}

/// Emit a `tool_end` notification (tool call finished).
async fn tool_end<W: AsyncWrite + Unpin>(writer: &mut W, call_id: &str, status: &str) {
    send(
        writer,
        &json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": SESSION_ID,
                "update": {
                    "sessionUpdate": "tool_end",
                    "toolCallId": call_id,
                    "status": status
                }
            }
        }),
    )
    .await;
}

/// Emit a `command_run` notification (agent wants to run a command).
async fn command_run<W: AsyncWrite + Unpin>(writer: &mut W, call_id: &str, cwd: &str, cmd: &str) {
    send(
        writer,
        &json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": SESSION_ID,
                "update": {
                    "sessionUpdate": "command_run",
                    "toolCallId": call_id,
                    "cwd": cwd,
                    "command": cmd
                }
            }
        }),
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use tokio::io::{AsyncWriteExt, BufReader};

    /// Send one Content-Length framed JSON-RPC message from the client side.
    async fn client_send<W: AsyncWrite + Unpin>(writer: &mut W, v: &Value) {
        let body = v.to_string();
        let frame = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
        writer
            .write_all(frame.as_bytes())
            .await
            .expect("write frame");
        writer.flush().await.expect("flush frame");
    }

    /// Normalize one `session/update` into a compact comparable string.
    fn normalize(kind: &str, update: &Value) -> String {
        match kind {
            "agent_message_chunk" => {
                let text = update["content"]["text"]
                    .as_str()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                format!("text:{text}")
            }
            "tool_call" => format!(
                "tool_call:{}:{}",
                update["toolName"].as_str().unwrap_or(""),
                update["toolCallId"].as_str().unwrap_or("")
            ),
            "tool_output" => format!(
                "tool_output:{}",
                update["toolCallId"].as_str().unwrap_or("")
            ),
            "tool_end" => format!(
                "tool_end:{}:{}",
                update["toolCallId"].as_str().unwrap_or(""),
                update["status"].as_str().unwrap_or("")
            ),
            "command_run" => {
                format!(
                    "command_run:{}",
                    update["toolCallId"].as_str().unwrap_or("")
                )
            }
            "turn_end" => format!(
                "turn_end:{}",
                update["reason"]["kind"].as_str().unwrap_or("")
            ),
            other => format!("{other}:{update}"),
        }
    }

    /// Drive the mock ACP server for one `session/prompt` turn, auto-approving
    /// every `request_permission` request, and return the ordered normalized
    /// `session/update` sequence.
    async fn drive_mock_turn() -> Vec<String> {
        let (client, mock) = tokio::io::duplex(65536);
        let (mock_reader, mock_writer) = tokio::io::split(mock);
        tokio::spawn(run_mock_loop(mock_reader, mock_writer));
        let (client_reader, mut client_writer) = tokio::io::split(client);
        let mut reader = BufReader::new(client_reader);

        // Handshake: initialize → session/new → session/prompt.
        client_send(
            &mut client_writer,
            &json!({"jsonrpc":"2.0","id":1,"method":"initialize"}),
        )
        .await;
        assert!(read_frame(&mut reader).await.is_some(), "initialize resp");
        client_send(
            &mut client_writer,
            &json!({"jsonrpc":"2.0","id":2,"method":"session/new"}),
        )
        .await;
        assert!(read_frame(&mut reader).await.is_some(), "session/new resp");
        client_send(
            &mut client_writer,
            &json!({
                "jsonrpc":"2.0","id":3,"method":"session/prompt",
                "params":{"sessionId":SESSION_ID,"prompt":[{"type":"text","text":"hi"}]}
            }),
        )
        .await;

        let mut updates = Vec::new();
        while let Some(body) = read_frame(&mut reader).await {
            let v: Value = serde_json::from_str(&body).expect("json frame");
            if let Some(method) = v.get("method").and_then(|m| m.as_str()) {
                match method {
                    "session/request_permission" => {
                        let id = v.get("id").and_then(|i| i.as_i64()).unwrap_or(0);
                        let call_id = v["params"]["toolCall"]["toolCallId"]
                            .as_str()
                            .unwrap_or("")
                            .to_string();
                        client_send(
                            &mut client_writer,
                            &json!({"jsonrpc":"2.0","id":id,"result":{"outcome":"allow-once"}}),
                        )
                        .await;
                        updates.push(format!("permission:{call_id}"));
                    }
                    "session/update" => {
                        let update = &v["params"]["update"];
                        let kind = update["sessionUpdate"].as_str().unwrap_or("").to_string();
                        let normalized = normalize(&kind, update);
                        let is_turn_end = kind == "turn_end";
                        updates.push(normalized);
                        if is_turn_end {
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
        updates
    }

    /// 回归测试：mockAgent 的输出流程必须遵循「先输出意图 → 再执行工具 → 工具
    /// 完成后输出文本 → 执行命令 → 最终总结」的流式顺序（对齐前端 mock 参考实现）。
    ///
    /// 期望序列（每条会话更新一条，审批门省略在 tool_output 之前的 request_permission）：
    /// 1. text: 你好，让我先读取几个关键文件...
    /// 2. text: 让我先读取 adapter.rs 文件。        ← 先输出意图
    /// 3. tool_call → tool_output → tool_end (read_file)
    /// 4. text: 已读取 adapter.rs。现在准备修改它。  ← 工具完成后输出文本
    /// 5. tool_call → tool_output → tool_end (edit_file)
    /// 6. text: ✅ 已允许。修改已应用到 adapter.rs。现在执行一条命令来验证修改。
    /// 7. command_run → tool_output → tool_end
    /// 8. text: ✅ 编译通过。本轮处理完成！...
    #[tokio::test]
    async fn mock_output_flow_matches_expected_sequence() {
        let updates = drive_mock_turn().await;
        let expected = vec![
            "text:你好，让我先读取几个关键文件，然后进行一些修改。".to_string(),
            "text:让我先读取 adapter.rs 文件。".to_string(),
            "tool_call:read_file:tc_1".to_string(),
            "tool_output:tc_1".to_string(),
            "tool_end:tc_1:done".to_string(),
            "text:已读取 adapter.rs。现在准备修改它。".to_string(),
            "tool_call:edit_file:tc_2".to_string(),
            "permission:tc_2".to_string(),
            "tool_output:tc_2".to_string(),
            "tool_end:tc_2:done".to_string(),
            "text:✅ 已允许。修改已应用到 adapter.rs。现在执行一条命令来验证修改。"
                .to_string(),
            "command_run:cmd_1".to_string(),
            "permission:tc_3".to_string(),
            "tool_output:cmd_1".to_string(),
            "tool_end:cmd_1:done".to_string(),
            "text:✅ 编译通过。本轮处理完成！以上就是 mockAgent 的完整模拟流程，包括：文件读取、文件编辑（带 diff 审批）、命令执行。你可以继续发送消息进行多轮对话。"
                .to_string(),
            "turn_end:completed".to_string(),
        ];
        assert_eq!(updates, expected);
    }
}
