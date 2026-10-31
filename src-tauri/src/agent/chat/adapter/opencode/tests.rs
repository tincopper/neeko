use std::collections::{HashMap, HashSet};

use crate::agent::chat::adapter::session_config::CATEGORY_THOUGHT_LEVEL;
use crate::agent::chat::adapter::AgentContext;
use crate::agent::chat::events::{ErrorKind, StreamEvent, TodoItem, TurnEndReason};

use super::{
    adapter::{missing_session_message, models_from_api_response, session_exists_from_status},
    config_options::{
        mode_option, thought_level_option, variants_of_model, ConfigKind, ConfigState,
    },
    connection::{base64_encode, extract_listening_url, extract_server_password},
    events_v1::{translate_event, PartKind, ServeEvent},
    events_v2::{self, session_of as session_of_v2, translate as translate_v2, V2State},
    eventurl::{event_stream_url, question_reply_url},
    protocol::{
        detect_protocol, model_body, model_slug_split, model_switch_body,
        model_switch_body_with_variant, permission_reply_body, prompt_body_for,
        prompt_body_with_options, question_reply_body, session_create_body, session_create_url,
        ServeProtocol,
    },
    pump::{process_buffered_lines, PumpTarget, Translator},
    tool_title::tool_title,
};

fn sse_event(json: &str) -> ServeEvent {
    serde_json::from_str(json).expect("valid sse event")
}

/// 从事件列表中取唯一事件（测试断言用）；为空或多余一个则 panic。
fn single(events: Vec<StreamEvent>) -> StreamEvent {
    let mut it = events.into_iter();
    let first = it.next().expect("expected exactly one event, got none");
    assert!(it.next().is_none(), "expected exactly one event, got more");
    first
}

fn serve_ctx(project_id: &str) -> AgentContext {
    AgentContext {
        agent_id: "opencode".into(),
        session_id: "ac_test".into(),
        cwd: project_id.into(),
        workspace: crate::common::git::WorkspaceSession::main(project_id),
        project_name: "demo".into(),
        env: "local".into(),
        skills: vec![],
        files: vec![],
        mode: "auto".into(),
        prompt: String::new(),
        model_id: None,
    }
}

#[test]
fn session_create_url_carries_project_directory() {
    let url = session_create_url(
        ServeProtocol::V1,
        "http://127.0.0.1:4096",
        &serve_ctx("/tmp/demo proj"),
    );
    assert_eq!(
        url, "http://127.0.0.1:4096/session?directory=%2Ftmp%2Fdemo%20proj",
        "POST /session 必须显式传 directory（会话工作目录），否则继承 serve 进程 cwd"
    );
}

#[test]
fn session_create_url_encodes_absolute_path() {
    let url = session_create_url(
        ServeProtocol::V1,
        "http://127.0.0.1:4096",
        &serve_ctx("/Users/demo/RustroverProjects/neeko"),
    );
    assert!(url.ends_with("?directory=%2FUsers%2Fdemo%2FRustroverProjects%2Fneeko"));
}

/// opencode 1.18.x 起按目录过滤事件广播：裸 `/event` 只推 server 级事件
///（connected/heartbeat），会话与消息事件必须带 `directory` 查询参数才会
/// 下发。回归实证（2026-08-22）：不带参数时模型回复已落盘但 SSE 零推送，
/// 前端表现为发送后一直 thinking 无任何响应数据。
#[test]
fn event_stream_url_encodes_directory_filter() {
    assert_eq!(
        event_stream_url(
            ServeProtocol::V1,
            "http://127.0.0.1:55652",
            "/Users/demo/my proj"
        ),
        "http://127.0.0.1:55652/event?directory=%2FUsers%2Fdemo%2Fmy%20proj"
    );
}

/// 提问回执路由（实测钉死，2026-10-14）：serve 的公开面是
/// `POST /question/{requestID}/reply?directory=…`（`200 application/json` + `true`）。
///
/// 曾经写错的形态 `POST /api/session/{sid}/question/{rid}/reply` 实测返回
/// `404 QuestionNotFoundError` —— 那一族是内部 SDK 面。写错时用户点「回答」后
/// agent 永久挂起，故连 URL 形状一起钉住。
#[test]
fn question_reply_url_uses_public_route_with_directory() {
    assert_eq!(
        question_reply_url("http://127.0.0.1:55652", "/Users/demo/my proj", "que_abc"),
        "http://127.0.0.1:55652/question/que_abc/reply?directory=%2FUsers%2Fdemo%2Fmy%20proj"
    );
}

/// 回执路由**不得**带 `/api` 前缀，也**不得**漏 `directory`（两者实测都是 404）。
#[test]
fn question_reply_url_shape_guards() {
    let url = question_reply_url("http://h:1", "/tmp/p", "que_1");
    assert!(!url.contains("/api/"), "serve 公开面无 /api 前缀：{url}");
    assert!(url.contains("directory="), "directory 必填：{url}");
    assert!(url.starts_with("http://h:1/question/que_1/reply?"), "{url}");
}

