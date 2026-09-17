//! DAP 测试支撑：事件记录器 + 假适配器（TCP DAP 服务器）。
//!
//! 存在的理由（neeko-check Pillar 2 / 80% 覆盖率红线）：会话与编排链路原先强耦合
//! `tauri::AppHandle` 与真实适配器进程，`launch_session` / `set_breakpoints` 的
//! 下发路径 / mute 同步 / 外部源码授权全部无法单测。抽出 [`DapEventSink`] 端口后，
//! 事件出口可以换成 [`RecordingSink`]；再加上一个说 DAP 帧协议的
//! [`FakeAdapter`]，整条编排链路可以脱离 Tauri 与真实 `dlv`/`lldb` 跑通。
//!
//! 只在 `#[cfg(test)]` 编译。

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::mpsc;

use super::backends::BackendRegistry;
use super::breakpoints::BreakpointStore;
use super::context::DapContext;
use super::events::DapEventSink;
use super::protocol::encode_message;
use super::session::DapSession;
use super::sessions::SessionRegistry;
use super::types::{BreakpointSpec, DapEventPayload, DapSessionInfo, LaunchConfig};
use crate::session::StorageManager;
use crate::AppStateWrapper;

// ── AppState 夹具 ────────────────────────────────────────────────────────────

/// 隔离的 `AppStateWrapper`：StorageManager 指向临时目录 —— 严禁用默认 `~/.neeko`，
/// 否则 project 的 auto-save 会覆盖用户数据。与 `browser/url_validator` 测试同款。
#[must_use]
pub fn isolated_state(tmp: &tempfile::TempDir) -> AppStateWrapper {
    let storage =
        StorageManager::with_dir(tmp.path().join(".neeko")).expect("fixture: storage manager");
    let store = Arc::new(
        crate::library::LibraryStore::open_in_memory().expect("fixture: in-memory library store"),
    );
    AppStateWrapper::new_with_storage_and_library(storage, store)
}

/// 注册一个普通项目（无语言后端），返回 `(state, project_id)`。
///
/// 断点 / 静音 / 会话编排的单测只依赖项目注册 + 磁盘路径。
#[must_use]
pub fn plain_project_state(tmp: &tempfile::TempDir) -> (AppStateWrapper, String) {
    let state = isolated_state(tmp);
    let project_dir = tmp.path().join("proj");
    std::fs::create_dir_all(&project_dir).expect("fixture: project dir");
    let project = state
        .project_manager
        .lock()
        .expect("fixture: project_manager")
        .add_project(project_dir, None, None, None)
        .expect("fixture: add_project");
    (state, project.id)
}

/// **用例模块级别**的夹具：就地装配四个协作者 + `DapContext`。
///
/// 存在的理由（Pillar 2 的口径是"核心 service 能**单独**测试"）：`launch` /
/// `breakpoints::service` 的测试不该经 `DapManager` 门面 —— 那会让门面为了可测性
/// 长出测试专用 API，也让断言绑在转调层而不是被测算例上。用它之后：
/// `let out = launch::start_language_debug(&f.ctx(), sink, request).await;`
pub struct DapFixture {
    /// 项目上下文（隔离的 `~/.neeko`）。
    pub state: AppStateWrapper,
    /// 已注册的项目 id。
    pub project_id: String,
    /// 会话注册表（就地实例，与组合根同型）。
    pub sessions: SessionRegistry,
    /// 断点仓储（就地实例）。
    pub breakpoints: BreakpointStore,
    /// 语言编排后端注册表（就地实例；`f.backends.register(..)` 注入 fake）。
    pub backends: BackendRegistry,
}

impl DapFixture {
    /// 注册一个项目并装配四个协作者。
    #[must_use]
    pub fn new(tmp: &tempfile::TempDir) -> Self {
        let (state, project_id) = plain_project_state(tmp);
        Self {
            state,
            project_id,
            sessions: SessionRegistry::new(),
            breakpoints: BreakpointStore::new(),
            backends: BackendRegistry::new(),
        }
    }

    /// 借用成用例上下文。
    #[must_use]
    pub fn ctx(&self) -> DapContext<'_> {
        DapContext {
            state: &self.state,
            sessions: &self.sessions,
            breakpoints: &self.breakpoints,
            backends: &self.backends,
        }
    }

    /// 塞一个真实会话（对着假适配器完成握手）并返回其 id。
    ///
    /// 下发路径需要真实 `session.kind()` 与真实 `setBreakpoints` 往返。
    pub async fn with_session(&self, adapter: &FakeAdapter) -> String {
        let session = DapSession::connect(
            adapter.addr(),
            RecordingSink::new(),
            self.project_id.clone(),
            "/proj".to_string(),
            go_launch_config("Go"),
            Vec::new(),
        )
        .await
        .expect("fixture: connect session");
        let id = session.session_id.clone();
        self.sessions.insert(session, None).await;
        id
    }
}

// ── 事件记录器 ───────────────────────────────────────────────────────────────

