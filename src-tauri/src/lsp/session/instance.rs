//! One LSP language-server session: spawn, I/O threads, request/response.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::{Context, Result};
use crossbeam_channel::{Receiver, Sender};
use lsp_server::{Message, Notification, Request, RequestId};
use serde_json::Value;

use crate::lsp::diag_bus::DiagnosticBus;
use crate::lsp::inflight::InflightRequestTracker;
use crate::lsp::plugin::LspPlugin;
use crate::lsp::transport::LspTransport;
use crate::lsp::types::{parse_server_version_output, LspServerInfo, LspServerLogEntry};

use super::lifecycle::{crash_message, Lifecycle};
use super::log_ring_buffer::LogRingBuffer;
use super::notify::{handle_diagnostics_notification, handle_progress_notification};
use super::request::PendingSender;
use super::status::LspSessionStatus;
use super::utils::{iso_timestamp_now, sample_process_memory_mb};

pub(crate) struct LspSession {
    /// Language identifier (e.g. "rust").
    pub(crate) language_id: String,
    /// Project filesystem path.
    pub(crate) project_path: String,
    /// Server binary name (e.g. "rust-analyzer").
    pub(crate) server_name: String,
    /// Channel sender for writing LSP messages to the server.
    pub(crate) writer: crossbeam_channel::Sender<Message>,
    /// Pending request ID to response sender map.
    pub(crate) pending: Arc<Mutex<HashMap<RequestId, PendingSender>>>,
    /// Latest in-flight request per single-flight method (hover/definition/…).
    pub(crate) inflight: Arc<Mutex<InflightRequestTracker>>,
    /// Reader thread handle for processing server responses.
    pub(crate) reader: Option<thread::JoinHandle<Result<()>>>,
    /// Stderr logger thread handle.
    #[allow(dead_code)]
    pub(crate) stderr_logger: Option<thread::JoinHandle<()>>,
    /// Number of times this session has been restarted.
    #[allow(dead_code)]
    pub(crate) restart_count: u32,
    /// Cached server capabilities from the initialize handshake.
    pub(crate) server_capabilities: Value,
    /// Child process handle for lifecycle management (kill on close).
    pub(crate) child: Option<crate::lsp::process::LspProcess>,
    /// OS / remote process id for memory sampling (when available).
    pub(crate) process_pid: Option<u32>,
    /// Version metadata parsed from `--version` at spawn (memory filled on demand).
    pub(crate) server_info: LspServerInfo,
    /// Ring buffer of recent stderr lines for View Logs (max 10 MB).
    pub(crate) log_buffer: Arc<Mutex<LogRingBuffer>>,
    /// Transport for emitting session lifecycle events to the frontend.
    pub(crate) transport: Arc<dyn LspTransport>,
    /// 在途 progress token 集合（`$/progress` 的 begin→end 生命周期）。
    ///
    /// 供"该项目+语言是否仍在导入/索引"的查询使用 —— Java debug 能力探测的
    /// `Warming` 判据依赖它（design §2.4）：`classpath` 空 **且** 有在途进度才
    /// 是"稍后可成"，无进度则属真损坏工程，必须直接报错。
    pub(crate) in_flight_progress: Arc<Mutex<HashSet<String>>>,
    /// 会话生命周期的唯一真相（相位 + 终态判定）。
    ///
    /// reader 线程（进程退出）与关闭路径（Neeko 主动关闭）都是**写者**；
    /// 快照 / 存活判定 / 事件发射都是**读者**。共享 Arc 供 reader 线程与 close
    /// 路径并发读写，`Lifecycle` 内部以原子相位保证终态不可复活。
    pub(crate) lifecycle: Arc<Lifecycle>,
}