#[test]
fn text_delta_translates_from_part_delta() {
    let event = sse_event(
        r#"{"type":"message.part.delta","properties":{"sessionID":"ses_1","messageID":"msg_1","partID":"prt_text","field":"text","delta":"hello"}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    kinds.insert("prt_text".to_string(), PartKind::Text);
    let ev = single(translate_event("ac_1", &event, &mut kinds, &mut started));
    assert_eq!(
        ev,
        StreamEvent::TextDelta {
            session_id: "ac_1".into(),
            delta: "hello".into()
        }
    );
}

#[test]
fn reasoning_delta_translates_when_part_is_reasoning() {
    let event = sse_event(
        r#"{"type":"message.part.delta","properties":{"sessionID":"ses_1","messageID":"msg_1","partID":"prt_reason","field":"text","delta":"想想"}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    kinds.insert("prt_reason".to_string(), PartKind::Reasoning);
    let ev = single(translate_event("ac_1", &event, &mut kinds, &mut started));
    assert_eq!(
        ev,
        StreamEvent::ReasoningDelta {
            session_id: "ac_1".into(),
            delta: "想想".into()
        }
    );
}

#[test]
fn part_updated_registers_kind_for_later_deltas() {
    let updated = sse_event(
        r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_reason","type":"reasoning","text":""}}}"#,
    );
    let delta = sse_event(
        r#"{"type":"message.part.delta","properties":{"sessionID":"ses_1","partID":"prt_reason","field":"text","delta":"ok"}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    assert!(translate_event("ac_1", &updated, &mut kinds, &mut started).is_empty());
    let ev = single(translate_event("ac_1", &delta, &mut kinds, &mut started));
    assert_eq!(
        ev,
        StreamEvent::ReasoningDelta {
            session_id: "ac_1".into(),
            delta: "ok".into()
        }
    );
}

#[test]
fn tool_running_translates_to_tool_start() {
    let event = sse_event(
        r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_t","type":"tool","tool":"bash","callID":"bash_0","state":{"status":"running","input":{"command":"echo hi"},"metadata":{"output":""}}}}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    let ev = single(translate_event("ac_1", &event, &mut kinds, &mut started));
    assert_eq!(
        ev,
        StreamEvent::ToolStart {
            session_id: "ac_1".into(),
            call_id: "bash_0".into(),
            name: "bash".into(),
            title: "echo hi".into(),
        }
    );
}

#[test]
fn tool_completed_translates_to_tool_output_then_end() {
    let event = sse_event(
        r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_t","type":"tool","tool":"bash","callID":"bash_1","state":{"status":"completed","input":{"command":"echo hi"},"output":"hi\n","title":"echo hi","metadata":{}}}}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    let evs = translate_event("ac_1", &event, &mut kinds, &mut started);
    assert_eq!(
        evs,
        vec![
            StreamEvent::ToolOutput {
                session_id: "ac_1".into(),
                call_id: "bash_1".into(),
                output: "hi\n".into(),
            },
            StreamEvent::ToolEnd {
                session_id: "ac_1".into(),
                call_id: "bash_1".into(),
                status: "done".into(),
            },
        ]
    );
}

#[test]
fn tool_completed_without_output_only_ends() {
    let event = sse_event(
        r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_t","type":"tool","tool":"bash","callID":"bash_3","state":{"status":"completed","input":{},"output":"","title":"echo","metadata":{}}}}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    let evs = translate_event("ac_1", &event, &mut kinds, &mut started);
    assert_eq!(
        evs,
        vec![StreamEvent::ToolEnd {
            session_id: "ac_1".into(),
            call_id: "bash_3".into(),
            status: "done".into(),
        }]
    );
}

#[test]
fn tool_error_translates_to_tool_end_failed() {
    let event = sse_event(
        r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_t","type":"tool","tool":"bash","callID":"bash_2","state":{"status":"error","input":{},"error":"boom"}}}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    let evs = translate_event("ac_1", &event, &mut kinds, &mut started);
    assert_eq!(
        evs,
        vec![
            StreamEvent::ToolOutput {
                session_id: "ac_1".into(),
                call_id: "bash_2".into(),
                output: "boom".into(),
            },
            StreamEvent::ToolEnd {
                session_id: "ac_1".into(),
                call_id: "bash_2".into(),
                status: "failed".into(),
            },
        ]
    );
}

/// `question.asked`（ask 类工具阻塞）→ `UserInput`。
///
/// 载荷是 **2026-10-14 从真 `opencode serve` 的 `GET /event` SSE 流抓下来的逐字样本**
/// （`question.asked` 1 条，见 `/tmp/sse3.txt`），不是照二进制猜的形状 —— 实测差异：
/// `options[]` 元素带 `description`，且**没有** `multiple` 字段。
/// 缺这条路由时自有会话的提问既不显示内联面板、也不产生「等待用户行动」通知。
#[test]
fn question_asked_translates_to_user_input() {
    let event = sse_event(
        r#"{"id":"evt_138828573001lOkACjg0X0LELX","type":"question.asked","properties":{"id":"que_138828572001SACyo0ucRUWNvM","sessionID":"ses_ec77e6947ffegOTypRWn4THThq","questions":[{"question":"Which file should I edit?","header":"File to edit","options":[{"label":"Option A","description":"First file option"},{"label":"Option B","description":"Second file option"},{"label":"Option C","description":"Third file option"}]}],"tool":{"messageID":"msg_138827c2e001ytw2Xf8cJY8lNo","callID":"call_01a1388282d77360a7315548c045d7e5"}}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    let ev = single(translate_event("ac_1", &event, &mut kinds, &mut started));
    match ev {
        StreamEvent::UserInput {
            session_id,
            turn_id,
            prompt,
            options,
        } => {
            assert_eq!(session_id, "ac_1");
            // 提问 id 承载在 turn_id：回执路由键（`que_` 前缀判定 question 端点）。
            assert_eq!(turn_id, "que_138828572001SACyo0ucRUWNvM");
            // header 优先（短标签），与 hook 模板同一口径。
            assert_eq!(prompt, "File to edit");
            // 候选项必须透传且**只取 label**：前端 UserInputPanel 据此渲染可点选项，
            // 丢了就只能让用户手打 agent 已经给了的答案；description 是面板不消费的噪声。
            assert_eq!(
                options,
                vec![
                    "Option A".to_string(),
                    "Option B".to_string(),
                    "Option C".to_string()
                ]
            );
        }
        other => panic!("expected UserInput, got {other:?}"),
    }
    // 无 options（纯开放问题）→ 空 vec，前端落自由文本输入而非空选项列表。
    let plain = sse_event(
        r#"{"type":"question.asked","properties":{"id":"que_9","sessionID":"ses_1","questions":[{"header":"分支名","question":"用哪个分支？"}]}}"#,
    );
    match single(translate_event("ac_1", &plain, &mut kinds, &mut started)) {
        StreamEvent::UserInput { options, .. } => assert!(options.is_empty()),
        other => panic!("expected UserInput, got {other:?}"),
    }
}

/// header 缺失时回落 question 正文；两者都缺 → 类别兜底（不产出空 prompt）。
#[test]
fn question_asked_falls_back_to_question_text_then_default() {
    let with_text = sse_event(
        r#"{"type":"question.asked","properties":{"id":"que_2","sessionID":"ses_1","questions":[{"question":"分支名是什么？"}]}}"#,
    );
    let defaulted = sse_event(
        r#"{"type":"question.asked","properties":{"id":"que_3","sessionID":"ses_1","questions":[{"header":"  "}]}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    let prompts: Vec<String> = [with_text, defaulted]
        .iter()
        .map(
            |e| match single(translate_event("ac_1", e, &mut kinds, &mut started)) {
                StreamEvent::UserInput { prompt, .. } => prompt,
                other => panic!("expected UserInput, got {other:?}"),
            },
        )
        .collect();
    assert_eq!(prompts[0], "分支名是什么？");
    assert_eq!(prompts[1], "Agent 需要你的输入");
}

/// 缺 id → 无可回执的路由键，静默丢弃（不产生无法回答的面板）。
#[test]
fn question_asked_without_id_is_ignored() {
    let event = sse_event(
        r#"{"type":"question.asked","properties":{"sessionID":"ses_1","questions":[{"header":"x"}]}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    assert!(translate_event("ac_1", &event, &mut kinds, &mut started).is_empty());
}

#[test]
fn session_idle_translates_to_turn_end() {
    let event = sse_event(r#"{"type":"session.idle","properties":{"sessionID":"ses_1"}}"#);
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    let ev = single(translate_event("ac_1", &event, &mut kinds, &mut started));
    assert_eq!(
        ev,
        StreamEvent::TurnEnd {
            session_id: "ac_1".into(),
            turn_id: String::new(),
            reason: TurnEndReason::Completed,
        }
    );
}

#[test]
fn session_error_translates_to_error() {
    let event = sse_event(
        r#"{"type":"session.error","properties":{"sessionID":"ses_1","error":{"name":"UnknownError","data":{"message":"Model not found"}}}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    let ev = single(translate_event("ac_1", &event, &mut kinds, &mut started));
    match ev {
        StreamEvent::Error { kind, message, .. } => {
            assert_eq!(kind, ErrorKind::Agent);
            assert_eq!(message, "Model not found");
        }
        other => panic!("expected Error, got {other:?}"),
    }
}

#[test]
fn todo_updated_translates_to_todo_list() {
    let event = sse_event(
        r#"{"type":"todo.updated","properties":{"sessionID":"ses_1","todos":[{"content":"读第一章","status":"pending","priority":"high"},{"content":"写笔记","status":"in_progress","priority":"medium"}]}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    let evs = translate_event("ac_1", &event, &mut kinds, &mut started);
    assert_eq!(
        evs,
        vec![StreamEvent::TodoUpdated {
            session_id: "ac_1".into(),
            todos: vec![
                TodoItem {
                    content: "读第一章".into(),
                    status: "pending".into(),
                    priority: "high".into(),
                },
                TodoItem {
                    content: "写笔记".into(),
                    status: "in_progress".into(),
                    priority: "medium".into(),
                },
            ],
        }]
    );
}

#[test]
fn todo_updated_without_todos_ignored() {
    let event = sse_event(r#"{"type":"todo.updated","properties":{"sessionID":"ses_1"}}"#);
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    assert!(translate_event("ac_1", &event, &mut kinds, &mut started).is_empty());
}

#[test]
fn task_tool_title_includes_subagent_and_description() {
    let part = serde_json::json!({
        "type": "tool",
        "tool": "task",
        "callID": "task_0",
        "state": {
            "status": "running",
            "input": { "subagent_type": "general", "description": "扫描代码库并总结模块边界" }
        }
    });
    assert_eq!(
        tool_title("task", part.get("state").and_then(|s| s.get("input"))),
        "general Task: 扫描代码库并总结模块边界"
    );
}

#[test]
fn todowrite_tool_title_counts_todos() {
    let part = serde_json::json!({
        "type": "tool",
        "tool": "todowrite",
        "callID": "todo_0",
        "state": {
            "status": "running",
            "input": {
                "todos": [
                    { "content": "a", "status": "pending", "priority": "high" },
                    { "content": "b", "status": "pending", "priority": "low" },
                    { "content": "c", "status": "completed", "priority": "medium" }
                ]
            }
        }
    });
    assert_eq!(
        tool_title("todowrite", part.get("state").and_then(|s| s.get("input"))),
        "3 todos"
    );
}

#[test]
fn unknown_event_ignored() {
    let event = sse_event(r#"{"type":"server.heartbeat","properties":{}}"#);
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    assert!(translate_event("ac_1", &event, &mut kinds, &mut started).is_empty());
}

#[test]
fn non_text_part_delta_ignored() {
    let event = sse_event(
        r#"{"type":"message.part.delta","properties":{"sessionID":"ses_1","partID":"prt_t","field":"tool_input","delta":"x"}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    assert!(translate_event("ac_1", &event, &mut kinds, &mut started).is_empty());
}

#[test]
fn model_slug_split_handles_slash_and_bare() {
    assert_eq!(
        model_slug_split("anthropic/claude-sonnet-4-5"),
        ("anthropic".to_string(), "claude-sonnet-4-5".to_string())
    );
    assert_eq!(
        model_slug_split("kimi-k2.7-code"),
        (String::new(), "kimi-k2.7-code".to_string())
    );
}

#[test]
fn model_body_omitted_when_absent_or_bare_id() {
    assert!(model_body(None).is_none());
    assert!(model_body(Some("kimi-k2.7-code")).is_none());
}

#[test]
fn model_body_builds_provider_model_object() {
    let body = model_body(Some("anthropic/claude-sonnet-4-5")).expect("body");
    assert_eq!(body["providerID"], "anthropic");
    assert_eq!(body["modelID"], "claude-sonnet-4-5");
}

#[test]
fn extract_listening_url_accepts_both_prefixes() {
    // 1.19: `opencode server listening on <url>`
    assert_eq!(
        extract_listening_url("opencode server listening on http://127.0.0.1:57775"),
        Some("http://127.0.0.1:57775".to_string())
    );
    // 2.0 去掉了 `opencode ` 前缀（实测 2.0.32）
    assert_eq!(
        extract_listening_url("server listening on http://127.0.0.1:60656"),
        Some("http://127.0.0.1:60656".to_string())
    );
    // 版本前缀不可知，URL 形态才是语义本体
    assert_eq!(
        extract_listening_url("some vendor server listening on http://127.0.0.1:1234"),
        Some("http://127.0.0.1:1234".to_string())
    );
    // 「listening on」但不是 URL → 不认
    assert!(extract_listening_url("loading config...").is_none());
    assert!(extract_listening_url("listening on something-else").is_none());
    // 1.19 未设密码时的警告行
    assert!(extract_listening_url(
        "Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured."
    )
    .is_none());
}

/// 2.0 在未注入 `OPENCODE_SERVER_PASSWORD` 时打印随机密码行（兜底路径）。
#[test]
fn extract_server_password_reads_password_line() {
    assert_eq!(
        extract_server_password("server password abc123"),
        Some("abc123".to_string())
    );
    assert!(extract_server_password("Warning: something").is_none());
    assert!(extract_server_password("").is_none());
    // 前缀后为空 → 不认（否则拿到空密码会发出非法 Basic 头）
    assert!(extract_server_password("server password   ").is_none());
}

/// 同一 callID 的 `pending` → `running` 只应发出一次 `ToolStart`。
/// opencode serve 会就同一工具多次推送 `message.part.updated`，若不加
/// 去重，前端会把同一任务渲染成两行（用户反馈的 bug）。
#[test]
fn bash_title_supports_command_array_and_script_fields() {
    // command 为数组 → join 成完整命令
    let arr = sse_event(
        r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_t","type":"tool","tool":"bash","callID":"bash_0","state":{"status":"running","input":{"command":["wc","-l","src/a.rs"]},"metadata":{}}}}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    let evs = translate_event("ac_1", &arr, &mut kinds, &mut started);
    assert!(matches!(
        &evs[0],
        StreamEvent::ToolStart { title, .. } if title == "wc -l src/a.rs"
    ));

    // script 字段兜底
    let script = sse_event(
        r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_t","type":"tool","tool":"bash","callID":"bash_1","state":{"status":"running","input":{"script":"cargo check"},"metadata":{}}}}}"#,
    );
    let evs = translate_event("ac_1", &script, &mut kinds, &mut started);
    assert!(matches!(
        &evs[0],
        StreamEvent::ToolStart { title, .. } if title == "cargo check"
    ));
}

#[test]
fn bash_title_falls_back_to_tool_name_when_no_command() {
    let ev = sse_event(
        r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_t","type":"tool","tool":"bash","callID":"bash_0","state":{"status":"running","input":{},"metadata":{}}}}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    let evs = translate_event("ac_1", &ev, &mut kinds, &mut started);
    assert!(matches!(
        &evs[0],
        StreamEvent::ToolStart { title, .. } if title == "bash"
    ));
}

#[test]
fn read_title_extracts_path_from_filepath_or_file() {
    let file_path = sse_event(
        r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_t","type":"tool","tool":"read","callID":"read_0","state":{"status":"running","input":{"filePath":"src/a.rs"},"metadata":{}}}}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    let evs = translate_event("ac_1", &file_path, &mut kinds, &mut started);
    assert!(matches!(
        &evs[0],
        StreamEvent::ToolStart { title, .. } if title == "src/a.rs"
    ));

    let file = sse_event(
        r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_t","type":"tool","tool":"read","callID":"read_1","state":{"status":"running","input":{"file":"src/b.rs"},"metadata":{}}}}}"#,
    );
    let evs = translate_event("ac_1", &file, &mut kinds, &mut started);
    assert!(matches!(
        &evs[0],
        StreamEvent::ToolStart { title, .. } if title == "src/b.rs"
    ));
}

#[test]
fn same_tool_callid_pending_then_running_only_starts_once() {
    let pending = sse_event(
        r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_t","type":"tool","tool":"bash","callID":"bash_0","state":{"status":"pending","input":{"command":"echo hi"},"metadata":{}}}}}"#,
    );
    let running = sse_event(
        r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_t","type":"tool","tool":"bash","callID":"bash_0","state":{"status":"running","input":{"command":"echo hi"},"metadata":{}}}}}"#,
    );
    let mut kinds = HashMap::new();
    let mut started = HashSet::new();
    let evs1 = translate_event("ac_1", &pending, &mut kinds, &mut started);
    assert_eq!(
        evs1,
        vec![StreamEvent::ToolStart {
            session_id: "ac_1".into(),
            call_id: "bash_0".into(),
            name: "bash".into(),
            title: "echo hi".into()
        }]
    );
    let evs2 = translate_event("ac_1", &running, &mut kinds, &mut started);
    assert!(
        evs2.is_empty(),
        "running 阶段不应重复发 ToolStart: {evs2:?}"
    );
}

/// Basic 认证头的 base64 编码。
///
/// 纯函数，断言对齐 RFC 4648 的标准测试向量 —— 用真实向量而不是「编码后再解码」
/// 是因为后者对任何自洽但有偏的实现在逻辑上都成立（例如丢了填充、错位分组）。
#[test]
fn base64_encodes_basic_credentials() {
    // RFC 4648 §10 标准向量
    assert_eq!(base64_encode(""), "");
    assert_eq!(base64_encode("f"), "Zg==");
    assert_eq!(base64_encode("fo"), "Zm8=");
    assert_eq!(base64_encode("foo"), "Zm9v");
    assert_eq!(base64_encode("foob"), "Zm9vYg==");
    assert_eq!(base64_encode("fooba"), "Zm9vYmE=");
    assert_eq!(base64_encode("foobar"), "Zm9vYmFy");
    // 真实用例：opencode 的用户名恒为 opencode
    assert_eq!(base64_encode("opencode:secret"), "b3BlbmNvZGU6c2VjcmV0");
}

/// 协议探测的判据是 **Content-Type**，不是状态码。
///
/// 为什么这一点是全部双栈工作的地基（实测 1.19.0 与 2.0.32）：
///
/// | 请求 | 1.19.0 | 2.0.32 |
/// | --- | --- | --- |
/// | `GET /api/info` | `200 text/html`（未匹配路由回落 SPA） | `200 application/json` |
///
/// 1.x 对 `/api/info` 也返回 **200**，只看状态码会把 1.x 误判成 2.x，
/// 之后所有 `/api/*` 请求打到 SPA 上，得到「200 + HTML」的假成功。
#[test]
fn detect_protocol_uses_content_type_not_status() {
    // 2.0：真 JSON
    assert_eq!(detect_protocol(200, "application/json"), ServeProtocol::V2);
    // 2.0 带 charset 的变体
    assert_eq!(
        detect_protocol(200, "application/json; charset=utf-8"),
        ServeProtocol::V2
    );
    // 1.19：同样是 200，但回落 SPA —— 必须判成 V1
    assert_eq!(detect_protocol(200, "text/html"), ServeProtocol::V1);
    assert_eq!(
        detect_protocol(200, "text/html; charset=utf-8"),
        ServeProtocol::V1
    );
    // 探测本身失败（401 / 404 / 空）→ 按 V1：1.x 是既有用户盘面，
    // 误判成 V2 会打断已经在工作的人。
    assert_eq!(detect_protocol(401, "application/json"), ServeProtocol::V1);
    assert_eq!(detect_protocol(404, ""), ServeProtocol::V1);
    assert_eq!(detect_protocol(500, "application/json"), ServeProtocol::V1);
    assert_eq!(detect_protocol(0, ""), ServeProtocol::V1);
}

/// 两个协议的端点前缀是唯一差异来源；调用点只查表。
#[test]
fn serve_protocol_prefix_is_the_single_endpoint_switch() {
    assert_eq!(ServeProtocol::V1.prefix(), "");
    assert_eq!(ServeProtocol::V2.prefix(), "/api");
}

/// V2 建会话：`directory` 进 body 的 `location`，**不是** query。
///
/// 实测 2.0.32：`POST /api/session?directory=...` 的 query 被**忽略**，
/// 会话落到 serve 进程 cwd —— 模型于是在错误的目录里跑工具。
/// 测试便捷包装：按协议调真实的 `session_create_url`。
fn session_create_url_for(protocol: ServeProtocol, base_url: &str, ctx: &AgentContext) -> String {
    session_create_url(protocol, base_url, ctx)
}

/// confirm 模式的 ctx —— 权限规则的形状只在这个模式下才有内容，
/// 而「字段名用错会被静默丢弃」正是 confirm 模式独有的故障。
fn confirm_ctx(project_id: &str) -> AgentContext {
    let mut ctx = serve_ctx(project_id);
    ctx.mode = "confirm".into();
    ctx
}

fn session_create_body_for(protocol: ServeProtocol, ctx: &AgentContext) -> serde_json::Value {
    session_create_body(protocol, ctx)
}

#[test]
fn session_create_url_drops_query_on_v2() {
    let ctx = serve_ctx("/tmp/demo proj");
    // V1 必须带 directory query（多目录服务的路由键）
    let v1 = session_create_url_for(ServeProtocol::V1, "http://127.0.0.1:4096", &ctx);
    assert!(v1.contains("/session?directory="), "v1 url: {v1}");
    assert!(v1.contains("demo%20proj"), "v1 url must encode space: {v1}");
    // V2 走 /api 前缀且不带 query
    let v2 = session_create_url_for(ServeProtocol::V2, "http://127.0.0.1:4096", &ctx);
    assert_eq!(v2, "http://127.0.0.1:4096/api/session");
    assert!(!v2.contains('?'), "v2 must not carry a query: {v2}");
}

/// V2 建会话体：`location.directory` + `permissions`（**不是** `permission`）。
///
/// 实测 2.0.32：收到 1.x 的 `permission` 字段时返回 **200 并静默丢弃** ——
/// 回读会话 `permissions` 为 ABSENT，等于 confirm 模式变成 auto，
/// 用户在无人审批的情况下被直接改文件。
#[test]
fn session_create_body_uses_location_and_permissions_on_v2() {
    let ctx = confirm_ctx("/tmp/demo proj");
    let body = session_create_body_for(ServeProtocol::V2, &ctx);

    assert_eq!(
        body["location"]["directory"], "/tmp/demo proj",
        "v2 must carry the directory in the body: {body}"
    );
    let perms = body["permissions"]
        .as_array()
        .expect("v2 permissions array");
    assert_eq!(perms.len(), 1);
    assert_eq!(perms[0]["action"], "*");
    assert_eq!(perms[0]["resource"], "*");
    assert_eq!(perms[0]["effect"], "ask");
    // 1.x 的字段绝不能出现 —— 那会被静默丢弃
    assert!(
        body.get("permission").is_none(),
        "v2 must not send the v1 `permission` field: {body}"
    );
}

/// V1 建会话体保持原样（回归面）。
#[test]
fn session_create_body_keeps_v1_shape() {
    let ctx = confirm_ctx("/tmp/demo proj");
    let body = session_create_body_for(ServeProtocol::V1, &ctx);
    assert!(body.get("location").is_none(), "v1 has no location: {body}");
    let perms = body["permission"].as_array().expect("v1 permission array");
    assert_eq!(perms[0]["permission"], "*");
    assert_eq!(perms[0]["pattern"], "*");
    assert_eq!(perms[0]["action"], "ask");
}

/// 端点表：**每条路径一个断言，两版各一组**。
///
/// 这是双栈的差异清单本身 —— 缺一条断言就等于丢一个端点。
/// 全部断言的是**形状**（前缀 + 动词），因为它们都是 `format!` 出来的字符串，
/// 拼错一个字符的后果是「请求打到 SPA 上，得到 200 + HTML 的假成功」。
#[test]
fn endpoint_paths_are_the_protocol_matrix() {
    let sid = "ses_x";
    let rid = "req_y";

    // ── 前缀 ──
    assert_eq!(ServeProtocol::V1.prefix(), "");
    assert_eq!(ServeProtocol::V2.prefix(), "/api");

    // ── 建会话 ──
    assert_eq!(ServeProtocol::V1.session_create_path(), "/session");
    assert_eq!(ServeProtocol::V2.session_create_path(), "/api/session");

    // ── 读会话（resume 探测 / 回读校验）──
    assert_eq!(ServeProtocol::V1.session_get_path(sid), "/session/ses_x");
    assert_eq!(
        ServeProtocol::V2.session_get_path(sid),
        "/api/session/ses_x"
    );

    // ── 发 prompt：V1 prompt_async / V2 prompt ──
    assert_eq!(
        ServeProtocol::V1.prompt_path(sid),
        "/session/ses_x/prompt_async"
    );
    assert_eq!(
        ServeProtocol::V2.prompt_path(sid),
        "/api/session/ses_x/prompt"
    );

    // ── 中止：V1 abort / V2 interrupt（2.0 不存在 abort）──
    assert_eq!(ServeProtocol::V1.abort_path(sid), "/session/ses_x/abort");
    assert_eq!(
        ServeProtocol::V2.abort_path(sid),
        "/api/session/ses_x/interrupt"
    );

    // ── 权限回执：V1 全局路由 / V2 会话内 + /reply ──
    assert_eq!(
        ServeProtocol::V1.permission_reply_path(sid, rid),
        "/session/ses_x/permissions/req_y"
    );
    assert_eq!(
        ServeProtocol::V2.permission_reply_path(sid, rid),
        "/api/session/ses_x/permission/req_y/reply"
    );
}

/// prompt 请求体：V1 的 model 是 per-prompt 且**生效**，
/// V2 的 model 字段会被静默忽略 —— 所以 V2 干脆不发它。
#[test]
fn prompt_body_carries_model_only_on_v1() {
    // V1 带 model（per-prompt 切换的唯一通道）
    let v1 = prompt_body_for(ServeProtocol::V1, "hi", Some("anthropic/claude"));
    assert_eq!(v1["parts"][0]["text"], "hi");
    assert_eq!(v1["model"]["providerID"], "anthropic");
    assert_eq!(v1["model"]["modelID"], "claude");

    // V2 用扁平 text，且**没有** model
    let v2 = prompt_body_for(ServeProtocol::V2, "hi", Some("anthropic/claude"));
    assert_eq!(v2["text"], "hi");
    assert!(
        v2.get("model").is_none(),
        "v2 must not send model in the prompt (silently ignored): {v2}"
    );
    assert!(v2.get("parts").is_none(), "v2 uses flat text: {v2}");

    // 无模型时 V1 也不带 model（服务端用默认）
    let v1_bare = prompt_body_for(ServeProtocol::V1, "hi", None);
    assert!(v1_bare.get("model").is_none());
}

/// 权限回执：字段名与取值集两版都不同，用错会 200 后静默丢弃。
#[test]
fn permission_reply_body_matches_each_protocol() {
    // V1: {response: once|reject}
    let v1_allow = permission_reply_body(ServeProtocol::V1, true);
    assert_eq!(v1_allow["response"], "once");
    assert!(v1_allow.get("decision").is_none());
    let v1_deny = permission_reply_body(ServeProtocol::V1, false);
    assert_eq!(v1_deny["response"], "reject");

    // V2: {decision: once|reject}
    let v2_allow = permission_reply_body(ServeProtocol::V2, true);
    assert_eq!(v2_allow["decision"], "once");
    assert!(v2_allow.get("response").is_none());
    let v2_deny = permission_reply_body(ServeProtocol::V2, false);
    assert_eq!(v2_deny["decision"], "reject");
}

// ── V2 事件翻译（样本取自 research/opencode-2x-protocol.md §4.1 逐字 JSON）──

/// 从 2.0 的包络里取 `data` —— V2 的载荷全在 `data`，V1 在 `properties`。
/// 这个差异是 `ServeEvent` 需要同时容纳两种包络的原因。
fn v2_event(json: &str) -> ServeEvent {
    serde_json::from_str(json).expect("valid v2 sse event")
}

/// V2 的流式文本与推理。
#[test]
fn translates_v2_text_and_reasoning_deltas() {
    let mut state = V2State::default();

    let text = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"session.text.delta","data":{"sessionID":"ses_1","delta":"Hi there"}}"#,
        ),
        &mut state,
    );
    assert_eq!(text.len(), 1);
    assert!(
        matches!(&text[0], StreamEvent::TextDelta { delta, .. } if delta == "Hi there"),
        "{text:?}"
    );

    let reasoning = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"session.reasoning.delta","data":{"sessionID":"ses_1","delta":"thinking"}}"#,
        ),
        &mut state,
    );
    assert!(
        matches!(&reasoning[0], StreamEvent::ReasoningDelta { delta, .. } if delta == "thinking"),
        "{reasoning:?}"
    );
}

/// V2 的工具三事件：`input.started` 只缓存名字，`called` 发 ToolStart，
/// `success` 发 ToolOutput + ToolEnd。
///
/// 名字必须缓存：`session.tool.called` 只带 `id` + `input`，**不带 name**。
#[test]
fn translates_v2_tool_lifecycle_through_cached_name() {
    let mut state = V2State::default();

    // input.started：只记名字，不发事件
    let started = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"session.tool.input.started","data":{"sessionID":"ses_1","id":"call_1","name":"write"}}"#,
        ),
        &mut state,
    );
    assert!(
        started.is_empty(),
        "input.started must not emit: {started:?}"
    );

    // called：ToolStart，名字来自缓存，title 来自 input
    let called = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"session.tool.called","data":{"sessionID":"ses_1","id":"call_1","input":{"path":"zz.txt","content":"hi"}}}"#,
        ),
        &mut state,
    );
    assert_eq!(called.len(), 1);
    match &called[0] {
        StreamEvent::ToolStart {
            call_id,
            name,
            title,
            ..
        } => {
            assert_eq!(call_id, "call_1");
            assert_eq!(
                name, "write",
                "name must come from the cached input.started"
            );
            assert_eq!(
                title, "zz.txt",
                "title is rendered by the shared tool_title"
            );
        }
        other => panic!("expected ToolStart, got {other:?}"),
    }

    // success：ToolOutput + ToolEnd(done)
    let success = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"session.tool.success","data":{"sessionID":"ses_1","id":"call_1","content":[{"type":"text","text":"Created file successfully: zz.txt"}]}}"#,
        ),
        &mut state,
    );
    assert_eq!(success.len(), 2, "{success:?}");
    assert!(
        matches!(&success[0], StreamEvent::ToolOutput { output, .. }
                 if output == "Created file successfully: zz.txt"),
        "{success:?}"
    );
    assert!(
        matches!(&success[1], StreamEvent::ToolEnd { status, .. } if status == "done"),
        "{success:?}"
    );
}

/// 同一 callID 的 `called` 重复到达只发一次 ToolStart（与 V1 的同名约束）。
#[test]
fn v2_duplicate_tool_called_starts_once() {
    let mut state = V2State::default();
    let _ = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"session.tool.input.started","data":{"sessionID":"ses_1","id":"c1","name":"bash"}}"#,
        ),
        &mut state,
    );
    let called = r#"{"type":"session.tool.called","data":{"sessionID":"ses_1","id":"c1","input":{"command":"ls"}}}"#;
    let first = translate_v2("ses_1", &v2_event(called), &mut state);
    let second = translate_v2("ses_1", &v2_event(called), &mut state);
    assert_eq!(first.len(), 1);
    assert!(
        second.is_empty(),
        "duplicate called must not re-start: {second:?}"
    );
}

/// V2 工具失败。
#[test]
fn translates_v2_tool_failure() {
    let mut state = V2State::default();
    let _ = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"session.tool.input.started","data":{"sessionID":"ses_1","id":"c1","name":"bash"}}"#,
        ),
        &mut state,
    );
    let _ = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"session.tool.called","data":{"sessionID":"ses_1","id":"c1","input":{"command":"exit 1"}}}"#,
        ),
        &mut state,
    );
    let failed = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"session.tool.failed","data":{"sessionID":"ses_1","id":"c1","content":[{"type":"text","text":"boom"}]}}"#,
        ),
        &mut state,
    );
    assert!(
        matches!(&failed.last(), Some(StreamEvent::ToolEnd { status, .. }) if status == "failed"),
        "{failed:?}"
    );
}