/// [`DapEventSink`] 的记录实现：把事件留在内存里供断言。
///
/// 内部锁用 `std::sync::Mutex` + `expect`：临界区只有 `Vec::push`，中毒即不可恢复，
/// 且这是测试代码（quality-guidelines 允许测试内 `expect`）。
#[derive(Default)]
pub struct RecordingSink {
    debug_events: Mutex<Vec<DapEventPayload>>,
    statuses: Mutex<Vec<DapSessionInfo>>,
}

impl RecordingSink {
    /// Create a shared recording sink.
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// 已记录的调试事件（`DAP_EVENT`）。
    #[must_use]
    pub fn debug_events(&self) -> Vec<DapEventPayload> {
        self.debug_events
            .lock()
            .expect("infallible: recording sink")
            .clone()
    }

    /// 已记录的事件 kind 序列（`output` / `stopped` / `terminated` …）。
    #[must_use]
    pub fn kinds(&self) -> Vec<String> {
        self.debug_events().into_iter().map(|e| e.kind).collect()
    }

    /// 已记录的 Debug Console 文本（`kind == "output"`，去掉行尾换行）。
    #[must_use]
    pub fn outputs(&self) -> Vec<String> {
        self.debug_events()
            .into_iter()
            .filter(|e| e.kind == "output")
            .filter_map(|e| {
                e.body
                    .get("output")
                    .and_then(Value::as_str)
                    .map(|s| s.trim_end().to_string())
            })
            .collect()
    }

    /// 已记录的会话状态快照（`status` 字段）。
    #[must_use]
    pub fn statuses(&self) -> Vec<String> {
        self.statuses
            .lock()
            .expect("infallible: recording sink")
            .iter()
            .map(|i| i.status.clone())
            .collect()
    }

    /// 是否出现过某 kind 的调试事件。
    #[must_use]
    pub fn has_kind(&self, kind: &str) -> bool {
        self.kinds().iter().any(|k| k == kind)
    }
}

impl DapEventSink for RecordingSink {
    fn debug_event(&self, payload: DapEventPayload) {
        self.debug_events
            .lock()
            .expect("infallible: recording sink")
            .push(payload);
    }

    fn session_status(&self, info: DapSessionInfo) {
        self.statuses
            .lock()
            .expect("infallible: recording sink")
            .push(info);
    }
}

// ── 假适配器 ─────────────────────────────────────────────────────────────────

/// 假 DAP 适配器：监听一个临时端口，按 DAP 帧协议应答，并记录收到的请求。
///
/// 用法：`let adapter = FakeAdapter::start().await;` → 把 `adapter.addr()` 交给
/// `DapSession::connect`（或注入到编排链路）→ 用 `seen_commands()` /
/// `breakpoint_requests()` 断言链路行为。
pub struct FakeAdapter {
    addr: String,
    outbox: mpsc::UnboundedSender<Value>,
    seen: Arc<Mutex<Vec<String>>>,
    breakpoint_args: Arc<Mutex<Vec<Value>>>,
    frames: Arc<Mutex<Vec<Value>>>,
}

impl FakeAdapter {
    /// Bind an ephemeral port and start serving one connection.
    pub async fn start() -> Self {
        Self::start_with(true).await
    }

    /// `verify_breakpoints = false` 时 `setBreakpoints` 一律回 `verified:false`
    /// （模拟适配器未解析断点 ⇒ 必须有 Console 诊断）。
    pub async fn start_with(verify_breakpoints: bool) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake adapter");
        let addr = listener
            .local_addr()
            .expect("fake adapter addr")
            .to_string();

        let (outbox, mut out_rx) = mpsc::unbounded_channel::<Value>();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let breakpoint_args = Arc::new(Mutex::new(Vec::new()));
        let frames = Arc::new(Mutex::new(vec![json!({
            "id": 1,
            "name": "main",
            "line": 1,
            "column": 1,
            "source": { "path": "/proj/src/main.go" },
        })]));