impl LspSession {
    /// Create a new LSP session: spawn server process, perform initialize handshake.
    pub(crate) fn new(
        plugin: &LspPlugin,
        project_path: &str,
        workspace_root: &Path,
        app_handle: tauri::AppHandle,
        diag_bus: Arc<DiagnosticBus>,
        transport: Arc<dyn LspTransport>,
        exec_target: crate::common::executor::factory::ExecTarget,
    ) -> Result<Self> {
        let language_id = plugin.language_id.to_string();
        let server_name = plugin.server_binary.to_string();
        // Non-UTF-8 segments are lossy-mapped to `�`; this mirrors how the
        // existing code elsewhere in the codebase falls back to the project
        // root on unrepresentable paths. `url::Url::from_directory_path` and
        // the JSON `rootPath` field both need a `&str`, so we must pick a
        // string representation here. Crucially, `workspace_root` (the `Path`)
        // is still used for `from_directory_path` and `starts_with` checks,
        // so lossy conversion only affects the textual `rootPath` the server
        // sees — the on-disk resolution stays correct.
        let workspace_root_str = workspace_root.to_string_lossy().into_owned();

        if !crate::lsp::installer::check_plugin_installed(plugin, &exec_target) {
            log::info!(
                "[LSP] {} not found in project env, attempting auto-install for: {}",
                server_name,
                language_id
            );
            match crate::lsp::installer::install_plugin_server(plugin, &app_handle, &exec_target) {
                Ok(true) => {
                    log::info!("[LSP] Auto-install succeeded for {}", language_id);
                    if !crate::lsp::installer::check_plugin_installed(plugin, &exec_target) {
                        anyhow::bail!("{} was installed but still not found in project PATH. Try restarting Neeko.", server_name);
                    }
                }
                Ok(false) => {
                    log::info!("[LSP] No auto-install method for {}, skipping", language_id);
                }
                Err(e) => {
                    log::error!("[LSP] Auto-install failed for {}: {}", language_id, e);
                    anyhow::bail!(
                        "Failed to auto-install {}. Install it manually: {}",
                        server_name,
                        e
                    );
                }
            }
        }

        let cmd = &plugin.server_command;
        if cmd.is_empty() {
            anyhow::bail!("LSP server command is empty for {}", language_id);
        }
        log::info!(
            "[LSP] Spawning server: language={} binary={:?} project={} env={:?}",
            language_id,
            cmd,
            project_path,
            std::mem::discriminant(&exec_target)
        );

        // 探测策略由插件自带 tuning 声明（见 plugin/builtins/java.rs 的 jdtls
        // 调优）：跳过探测的服务器版本降级为 unknown；其余限时 3s，超时组杀后
        // 降级为无元数据。session 层不按语言名分支。
        let mut server_info = if !plugin.tuning.version_probe {
            LspServerInfo::unknown()
        } else {
            match crate::lsp::process::run_command_blocking(
                &exec_target,
                &cmd[0],
                &["--version"],
                std::time::Duration::from_secs(3),
            ) {
                Ok((_code, stdout, stderr)) => {
                    parse_server_version_output(if stdout.trim().is_empty() {
                        &stderr
                    } else {
                        &stdout
                    })
                }
                Err(e) => {
                    log::debug!(
                        "[LSP] --version failed for {}: {} (continuing without metadata)",
                        server_name,
                        e
                    );
                    LspServerInfo::unknown()
                }
            }
        };

        let args: Vec<&str> = cmd[1..].iter().map(|s| s.as_str()).collect();
        // Tooling JDK 对齐（VSCode `java.jdt.ls.java.home` 语义）：由插件 tuning
        // 声明是否需要注入（`java_home_from_path`），不再按语言名判断 —— 第二个
        // Java 系服务器声明同一 tuning 即可，无需改此处。
        let env: Vec<(String, String)> = if plugin.tuning.java_home_from_path {
            crate::lsp::process::resolve_java_home(&exec_target)
                .into_iter()
                .map(|home| ("JAVA_HOME".to_string(), home))
                .collect()
        } else {
            Vec::new()
        };
        let env_ref: Vec<(&str, &str)> =
            env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        let mut process = crate::lsp::process::spawn_lsp_process(
            &exec_target,
            &cmd[0],
            &args,
            Some(&workspace_root_str),
            &env_ref,
        )
        .map_err(|e| anyhow::anyhow!("Failed to spawn LSP server {}: {}", server_name, e))?;

        let process_pid = process.pid;
        let log_buffer: Arc<Mutex<LogRingBuffer>> = Arc::new(Mutex::new(LogRingBuffer::new()));
        // 生命周期唯一真相：spawn 前建立，reader 线程与后续所有发布共用同一 Arc。
        let lifecycle = Arc::new(Lifecycle::new());
        // 生命周期起点：spawn 成功后即推 starting（此时 session 结构尚未构造，
        // 只能经自由函数发布；状态相位与事件文案同源，见 `publish_status`）。
        publish_status(
            &lifecycle,
            transport.as_ref(),
            project_path,
            &language_id,
            LspSessionStatus::Starting,
            Some(&format!("Starting {}...", server_name)),
            None,
        );

        let (child_stdin, child_stdout, child_stderr) =
            process.take_stdio().map_err(|e| anyhow::anyhow!(e))?;
        let (writer_tx, writer_rx): (Sender<Message>, Receiver<Message>) =
            crossbeam_channel::unbounded();

        let mut child_stdin_w = child_stdin;
        let _writer_handle = thread::Builder::new()
            .name(format!(
                "lsp-writer-{}",
                &server_name[..4.min(server_name.len())]
            ))
            .spawn(move || -> Result<()> {
                for msg in writer_rx {
                    msg.write(&mut child_stdin_w)
                        .context("LSP writer: failed to write message")?;
                }
                Ok(())
            })
            .map_err(|e| anyhow::anyhow!("Failed to spawn LSP writer thread: {}", e))?;

        let stderr_name = server_name.clone();
        let log_buf_clone = Arc::clone(&log_buffer);
        let stderr_handle = thread::Builder::new()
            .name(format!(
                "lsp-stderr-{}",
                &server_name[..4.min(server_name.len())]
            ))
            .spawn(move || {
                let reader = BufReader::new(child_stderr);
                for line in reader.lines() {
                    let l = match line {
                        Ok(l) => l,
                        Err(_) => break,
                    };
                    let trimmed = l.trim_end().to_string();
                    if !trimmed.is_empty() {
                        let level = if trimmed.contains("error") || trimmed.contains("panic") {
                            "error"
                        } else if trimmed.contains("warn") {
                            "warn"
                        } else {
                            "info"
                        };
                        log::warn!("[LSP][{} stderr] {}", stderr_name, trimmed);
                        let entry = LspServerLogEntry {
                            timestamp: iso_timestamp_now(),
                            level: level.into(),
                            message: trimmed,
                        };
                        if let Ok(mut buf) = log_buf_clone.lock() {
                            buf.push(entry);
                        }
                    }
                }
            })
            .ok();

        let root_uri = url::Url::from_directory_path(workspace_root)
            .map_err(|_| anyhow::anyhow!("Invalid workspace root: {}", workspace_root_str))?
            .to_string();
        let pending: Arc<Mutex<HashMap<RequestId, PendingSender>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let reader_stream = BufReader::new(child_stdout);
        let pending_clone = Arc::clone(&pending);
        let pp_reader = project_path.to_string();
        let ws_root_reader = workspace_root_str.to_string();
        let lang_id_clone = language_id.clone();
        let server_name_reader = server_name.clone();
        let transport_clone = Arc::clone(&transport);
        let writer_for_reader = writer_tx.clone();
        let in_flight_progress: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
        let progress_tokens_reader = Arc::clone(&in_flight_progress);
        // reader 线程是"进程何时死"的唯一观测者：它退出时把相位写进 lifecycle，
        // 快照与存活判定据此读取（不再各自轮询 JoinHandle）。session 结构持有同一 Arc。
        let lifecycle_reader = Arc::clone(&lifecycle);

        let reader_handle = thread::Builder::new()
            .name(format!(
                "lsp-reader-{}",
                &server_name[..4.min(server_name.len())]
            ))
            .spawn(move || -> Result<()> {
                let mut reader_stream = reader_stream;
                // 手动接管 read 结果（不再用 `?` 提前返回）：循环结束点统一做
                // 崩溃判定 —— 非优雅关闭时子进程退出 = 崩溃信号（AC2）。catch_unwind
                // 兜底循环体内任何 panic（含 pending 锁中毒的早退路径）也补发崩溃
                // 事件：reader 线程静默死亡会让状态栏永久停在 running（M2 反目标）。
                // catch_unwind 会把闭包捕获的所有权带走，崩溃事件参数须在进入前克隆。
                let exit_transport = Arc::clone(&transport_clone);
                let exit_pp = pp_reader.clone();
                let exit_lang = lang_id_clone.clone();
                let exit_name = server_name_reader.clone();
                let exit_lifecycle = Arc::clone(&lifecycle_reader);
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let read_result = loop {
                        match Message::read(&mut reader_stream) {
                            Ok(Some(msg)) => match &msg {
                                Message::Response(resp) => {
                                    // 锁中毒不得 `?` 提前返回：那会绕过循环出口的崩溃判定。
                                    let mut map = match pending_clone.lock() {
                                        Ok(map) => map,
                                        Err(e) => break Err(anyhow::anyhow!(
                                            "LSP reader pending lock poisoned: {}",
                                            e
                                        )),
                                    };
                                    if let Some(tx) = map.remove(&resp.id) {
                                        let _ = tx.send(msg);
                                        continue;
                                    }
                                    log::debug!("[LSP] Dropping unmatched response id={:?}", resp.id);
                                }
                                Message::Notification(notif) => {
                                    if notif.method == "textDocument/publishDiagnostics" {
                                        handle_diagnostics_notification(
                                            &notif.params,
                                            &pp_reader,
                                            &lang_id_clone,
                                            &diag_bus,
                                        );
                                    } else if notif.method == "window/workDoneProgress"
                                        || notif.method == "$/progress"
                                    {
                                        handle_progress_notification(
                                            &notif.params,
                                            &pp_reader,
                                            &lang_id_clone,
                                            &*transport_clone,
                                            &progress_tokens_reader,
                                        );
                                    }
                                }
                                Message::Request(req) => {
                                    let root = url::Url::from_directory_path(&ws_root_reader)
                                        .ok()
                                        .map(|u| u.to_string());
                                    let resp = crate::lsp::server_request::respond_to_server_request(
                                        req,
                                        root.as_deref(),
                                    );
                                    log::debug!(
                                        "[LSP] Answered server request: {} id={:?}",
                                        req.method,
                                        req.id
                                    );
                                    if let Err(e) =
                                        writer_for_reader.send(Message::Response(resp))
                                    {
                                        log::warn!(
                                            "[LSP] Failed to send response for server request {}: {}",
                                            req.method,
                                            e
                                        );
                                    }
                                }
                            },
                            // `Ok(None)` = 服务端关闭了连接（收到 exit 通知后）。这**不是**
                            // 优雅关闭的判据：Neeko 主动关闭的判据在 lifecycle（close 路径
                            // 先落终态）。此处仅结束循环，由出口统一判定（未主动关闭即崩溃）。
                            Ok(None) => break Ok(()),
                            Err(e) => {
                                break Err(anyhow::anyhow!("LSP reader: read error: {e}"));
                            }
                        }
                    };
                    // 出口统一判定（幂等）：优雅关闭 → 静默；否则崩溃 → error + 重试。
                    on_reader_exit(
                        &lifecycle_reader,
                        &*transport_clone,
                        &pp_reader,
                        &lang_id_clone,
                        &server_name_reader,
                    );
                    read_result
                }));
                match result {
                    Ok(read_result) => read_result,
                    Err(payload) => {
                        // 循环体内 panic：仍按崩溃发事件（状态栏可给出重试入口），
                        // 并把 panic 载荷写进日志 —— 应用无全局 panic hook，载荷若丢
                        // 弃则只进 stderr，打包后的 GUI 里无处可查（Pillar 13 可观测性）。
                        let detail = panic_payload_message(&*payload);
                        log::error!(
                            "[LSP] reader thread panicked for {pp_reader}:{lang_id_clone}: {detail}"
                        );
                        on_reader_exit(
                            &exit_lifecycle,
                            &*exit_transport,
                            &exit_pp,
                            &exit_lang,
                            &exit_name,
                        );
                        Err(anyhow::anyhow!("LSP reader thread panicked: {detail}"))
                    }
                }
            })
            .map_err(|e| anyhow::anyhow!("Failed to spawn LSP reader thread: {}", e))?;

        let (init_tx, init_rx) = tokio::sync::oneshot::channel::<Message>();
        let mut init_params = serde_json::json!({
            "processId": std::process::id(), "rootUri": root_uri, "rootPath": workspace_root_str,
            "workspaceFolders": [{ "uri": root_uri, "name": Path::new(&workspace_root_str).file_name().and_then(|n| n.to_str()).unwrap_or("workspace") }],
            "capabilities": merge_client_capabilities(build_client_capabilities(), plugin),
            "clientInfo": { "name": "neeko", "version": env!("CARGO_PKG_VERSION") }
        });
        // JDT 扩展字段归属 initializationOptions（非 capabilities）。两者皆无时
        // 不注入该键 —— 保持既有各语言 initialize 载荷不变（空对象注入是无谓变更）。
        if let Some(init_options) = init_options_for(plugin) {
            if let Some(obj) = init_params.as_object_mut() {
                obj.insert("initializationOptions".into(), init_options);
            }
        }

        let init_req_id = RequestId::from(1i32);
        {
            let mut map = pending
                .lock()
                .map_err(|e| anyhow::anyhow!("LSP init pending lock poisoned: {}", e))?;
            map.insert(init_req_id.clone(), init_tx);
        }

        let init_req = Request::new(init_req_id.clone(), "initialize".to_string(), init_params);
        writer_tx
            .send(Message::Request(init_req))
            .context("Failed to send initialize request")?;

        let init_response = init_rx
            .blocking_recv()
            .context("LSP initialization: no response received")?;
        let server_capabilities = parse_initialize_response(init_response)?;

        log::info!("[LSP] {} initialized, capabilities received", server_name);
        publish_status(
            &lifecycle,
            transport.as_ref(),
            project_path,
            &language_id,
            LspSessionStatus::Initializing,
            None,
            None,
        );

        let notif = Notification::new("initialized".to_string(), serde_json::json!({}));
        writer_tx
            .send(Message::Notification(notif))
            .context("Failed to send initialized notification")?;
        {
            let mut map = pending
                .lock()
                .map_err(|e| anyhow::anyhow!("LSP init pending lock poisoned: {}", e))?;
            map.remove(&init_req_id);
        }

        server_info.memory_mb = 0.0;

        let session = Self {
            language_id,
            project_path: project_path.to_string(),
            server_name,
            writer: writer_tx,
            pending,
            inflight: Arc::new(Mutex::new(InflightRequestTracker::new())),
            reader: Some(reader_handle),
            stderr_logger: stderr_handle,
            restart_count: 0,
            server_capabilities,
            child: Some(process),
            process_pid,
            server_info,
            log_buffer,
            transport,
            in_flight_progress,
            lifecycle,
        };
        // 生命周期终态：initialize 握手成功 → Ready（相位与事件同一入口，单写点）。
        session.publish(LspSessionStatus::Ready, None, None);
        Ok(session)
    }

    /// Whether the session can still serve requests.
    ///
    /// 单一真相：判据取自 `lifecycle`（reader 线程退出时会写下崩溃相位），不再二次
    /// 轮询 `JoinHandle::is_finished()` —— 后者无法区分「优雅关闭」与「进程崩溃」，
    /// 且与事件发射各持一套判据。无 reader 的桩会话（测试夹具）不算存活。
    pub(crate) fn is_alive(&self) -> bool {
        self.reader.is_some() && !self.lifecycle.is_terminal()
    }

    /// Send an LSP request and await the response asynchronously.
    #[allow(dead_code)]
    pub(crate) async fn send_request_async(&self, method: &str, params: Value) -> Result<Value> {
        super::request::do_send_request(
            Arc::clone(&self.pending),
            self.writer.clone(),
            Arc::clone(&self.inflight),
            method,
            params,
            false,
        )
        .await
    }

    /// Send a raw LSP notification to the server.
    pub(crate) fn send_notification_raw(&self, method: &str, params: Value) -> Result<()> {
        let notif = Notification::new(method.to_string(), params);
        self.writer
            .send(Message::Notification(notif))
            .with_context(|| format!("Failed to send LSP notification: {}", method))
    }

    /// Send a graceful shutdown request and wait for the response.
    pub(crate) fn send_shutdown_request(&self) -> Result<Message> {
        let (tx, rx) = tokio::sync::oneshot::channel::<Message>();
        let req_id = RequestId::from(1000i32);
        {
            let mut map = self
                .pending
                .lock()
                .map_err(|e| anyhow::anyhow!("LSP pending lock poisoned: {}", e))?;
            map.insert(req_id.clone(), tx);
        }
        let req = Request::new(
            req_id.clone(),
            "shutdown".to_string(),
            serde_json::json!({}),
        );
        self.writer
            .send(Message::Request(req))
            .context("Failed to send shutdown request")?;
        let response = rx
            .blocking_recv()
            .context("LSP shutdown: no response received")?;
        {
            let mut map = self
                .pending
                .lock()
                .map_err(|e| anyhow::anyhow!("LSP pending lock poisoned: {}", e))?;
            map.remove(&req_id);
        }
        Ok(response)
    }

    /// Kill the child process and wait for it to exit.
    pub(crate) fn kill_child(&mut self) {
        if let Some(mut child) = self.child.take() {
            child.kill();
        }
    }

    /// 推进生命周期相位并发布对应事件。
    ///
    /// 状态与事件**同源同入口**：不允许只改相位不发事件，或反之 —— 两者失配正是
    /// "状态栏显示与快照不一致"的成因（相位是唯一真相，事件是它的投影）。
    fn publish(&self, status: LspSessionStatus, message: Option<&str>, progress_pct: Option<u32>) {
        publish_status(
            &self.lifecycle,
            self.transport.as_ref(),
            &self.project_path,
            &self.language_id,
            status,
            message,
            progress_pct,
        );
    }

    /// 关闭会话并**宣告结束**（用户停止 / 项目停用）。
    ///
    /// 顺序不可交换：终态必须先于 reader 线程察觉连接断开，否则 reader 退出会被
    /// 判成崩溃（"关闭后闪错误"）。幂等由状态机保证（重复关闭不再发事件）。
    pub(crate) fn close(&self) -> bool {
        self.close_with_notice(true)
    }

    /// 关闭会话但**不宣告结束**（重启前的替换）。
    ///
    /// 相位仍必须落终态（reader 退出据此静默），但 `stopped` 事件被刻意不发：
    /// 重启是替换而非结束，宣告终态只会让状态栏 chip 闪断。语义细节见
    /// `LspManager::close_session_for_restart`。
    pub(crate) fn close_silently(&self) -> bool {
        self.close_with_notice(false)
    }

    /// 落终态；`announce` 决定是否把终态投影成 `stopped` 事件。
    fn close_with_notice(&self, announce: bool) -> bool {
        if !self.lifecycle.close() {
            return false;
        }
        if announce {
            self.publish(LspSessionStatus::Stopped, None, None);
        }
        true
    }

    /// Snapshot server metadata; refreshes RSS when a process pid is known.
    pub(crate) fn snapshot_server_info(&self) -> LspServerInfo {
        let mut info = self.server_info.clone();
        info.memory_mb = self
            .process_pid
            .and_then(sample_process_memory_mb)
            .unwrap_or(0.0);
        info
    }

    /// Return the most recent stderr log lines (newest last), capped by `limit`.
    #[allow(dead_code)]
    pub(crate) fn snapshot_logs(&self, limit: usize) -> Vec<LspServerLogEntry> {
        let Ok(buf) = self.log_buffer.lock() else {
            return Vec::new();
        };
        buf.snapshot(limit)
    }

    /// Create a session info snapshot for the status bar.
    ///
    /// 直接读生命周期相位（唯一真相）：崩溃会话不得快照为 ready —— 否则前端
    /// `LspSubscriptionBridge` 的项目切换初始同步会把事件驱动的 error 状态冲回
    /// 绿点（design.md M2：进程退出 → 可见错误 + 重试）。
    pub(crate) fn snapshot(&self) -> crate::lsp::types::LspSessionInfo {
        use crate::lsp::types::LspSessionInfo;
        let status = self.lifecycle.status(&self.server_name);
        LspSessionInfo {
            language_id: self.language_id.clone(),
            project_path: self.project_path.clone(),
            server_name: self.server_name.clone(),
            status: status.as_str().to_string(),
            status_message: match &status {
                LspSessionStatus::Error(msg) => Some(msg.clone()),
                _ => None,
            },
            progress_pct: None,
        }
    }
}