/// V2 的回合结束：三个 `session.execution.*` 事件分别映射到
/// Completed / Error / Stopped —— **不能共用一条**，否则用户看到
/// 「跑完了」而实际是被中断或失败。
#[test]
fn translates_v2_execution_outcomes_distinctly() {
    let ok = translate_v2(
        "ses_1",
        &v2_event(r#"{"type":"session.execution.succeeded","data":{"sessionID":"ses_1"}}"#),
        &mut V2State::default(),
    );
    assert!(
        matches!(
            &ok[0],
            StreamEvent::TurnEnd {
                reason: TurnEndReason::Completed,
                ..
            }
        ),
        "{ok:?}"
    );

    let failed = translate_v2(
        "ses_1",
        &v2_event(r#"{"type":"session.execution.failed","data":{"sessionID":"ses_1"}}"#),
        &mut V2State::default(),
    );
    assert!(
        failed.iter().any(|e| matches!(
            e,
            StreamEvent::TurnEnd {
                reason: TurnEndReason::Error,
                ..
            }
        )),
        "{failed:?}"
    );

    let interrupted = translate_v2(
        "ses_1",
        &v2_event(r#"{"type":"session.execution.interrupted","data":{"sessionID":"ses_1"}}"#),
        &mut V2State::default(),
    );
    assert!(
        matches!(
            &interrupted[0],
            StreamEvent::TurnEnd {
                reason: TurnEndReason::Stopped,
                ..
            }
        ),
        "{interrupted:?}"
    );
}

/// V2 的 `session.error`。
#[test]
fn translates_v2_session_error() {
    let evs = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"session.error","data":{"sessionID":"ses_1","error":{"data":{"message":"upstream 500"}}}}"#,
        ),
        &mut V2State::default(),
    );
    assert!(
        matches!(&evs[0], StreamEvent::Error { message, kind: ErrorKind::Agent, .. }
                 if message == "upstream 500"),
        "{evs:?}"
    );
}