        let seen_r = Arc::clone(&seen);
        let bp_r = Arc::clone(&breakpoint_args);
        let frames_r = Arc::clone(&frames);
        let server_outbox = outbox.clone();
        tokio::spawn(async move {
            let Ok((sock, _)) = listener.accept().await else {
                return;
            };
            let (mut reader, mut writer) = sock.into_split();
            let writer_task = tokio::spawn(async move {
                while let Some(msg) = out_rx.recv().await {
                    if writer.write_all(&encode_message(&msg)).await.is_err() {
                        break;
                    }
                    let _ = writer.flush().await;
                }
            });

            let mut buf: Vec<u8> = Vec::new();
            let mut seq: i64 = 1_000;
            loop {
                let Some(msg) = read_message(&mut reader, &mut buf).await else {
                    break;
                };
                if msg.get("type").and_then(Value::as_str) != Some("request") {
                    continue;
                }
                let command = msg
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let request_seq = msg.get("seq").and_then(Value::as_i64).unwrap_or(-1);
                let args = msg.get("arguments").cloned().unwrap_or(json!({}));
                seen_r
                    .lock()
                    .expect("infallible: fake adapter seen")
                    .push(command.clone());

                seq += 1;
                let mut out = vec![json!({
                    "seq": seq,
                    "type": "response",
                    "request_seq": request_seq,
                    "success": true,
                    "command": command,
                })];
                let body = match command.as_str() {
                    "setBreakpoints" => {
                        bp_r.lock()
                            .expect("infallible: fake adapter bp args")
                            .push(args.clone());
                        let lines = args
                            .pointer("/breakpoints")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default();
                        Some(json!({
                            "breakpoints": lines
                                .iter()
                                .map(|b| json!({
                                    "verified": verify_breakpoints,
                                    "line": b.get("line").cloned().unwrap_or(Value::Null),
                                }))
                                .collect::<Vec<_>>(),
                        }))
                    }
                    "stackTrace" => {
                        let frames = frames_r
                            .lock()
                            .expect("infallible: fake adapter frames")
                            .clone();
                        Some(json!({ "stackFrames": frames }))
                    }
                    "source" => Some(json!({ "content": "fn main() {}\n" })),
                    "evaluate" => Some(json!({ "result": "42", "variablesReference": 0 })),
                    _ => None,
                };
                if let Some(body) = body {
                    out[0]["body"] = body;
                }
                // 真适配器在 launch 响应后派发 `initialized`（会话据此判定握手就绪）。
                if command == "launch" || command == "attach" {
                    seq += 1;
                    out.push(json!({
                        "seq": seq,
                        "type": "event",
                        "event": "initialized",
                        "body": {},
                    }));
                }
                for msg in out {
                    if server_outbox.send(msg).is_err() {
                        break;
                    }
                }
            }
            writer_task.abort();
        });

        Self {
            addr,
            outbox,
            seen,
            breakpoint_args,
            frames,
        }
    }

    /// Endpoint address to hand to `DapSession::connect`.
    #[must_use]
    pub fn addr(&self) -> &str {
        &self.addr
    }

    /// 收到的请求命令序列（按到达顺序）。
    #[must_use]
    pub fn seen_commands(&self) -> Vec<String> {
        self.seen
            .lock()
            .expect("infallible: fake adapter seen")
            .clone()
    }

    /// 每次 `setBreakpoints` 的 arguments（断言"下发的是翻译后的路径"）。
    #[must_use]
    pub fn breakpoint_requests(&self) -> Vec<Value> {
        self.breakpoint_args
            .lock()
            .expect("infallible: fake adapter bp args")
            .clone()
    }

    /// 覆盖适配器返回的调用栈帧（外部源码授权测试用）。
    pub fn set_stack_frames(&self, frames: Vec<Value>) {
        *self.frames.lock().expect("infallible: fake adapter frames") = frames;
    }

    /// 推一个 `stopped` 事件（`resolve_external_source` 要求会话处于 Stopped）。
    pub fn emit_stopped(&self) {
        self.emit_event("stopped", json!({ "reason": "breakpoint", "threadId": 1 }));
    }

    fn emit_event(&self, event: &str, body: Value) {
        let _ = self.outbox.send(json!({
            "seq": 9_000,
            "type": "event",
            "event": event,
            "body": body,
        }));
    }
}

/// 读满一个 DAP 帧（返回 `None` = 对端关闭）。
async fn read_message<R: AsyncReadExt + Unpin>(reader: &mut R, buf: &mut Vec<u8>) -> Option<Value> {
    loop {
        if let Some(msg) = super::protocol::try_decode(buf) {
            return Some(msg);
        }
        let mut tmp = [0u8; 8192];
        match reader.read(&mut tmp).await {
            Ok(0) | Err(_) => return None,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
        }
    }
}

// ── 断点夹具 ─────────────────────────────────────────────────────────────────

#[must_use]
pub fn bp(file_path: &str, line: u32) -> BreakpointSpec {
    BreakpointSpec {
        file_path: file_path.to_string(),
        line,
        verified: false,
        enabled: true,
    }
}

#[must_use]
pub fn bp_disabled(file_path: &str, line: u32) -> BreakpointSpec {
    BreakpointSpec {
        file_path: file_path.to_string(),
        line,
        verified: false,
        enabled: false,
    }
}

// ── 测试用 launch 配置 ───────────────────────────────────────────────────────

/// 一个最小的 Go launch 配置：`plugin_for("go")` 命中，`build_launch_args` 不会失败。
#[must_use]
pub fn go_launch_config(name: &str) -> LaunchConfig {
    LaunchConfig {
        name: name.to_string(),
        type_: "go".into(),
        request: "launch".into(),
        program: Some("${workspaceFolder}".into()),
        cwd: Some("${workspaceFolder}".into()),
        mode: Some("debug".into()),
        stop_on_entry: Some(false),
        ..Default::default()
    }
}

/// 等待某条件成立（事件是异步派发的：DAP 事件 → `tokio::spawn` → sink 记录）。
///
/// 上限 2s：超时即断言失败，避免用固定 `sleep` 制造偶发红。
pub async fn wait_until<F: Fn() -> bool>(predicate: F) {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
    while tokio::time::Instant::now() < deadline {
        if predicate() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(predicate(), "condition not met within 2s");
}