/// 推进生命周期相位并经 transport 发布事件（session 未构造时也可用的自由函数）。
pub(crate) fn publish_status(
    lifecycle: &Lifecycle,
    transport: &dyn LspTransport,
    project_path: &str,
    language_id: &str,
    status: LspSessionStatus,
    message: Option<&str>,
    progress_pct: Option<u32>,
) {
    lifecycle.set(&status);
    transport.push_session_event(
        project_path,
        language_id,
        status.as_str(),
        message,
        progress_pct,
    );
}

/// Push a session `error` lifecycle event to the frontend.
///
/// 失败路径（会话尚未构造 / reader 线程内）没有 `&self` 可借用，统一经此直发；
/// 状态串取自类型化枚举，保证与 `publish_status` 同源。
pub(crate) fn emit_session_error(
    transport: &dyn LspTransport,
    project_path: &str,
    language_id: &str,
    message: &str,
) {
    transport.push_session_event(
        project_path,
        language_id,
        LspSessionStatus::Error(message.to_string()).as_str(),
        Some(message),
        None,
    );
}

/// Reader 循环退出时的崩溃判定 + 事件发布。
///
/// 判定完全交给 [`Lifecycle::on_reader_exit`]（单一真相，天然幂等）：
/// 优雅关闭（close 路径已先落终态）→ 静默，避免「关闭后闪错误」；
/// 非优雅关闭（子进程提前退出，如 `kill gopls`）→ 发 `error` 供前端展示
/// message + 重试入口。返回是否本次真的发出了崩溃事件。
pub(crate) fn on_reader_exit(
    lifecycle: &Lifecycle,
    transport: &dyn LspTransport,
    project_path: &str,
    language_id: &str,
    server_name: &str,
) -> bool {
    if !lifecycle.on_reader_exit() {
        return false;
    }
    emit_session_error(
        transport,
        project_path,
        language_id,
        &crash_message(server_name),
    );
    true
}