/// V1 专属事件在 V2 下必须**不产生任何事件** —— 否则会误命中。
///
/// 最危险的是 `todo.updated`：2.0 已无此事件，如果 V2 翻译器把 V1 的事件名
/// 也认了，前端会收到一份旧的/伪造的 todo 快照。设计明确禁止伪造。
#[test]
fn v1_only_events_are_ignored_under_v2() {
    let mut state = V2State::default();
    // V1 的 todo.updated
    let todo = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"todo.updated","properties":{"sessionID":"ses_1","todos":[{"id":"t1","content":"x","status":"pending"}]}}"#,
        ),
        &mut state,
    );
    assert!(
        todo.is_empty(),
        "v2 must never fabricate TodoUpdated: {todo:?}"
    );

    // V1 的 message.part.updated
    let part = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"p1","type":"text"}}}"#,
        ),
        &mut state,
    );
    assert!(
        part.is_empty(),
        "v1 part events must not leak into v2: {part:?}"
    );

    // V1 的 session.idle
    let idle = translate_v2(
        "ses_1",
        &v2_event(r#"{"type":"session.idle","properties":{"sessionID":"ses_1"}}"#),
        &mut state,
    );
    assert!(
        idle.is_empty(),
        "v1 session.idle must not end a v2 turn: {idle:?}"
    );
}

/// V2 的 permission.asked：`action` → tool，`resources.join(" ")` → title，
/// `metadata.files[0].patch` → diff（1.x 路径没有现成 diff）。
#[test]
fn translates_v2_permission_with_diff() {
    let evs = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"permission.asked","data":{"id":"per_1","sessionID":"ses_1","action":"edit","resources":["pp.txt"],"metadata":{"files":[{"file":"pp.txt","patch":"Index: pp.txt\n+demo","status":"added"}]},"source":{"type":"tool","id":"call_1"}}}"#,
        ),
        &mut V2State::default(),
    );
    assert_eq!(evs.len(), 1, "{evs:?}");
    match &evs[0] {
        StreamEvent::RequestApproval {
            call_id,
            tool,
            title,
            diff,
            ..
        } => {
            assert_eq!(call_id, "per_1");
            assert_eq!(tool, "edit");
            assert_eq!(title, "pp.txt");
            assert_eq!(diff.as_deref(), Some("Index: pp.txt\n+demo"));
        }
        other => panic!("expected RequestApproval, got {other:?}"),
    }
}

/// V2 的 `form.created`：只有 `metadata.kind == "question"` 才是提问，
/// 其余 kind 一律忽略（不假装能答）。
#[test]
fn translates_v2_form_question_only() {
    let question = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"form.created","data":{"form":{"id":"frm_1","sessionID":"ses_1","title":"Questions","metadata":{"kind":"question"},"fields":[{"key":"q0","title":"Favorite color","description":"What is your favorite color?","type":"string","options":[{"value":"Blue","label":"Blue"}],"custom":true}]}}}"#,
        ),
        &mut V2State::default(),
    );
    assert_eq!(question.len(), 1, "{question:?}");
    match &question[0] {
        StreamEvent::UserInput {
            turn_id,
            prompt,
            options,
            ..
        } => {
            assert_eq!(turn_id, "frm_1");
            assert!(prompt.contains("Favorite color"), "{prompt}");
            assert_eq!(options.len(), 1);
        }
        other => panic!("expected UserInput, got {other:?}"),
    }

    // 非 question 的 form 必须忽略
    let ignored = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"form.created","data":{"form":{"id":"frm_2","sessionID":"ses_1","metadata":{"kind":"other"},"fields":[]}}}"#,
        ),
        &mut V2State::default(),
    );
    assert!(
        ignored.is_empty(),
        "non-question forms are not approvable: {ignored:?}"
    );
}

/// V2 的会话过滤：`data.sessionID`（V1 是 `properties.sessionID`）。
#[test]
fn v2_session_of_reads_data_envelope() {
    let ev =
        v2_event(r#"{"type":"session.text.delta","data":{"sessionID":"ses_abc","delta":"x"}}"#);
    assert_eq!(session_of_v2(&ev).as_deref(), Some("ses_abc"));
    let form =
        v2_event(r#"{"type":"form.created","data":{"form":{"id":"f","sessionID":"ses_nested"}}}"#);
    assert_eq!(session_of_v2(&form).as_deref(), Some("ses_nested"));
    // 没有 sessionID 的事件
    let none = v2_event(r#"{"type":"session.execution.succeeded","data":{}}"#);
    assert_eq!(session_of_v2(&none), None);
}

/// SSE URL：V1 必须带 directory query，V2 绝不能带。
///
/// V2 带 query 不会报错但会被忽略 —— 于是 1.x 的「按目录缩小订阅范围」在
/// 2.x 静默失效，只能靠事件载荷过滤。这个差异必须有断言钉住。
#[test]
fn sse_url_differs_by_protocol() {
    let v1 = event_stream_url(ServeProtocol::V1, "http://h:1", "/a b");
    assert_eq!(v1, "http://h:1/event?directory=%2Fa%20b");

    let v2 = event_stream_url(ServeProtocol::V2, "http://h:1", "/a b");
    assert_eq!(v2, "http://h:1/api/event");
    assert!(!v2.contains('?'), "v2 SSE must not carry a query: {v2}");
}

/// **实测样本**：2.0.32 真实 `GET /api/event` 的包络与失败路径。
///
/// 下面这条是 2026-10-23 用真 `opencode serve`（v2.0.32）抓的逐字 JSON，
/// 触发条件：provider API key 过期 → `session.execution.failed`。
///
/// 它证明三件本模块依赖的事实：
/// 1. 包络是 `{id, created, type, location, data, durable}`（载荷在 `data`）；
/// 2. 会话过滤靠 `data.sessionID`（**不是** V1 的 `properties.sessionID`）；
/// 3. 失败路径真的会发 `session.execution.failed`（不是只发 `step.failed`）。
///
/// 变异验证：把 `ServeEvent` 的 `alias = "data"` 去掉 → 本用例红（载荷读不到）。
#[test]
fn real_v2_failure_envelope_maps_to_error_turn_end() {
    // 逐字取自真机（只截掉超长的 response.body）
    let raw = r#"{"id":"evt_163d026c00013wroCt19dQjH1r","created":1792675948224,"type":"session.execution.failed","data":{"sessionID":"ses_e9c2fe7e2ffeoH3UBaZiRyjSbA","error":{"type":"provider.auth","message":"This API key has expired.","status":401}},"durable":true}"#;
    let ev = v2_event(raw);

    // 包络归一化：data → properties
    assert_eq!(ev.properties["sessionID"], "ses_e9c2fe7e2ffeoH3UBaZiRyjSbA");
    // 会话过滤走 data.sessionID
    assert_eq!(
        session_of_v2(&ev).as_deref(),
        Some("ses_e9c2fe7e2ffeoH3UBaZiRyjSbA")
    );
    // 失败 → TurnEnd(Error)，不是 Completed
    let evs = translate_v2("inner", &ev, &mut V2State::default());
    assert!(
        evs.iter().any(|e| matches!(
            e,
            StreamEvent::TurnEnd {
                reason: TurnEndReason::Error,
                ..
            }
        )),
        "{evs:?}"
    );
}

/// 实测的 `session.step.started`（带 `data.model`）——切模型后用它校验生效。
///
/// 这条同时钉住一个设计决定：`session.step.started` **不产生** StreamEvent。
/// 它是「这一步在跑什么」的元信息，不是用户可见内容；误发会让前端多出空行。
#[test]
fn real_v2_step_started_emits_nothing() {
    let raw = r#"{"id":"evt_1","created":1792675948000,"type":"session.step.started","data":{"sessionID":"ses_1","agent":"build","model":{"id":"mimo-v2.6-flash-free","providerID":"opencode"},"started":1792675948000},"durable":true}"#;
    let evs = translate_v2("inner", &v2_event(raw), &mut V2State::default());
    assert!(
        evs.is_empty(),
        "step.started is metadata, not content: {evs:?}"
    );
}

/// 切模型请求体（仅 V2）：`model.id`，**不是** `model.modelID`。
///
/// 实测 2.0：传 `modelID` 得到 `400 Missing key at ["model"]["id"]`。
/// 同一个 `ModelInfo` 在 V1 的 per-prompt 载荷里叫 `modelID`，在这里叫 `id`。
#[test]
fn model_switch_body_uses_id_not_model_id() {
    let body = model_switch_body("opencode", "mimo-v2.6-flash-free");
    assert_eq!(body["model"]["providerID"], "opencode");
    assert_eq!(body["model"]["id"], "mimo-v2.6-flash-free");
    assert!(
        body["model"].get("modelID").is_none(),
        "v2 wants `id`; `modelID` is rejected with 400: {body}"
    );
}

/// 提问回执：V1 是二维 answers 数组，V2 是按 field key 映射的对象。
#[test]
fn question_reply_body_matches_each_protocol() {
    let v1 = question_reply_body(ServeProtocol::V1, "q0", "Blue");
    assert_eq!(v1["answers"][0][0], "Blue");
    assert!(v1.get("answer").is_none());

    let v2 = question_reply_body(ServeProtocol::V2, "q0", "Blue");
    assert_eq!(v2["answer"]["q0"], "Blue");
    assert!(
        v2.get("answers").is_none(),
        "v2 uses a keyed object, not the v1 array: {v2}"
    );

    // key 必须原样进 map —— 与 form.created 的 fields[].key 对应
    let v2_other = question_reply_body(ServeProtocol::V2, "color_choice", "Red");
    assert_eq!(v2_other["answer"]["color_choice"], "Red");
}

/// 端点表补齐：切模型与提问回执。
#[test]
fn stage6_endpoint_paths() {
    let sid = "ses_x";
    let rid = "req_y";

    // 切模型：只有 V2 有独立端点
    assert_eq!(
        ServeProtocol::V2.model_switch_path(sid),
        "/api/session/ses_x/model"
    );

    // 提问回执
    assert_eq!(
        ServeProtocol::V1.question_reply_path(sid, rid),
        "/question/req_y/reply"
    );
    assert_eq!(
        ServeProtocol::V2.question_reply_path(sid, rid),
        "/api/session/ses_x/form/req_y/reply"
    );
}

/// V2 的 `form.created` 必须能被抽出 field key —— 回执靠它映射答案。
///
/// 这条钉住「翻译」与「回执」两个用途读同一份载荷的不同字段：
/// `StreamEvent::UserInput` 不带 key（前端用不上），回执需要它。
#[test]
fn v2_form_field_key_is_extracted_for_replies() {
    let ev = v2_event(
        r#"{"type":"form.created","data":{"form":{"id":"frm_1","sessionID":"ses_1","metadata":{"kind":"question"},"fields":[{"key":"q0","title":"Color","options":[{"value":"Blue","label":"Blue"}]}]}}}"#,
    );
    assert_eq!(
        events_v2::form_field_key(&ev.properties).as_deref(),
        Some("q0")
    );

    // 无 fields 的 form → None（调用方回退 q0，不 panic）
    let empty = v2_event(
        r#"{"type":"form.created","data":{"form":{"id":"frm_2","sessionID":"ses_1","metadata":{"kind":"question"},"fields":[]}}}"#,
    );
    assert_eq!(events_v2::form_field_key(&empty.properties), None);
}

/// resume 前必须探测会话存在性。
///
/// # 为什么不能直接 attach
///
/// 1.x 的老会话在 2.0 下 `GET /api/session/{id}` 是 **404**（迁移单向，不可 resume）。
/// 现有 `attach_streaming` 不校验存在性，只会在 SSE 上**静默等待**一条永不到来的
/// 事件 —— 用户看到的是「一直在加载」，且没有任何日志能定位。
///
/// 判据是状态码（不是 Content-Type）：V2 的 200 一定是 JSON，
/// 404 一定不存在；V1 没有 404 也一定是真的没有。
#[test]
fn resume_probe_judges_existence_by_status() {
    // V2：200 → 存在
    assert!(session_exists_from_status(ServeProtocol::V2, 200));
    // V2：404 → 不存在（1.x 老会话在 2.0 下的真实处境）
    assert!(!session_exists_from_status(ServeProtocol::V2, 404));
    // 其他错误码（401 / 500 / 连接失败用 0 表示）→ 判为不存在，
    // 因为「不确定」不该让用户等一条永不到来的流。
    assert!(!session_exists_from_status(ServeProtocol::V2, 401));
    assert!(!session_exists_from_status(ServeProtocol::V2, 500));
    assert!(!session_exists_from_status(ServeProtocol::V2, 0));
    // V1：200 → 存在；404 → 不存在
    assert!(session_exists_from_status(ServeProtocol::V1, 200));
    assert!(!session_exists_from_status(ServeProtocol::V1, 404));
}

/// 不存在的会话必须报 `NotFound`，且**错误信息要说清「不是网络问题」**。
///
/// 1.x 老会话在 2.0 下 404 是迁移单向导致的，不是网络故障。
/// 用户看到 generic 的 IO 错误会去查网络，而实际要做的是在新版里重开会话。
#[test]
fn missing_native_session_error_explains_migration() {
    let msg = missing_session_message(ServeProtocol::V2, "ses_old");
    assert!(msg.contains("ses_old"), "{msg}");
    assert!(
        msg.contains("2.0") || msg.contains("migrat"),
        "message must explain the migration, not look like a network error: {msg}"
    );
}

// ── 模型列表（阶段 8）：`GET /api/model` 结构化 vs CLI 回落 ──

/// `GET /api/model` 的两种响应形状都要能解。
///
/// | 版本 | 关键字段 |
/// | --- | --- |
/// | 1.19 | `data[].id` + `providerID` |
/// | 2.0 | `data[].modelID` + `providerID`（还有 `package`/`capabilities`/`limit`） |
///
/// 两种都要产出 `ModelInfo{id: "provider/model", name}`，因为前端模型选择器
/// 的 id 语义是 `provider/model` 复合串（`model_slug_split` 按此拆）。
#[test]
fn models_from_api_handles_both_shapes() {
    // 2.0：modelID
    let v2 = serde_json::json!({
        "location": {"directory": "/p"},
        "data": [
            {"id": "mimo", "modelID": "mimo-v2.6-flash-free", "providerID": "opencode",
             "name": "MiMo-V2.6-Flash Free", "limit": {"context": 200000}},
            {"modelID": "deepseek-flash", "providerID": "deepseek", "name": "DeepSeek V4.1"}
        ]
    });
    let models = models_from_api_response(&v2);
    assert_eq!(models.len(), 2, "{models:?}");
    assert_eq!(models[0].id, "opencode/mimo-v2.6-flash-free");
    assert_eq!(models[0].name, "MiMo-V2.6-Flash Free");
    assert_eq!(models[1].id, "deepseek/deepseek-flash");

    // 1.19：id
    let v1 = serde_json::json!({
        "data": [
            {"id": "big-pickle", "providerID": "opencode", "name": "Big Pickle"}
        ]
    });
    let models_v1 = models_from_api_response(&v1);
    assert_eq!(models_v1.len(), 1);
    assert_eq!(models_v1[0].id, "opencode/big-pickle");

    // 畸形响应 → 空列表（不 panic）
    assert!(models_from_api_response(&serde_json::json!({})).is_empty());
    assert!(models_from_api_response(&serde_json::json!({"data": "nope"})).is_empty());
    assert!(models_from_api_response(&serde_json::json!(null)).is_empty());
}

/// 2.0 **不得**调用 `models --verbose`（实测 `Unrecognized flag`，exit 1）。
///
/// 这是 R8 的核心约束：错误版本上调用会刷 ERROR 日志、并且让模型选择器空着。
/// 判据是「回落路径按协议选择」——V2 只能走 `models`（无 flag）。
#[test]
fn cli_fallback_command_differs_by_protocol() {
    // V1 保留 --verbose（有 limit.context，是既有行为）
    assert_eq!(
        ServeProtocol::V1.cli_models_args(),
        vec!["models", "--verbose"],
        "v1 keeps the verbose NDJSON path"
    );
    // V2 不能传 --verbose
    assert_eq!(
        ServeProtocol::V2.cli_models_args(),
        vec!["models"],
        "v2 removed --verbose (Unrecognized flag)"
    );
    assert!(
        !ServeProtocol::V2.cli_models_args().contains(&"--verbose"),
        "v2 must never pass --verbose"
    );
}

/// 模型列表端点是**唯一前缀不随协议变的路径** —— 这条必须钉住。
///
/// 实测（真 `opencode serve`，两版各一次）：
///
/// | 路径 | 1.19.0 | 2.0.32 |
/// | --- | --- | --- |
/// | `/model` | `200 text/html`（SPA 回落） | `200 text/html`（SPA 回落） |
/// | `/api/model` | `200 application/json`（206 条） | `200 application/json`（167 条） |
///
/// 1.19 就把模型目录放在 `/api/model` —— 它的 `/api` 不是「v2 专属」。
/// 如果这里跟着 `prefix()` 走，V1 会请求 `/model` 拿到 HTML，模型选择器就空了。
///
/// 变异验证：把 `models_path` 改回 `format!("{}/model", self.prefix())` → 本用例红。
#[test]
fn models_path_is_protocol_independent() {
    assert_eq!(
        ServeProtocol::V1.models_path(),
        "/api/model",
        "v1 also serves the catalog at /api/model; /model is the SPA fallback"
    );
    assert_eq!(ServeProtocol::V2.models_path(), "/api/model");
    // 两个协议必须相同 —— 这正是它作为例外的定义
    assert_eq!(
        ServeProtocol::V1.models_path(),
        ServeProtocol::V2.models_path()
    );
}

/// **失败必须产出 `Error` 事件，而不只是 `TurnEnd{Error}`。**
///
/// # 这是真实故障（2026-10-23 用户截图）
///
/// 界面显示「发了 hello，什么都没有」。原因不是「没发信息」，而是后端只发了
/// `TurnEnd{reason: Error}` —— 那个变体**没有 message 字段**，错误文本被整段丢弃。
/// 前端 `useTurnStream` 对 `turn_end` 只做收尾（closeRunningTools + worked 卡片），
/// **不渲染任何提示**；错误提示只由 `error` 事件经
/// `appendSystemMessage("⚠ …")` 产生。
///
/// 所以「下游失败」必须走 `Error` 事件。`TurnEnd{Error}` 仍然要发（它负责收尾），
/// 但**不能只有它**。
#[test]
fn v2_step_failed_emits_error_event() {
    // 逐字取自真机（2.0.32，provider key 过期）
    let raw = r#"{"type":"session.step.failed","data":{"sessionID":"ses_1","assistantMessageID":"msg_1","error":{"type":"provider.auth","message":"This API key has expired.","status":401}}}"#;
    let evs = translate_v2("inner", &v2_event(raw), &mut V2State::default());

    let err = evs
        .iter()
        .find_map(|e| match e {
            StreamEvent::Error { message, .. } => Some(message.clone()),
            _ => None,
        })
        .expect("step.failed must surface an Error event, not only TurnEnd");
    assert!(
        err.contains("API key has expired"),
        "the provider message must reach the user: {err}"
    );
}

/// `session.execution.failed` 同样要带 message —— 它也可能**单独**到达。
///
/// 实测两条路径都会发：`step.failed`（单步失败）与 `execution.failed`（整轮失败）。
/// 只处理其中一个，另一条路径的用户仍然看到空白。
#[test]
fn v2_execution_failed_emits_error_event_with_message() {
    let raw = r#"{"type":"session.execution.failed","data":{"sessionID":"ses_1","error":{"type":"provider.auth","message":"upstream refused","status":502}}}"#;
    let evs = translate_v2("inner", &v2_event(raw), &mut V2State::default());

    let err = evs.iter().find_map(|e| match e {
        StreamEvent::Error { message, .. } => Some(message.clone()),
        _ => None,
    });
    assert_eq!(err.as_deref(), Some("upstream refused"));
    // 收尾事件仍然要在
    assert!(
        evs.iter().any(|e| matches!(
            e,
            StreamEvent::TurnEnd {
                reason: TurnEndReason::Error,
                ..
            }
        )),
        "TurnEnd(Error) still closes the turn: {evs:?}"
    );
}

/// **两条事件同时到达时，错误只提示一次**（不重复刷屏）。
///
/// 实测序列：`step.failed` → `execution.failed`，错误内容完全相同。
/// 两条都发 `Error` 会让界面出现两行一样的 ⚠。
#[test]
fn v2_duplicate_failure_reports_error_once() {
    let step =
        r#"{"type":"session.step.failed","data":{"sessionID":"ses_1","error":{"message":"boom"}}}"#;
    let exec = r#"{"type":"session.execution.failed","data":{"sessionID":"ses_1","error":{"message":"boom"}}}"#;
    let mut state = V2State::default();

    let first = translate_v2("inner", &v2_event(step), &mut state);
    let second = translate_v2("inner", &v2_event(exec), &mut state);

    assert_eq!(
        first
            .iter()
            .filter(|e| matches!(e, StreamEvent::Error { .. }))
            .count(),
        1,
        "first failure reports once: {first:?}"
    );
    assert_eq!(
        second
            .iter()
            .filter(|e| matches!(e, StreamEvent::Error { .. }))
            .count(),
        0,
        "the same failure must not be reported twice: {second:?}"
    );
}

/// **成功路径必须清掉失败记录** —— 否则第二轮的同一条错误会被误吞。
///
/// 去重状态是跨事件、跨回合的（`V2State` 活在整个 SSE 连接期间），
/// 不在 `execution.*` 时重置就会把「这一轮成功了」之后的失败也吞掉。
#[test]
fn v2_successful_turn_resets_failure_dedup() {
    let step =
        r#"{"type":"session.step.failed","data":{"sessionID":"ses_1","error":{"message":"boom"}}}"#;
    let ok = r#"{"type":"session.execution.succeeded","data":{"sessionID":"ses_1"}}"#;
    let mut state = V2State::default();

    let first = translate_v2("inner", &v2_event(step), &mut state);
    assert_eq!(
        first
            .iter()
            .filter(|e| matches!(e, StreamEvent::Error { .. }))
            .count(),
        1
    );

    // 一轮成功收尾
    let _ = translate_v2("inner", &v2_event(ok), &mut state);

    // 下一轮同样的错误必须重新提示
    let again = translate_v2("inner", &v2_event(step), &mut state);
    assert_eq!(
        again
            .iter()
            .filter(|e| matches!(e, StreamEvent::Error { .. }))
            .count(),
        1,
        "a failure after a successful turn must be reported again: {again:?}"
    );
}

/// **V1 失败路径的真实形状**（2026-10-23 抓包，1.19.0）。
///
/// 实测事件序列：`message.part.updated` → `message.updated` → **`session.error`**
/// → `session.status` → `session.updated` → `session.idle`。
///
/// 两个必须钉住的事实：
/// 1. 错误文本在 `properties.error.data.message`（外层还有 `name: "UnknownError"`）；
/// 2. `session.idle` **仍会到达** —— 所以 V1 不需要在 `session.error` 里补 TurnEnd，
///    补了反而会收尾两次（前端 worked 卡片重复）。
#[test]
fn v1_session_error_uses_real_error_shape() {
    // 逐字取自真机（只截断 message 尾部）
    let raw = r#"{"id":"evt_1","type":"session.error","properties":{"sessionID":"ses_1","error":{"name":"UnknownError","data":{"message":"Model not found: opencode/deepseek-v4"}}}}"#;
    let ev = sse_event(raw);

    let evs = translate_event("inner", &ev, &mut HashMap::new(), &mut HashSet::new());
    assert_eq!(evs.len(), 1, "{evs:?}");
    match &evs[0] {
        StreamEvent::Error { message, .. } => assert!(
            message.contains("Model not found"),
            "the nested data.message must be surfaced: {message}"
        ),
        other => panic!("expected Error, got {other:?}"),
    }

    // session.error **不**产出 TurnEnd —— 收尾由随后的 session.idle 负责。
    assert!(
        !evs.iter().any(|e| matches!(e, StreamEvent::TurnEnd { .. })),
        "session.error must not end the turn; session.idle does that: {evs:?}"
    );
}

// ── 模式（plan / build）与思考等级 ─────────────────────────────────────────

/// 模式配置项：两版共用同一张静态表，`category` 必须是 `mode`。
///
/// 前端 `ChatComposer` 的 `modeOptionOf` 按 `category === 'mode'` 找它 ——
/// category 写错等于控件永不出现。
#[test]
fn mode_option_lists_build_and_plan() {
    let opt = mode_option(None);
    assert_eq!(opt.id, "mode");
    assert_eq!(opt.category.as_deref(), Some("mode"));
    assert_eq!(opt.name, "Mode");

    let values: Vec<String> = opt.select_options().into_iter().map(|o| o.value).collect();
    assert!(values.contains(&"build".to_string()), "{values:?}");
    assert!(values.contains(&"plan".to_string()), "{values:?}");
    // 默认 build（opencode 的默认 agent）
    assert_eq!(opt.current(), Some("build"));
}

/// 用户自定义的 primary agent 不能被静默重置成 build。
#[test]
fn mode_option_keeps_unknown_current_agent_selectable() {
    let opt = mode_option(Some("my-custom-agent"));
    assert_eq!(opt.current(), Some("my-custom-agent"));
    let values: Vec<String> = opt.select_options().into_iter().map(|o| o.value).collect();
    assert!(
        values.contains(&"my-custom-agent".to_string()),
        "an unknown current agent must stay in the list: {values:?}"
    );
}

/// 模型没有 variants → **不产出**思考等级配置项（不渲染点了没反应的控件）。
#[test]
fn thought_level_is_absent_when_model_has_no_variants() {
    assert!(thought_level_option(&[], None).is_none());
}

/// 档位选项来自当前模型的 variants，`category` 必须是 `thought_level`。
#[test]
fn thought_level_option_lists_model_variants() {
    let variants = vec!["low".to_string(), "high".to_string(), "max".to_string()];
    let opt = thought_level_option(&variants, Some("high")).expect("must exist");
    assert_eq!(opt.category.as_deref(), Some(CATEGORY_THOUGHT_LEVEL));
    assert_eq!(opt.current(), Some("high"));
    let values: Vec<String> = opt.select_options().into_iter().map(|o| o.value).collect();
    assert_eq!(values, vec!["low", "high", "max"]);
    // 展示名做了可读化
    let names: Vec<String> = opt.select_options().into_iter().map(|o| o.name).collect();
    assert_eq!(names, vec!["Low", "High", "Max"]);
}

/// 当前值不在模型支持集合里 → 回落到第一个（而不是留一个非法值）。
#[test]
fn thought_level_falls_back_when_current_is_unsupported() {
    let variants = vec!["low".to_string(), "high".to_string()];
    let opt = thought_level_option(&variants, Some("max")).expect("must exist");
    assert_eq!(opt.current(), Some("low"));
}

/// 从 `/api/model` 响应取 variants：**必须按 (providerID, modelID) 二元组匹配**。
///
/// 实测 133 条模型里有大量重复 `modelID`（同名模型挂在多个 provider 下）。
/// 只按 modelID 匹配会取到别的 provider 的档位集合。
#[test]
fn variants_lookup_matches_provider_and_model() {
    let json = serde_json::json!({
        "data": [
            {"providerID": "opencode", "modelID": "m1", "variants": [{"id": "low"}, {"id": "high"}]},
            {"providerID": "opencode-go", "modelID": "m1", "variants": [{"id": "max"}]}
        ]
    });
    assert_eq!(
        variants_of_model(&json, "opencode", "m1"),
        vec!["low", "high"]
    );
    assert_eq!(
        variants_of_model(&json, "opencode-go", "m1"),
        vec!["max"],
        "same modelID under another provider must not leak"
    );
    // 不存在 → 空（调用方据此不渲染控件）
    assert!(variants_of_model(&json, "nope", "m1").is_empty());
    // 1.19 的字段名是 `id`
    let v1 = serde_json::json!({"data": [{"providerID": "opencode", "id": "m2", "variants": [{"id": "off"}]}]});
    assert_eq!(variants_of_model(&v1, "opencode", "m2"), vec!["off"]);
}

/// 切模型时可带 `variant`（思考等级）—— 这是 2.0 档位的唯一写通道。
#[test]
fn model_switch_body_carries_variant_when_present() {
    let with = model_switch_body_with_variant("opencode", "m1", Some("high"));
    assert_eq!(with["model"]["variant"], "high");
    assert_eq!(with["model"]["id"], "m1");

    let without = model_switch_body_with_variant("opencode", "m1", None);
    assert!(
        without["model"].get("variant").is_none(),
        "no variant must be omitted, not set to null: {without}"
    );
}

/// prompt 载荷：V1 的 agent/variant 随 prompt 下发；V2 只带 agent。
///
/// | 版本 | `agent` | `variant` |
/// | --- | --- | --- |
/// | V1 | ✅ per-prompt | ✅ 在 `model.variant` |
/// | V2 | ✅ 实测生效 | ❌ 顶层发它无效（正确位置是 `Model.Ref.variant`） |
#[test]
fn prompt_body_carries_per_turn_options_by_protocol() {
    // V1：agent + variant 都在，variant 嵌在 model 里
    let v1 = prompt_body_with_options(
        ServeProtocol::V1,
        "hi",
        Some("opencode/m1"),
        Some("plan"),
        Some("high"),
    );
    assert_eq!(v1["agent"], "plan");
    assert_eq!(v1["model"]["variant"], "high");
    assert_eq!(v1["model"]["modelID"], "m1");

    // V2：只有 agent，无 variant、无 parts
    let v2 = prompt_body_with_options(
        ServeProtocol::V2,
        "hi",
        Some("opencode/m1"),
        Some("plan"),
        Some("high"),
    );
    assert_eq!(v2["text"], "hi");
    assert_eq!(v2["agent"], "plan");
    assert!(
        v2.get("model").is_none(),
        "v2 prompt must not carry a model: {v2}"
    );
}

/// agent 切换端点（仅 V2 有真实通道）。
#[test]
fn agent_switch_path_is_v2_only_endpoint() {
    assert_eq!(
        ServeProtocol::V2.agent_switch_path("ses_x"),
        "/api/session/ses_x/agent"
    );
}

/// **serve 的 HTTP client 必须禁用代理**。
///
/// # 真实故障（2026-10-22 用户报告「输入没有响应」）
///
/// serve 永远跑在 `127.0.0.1`，而 reqwest 默认读系统代理设置。macOS 上开了
/// Clash/Surge 之类（`scutil --proxy` 显示 `HTTPEnable: 1`, `HTTPProxy:
/// 127.0.0.1:7890`）时，连**本地回环**也会被送去代理：
///
/// ```text
/// proxy(http://127.0.0.1:7890/) intercepts 'http://127.0.0.1:50912/'
/// connecting to 127.0.0.1:7890        ← 连到代理，不是 serve
/// ```
///
/// 后果是建会话 / 协议探测 / SSE 全部失败，前端看到「发了消息，什么都没有」，
/// 而日志里**没有任何 serve 侧错误**（请求根本没到 serve）—— 这种故障最难查。
///
/// 本地回环走代理在语义上永远是错的，所以是 `.no_proxy()` 而不是「尊重用户配置」。
///
/// 变异验证：去掉 `.no_proxy()` → 本用例红。
#[test]
fn serve_http_client_disables_proxy() {
    // 源码级断言：这个约束没有运行时表现（no_proxy 是 client 内部状态，
    // 无法从外部观察），只能钉住构建调用。
    const SOURCE: &str = include_str!("connection.rs");
    assert!(
        SOURCE.contains(".no_proxy()"),
        "the serve HTTP client must call .no_proxy(): loopback traffic going \n         through a system proxy silently breaks the whole chat transport"
    );
}

/// **实测**：带 `no_proxy()` 的 client 能连上真实 serve，不带则连不上。
///
/// 这条直接验证 `.no_proxy()` 的**效果**，而不只是「调用存在」：
/// 用系统代理环境跑同一个请求，比较两种 client 的结果。
///
/// 标记 `#[ignore]`：需要装 `opencode` 且能起 serve 进程。
/// 跑法：`cargo test -- --ignored serve_client_actually_bypasses_system_proxy`
#[tokio::test]
#[ignore]
async fn serve_client_actually_bypasses_system_proxy() {
    use crate::common::executor::factory::ExecTarget;

    // 起一个真 serve（随机端口，带密码）
    let password = "test-password-for-proxy-check";
    let mut child = crate::core::exec::spawn(
        &ExecTarget::Local,
        "opencode",
        &["serve", "--hostname", "127.0.0.1", "--port", "0"],
        crate::core::exec::SpawnSpec::new()
            .with_env(&[("OPENCODE_SERVER_PASSWORD", password)])
            .kill_tree(),
    )
    .await
    .expect("spawn opencode serve");
    let stdout = child.stdout.take().expect("stdout");
    let base_url = {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut found = None;
        for _ in 0..20 {
            line.clear();
            if reader.read_line(&mut line).await.unwrap_or(0) == 0 {
                break;
            }
            if let Some(u) = extract_listening_url(line.trim()) {
                found = Some(u);
                break;
            }
        }
        found.expect("serve must print its listening URL")
    };
    std::mem::drop(child.kill());

    let url = format!("{base_url}/api/info");

    // 不带 no_proxy：受系统代理影响（在开了代理的机器上会失败）
    let with_proxy = reqwest::Client::builder().build().expect("client");
    let proxy_ok = with_proxy.get(&url).send().await.is_ok();

    // 带 no_proxy：必须成功
    let no_proxy = reqwest::Client::builder()
        .no_proxy()
        .build()
        .expect("client");
    let direct = no_proxy
        .get(&url)
        .send()
        .await
        .expect("loopback must work with no_proxy()");

    assert!(
        direct.status().is_success() || direct.status().as_u16() == 401,
        "no_proxy() must reach the serve: {}",
        direct.status()
    );
    // 记录对照信息（在没开代理的机器上 proxy_ok 也会是 true，不是断言）
    eprintln!(
        "with system proxy: {proxy_ok}, with no_proxy(): {}",
        direct.status()
    );
}

/// **`Cancel` 不得终止请求循环** —— 否则取消一次之后所有控件永久失效。
///
/// # 真实故障（2026-10-23 用户报告「Mode 出现了但不能切换」）
///
/// `run_request_loop` 在 `SessionRequest::Cancel` 分支里 `break`。一次取消
/// （或任何走到 Cancel 的路径）之后循环永久退出，此后：
///
/// - `SetConfigOption`（模式 / 思考等级）→ 无处投递
/// - `Approve`（审批回执）→ 无处投递
/// - `Turn`（下一轮对话）→ 无处投递
///
/// 表现就是「控件在，点了没反应」，而且**没有任何错误**——请求被 `recv()`
/// 之前就没了（`request_tx` 的另一端已 drop）。
///
/// 对照：Pi 的 `Cancel` 只发 `abort` 并 `Ok(Vec::new())`，循环继续。
///
/// 变异验证：把 `break` 加回 Cancel 分支 → 本用例红。
#[test]
fn cancel_does_not_break_the_request_loop() {
    const SOURCE: &str = include_str!("request.rs");
    // 定位 Cancel 分支的函数体
    let start = SOURCE
        .find("SessionRequest::Cancel =>")
        .expect("Cancel arm must exist");
    let rest = &SOURCE[start..];
    // 到该 arm 结束：下一个顶层 arm 之前
    let end = rest
        .find("SessionRequest::ContextSet")
        .expect("ContextSet arm follows Cancel");
    let arm = &rest[..end];

    assert!(
        !arm.contains("break;"),
        "Cancel must not break the request loop — after one cancel every          subsequent SetConfigOption / Approve / Turn would be undeliverable.\n\n{arm}"
    );
    // 仍然要真的发 abort
    assert!(
        arm.contains("abort_path"),
        "Cancel must still abort the current turn on the serve side"
    );
}

/// **写配置项后必须回推 `ConfigOptionUpdate`** —— 否则下拉永远显示旧值。
///
/// # 真实故障（2026-10-23 用户报告「选择 plan 模式显示还是 build」）
///
/// serve **不产生** `config_option_update`（它没有配置项推送机制），而前端
/// `useSessionConfigOptions` 只在该事件里 `replace()`。于是：
///
/// ```
/// 用户点 plan → 后端 POST /agent 成功（真的切了）
///            → 但前端 currentValue 仍是 build
///            → 下拉显示 Build，用户以为「根本切换不了」
/// ```
///
/// 这是「后端生效了但 UI 不知道」的典型形态 —— 与 Pi 的 `ConfigOptionUpdate`
/// 同理（Pi 在 `refresh_configs` 后主动回推）。
///
/// 变异验证：删掉 `StreamEvent::ConfigOptionUpdate` 的发送 → 本用例红。
#[test]
fn config_option_write_pushes_update_event() {
    const SOURCE: &str = include_str!("request.rs");
    let start = SOURCE
        .find("async fn handle_config_option(")
        .expect("handle_config_option must exist");
    let rest = &SOURCE[start..];
    // 到下一个顶层项之前
    let end = rest.find("fn question_reply_url_for").unwrap_or(rest.len());
    let body = &rest[..end];

    assert!(
        body.contains("StreamEvent::ConfigOptionUpdate"),
        "writing a config option must push ConfigOptionUpdate — the frontend only \
         updates `currentValue` from that event, so without it the dropdown keeps \
         showing the old value and the control looks broken"
    );
    // 状态更新走唯一入口 `ConfigState::apply`（不是就地改 Vec）
    assert!(
        body.contains("cfg.apply(kind, text)"),
        "the state must be updated through ConfigState::apply — the single mutation \
         point shared by user selection and agent self-report"
    );
    // 载荷由 `to_options()` 从状态**重建**（协议要求全量，且必须与状态同源）
    assert!(
        body.contains("cfg.to_options()"),
        "ConfigOptionUpdate carries the FULL option list, rebuilt from the state \
         (not a stored copy — two copies inevitably drift)"
    );
}

/// 未知 configId 不得回推（否则前端会收到一份没变化的全量列表，白刷一次）。
#[test]
fn unknown_config_id_does_not_push_update() {
    const SOURCE: &str = include_str!("request.rs");
    let start = SOURCE
        .find("async fn handle_config_option(")
        .expect("handle_config_option must exist");
    let rest = &SOURCE[start..];
    let end = rest.find("fn question_reply_url_for").unwrap_or(rest.len());
    let body = &rest[..end];

    // 未知分支必须先 return，不能落到回推逻辑
    let unknown = body
        .find("unknown config option")
        .expect("unknown branch must exist");
    let after = &body[unknown..];
    let push = after.find("ConfigOptionUpdate");
    if let Some(p) = push {
        let before_push = &after[..p];
        assert!(
            before_push.contains("return;"),
            "the unknown-configId branch must return before pushing an update"
        );
    }
}

// ── ConfigState：配置项状态的唯一真相 ──────────────────────────────────────

/// 默认状态：build + 无档位（还没拉到模型信息）。
#[test]
fn config_state_defaults_to_build_without_variants() {
    let state = ConfigState::default();
    assert_eq!(state.agent, "build");
    assert_eq!(state.variant, None);
    assert!(state.variants.is_empty());

    let opts = state.to_options();
    // 只有 mode（没有 variants → 不列思考等级，避免点了没反应的控件）
    assert_eq!(opts.len(), 1);
    assert_eq!(opts[0].id, "mode");
    assert_eq!(opts[0].current(), Some("build"));
}

/// `to_options` 是**唯一构造入口**：当前值与候选值来自同一份状态。
///
/// 这条防的是「options 与 currentValue 来自不同快照」——那类 bug 的表现是
/// 下拉列着 A/B/C 但当前值显示 D（或反之）。
#[test]
fn config_state_builds_options_from_one_snapshot() {
    let state = ConfigState {
        agent: "plan".into(),
        variant: Some("high".into()),
        variants: vec!["low".into(), "high".into(), "max".into()],
        model: Some("opencode/m".into()),
    };
    let opts = state.to_options();
    assert_eq!(opts.len(), 2);

    assert_eq!(opts[0].id, "mode");
    assert_eq!(opts[0].current(), Some("plan"));
    let mode_values: Vec<String> = opts[0]
        .select_options()
        .into_iter()
        .map(|o| o.value)
        .collect();
    assert!(mode_values.contains(&"plan".to_string()));

    assert_eq!(opts[1].id, "thought_level");
    assert_eq!(opts[1].current(), Some("high"));
    let level_values: Vec<String> = opts[1]
        .select_options()
        .into_iter()
        .map(|o| o.value)
        .collect();
    assert_eq!(level_values, vec!["low", "high", "max"]);
}

/// `kind_of` 是 configId 的唯一解析点；未知 id 返回 `None`（**不 panic**）。
///
/// 上一版用 `apply(&str) -> bool` + 写通道的 `unreachable!()`，两处靠约定
/// 保持一致 —— 漏改一处就是生产 panic。现在类型化成 `ConfigKind`。
#[test]
fn kind_of_parses_known_ids_only() {
    assert_eq!(ConfigState::kind_of("mode"), Some(ConfigKind::Mode));
    assert_eq!(
        ConfigState::kind_of("thought_level"),
        Some(ConfigKind::ThoughtLevel)
    );
    // ACP 的 model_config 项不归本模块 —— 必须返回 None，不能 panic
    assert_eq!(ConfigState::kind_of("model_config"), None);
    assert_eq!(ConfigState::kind_of(""), None);
}

/// `apply` 只改状态，不做 IO —— 两条路径（用户点选 / agent 自述）共用它。
#[test]
fn config_state_apply_updates_by_kind() {
    let mut state = ConfigState {
        agent: "build".into(),
        variant: Some("low".into()),
        variants: vec!["low".into(), "high".into()],
        model: Some("opencode/m".into()),
    };

    state.apply(ConfigKind::Mode, "plan");
    assert_eq!(state.agent, "plan");

    state.apply(ConfigKind::ThoughtLevel, "high");
    assert_eq!(state.variant, Some("high".to_string()));
}

/// **`learn_from_step` 是「真实状态」的唯一来源。**
///
/// 2.0 的会话详情不含 agent/model（实测只有 cost/id/location/...），
/// 所以 `resume` 一个曾切到 plan 的会话，只能靠这条事件知道真相。
///
/// 变异验证：不调用 `learn_from_step` → `resume` 后 UI 显示 build（Block 级缺陷）。
#[test]
fn config_state_learns_real_agent_and_variant_from_step() {
    let mut state = ConfigState::default();
    assert_eq!(state.agent, "build");

    // 逐字取自真机 session.step.started
    let data = serde_json::json!({
        "sessionID": "ses_1",
        "agent": "plan",
        "model": {"id": "flint-40b-free", "providerID": "opencode", "variant": "high"}
    });

    assert!(state.learn_from_step(&data), "must report a change");
    assert_eq!(state.agent, "plan");
    assert_eq!(state.variant, Some("high".to_string()));

    // 同样的数据再来一次 → 无变化（不重复回推）
    assert!(!state.learn_from_step(&data));
}

/// 缺字段的 `step.started` 不得覆盖已有状态（部分 agent 不报 variant）。
#[test]
fn config_state_learn_ignores_missing_fields() {
    let mut state = ConfigState {
        agent: "plan".into(),
        variant: Some("high".into()),
        variants: vec!["high".into()],
        model: Some("opencode/m".into()),
    };

    // 只有 sessionID，没有 agent / model
    let data = serde_json::json!({"sessionID": "ses_1"});
    assert!(!state.learn_from_step(&data));
    assert_eq!(state.agent, "plan");
    assert_eq!(state.variant, Some("high".to_string()));
}

/// **pump 必须在 `session.step.started` 时校正状态并回推** —— 行为级。
///
/// # 为什么不能只断言源码
///
/// 第一版写的是 `expect(SOURCE).toContain("learn_from_step")`。变异验证时把分支
/// 改成 `if false && ...`，**字符串还在、断言全绿**，而功能已经没了。这正是
/// `quality-guidelines.md` §18(c) 说的「判据要钉在不变量上，不是某个标识符
/// 出现了」。
///
/// 这里直接喂一条真实的 `session.step.started` 字节流，断言：
/// 1. 状态被校正成事件里的 agent / variant；
/// 2. 收到一条 `ConfigOptionUpdate`，且其 `currentValue` 是新值。
#[tokio::test]
async fn pump_learns_config_state_from_step_started() {
    use tokio::sync::mpsc;

    let mut buf = Vec::new();
    // 逐字取自真机 2.0.32 的 session.step.started
    buf.extend_from_slice(
        b"data: {\"type\":\"session.step.started\",\"data\":{\"sessionID\":\"ses_1\",\"agent\":\"plan\",\"model\":{\"id\":\"m\",\"providerID\":\"opencode\",\"variant\":\"high\"}}}\n\n",
    );

    let mut translator = Translator::for_protocol(ServeProtocol::V2);
    let target = PumpTarget {
        protocol: ServeProtocol::V2,
        base_url: "http://x",
        serve_sid: "ses_1",
        session_id: "inner",
        directory: "/p",
    };
    let pending_forms = std::sync::Mutex::new(HashMap::new());
    let config_state = std::sync::Mutex::new(ConfigState::default());
    let (tx, mut rx) = mpsc::channel(16);

    let alive = process_buffered_lines(
        &mut buf,
        &mut translator,
        target,
        &pending_forms,
        &config_state,
        &tx,
    )
    .await;
    assert!(alive);
    drop(tx);

    // 状态被校正
    {
        let cfg = config_state.lock().unwrap();
        assert_eq!(cfg.agent, "plan", "pump must learn the real agent");
        assert_eq!(
            cfg.variant.as_deref(),
            Some("high"),
            "pump must learn the real variant"
        );
    }

    // 并且回推了一条 ConfigOptionUpdate，其 currentValue 是新值
    let mut saw_update = false;
    while let Some(ev) = rx.recv().await {
        if let StreamEvent::ConfigOptionUpdate { config_options, .. } = ev {
            saw_update = true;
            let mode = config_options
                .iter()
                .find(|o| o.id == "mode")
                .expect("mode option");
            assert_eq!(mode.current(), Some("plan"));
        }
    }
    assert!(
        saw_update,
        "a learned change must be pushed as ConfigOptionUpdate, otherwise the \
         dropdown keeps showing the old value"
    );
}

/// `step.started` 无变化时**不**回推（避免每轮都白刷一次全量列表）。
#[tokio::test]
async fn pump_does_not_push_when_step_reports_no_change() {
    use tokio::sync::mpsc;

    let line = |agent: &str| {
        format!(
            "data: {{\"type\":\"session.step.started\",\"data\":{{\"sessionID\":\"ses_1\",\"agent\":\"{agent}\"}}}}\n\n"
        )
    };

    let mut translator = Translator::for_protocol(ServeProtocol::V2);
    let target = PumpTarget {
        protocol: ServeProtocol::V2,
        base_url: "http://x",
        serve_sid: "ses_1",
        session_id: "inner",
        directory: "/p",
    };
    let pending_forms = std::sync::Mutex::new(HashMap::new());
    let config_state = std::sync::Mutex::new(ConfigState::default());
    let (tx, mut rx) = mpsc::channel(16);

    // 第一次：build → build（默认值就是 build，无变化）
    let mut buf = line("build").into_bytes();
    let _ = process_buffered_lines(
        &mut buf,
        &mut translator,
        target,
        &pending_forms,
        &config_state,
        &tx,
    )
    .await;
    drop(tx);

    let updates: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok())
        .filter(|e| matches!(e, StreamEvent::ConfigOptionUpdate { .. }))
        .collect();
    assert!(
        updates.is_empty(),
        "no change means no push (the default is already build): {updates:?}"
    );
}

// ── 切模型后刷新档位候选（`列出即能写` 的落点）──────────────────────────

/// **切到档位更少的模型 → 当前档位必须回落，不能留非法值。**
///
/// # 为什么这是不变式而不是优化
///
/// `variants` 是模型属性（实测 133 个模型里 114 个有，集合不同）。切模型后
/// 不刷新的话，下拉仍列旧档位：用户选一个**新模型不支持**的档位，
/// 请求发出去了但静默失效 —— 这正是「显示了但点了没反应」。
#[test]
fn refresh_variants_falls_back_when_current_is_unsupported() {
    let mut state = ConfigState {
        agent: "build".into(),
        variant: Some("max".into()),
        variants: vec!["low".into(), "high".into(), "max".into()],
        model: Some("opencode/a".into()),
    };

    // 切到一个只支持 off 的模型
    assert!(state.refresh_variants(vec!["off".into()], "opencode/b"));
    assert_eq!(
        state.variant,
        Some("off".to_string()),
        "an unsupported current level must fall back, not linger as an illegal value"
    );
    assert_eq!(state.variants, vec!["off".to_string()]);

    // `to_options` 的当前值必须在候选集合里（两者同源）
    let opts = state.to_options();
    let level = opts
        .iter()
        .find(|o| o.id == "thought_level")
        .expect("level option");
    assert_eq!(level.current(), Some("off"));
}

/// 切到**没有档位**的模型 → 思考等级配置项消失（不是显示一个空下拉）。
#[test]
fn refresh_variants_removes_option_when_new_model_has_none() {
    let mut state = ConfigState {
        agent: "build".into(),
        variant: Some("high".into()),
        variants: vec!["low".into(), "high".into()],
        model: Some("opencode/a".into()),
    };

    assert!(state.refresh_variants(Vec::new(), "opencode/b"));
    assert_eq!(state.variant, None);
    let opts = state.to_options();
    assert!(
        !opts.iter().any(|o| o.id == "thought_level"),
        "a model with no variants must not offer a thinking-level control: {opts:?}"
    );
}

/// 新模型仍支持当前档位 → 保持不变（不该无故把用户选的档位重置）。
#[test]
fn refresh_variants_keeps_supported_current() {
    let mut state = ConfigState {
        agent: "build".into(),
        variant: Some("high".into()),
        variants: vec!["low".into(), "high".into()],
        model: Some("opencode/a".into()),
    };

    assert!(state.refresh_variants(
        vec!["low".into(), "high".into(), "max".into()],
        "opencode/b"
    ));
    assert_eq!(state.variant, Some("high".to_string()));
}

/// **同一模型不重拉** —— `/api/model` 有 133 条，而 `Turn` 是热路径。
#[test]
fn refresh_variants_short_circuits_for_same_model() {
    let mut state = ConfigState::default();
    assert!(
        state.needs_variants_for("opencode/a"),
        "first time always needs a fetch"
    );
    state.refresh_variants(vec!["low".into()], "opencode/a");
    assert!(
        !state.needs_variants_for("opencode/a"),
        "same model must not refetch"
    );
    assert!(
        state.needs_variants_for("opencode/b"),
        "a different model needs its own variants"
    );
}

/// 候选值未变时 `refresh_variants` 返回 `false`（调用方据此跳过回推）。
#[test]
fn refresh_variants_reports_no_change_for_identical_set() {
    let mut state = ConfigState::default();
    assert!(state.refresh_variants(vec!["low".into(), "high".into()], "opencode/a"));
    // 同一份集合再来一次 → 无变化
    assert!(!state.refresh_variants(vec!["low".into(), "high".into()], "opencode/a"));
}

/// **`Turn` 分支必须在切模型前刷新档位候选** —— 源码级。
///
/// # 为什么这条只能是源码级（而 `ConfigState` 那几条是行为级）
///
/// `run_request_loop` 的 `Turn` 分支需要真实 HTTP（拉 `/api/model`）与
/// 一个活的 `reqwest::Client`，无法在单测里不启进程地驱动。所以「有没有接线」
/// 只能从结构上断言。
///
/// 但**判断力更强的那部分**已经由行为测试覆盖了：
/// `refresh_variants_*` 四条断言「刷新时怎么算」（回落 / 移除 / 保持 / 短路），
/// 这里只补「它被调用了」。
///
/// 变异验证：把 `needs_variants_for` 短路成 `false` → 本用例红。
#[test]
fn turn_refreshes_variants_before_switching_model() {
    const SOURCE: &str = include_str!("request.rs");
    let start = SOURCE
        .find("SessionRequest::Turn {")
        .expect("Turn arm must exist");
    let rest = &SOURCE[start..];
    let end = rest
        .find("SessionRequest::Input {")
        .expect("Input arm follows Turn");
    let arm = &rest[..end];

    // 必须查「要不要刷新」，且真的去拉
    assert!(
        arm.contains("needs_variants_for"),
        "the Turn arm must check whether the model changed before fetching"
    );
    assert!(
        arm.contains("fetch_variants"),
        "the Turn arm must actually fetch the new model's variants"
    );
    assert!(
        arm.contains("refresh_variants"),
        "and feed them into the state"
    );

    // **顺序**：刷新必须在切模型之前 —— 否则下发的是旧模型的档位
    let refresh_at = arm.find("refresh_variants").expect("refresh");
    let switch_at = arm.find("model_switch_path").expect("model switch");
    assert!(
        refresh_at < switch_at,
        "variants must be refreshed BEFORE the model switch — otherwise the old \
         model's level is sent to the new model"
    );
}

/// **一轮结束时必须清理工具状态**（`tool_names` / `tool_started`）。
///
/// # 两个后果，第二个更严重
///
/// 1. 长会话里持续增长（每次工具调用约 130 字节）；
/// 2. `tool_started` 是**去重集合** —— 跨轮累积后，若 agent 复用 callID，
///    第二轮的同名工具会被误判成「已发过」而**静默丢掉 ToolStart**，
///    前端少一张卡片且没有日志。
///
/// 当前 callID 是全局唯一的随机串（实测 `766c…`），所以第 2 条不会真的撞上；
/// 但「靠对端保证唯一性」不该是本地状态无界的理由。
#[test]
fn execution_end_clears_tool_state() {
    let mut state = V2State::default();

    // 一轮里发生一次工具调用
    let _ = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"session.tool.input.started","data":{"sessionID":"ses_1","id":"c1","name":"bash"}}"#,
        ),
        &mut state,
    );
    let _ = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"session.tool.called","data":{"sessionID":"ses_1","id":"c1","input":{"command":"ls"}}}"#,
        ),
        &mut state,
    );
    assert!(!state.tool_names.is_empty(), "tool name must be cached");
    assert!(!state.tool_started.is_empty(), "callID must be recorded");

    // 一轮结束
    let _ = translate_v2(
        "ses_1",
        &v2_event(r#"{"type":"session.execution.succeeded","data":{"sessionID":"ses_1"}}"#),
        &mut state,
    );
    assert!(state.tool_names.is_empty(), "tool names are per-turn");
    assert!(state.tool_started.is_empty(), "dedup set is per-turn");
}