/// panic 载荷 → 可读文案（应用无全局 panic hook，载荷必须落进日志）。
pub(crate) fn panic_payload_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic payload".to_string())
}

/// Client capabilities advertised to the language server during `initialize`.
///
/// `completionItem.snippetSupport: true` lets servers return snippet-format
/// `insertText` (e.g. `foo(${1:param1}, ${2:param2})`) so accepting a function
/// completion auto-fills its parameters with tab-stop placeholders
/// (IDEA-style), instead of inserting only the bare function name.
///
/// `completionItem.documentation: true` asks servers to include per-item
/// documentation in completion responses — the info panel's docs section
/// ("function documentation hints") depends on it.
pub(crate) fn build_client_capabilities() -> Value {
    serde_json::json!({
        "textDocument": {
            "hover": { "contentFormat": ["markdown", "plaintext"] },
            "definition": { "linkSupport": true },
            "references": {},
            "completion": { "completionItem": { "snippetSupport": true, "documentation": true, "documentationFormat": ["markdown", "plaintext"] } },
            "publishDiagnostics": { "relatedInformation": true }
        },
        "workspace": { "workspaceFolders": true, "configuration": true, "didChangeConfiguration": { "dynamicRegistration": false } },
        "window": { "workDoneProgress": true }
    })
}

/// Merge a plugin's extra client capabilities **over** the base set (top-level keys).
///
/// 用于服务端专属能力：rust-analyzer 的 `experimental.runnables` 只有客户端在
/// `capabilities.experimental.runnables.kinds` 声明后才应答（实测 1.97.1）。按插件声明
/// 而不是全局注入 —— 其它语言（gopls / jdtls）的 initialize 载荷保持逐字节不变。
///
/// 合并语义：顶层 key 浅合并（同名 key 由插件覆盖）。`None` → 原样返回（逐字节不变）。
pub(crate) fn merge_client_capabilities(mut base: Value, plugin: &LspPlugin) -> Value {
    let Some(extra) = plugin.client_capabilities.clone() else {
        return base;
    };
    match (base.as_object_mut(), extra.as_object()) {
        (Some(base_obj), Some(extra_obj)) => {
            for (k, v) in extra_obj {
                base_obj.insert(k.clone(), v.clone());
            }
            base
        }
        // 非对象形态无法浅合并 → 退回基础集（不猜语义）。
        _ => base,
    }
}

/// Build the `initializationOptions` payload for a plugin, or `None` when the
/// plugin declares neither options nor extended capabilities — callers must
/// then omit the key entirely (an empty `{}` would be a gratuitous change to
/// every other language's initialize payload).
pub(crate) fn init_options_for(plugin: &LspPlugin) -> Option<Value> {
    // 运行时提供者优先：载荷可能依赖"此刻磁盘上是否已有某文件"（jdtls 的 bundles）。
    let base = plugin
        .initialization_options_provider
        .map(|provider| provider())
        .or_else(|| plugin.initialization_options.clone());
    if base.is_none() && plugin.extended_client_capabilities.is_none() {
        return None;
    }
    Some(merge_extended_client_capabilities_into_init_options(
        base.unwrap_or_else(|| serde_json::json!({})),
        plugin,
    ))
}