/// 失败收尾同样清理 —— 否则失败一轮后状态永久残留。
#[test]
fn execution_failure_also_clears_tool_state() {
    let mut state = V2State::default();
    let _ = translate_v2(
        "ses_1",
        &v2_event(
            r#"{"type":"session.tool.input.started","data":{"sessionID":"ses_1","id":"c1","name":"bash"}}"#,
        ),
        &mut state,
    );
    assert!(!state.tool_names.is_empty());

    let _ = translate_v2(
        "ses_1",
        &v2_event(r#"{"type":"session.execution.failed","data":{"sessionID":"ses_1"}}"#),
        &mut state,
    );
    assert!(state.tool_names.is_empty());
    assert!(state.tool_started.is_empty());
}

// ── V1 的回合结束清理（与 V2 统一）──────────────────────────────────────

/// **V1 的 `session.idle` 必须清理 `part_kinds` / `tool_started`。**
///
/// 与 V2 的 `execution.*` 是**同一个契约**：这些状态只描述一轮内的流式/工具
/// 生命周期。不清的后果两版相同 —— 长会话里持续增长，且 `tool_started` 的
/// 去重语义会被跨轮污染。
///
/// V1 实测（1.19.0，连续两轮）：`partID` 跨轮**无重叠**，清空安全。
#[test]
fn v1_session_idle_clears_turn_state() {
    let mut part_kinds = HashMap::new();
    let mut tool_started = HashSet::new();

    // 一轮里：注册一个 part 的类型 + 一个工具调用
    let _ = translate_event(
        "ses_1",
        &sse_event(
            r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"p1","type":"reasoning"}}}"#,
        ),
        &mut part_kinds,
        &mut tool_started,
    );
    let _ = translate_event(
        "ses_1",
        &sse_event(
            r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"c1","type":"tool","callID":"c1","tool":"bash","state":{"status":"running","input":{"command":"ls"}}}}}"#,
        ),
        &mut part_kinds,
        &mut tool_started,
    );
    assert!(!part_kinds.is_empty(), "part kind must be registered");
    assert!(!tool_started.is_empty(), "callID must be recorded");

    // 回合结束
    let evs = translate_event(
        "ses_1",
        &sse_event(r#"{"type":"session.idle","properties":{"sessionID":"ses_1"}}"#),
        &mut part_kinds,
        &mut tool_started,
    );
    assert!(
        matches!(&evs[0], StreamEvent::TurnEnd { .. }),
        "idle still ends the turn: {evs:?}"
    );
    assert!(part_kinds.is_empty(), "part kinds are per-turn");
    assert!(tool_started.is_empty(), "dedup set is per-turn");
}