/// Merge plugin-declared `extendedClientCapabilities` into `initializationOptions`.
///
/// JDT 只从 `initializationOptions.extendedClientCapabilities` 读取（见
/// plugin/builtins/java.rs），`capabilities` 下的同名字段它永远看不见。
/// Only plugins that declare them (currently java/jdtls) gain the extra key;
/// all other languages get the input back byte-identical. Non-object input
/// with declared caps cannot be merged, so a fresh object holding only the
/// extra key is returned instead.
pub(crate) fn merge_extended_client_capabilities_into_init_options(
    mut init_options: Value,
    plugin: &LspPlugin,
) -> Value {
    match plugin.extended_client_capabilities.clone() {
        Some(extra) => match init_options.as_object_mut() {
            Some(obj) => {
                obj.insert("extendedClientCapabilities".into(), extra);
                init_options
            }
            None => serde_json::json!({ "extendedClientCapabilities": extra }),
        },
        None => init_options,
    }
}

/// When the server answered with an error (e.g. typescript-language-server
/// failing to locate a TypeScript installation), the server's own message is
/// surfaced instead of a bare "has no result", so the real cause is visible.
pub(crate) fn parse_initialize_response(msg: Message) -> Result<Value> {
    match msg {
        Message::Response(resp) => {
            if let Some(err) = resp.error {
                anyhow::bail!(
                    "LSP initialize failed: [{code}] {message}",
                    code = err.code,
                    message = err.message
                );
            }
            resp.result
                .ok_or_else(|| anyhow::anyhow!("LSP initialize response has no result"))
        }
        _ => anyhow::bail!("LSP initialization: unexpected message type"),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use crate::lsp::session::testing::{stub_session, RecordingTransport};
    use lsp_server::{RequestId, Response, ResponseError};
    use serde_json::json;

    fn err_response(message: &str) -> Message {
        Message::Response(Response {
            id: RequestId::from(1),
            result: None,
            error: Some(ResponseError {
                code: -32603,
                message: message.to_string(),
                data: None,
            }),
        })
    }

    #[test]
    fn surfaces_server_error_message() {
        let err = parse_initialize_response(err_response(
            "Could not find a valid TypeScript installation",
        ))
        .unwrap_err();
        assert!(
            err.to_string()
                .contains("Could not find a valid TypeScript installation"),
            "server error message must be surfaced, got: {err}"
        );
    }

    #[test]
    fn ok_response_returns_capabilities() {
        let msg = Message::Response(Response::new_ok(
            RequestId::from(1),
            json!({"capabilities": {}}),
        ));
        let caps = parse_initialize_response(msg).unwrap();
        assert_eq!(caps["capabilities"], json!({}));
    }

    #[test]
    fn empty_response_reports_no_result() {
        let msg = Message::Response(Response {
            id: RequestId::from(1),
            result: None,
            error: None,
        });
        let err = parse_initialize_response(msg).unwrap_err();
        assert!(err.to_string().contains("no result"), "got: {err}");
    }

    #[test]
    fn non_response_message_is_rejected() {
        let msg = Message::Notification(lsp_server::Notification::new(
            "initialized".to_string(),
            json!({}),
        ));
        let err = parse_initialize_response(msg).unwrap_err();
        assert!(
            err.to_string().contains("unexpected message type"),
            "got: {err}"
        );
    }

    #[test]
    fn client_capabilities_advertise_snippet_support() {
        let caps = build_client_capabilities();
        // JDT 扩展字段走 initializationOptions：capabilities 下绝不能出现残留。
        assert!(caps.get("extendedClientCapabilities").is_none());
        assert_eq!(
            caps["textDocument"]["completion"]["completionItem"]["snippetSupport"],
            json!(true),
            "snippetSupport must be advertised so servers return snippet insertText \
             (function completions auto-fill parameters, IDEA-style)"
        );
        // Hover / documentation formats must be preserved.
        assert_eq!(
            caps["textDocument"]["hover"]["contentFormat"],
            json!(["markdown", "plaintext"])
        );
        assert_eq!(
            caps["textDocument"]["completion"]["completionItem"]["documentationFormat"],
            json!(["markdown", "plaintext"])
        );
        // Completion items must carry documentation so the info panel can show
        // function documentation hints (the master-detail right column).
        assert_eq!(
            caps["textDocument"]["completion"]["completionItem"]["documentation"],
            json!(true),
            "documentation must be advertised so servers include per-item docs"
        );
    }

    #[test]
    fn merge_extended_capabilities_into_init_options_inserts_when_present() {
        let plugin = LspPlugin::builtin("java", &["java"], "jdtls", &["jdtls"], None)
            .with_extended_client_capabilities(serde_json::json!({
                "classFileContentsSupport": true,
                "progressReportProvider": true
            }));
        // 空对象基底：仅插入 extendedClientCapabilities。
        let merged = merge_extended_client_capabilities_into_init_options(json!({}), &plugin);
        assert_eq!(
            merged["extendedClientCapabilities"]["classFileContentsSupport"],
            json!(true)
        );
        assert_eq!(
            merged["extendedClientCapabilities"]["progressReportProvider"],
            json!(true)
        );
        // 预置键保留：插件原有 initializationOptions 键不受影响。
        let merged =
            merge_extended_client_capabilities_into_init_options(json!({ "existing": 1 }), &plugin);
        assert_eq!(merged["existing"], json!(1));
        assert_eq!(
            merged["extendedClientCapabilities"]["classFileContentsSupport"],
            json!(true)
        );
    }

    #[test]
    fn merge_extended_capabilities_into_init_options_passthrough_without_field() {
        let plugin = LspPlugin::builtin("rust", &["rs"], "rust-analyzer", &["rust-analyzer"], None);
        let before = json!({ "existing": 1 });
        let after = merge_extended_client_capabilities_into_init_options(before.clone(), &plugin);
        assert_eq!(after, before, "无扩展字段时初始化选项必须与之前字节一致");
        assert!(after.get("extendedClientCapabilities").is_none());
        // 非对象输入无扩展字段时同样原样返回。
        let before = json!("garbage");
        let after = merge_extended_client_capabilities_into_init_options(before.clone(), &plugin);
        assert_eq!(after, before);
    }

    #[test]
    fn init_options_absent_for_plugin_without_options() {
        let plugin = LspPlugin::builtin("rust", &["rs"], "rust-analyzer", &["rust-analyzer"], None);
        assert!(
            init_options_for(&plugin).is_none(),
            "无选项/无扩展能力的插件不得注入 initializationOptions"
        );
    }

    #[test]
    fn init_options_present_when_plugin_declares_any() {
        let with_opts = LspPlugin::builtin("go", &["go"], "gopls", &["gopls"], None)
            .with_initialization_options(json!({ "a": 1 }));
        assert_eq!(init_options_for(&with_opts), Some(json!({ "a": 1 })));

        let with_caps = LspPlugin::builtin("java", &["java"], "jdtls", &["jdtls"], None)
            .with_extended_client_capabilities(json!({ "classFileContentsSupport": true }));
        let opts = init_options_for(&with_caps).expect("extended caps → Some payload");
        assert_eq!(
            opts["extendedClientCapabilities"]["classFileContentsSupport"],
            json!(true)
        );
    }

    #[test]
    fn merge_extended_capabilities_into_init_options_replaces_non_object() {
        let plugin = LspPlugin::builtin("java", &["java"], "jdtls", &["jdtls"], None)
            .with_extended_client_capabilities(serde_json::json!({
                "classFileContentsSupport": true
            }));
        // 非对象基底无法合并且无保留价值：一律返回仅含扩展字段的新对象。
        let merged =
            merge_extended_client_capabilities_into_init_options(json!("garbage"), &plugin);
        assert_eq!(
            merged,
            json!({ "extendedClientCapabilities": { "classFileContentsSupport": true } })
        );
    }

    /// No-op transport for tests that do not touch IPC.
    struct NoopTransport;

    impl LspTransport for NoopTransport {
        fn push_diagnostics(&self, _: &str, _: &str, _: serde_json::Value) {}
    }

    /// Regression: `snapshot_server_info` must sample live RSS, not return the
    /// static spawn-time metadata (`memory_mb` was always 0.0 before the fix).
    #[test]
    fn snapshot_server_info_refreshes_live_memory() {
        let session = LspSession {
            // Our own test process is alive, so RSS sampling must succeed.
            process_pid: Some(std::process::id()),
            ..stub_session(Arc::new(NoopTransport), PROJECT, LANG, SERVER)
        };

        let info = session.snapshot_server_info();
        // Windows stub returns None by design (v1 skips memory sampling there).
        #[cfg(not(target_os = "windows"))]
        assert!(
            info.memory_mb > 0.0,
            "expected live RSS sample, got {}",
            info.memory_mb
        );
    }

    // ── plugin 专属 client capabilities 合并（P1：rust-analyzer runnables）──

    /// 未声明扩展的插件（gopls / jdtls / 自定义）→ capabilities **逐字节不变**。
    #[test]
    fn merge_client_capabilities_is_identity_without_plugin_extension() {
        let plugin = LspPlugin::builtin("go", &["go"], "gopls", &["gopls"], None);
        let base = build_client_capabilities();
        assert_eq!(merge_client_capabilities(base.clone(), &plugin), base);
    }

    /// 声明了扩展的插件 → 顶层 key 合并进基础集，其余键保持不变。
    #[test]
    fn merge_client_capabilities_adds_plugin_top_level_keys() {
        let plugin = LspPlugin::builtin("rust", &["rs"], "rust-analyzer", &["rust-analyzer"], None)
            .with_client_capabilities(json!({
                "experimental": { "runnables": { "kinds": ["cargo", "shell"] } }
            }));
        let merged = merge_client_capabilities(build_client_capabilities(), &plugin);
        assert_eq!(
            merged["experimental"]["runnables"]["kinds"],
            json!(["cargo", "shell"])
        );
        // 基础集未被破坏
        assert_eq!(merged["window"]["workDoneProgress"], json!(true));
        assert!(merged["textDocument"]["hover"].is_object());
    }

    /// 非对象形态（异常插件配置）→ 退回基础集，不猜语义。
    #[test]
    fn merge_client_capabilities_falls_back_on_non_object_extension() {
        let plugin = LspPlugin::builtin("rust", &["rs"], "rust-analyzer", &["rust-analyzer"], None)
            .with_client_capabilities(json!("not-an-object"));
        let base = build_client_capabilities();
        assert_eq!(merge_client_capabilities(base.clone(), &plugin), base);
    }

    // ── M2 会话健康度：生命周期相位 → 事件（design.md §M2）──

    /// 桩会话身份（夹具参数集中在此，测试体只关心行为）。
    const PROJECT: &str = "/test/project";
    const LANG: &str = "rust";
    const SERVER: &str = "rust-analyzer";

    /// 本项目桩会话（无真实进程、无 reader）。
    fn session(transport: Arc<dyn LspTransport>) -> LspSession {
        stub_session(transport, PROJECT, LANG, SERVER)
    }

    /// 相位与事件同源：`publish_status` 必须同时推进 lifecycle 与发出事件
    /// （只做其一是"状态栏与快照不一致"的成因）。
    #[test]
    fn publish_status_advances_phase_and_emits_event() {
        let transport = Arc::new(RecordingTransport::default());
        let lifecycle = Lifecycle::new();

        publish_status(
            &lifecycle,
            transport.as_ref(),
            PROJECT,
            LANG,
            LspSessionStatus::Ready,
            None,
            None,
        );
        publish_status(
            &lifecycle,
            transport.as_ref(),
            PROJECT,
            LANG,
            LspSessionStatus::Ready,
            Some("running"),
            Some(40),
        );

        assert_eq!(lifecycle.status(SERVER), LspSessionStatus::Ready);
        let events = transport.take();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].0, PROJECT);
        assert_eq!(events[0].1, LANG);
        assert_eq!(events[0].2, "ready");
        assert_eq!(events[1].3.as_deref(), Some("running"));
        assert_eq!(events[1].4, Some(40));
    }

    /// Error 相位：事件携带调用方文案，相位归一为崩溃（文案由 crash_message 单点重建）。
    #[test]
    fn publish_status_error_emits_message_and_normalizes_phase() {
        let transport = Arc::new(RecordingTransport::default());
        let lifecycle = Lifecycle::new();

        publish_status(
            &lifecycle,
            transport.as_ref(),
            PROJECT,
            LANG,
            LspSessionStatus::Error("boom".into()),
            Some("boom"),
            None,
        );

        let events = transport.take();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].2, "error");
        assert_eq!(events[0].3.as_deref(), Some("boom"));
        assert_eq!(
            lifecycle.status(SERVER),
            LspSessionStatus::Error(crash_message(SERVER))
        );
    }

    /// 主动关闭：置终态 + 发 `stopped`，且只发一次（幂等由状态机给出）。
    #[test]
    fn close_emits_stopped_once() {
        let transport = Arc::new(RecordingTransport::default());
        let session = session(Arc::clone(&transport) as Arc<dyn LspTransport>);

        assert!(session.close(), "首次关闭必须返回 true");
        assert!(!session.close(), "重复关闭不得再发 stopped");

        let events = transport.take();
        assert_eq!(events.len(), 1, "stopped 只能发一次: {events:?}");
        assert_eq!(events[0].2, "stopped");
        assert_eq!(session.snapshot().status, "stopped");
    }

    /// 创建失败路径（无 session 对象）：`emit_session_error` 直发 error 事件。
    #[test]
    fn emit_session_error_free_fn_pushes_error_event() {
        let transport = Arc::new(RecordingTransport::default());
        emit_session_error(transport.as_ref(), PROJECT, "go", "Failed to spawn gopls");
        let events = transport.take();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1, "go");
        assert_eq!(events[0].2, "error");
        assert_eq!(events[0].3.as_deref(), Some("Failed to spawn gopls"));
        assert_eq!(events[0].4, None);
    }

    /// 崩溃路径（AC2：kill gopls）：运行中 reader 退出 → error + 服务器名。
    #[test]
    fn on_reader_exit_emits_error_while_running() {
        let transport = Arc::new(RecordingTransport::default());
        let lifecycle = Lifecycle::new();
        lifecycle.set(&LspSessionStatus::Ready);

        assert!(on_reader_exit(
            &lifecycle,
            transport.as_ref(),
            PROJECT,
            "go",
            "gopls"
        ));

        let events = transport.take();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].2, "error");
        assert_eq!(events[0].3.as_deref(), Some("gopls exited unexpectedly"));
    }

    /// 优雅关闭（close 已先落终态）：reader 退出静默，且不覆盖 stopped。
    #[test]
    fn on_reader_exit_silent_after_close() {
        let transport = Arc::new(RecordingTransport::default());
        let lifecycle = Lifecycle::new();
        lifecycle.set(&LspSessionStatus::Ready);
        lifecycle.close();

        assert!(!on_reader_exit(
            &lifecycle,
            transport.as_ref(),
            PROJECT,
            "go",
            "gopls"
        ));
        assert!(transport.take().is_empty(), "关闭后不得再发任何事件");
        assert_eq!(lifecycle.status("gopls"), LspSessionStatus::Stopped);
    }

    /// 幂等：同一生命周期内重复判定崩溃只发一次 error（否则前端重复弹重试提示）。
    #[test]
    fn on_reader_exit_is_idempotent() {
        let transport = Arc::new(RecordingTransport::default());
        let lifecycle = Lifecycle::new();
        lifecycle.set(&LspSessionStatus::Ready);

        assert!(on_reader_exit(
            &lifecycle,
            transport.as_ref(),
            PROJECT,
            "go",
            "gopls"
        ));
        assert!(
            !on_reader_exit(&lifecycle, transport.as_ref(), PROJECT, "go", "gopls"),
            "重复退出不得再判定为崩溃"
        );
        assert_eq!(transport.take().len(), 1);
    }

    /// 崩溃后的快照必须报 error —— 前端 LspSubscriptionBridge 的项目切换初始同步
    /// 依赖它，否则会把事件驱动的 error 状态冲回 ready（design.md M2）。
    #[test]
    fn snapshot_reports_error_after_reader_exit() {
        let transport = Arc::new(RecordingTransport::default());
        let session = session(Arc::clone(&transport) as Arc<dyn LspTransport>);
        // reader 线程退出时会写下崩溃相位（此处直接落相位，等价于那一刻）。
        session.lifecycle.on_reader_exit();

        let info = session.snapshot();
        assert_eq!(info.status, "error");
        assert_eq!(
            info.status_message.as_deref(),
            Some("rust-analyzer exited unexpectedly")
        );
    }

    /// 优雅关闭后的快照必须是 stopped，**不得**因 reader 结束而报错 ——
    /// 两种"线程已结束"在旧实现（轮询 is_finished）下同义，lifecycle 让它们可分。
    #[test]
    fn snapshot_reports_stopped_after_graceful_close() {
        let transport = Arc::new(RecordingTransport::default());
        let session = session(Arc::clone(&transport) as Arc<dyn LspTransport>);
        session.close();

        let info = session.snapshot();
        assert_eq!(info.status, "stopped");
        assert_eq!(info.status_message, None, "关闭不是错误，不得携带 message");
    }

    /// 刚装配完成的会话：快照为 ready，无 message。
    #[test]
    fn snapshot_reports_ready_for_fresh_session() {
        let transport = Arc::new(RecordingTransport::default());
        let session = session(Arc::clone(&transport) as Arc<dyn LspTransport>);

        let info = session.snapshot();
        assert_eq!(info.status, "ready");
        assert_eq!(info.status_message, None);
    }

    /// panic 载荷 → 可读文案（无全局 panic hook，载荷必须能被日志记录）。
    #[test]
    fn panic_payload_message_supports_str_and_string_payloads() {
        let s: Box<dyn std::any::Any + Send> = Box::new("static str payload");
        assert_eq!(panic_payload_message(&*s), "static str payload");
        let owned: Box<dyn std::any::Any + Send> = Box::new("owned payload".to_string());
        assert_eq!(panic_payload_message(&*owned), "owned payload");
        let opaque: Box<dyn std::any::Any + Send> = Box::new(42u32);
        assert_eq!(panic_payload_message(&*opaque), "unknown panic payload");
    }
}