/// `session.error` **不**清理 —— 它后面还会来 `session.idle`（实测）。
///
/// 提前清理会让 `idle` 之前残余的 part 状态丢失，且没有收益：
/// 清理本来就由 `idle` 负责。
#[test]
fn v1_session_error_does_not_clear_turn_state() {
    let mut part_kinds = HashMap::new();
    let mut tool_started = HashSet::new();
    let _ = translate_event(
        "ses_1",
        &sse_event(
            r#"{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"p1","type":"text"}}}"#,
        ),
        &mut part_kinds,
        &mut tool_started,
    );
    let before = part_kinds.len();

    let _ = translate_event(
        "ses_1",
        &sse_event(
            r#"{"type":"session.error","properties":{"sessionID":"ses_1","error":{"data":{"message":"boom"}}}}"#,
        ),
        &mut part_kinds,
        &mut tool_started,
    );
    assert_eq!(
        part_kinds.len(),
        before,
        "session.error must not clear state — session.idle follows and owns the cleanup"
    );
}

/// **V2 的思考等级必须立即写**，不能等下一轮。
///
/// # 实测依据（2.0.32）
///
/// 同一模型只改 variant 的 `POST /api/session/{id}/model`：
/// - 返回 **204**；
/// - 下一轮 `session.step.started.data.model.variant` 立即是新值。
///
/// 原实现注释写着「V2 随下一次切模型下发」并只记 `pending`，于是用户点档位后
/// **不发任何请求**，UI 靠回推假装成功 —— 表现是「点了没反应」。
///
/// 变异验证：把 V2 的 `post_serve` 调用删掉（只留 `pending.variant`）→ 本用例红。
#[test]
fn v2_thought_level_writes_immediately() {
    const SOURCE: &str = include_str!("request.rs");
    let start = SOURCE
        .find("ConfigKind::ThoughtLevel => {")
        .expect("thought level branch must exist");
    let rest = &SOURCE[start..];
    let end = rest
        .find("state.pending.variant")
        .expect("pending assignment");
    let branch = &rest[..end];

    assert!(
        branch.contains("ServeProtocol::V2"),
        "the level branch must distinguish protocols"
    );
    assert!(
        branch.contains("model_switch_path"),
        "V2 must POST the level immediately via the model endpoint — deferring it \
         until the next model switch means the user's click does nothing"
    );
    assert!(
        branch.contains("post_serve"),
        "and must actually send the request"
    );
}

/// 立即写需要知道当前模型 —— 所以 `ConfigState.model` 是必需的，不是可选优化。
#[test]
fn config_state_tracks_current_model() {
    let mut state = ConfigState::default();
    assert_eq!(state.model, None);

    state.refresh_variants(vec!["low".into(), "high".into()], "opencode/flint");
    assert_eq!(state.model.as_deref(), Some("opencode/flint"));
    // 短路判断也依赖它
    assert!(!state.needs_variants_for("opencode/flint"));
    assert!(state.needs_variants_for("opencode/other"));
}

// ── 命令列表（`GET /api/command`，仅 V2）────────────────────────────────

/// 实测响应形状（2.1.3）：`{location:{directory}, data:[{name, description}]}`。
#[test]
fn commands_from_response_maps_data_entries() {
    let json = serde_json::json!({
        "location": { "directory": "/p" },
        "data": [
            { "name": "init", "description": "guided AGENTS.md setup" },
            { "name": "trellis/start", "description": "Start session" }
        ]
    });
    let commands = super::adapter::commands_from_response(&json);
    assert_eq!(commands.len(), 2);
    assert_eq!(commands[0].name, "init");
    assert_eq!(
        commands[0].description.as_deref(),
        Some("guided AGENTS.md setup")
    );
    assert_eq!(commands[1].name, "trellis/start");
    // opencode 不给 source —— 不编一个（编了会让前端分组把它当 pi 的分类）
    assert!(commands[0].source.is_none());
}

/// 缺 `name` 或名字为空 → 丢弃（没有名字的命令无法插入文本）。
#[test]
fn commands_from_response_drops_nameless_entries() {
    let json = serde_json::json!({
        "data": [
            { "description": "no name" },
            { "name": "" },
            { "name": "ok" }
        ]
    });
    let commands = super::adapter::commands_from_response(&json);
    assert_eq!(commands.len(), 1);
    assert_eq!(commands[0].name, "ok");
}

/// 容忍裸数组与空/畸形载荷 —— 前端拿到空列表（真的没命令），而不是 panic。
#[test]
fn commands_from_response_tolerates_other_shapes() {
    let bare = serde_json::json!([{ "name": "a" }]);
    assert_eq!(super::adapter::commands_from_response(&bare).len(), 1);
    assert!(super::adapter::commands_from_response(&serde_json::json!({})).is_empty());
    assert!(super::adapter::commands_from_response(&serde_json::json!({ "data": [] })).is_empty());
    assert!(super::adapter::commands_from_response(&serde_json::json!(null)).is_empty());
}

/// `?directory=` 必须带上，否则项目级命令（`<project>/.opencode/commands/**`）不被发现。
#[test]
fn commands_url_carries_the_project_directory() {
    assert_eq!(
        super::adapter::commands_url("/api/command", "http://127.0.0.1:1", Some("/p/roject")),
        "http://127.0.0.1:1/api/command?directory=%2Fp%2Froject"
    );
    // 未提供路径（设置页预览等）→ 只查用户级命令
    assert_eq!(
        super::adapter::commands_url("/api/command", "http://127.0.0.1:1", None),
        "http://127.0.0.1:1/api/command"
    );
    assert_eq!(
        super::adapter::commands_url("/api/command", "http://127.0.0.1:1", Some("")),
        "http://127.0.0.1:1/api/command"
    );
}

/// **命令端点是 `/api/*` 共享层**：两版同一路径，不随协议分叉。
///
/// 证据表见 `ServeProtocol::commands_path` 的文档：`/api/model`、`/api/session`、
/// `/api/event` 都已实测两版共存；`/api/info` 是唯一只有 v2 的（正因如此它才是
/// 协议判据）。所以命令端点按共用实现，真没有的版本由运行时失败暴露 ——
/// **不用静态假设把功能藏起来**。
///
/// 变异验证：把 `commands_path` 改回 `match { V1 => "/command", … }` → 本用例红
/// （那会拼出 SPA 回落路径，永远拿不到 JSON）。
#[test]
fn commands_path_is_shared_by_both_protocols() {
    use crate::agent::chat::adapter::opencode::protocol::ServeProtocol;
    assert_eq!(ServeProtocol::V1.commands_path(), "/api/command");
    assert_eq!(ServeProtocol::V2.commands_path(), "/api/command");
}
