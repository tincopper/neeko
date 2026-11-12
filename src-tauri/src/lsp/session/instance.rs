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

use crate::lsp::attempt_diagnostics::{AttemptDiagnostics, TAIL_INLINE_MAX_BYTES};
use crate::lsp::diag_bus::DiagnosticBus;
use crate::lsp::inflight::InflightRequestTracker;
use crate::lsp::plugin::LspPlugin;
use crate::lsp::process::{classify_probe_run, probe_command, ProbeVerdict};
use crate::lsp::spawn_spec::LspExecContext;
use crate::lsp::transport::LspTransport;
use crate::lsp::types::{parse_server_version_output, LspServerInfo};

use super::lifecycle::{crash_message, Lifecycle};
use super::notify::{
    handle_diagnostics_notification, handle_progress_notification,
    handle_server_status_notification, SERVER_STATUS_METHOD,
};
use super::request::PendingSender;
use super::status::LspSessionStatus;
use super::utils::sample_process_memory_mb;

/// `<server> --version` 探测超时。重量级服务器（jdtls 的完整 OSGi JVM）由插件
/// 数据 `tuning.version_probe=false` 直接跳过探测，不走这里。
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// `initialize` 握手的通用上限：插件未声明 `request_timeout_ms` 时用它。
///
/// 60s 覆盖「进程启动 + 项目首次索引」的常规区间；重量级服务器（java / rust）由插件
/// 数据声明更大的值。**不允许无界**：服务器活而不答会永久占住 `spawn_blocking` 线程
/// 与 per-key 创建门，使该 key 的全部 LSP 命令悬挂。
const INIT_TIMEOUT_DEFAULT: std::time::Duration = std::time::Duration::from_secs(60);

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
    /// 发出 `exit` 后等进程自行退出的宽限（来自插件 `tuning.shutdown_grace_ms`）。
    ///
    /// 落到会话上而不是关闭时回查插件表：关闭路径只读会话（插件表可能已被卸载），
    /// 且宽限只能有**一个**事实来源（红线 15：语言差异落数据）。
    pub(crate) shutdown_grace: std::time::Duration,
    /// Cached server capabilities from the initialize handshake.
    pub(crate) server_capabilities: Value,
    /// Child process handle for lifecycle management (kill on close).
    pub(crate) child: Option<crate::lsp::process::LspProcess>,
    /// OS / remote process id for memory sampling (when available).
    pub(crate) process_pid: Option<u32>,
    /// Version metadata parsed from `--version` at spawn (memory filled on demand).
    pub(crate) server_info: LspServerInfo,
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

/// 会话装配的横切依赖（进程 / 事件 / 证据）：与「会话身份」参数分开传，
/// 避免 `new` 参数表膨胀（clippy too_many_arguments），也让装配端口只组装一次。
pub(crate) struct SessionPlumbing {
    pub(crate) app_handle: tauri::AppHandle,
    pub(crate) diag_bus: Arc<DiagnosticBus>,
    pub(crate) transport: Arc<dyn LspTransport>,
    /// 本次尝试的键控诊断句柄（写只走句柄；证据宿主是身份键，不随会话存活变化）。
    pub(crate) diagnostics: Arc<AttemptDiagnostics>,
}

impl LspSession {
    /// Create a new LSP session: spawn server process, perform initialize handshake.
    pub(crate) fn new(
        plugin: &LspPlugin,
        project_path: &str,
        workspace_root: &Path,
        exec_target: crate::common::executor::factory::ExecTarget,
        plumbing: SessionPlumbing,
    ) -> Result<Self> {
        let SessionPlumbing {
            app_handle,
            diag_bus,
            transport,
            diagnostics,
        } = plumbing;
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

        // 执行上下文（P2a）：探测 / 启动 / 安装共用同一个「在哪执行」。env 由插件
        // tuning 派生（不按语言名分支），必须在探测之前就绪。
        let ctx = LspExecContext::for_session(plugin, workspace_root, exec_target);

        if !crate::lsp::installer::check_plugin_installed(plugin, &ctx.target) {
            log::info!(
                "[LSP] {} not found in project env, attempting auto-install for: {}",
                server_name,
                language_id
            );
            match crate::lsp::installer::install_plugin_server(plugin, &app_handle, &ctx) {
                Ok(true) => {
                    log::info!("[LSP] Auto-install succeeded for {}", language_id);
                    if !crate::lsp::installer::check_plugin_installed(plugin, &ctx.target) {
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
            std::mem::discriminant(&ctx.target)
        );

        let args: Vec<&str> = cmd[1..].iter().map(|s| s.as_str()).collect();

        // 探测策略由插件自带 tuning 声明（见 plugin/builtins/java.rs 的 jdtls
        // 调优）：跳过探测的服务器版本降级为 unknown。session 层不按语言名分支。
        //
        // 形态判据按 design §2.2（方案 A「分形」）：
        // - 执行不了（Err）→ 真实启动必以同一错误失败，直接失败（不白跑一次 spawn）；
        // - 可执行但拒绝应答（非零 + stderr）→ 证据入诊断与失败消息，**继续启动**
        //   （由 spawn + 握手兜底）——「不支持 --version」的服务器不得被误杀；
        // - 弱信号（非零无 stderr / 超时）→ 仅记录。
        let mut server_info = if !plugin.tuning.version_probe {
            LspServerInfo::unknown()
        } else {
            let run = probe_command(&ctx, &cmd[0], &["--version"], PROBE_TIMEOUT);
            match classify_probe_run(&run) {
                ProbeVerdict::Answered => {
                    let stdout = run.as_ref().map(|r| r.stdout.as_str()).unwrap_or("");
                    let stderr = run.as_ref().map(|r| r.stderr.as_str()).unwrap_or("");
                    parse_server_version_output(if stdout.trim().is_empty() {
                        stderr
                    } else {
                        stdout
                    })
                }
                ProbeVerdict::Refused { evidence } => {
                    diagnostics.push_line(
                        "warn",
                        &format!("{server_name} --version refused to answer: {evidence}"),
                    );
                    LspServerInfo::unknown()
                }
                ProbeVerdict::Weak { note } => {
                    diagnostics.push_line("info", &format!("{server_name} --version: {note}"));
                    LspServerInfo::unknown()
                }
                ProbeVerdict::NotRunnable { reason } => {
                    // 「修法」提示由插件 install 数据派生（数据驱动，红线 15）。
                    // 终态单写者：此处只上抛，落账（log + outcome）归 manager。
                    return Err(anyhow::anyhow!(
                        "Failed to run {} in the session environment: {}{}",
                        server_name,
                        reason,
                        crate::lsp::installer::install_hint(plugin).unwrap_or_default()
                    ));
                }
            }
        };

        // Tooling JDK 对齐（VSCode `java.jdt.ls.java.home` 语义）：env 已在上面的
        // `LspExecContext` 中派生（`java_home_from_path` 插件数据），不按语言名判断。
        let mut process = crate::lsp::process::spawn_lsp_process(&ctx, &cmd[0], &args)
            .map_err(|e| anyhow::anyhow!("Failed to spawn LSP server {}: {}", server_name, e))?;

        let process_pid = process.pid;
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
        let diag_pump = Arc::clone(&diagnostics);
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
                        // 证据写入身份键句柄（不随失败蒸发；生代隔离由句柄保证）。
                        diag_pump.push_line(level, &trimmed);
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
        let diag_reader = Arc::clone(&diagnostics);

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
                                    } else if notif.method == SERVER_STATUS_METHOD {
                                        // rust-analyzer 就绪语义（能力门控；消费点见
                                        // `notify::handle_server_status_notification`，红线 14）。
                                        handle_server_status_notification(
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
                                    let ctx = crate::lsp::server_request::ServerRequestCtx {
                                        workspace_folder_uri: root.as_deref(),
                                        project_path: &pp_reader,
                                        language_id: &lang_id_clone,
                                        transport: &*transport_clone,
                                    };
                                    let resp = crate::lsp::server_request::respond_to_server_request(
                                        req,
                                        &ctx,
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
                    // reader 已死 ⇒ 任何在途等待（含 initialize 握手）不可能再拿到响应：
                    // 先摘掉全部发送端，让等待方按「无响应」快速失败，而不是把 sender
                    // 留在 pending 里永久挂死（mode ⑤/⑥ 的可解释性依赖这条）。
                    drain_pending(&pending_clone);
                    on_reader_exit(
                        &lifecycle_reader,
                        &*transport_clone,
                        &pp_reader,
                        &lang_id_clone,
                        &server_name_reader,
                        &diag_reader,
                    );
                    read_result
                }));
                match result {
                    Ok(read_result) => read_result,
                    Err(payload) => {
                        // 循环体内 panic：仍按崩溃发事件（状态栏可给出重试入口），
                        // 并把 panic 载荷写进日志 —— 应用无全局 panic hook，载荷若丢
                        // 弃则只进 stderr，打包后的 GUI 里无处可查。
                        let detail = panic_payload_message(&*payload);
                        log::error!(
                            "[LSP] reader thread panicked for {pp_reader}:{lang_id_clone}: {detail}"
                        );
                        // panic 早退同样摘发送端（锁若已中毒则退化为不做）。
                        drain_pending(&pending_clone);
                        on_reader_exit(
                            &exit_lifecycle,
                            &*exit_transport,
                            &exit_pp,
                            &exit_lang,
                            &exit_name,
                            &diag_reader,
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

        // 握手预算取插件数据（冷启动慢的服务器自行声明），未声明回落到通用默认。
        // 服务器活而不答（jdtls 撞 `-data` 锁）时，无 deadline 会永久占住阻塞线程与
        // per-key 创建门（审计 channel D1）。
        let init_timeout = plugin
            .request_timeout_ms
            .map_or(INIT_TIMEOUT_DEFAULT, |ms| {
                std::time::Duration::from_millis(u64::from(ms))
            });

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

        let init_response = match await_init_response(
            init_req_id.clone(),
            init_rx,
            &pending,
            &reader_handle,
            init_timeout,
        ) {
            Ok(response) => response,
            Err(e) => {
                // 子进程已退出（reader 线程结束 → init 发送端断开）。先把 stderr 泵
                // 收敛（kill → join 收在 EOF 上），再读证据尾部 —— 内联证据的确定性
                // 依赖此顺序（见 design「终态文案与内联证据」），否则会与泵赛跑而拿到
                // 空尾巴，恰是本任务要修的时刻。
                process.kill();
                if let Some(handle) = stderr_handle {
                    let _ = handle.join();
                }
                let tail = diagnostics.tail_inline(TAIL_INLINE_MAX_BYTES);
                let message = inline_failure(&e.to_string(), tail.as_deref());
                // 终态单写者：文案随 `Err` 上抛，由 manager 经**本次尝试的句柄**
                // `record_failure` 一次落账（同时进 log）。此处再推一遍会让同一条
                // 消息在 View logs 里出现两次（见 design「单写者与 begin 落点」）。
                return Err(anyhow::anyhow!(message));
            }
        };
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
            shutdown_grace: std::time::Duration::from_millis(u64::from(
                plugin.tuning.shutdown_grace_ms,
            )),
            server_capabilities,
            child: Some(process),
            process_pid,
            server_info,
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

    /// Send a graceful shutdown request and wait for the response — **bounded**.
    ///
    /// `shutdown` 是 LSP **request**：服务器响应后客户端才允许发 `exit` 通知。
    /// 等待必须有界 —— `spawn_blocking` 线程不是无界资源，服务器沉默时不许永久阻塞。
    ///
    /// 超时机制复用 pending 表（与 [`drain_pending`] 同一不变量）：看门狗到期摘掉该
    /// id 的发送端 → `blocking_recv` 立即以「无响应」失败。响应先到时，看门狗在下一轮
    /// 轮询发现条目已不在便自行退出（最多多活一个轮询间隔）。
    pub(crate) fn send_shutdown_request_bounded(
        &self,
        timeout: std::time::Duration,
    ) -> Result<Message> {
        let (tx, rx) = tokio::sync::oneshot::channel::<Message>();
        let req_id = RequestId::from(1000i32);
        {
            let mut map = self
                .pending
                .lock()
                .map_err(|e| anyhow::anyhow!("LSP pending lock poisoned: {e}"))?;
            map.insert(req_id.clone(), tx);
        }

        let req = Request::new(
            req_id.clone(),
            "shutdown".to_string(),
            serde_json::json!({}),
        );
        if let Err(e) = self.writer.send(Message::Request(req)) {
            // 发不出去就别把发送端留在表里（否则 pending 泄漏）
            if let Ok(mut map) = self.pending.lock() {
                map.remove(&req_id);
            }
            return Err(anyhow::anyhow!("Failed to send shutdown request: {e}"));
        }

        if let Err(e) = spawn_pending_watchdog(
            &self.pending,
            req_id.clone(),
            timeout,
            "lsp-shutdown-watchdog",
        ) {
            // 没看门狗就只能无界等 —— 宁可失败也不退回到无界等待
            if let Ok(mut map) = self.pending.lock() {
                map.remove(&req_id);
            }
            return Err(anyhow::anyhow!("Failed to spawn shutdown watchdog: {e}"));
        }

        let response = rx
            .blocking_recv()
            .context("LSP shutdown: no response received");
        if let Ok(mut map) = self.pending.lock() {
            map.remove(&req_id);
        }
        response
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
///
/// capture-at-transition：文案在本函数**一次合成**（`crash_message` + 证据尾部），
/// 存入 lifecycle 并写进该次尝试的键控诊断 —— 事件与快照投影同一份字符串。
pub(crate) fn on_reader_exit(
    lifecycle: &Lifecycle,
    transport: &dyn LspTransport,
    project_path: &str,
    language_id: &str,
    server_name: &str,
    diagnostics: &AttemptDiagnostics,
) -> bool {
    let tail = diagnostics.tail_inline(TAIL_INLINE_MAX_BYTES);
    let message = crash_message(server_name, tail.as_deref());
    if !lifecycle.on_reader_exit(&message) {
        return false;
    }
    diagnostics.record_failure(&message);
    emit_session_error(transport, project_path, language_id, &message);
    true
}

/// 失败文案内联证据尾部（P1a）：`{base} | server stderr: {tail}` —— 与
/// `dap/session.rs` 的 `"{base} | adapter stderr: {detail}"` 同构。
fn inline_failure(base: &str, tail: Option<&str>) -> String {
    match tail.map(str::trim).filter(|tail| !tail.is_empty()) {
        Some(tail) => format!("{base} | server stderr: {tail}"),
        None => base.to_string(),
    }
}

/// 摘掉全部在途等待的发送端（reader 已退出 ⇒ 响应不可能再到达，等待方应快速失败
/// 而不是挂死）。
fn drain_pending(pending: &Mutex<HashMap<RequestId, PendingSender>>) {
    if let Ok(mut map) = pending.lock() {
        map.clear();
    }
}

/// 等待 `initialize` 响应，且**不得挂死**（两条独立的解锁条件）：
/// 1. reader 线程退出 ⇒ 响应不可能再到达 → 摘掉 pending 发送端快速失败
///    （mode ⑤/⑥：子进程启动后立即退出，失败必须产生才能「自我解释」）；
/// 2. `timeout` 到期 ⇒ 看门狗摘掉 pending 发送端 → 同样以「无响应」失败
///    （服务器**活着但不答**：jdtls 撞 `-data` 锁 / OSGi 卡死）。
///
/// 两条路径都走既有 `drain` 语义，不引入新原语；失败文案不变，装配失败路径照原样
/// 合成内联证据（kill 进程 + 单次终态文案）。
fn await_init_response(
    req_id: RequestId,
    init_rx: tokio::sync::oneshot::Receiver<Message>,
    pending: &Arc<Mutex<HashMap<RequestId, PendingSender>>>,
    reader: &thread::JoinHandle<Result<()>>,
    timeout: std::time::Duration,
) -> Result<Message> {
    if reader.is_finished() {
        // 关窗：reader 在「插入 sender」与「本检查」之间退出时，它在出口的 drain
        // 可能已经跑过（见 reader 闭包），这里补一次。
        drain_pending(pending);
    }
    // 与 shutdown 等响应同一不变量：到期摘掉该 id 的发送端 → `blocking_recv` 立刻
    // 以「无响应」失败。没有它，服务器「活着但不答」会把阻塞线程与 per-key 创建门
    // 一起永久占住（审计 channel D1）。
    if let Err(e) = spawn_pending_watchdog(pending, req_id.clone(), timeout, "lsp-init-watchdog") {
        // 没看门狗就只能无界等 —— 宁可快速失败，也不退回到无界等待。
        if let Ok(mut map) = pending.lock() {
            map.remove(&req_id);
        }
        return Err(anyhow::anyhow!("Failed to spawn init watchdog: {e}"));
    }
    let response = init_rx
        .blocking_recv()
        .context("LSP initialization: no response received");
    if let Ok(mut map) = pending.lock() {
        map.remove(&req_id);
    }
    response
}

/// 有界等待的看门狗：到期把 `req_id` 从 `pending` 摘除 ⇒ 对应的 `blocking_recv`
/// 立即以「无响应」失败。
///
/// 与 [`drain_pending`] 是同一不变量（摘除发送端 = 宣告响应不可能再到达），只是触发
/// 条件从「reader 退出」换成「超时」。响应先到时，看门狗在下一轮轮询发现条目已不在
/// 便自行退出（最多多活一个轮询间隔）。
///
/// 存在的理由：`spawn_blocking` 线程与 per-key 门都不是无界资源，服务器沉默时不许
/// 永久阻塞（红线 3 的形态）。返回 `Err` 表示线程没起来 —— 调用方必须放弃等待。
fn spawn_pending_watchdog(
    pending: &Arc<Mutex<HashMap<RequestId, PendingSender>>>,
    req_id: RequestId,
    timeout: std::time::Duration,
    thread_name: &str,
) -> std::io::Result<()> {
    /// 轮询间隔：只用于「响应已到 / 未到」的快速退出，不决定宽限时长。
    const WATCHDOG_POLL: std::time::Duration = std::time::Duration::from_millis(5);

    let pending = Arc::clone(pending);
    thread::Builder::new()
        .name(thread_name.to_string())
        .spawn(move || {
            let deadline = std::time::Instant::now() + timeout;
            loop {
                match pending.lock() {
                    // 已被响应路径 / reader 的 drain 摘除 → 无需再等
                    Ok(map) if !map.contains_key(&req_id) => return,
                    Ok(_) => {}
                    Err(_) => return,
                }
                let remaining = deadline.saturating_duration_since(std::time::Instant::now());
                if remaining.is_zero() {
                    if let Ok(mut map) = pending.lock() {
                        map.remove(&req_id);
                    }
                    return;
                }
                thread::sleep(remaining.min(WATCHDOG_POLL));
            }
        })
        .map(|_handle| ())
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
///
/// `completionItem.resolveSupport.properties: ["additionalTextEdits"]` declares
/// we can fetch auto-import edits later via `completionItem/resolve` — every
/// mainstream LSP client declares this for every server. Servers react
/// differently and all three reactions are handled by one generic consumer
/// (`src/features/lsp/hooks/lspCompletionResolve.ts`), hence it is declared
/// globally rather than per plugin (measured 2026-09-19, same probe/scenario):
///   - rust-analyzer 1.97.1: without it, **every** flyimport candidate is
///     dropped (no `HashMap` in the list at all); with it, candidates appear
///     and the `use …;` edit moves to `completionItem/resolve`
///   - jdtls 1.61.0: without it, import edits arrive inline (33/33); with it,
///     they move to resolve too (returns `import java.awt.List;`)
///   - gopls v0.23.0: always inline, unaffected by the declaration
///
/// `documentation`/`detail` are deliberately NOT listed — including them makes
/// servers defer docs as well, rendering the info panel empty until resolve.
pub(crate) fn build_client_capabilities() -> Value {
    serde_json::json!({
        "textDocument": {
            "hover": { "contentFormat": ["markdown", "plaintext"] },
            "definition": { "linkSupport": true },
            "references": {},
            "completion": { "completionItem": { "snippetSupport": true, "documentation": true, "documentationFormat": ["markdown", "plaintext"], "resolveSupport": { "properties": ["additionalTextEdits"] } } },
            "codeAction": {
                // `codeActionLiteralSupport`：声明我们消费结构化 CodeAction（带 `edit` 的
                // quickfix，经 `groupQuickFixActions` 铺进菜单）。**不声明** `resolveSupport`：
                // 本栈没有 `codeAction/resolve` 通道，声明会让 jdtls 把 edit 全部推迟到
                // resolve（同 `resolveAdditionalTextEditsSupport` 事故，2026-09-18）。
                "codeActionLiteralSupport": { "codeActionKind": { "valueSet": ["quickfix", "source"] } }
            },
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
    use crate::lsp::session::testing::{
        stub_session, stub_session_with_writer, RecordingTransport,
    };
    use lsp_server::{RequestId, Response, ResponseError};
    use serde_json::json;
    use std::time::Duration;

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

    /// 红线 14：我们向**所有**服务器声明了「能通过 `completionItem/resolve` 取回
    /// `additionalTextEdits`」，就必须真的发得出去 —— 消费者是前端的通用 resolver
    ///（`src/features/lsp/hooks/lspCompletionResolve.ts`），不区分语言。
    ///
    /// 为什么是全局而非按插件声明（实测 2026-09-19，同一探针、同一未导入符号场景）：
    ///   - rust-analyzer 1.97.1：不声明 → **丢弃全部** flyimport 候选（108 项无 HashMap）；
    ///     声明 → 候选出现且编辑走 resolve（返回 `use std::collections::HashMap;`）
    ///   - jdtls 1.61.0：不声明 → 33 项全部内联；声明 → 改走 resolve
    ///     （resolve 返回 `import java.awt.List;`）
    ///   - gopls v0.23.0：恒内联，对此声明无感
    ///
    /// 三种策略由**同一套**通用 resolver 兜住，故能力声明不带语言差异。
    #[test]
    fn client_capabilities_advertise_additional_text_edits_resolve() {
        let caps = build_client_capabilities();
        let props = caps["textDocument"]["completion"]["completionItem"]["resolveSupport"]
            ["properties"]
            .as_array()
            .expect("resolveSupport.properties must be declared");
        assert_eq!(
            props,
            &vec![json!("additionalTextEdits")],
            "without this declaration servers may drop every auto-import candidate \
             (rust-analyzer 1.97.1 measured)"
        );
        // 刻意**不**声明 documentation / detail：多声明会让服务器把文档一并推迟，
        // 补全信息面板在 resolve 返回前渲染为空。
        assert!(
            !props.iter().any(|p| p == "documentation" || p == "detail"),
            "do not defer documentation/detail — the info panel would render empty until \
             completionItem/resolve returns"
        );
    }

    /// 红线 14（声明 = 行为契约）：必须声明 `codeActionLiteralSupport` 否则 jdtls
    /// 丢弃全部 quickfix（`isSupportedCodeActionKind` 对未声明 valueSet 恒 false，
    /// 实测 2026-09-22：Java 未导入包无任何修复项，而 gopls 不检查故 Go 正常）。
    ///
    /// 同时**不得**声明 `resolveSupport`：本栈没有 `codeAction/resolve` 通道，声明会让
    /// jdtls 把 edit 全部推迟到 resolve（同 `resolveAdditionalTextEditsSupport` 事故，
    /// 2026-09-18 —— 能力声明必须与消费实现一一对应）。
    #[test]
    fn client_capabilities_advertise_code_action_literal_support_without_resolve() {
        let caps = build_client_capabilities();
        let value_set = caps["textDocument"]["codeAction"]["codeActionLiteralSupport"]
            ["codeActionKind"]["valueSet"]
            .as_array()
            .expect(
                "codeActionKind.valueSet must be declared (jdtls drops all quickfix without it)",
            );
        assert!(
            value_set.iter().any(|v| v == "quickfix"),
            "quickfix kind must be in valueSet — jdtls filters every code action through it"
        );
        // 不声明 resolveSupport：无 `codeAction/resolve` 消费实现。
        assert!(
            caps["textDocument"]["codeAction"].get("resolveSupport").is_none(),
            "do not declare codeAction.resolveSupport — no codeAction/resolve channel exists; \
             jdtls would defer every edit to resolve (same trap as resolveAdditionalTextEditsSupport)"
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
        fn push_diagnostics(&self, _: &str, _: &str, _: serde_json::Value, _: Option<i64>) {}
    }

    /// 以本测试进程为 pid 的会话：进程活着 ⇒ 内存采样（非 Windows）必然成功。
    ///
    /// 两个平台整测试共用这一处构造（平台差异只在断言侧；门控挂在 item 级，
    /// 见红线 10 的门控粒度要求）。
    fn live_process_session() -> LspSession {
        LspSession {
            process_pid: Some(std::process::id()),
            ..stub_session(Arc::new(NoopTransport), PROJECT, LANG, SERVER)
        }
    }

    /// Regression: `snapshot_server_info` must sample live RSS, not return the
    /// static spawn-time metadata (`memory_mb` was always 0.0 before the fix).
    /// 本测试进程活着 ⇒ 采样必须成功。
    #[cfg(not(target_os = "windows"))]
    #[test]
    fn snapshot_server_info_refreshes_live_memory() {
        let info = live_process_session().snapshot_server_info();
        assert!(
            info.memory_mb > 0.0,
            "expected live RSS sample, got {}",
            info.memory_mb
        );
    }

    /// Windows：内存采样按设计跳过（`platform/process_memory/windows.rs` 返回 `None`）
    /// → `memory_mb` 必须恒为 0.0。这条断言把该契约钉在 Windows 侧。
    #[cfg(target_os = "windows")]
    #[test]
    fn snapshot_server_info_memory_is_zero_on_windows() {
        let info = live_process_session().snapshot_server_info();
        assert_eq!(info.memory_mb, 0.0);
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

    /// 诊断句柄（经 store 铸造 —— `begin` 是唯一创建点；用例只验证写者落账）。
    fn diag() -> Arc<AttemptDiagnostics> {
        crate::lsp::attempt_diagnostics::AttemptDiagnosticsStore::new().begin("test:stub", PROJECT)
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

    /// Error 相位：事件携带写者文案，快照逐字投影同一份（capture-at-transition ——
    /// 唯一构造点仍是 `crash_message`，`Lifecycle` 只落账不重建）。
    #[test]
    fn publish_status_error_emits_message_and_projects_it() {
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
            LspSessionStatus::Error("boom".into()),
            "快照必须与事件投影同一份写者文案"
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

    /// mode ⑤/⑥ 回归：reader 已退出时握手必须**快速失败**为「无响应」，不得挂死。
    /// （此前 sender 留在 `pending` 里，`blocking_recv` 永久阻塞 —— 失败永不产生，
    /// 事故现场更不可能自我解释。）
    #[test]
    fn await_init_response_fails_fast_when_reader_dead() {
        let (tx, rx) = tokio::sync::oneshot::channel::<Message>();
        let pending: Arc<Mutex<HashMap<RequestId, PendingSender>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let req_id = RequestId::from(1i32);
        pending.lock().expect("lock").insert(req_id.clone(), tx);

        let reader: thread::JoinHandle<Result<()>> = thread::spawn(|| Ok(()));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !reader.is_finished() && std::time::Instant::now() < deadline {
            thread::yield_now();
        }
        assert!(reader.is_finished(), "模拟 reader 必须已退出");

        let error = await_init_response(
            req_id,
            rx,
            &pending,
            &reader,
            std::time::Duration::from_secs(5),
        )
        .expect_err("必须失败而非挂死");
        assert!(
            error.to_string().contains("no response received"),
            "失败原因必须指向无响应（供内联证据合成）: {error}"
        );
        assert!(
            pending.lock().expect("lock").is_empty(),
            "在途发送端必须已被摘除（否则握手会再次挂死）"
        );
    }

    /// T0-4（审计 channel D1 / contracts #9）：`initialize` 握手必须有 deadline。
    ///
    /// 事故形态：服务器**活着但不答** `initialize`（jdtls 撞 `-data` 锁、OSGi 卡死）⇒
    /// `blocking_recv` 只由 reader 退出解除 ⇒ `spawn_blocking` 线程与 per-key 创建门
    /// 被一并永久占用 ⇒ 该 key 的**所有** LSP 命令悬挂，前端每条 invoke 永不 settle。
    ///
    /// 判据：50ms 预算 + 服务器沉默（reader 存活）+ 无响应 ⇒ 必须在预算附近以
    /// 「no response received」失败，且 pending 里那条 initialize 发送端已被摘除。
    #[test]
    fn await_init_response_fails_when_server_stays_silent() {
        let (tx, rx) = tokio::sync::oneshot::channel::<Message>();
        let pending: Arc<Mutex<HashMap<RequestId, PendingSender>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let req_id = RequestId::from(1i32);
        pending.lock().expect("lock").insert(req_id.clone(), tx);

        // reader **存活**：本用例测的是「进程活着但不答」，不是「进程死了」
        // （后者由 `await_init_response_fails_fast_when_reader_dead` 覆盖）。
        let (release_tx, release_rx) = crossbeam_channel::bounded::<()>(1);
        let reader: thread::JoinHandle<Result<()>> = thread::spawn(move || {
            let _ = release_rx.recv();
            Ok(())
        });
        assert!(!reader.is_finished(), "reader 必须存活");

        let started = std::time::Instant::now();
        let error = await_init_response(
            req_id.clone(),
            rx,
            &pending,
            &reader,
            std::time::Duration::from_millis(50),
        )
        .expect_err("服务器沉默时必须失败，而不是挂死");
        let elapsed = started.elapsed();

        assert!(
            error.to_string().contains("no response received"),
            "失败原因必须沿用既有文案（装配失败路径据此合成内联证据）: {error}"
        );
        assert!(
            elapsed >= std::time::Duration::from_millis(40)
                && elapsed < std::time::Duration::from_secs(1),
            "50ms 预算必须在预算附近收口（不是立刻失败、也不是无界等待），实际 {elapsed:?}"
        );
        assert!(
            pending.lock().expect("lock").is_empty(),
            "超时后必须摘除 initialize 的发送端（否则 pending 条目泄漏、该 key 永久占用）"
        );

        drop(release_tx);
        let _ = reader.join();
    }

    /// 正常路径：reader 存活、响应到达 → 原样返回。
    #[test]
    fn await_init_response_returns_response_when_reader_alive() {
        let (tx, rx) = tokio::sync::oneshot::channel::<Message>();
        let pending: Arc<Mutex<HashMap<RequestId, PendingSender>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let reader: thread::JoinHandle<Result<()>> = thread::spawn(|| Ok(()));
        // 模拟 reader 送响应（oneshot 有缓冲，先 send 后 recv 亦可）。
        tx.send(err_response("server said no")).expect("send");

        let response = await_init_response(
            RequestId::from(1i32),
            rx,
            &pending,
            &reader,
            std::time::Duration::from_secs(5),
        )
        .expect("response");

        assert!(matches!(response, Message::Response(_)));
    }

    /// 崩溃路径（AC2：kill gopls）：运行中 reader 退出 → error + 服务器名 +
    /// **证据尾部内联**（AC3）；同一条文案进该键的诊断日志，快照投影同一份字符串。
    #[test]
    fn on_reader_exit_emits_error_with_inlined_evidence() {
        let transport = Arc::new(RecordingTransport::default());
        let lifecycle = Lifecycle::new();
        lifecycle.set(&LspSessionStatus::Ready);
        let diagnostics = diag();
        diagnostics.push_line("error", "error: Unknown binary 'rust-analyzer'");

        assert!(on_reader_exit(
            &lifecycle,
            transport.as_ref(),
            PROJECT,
            "go",
            "gopls",
            &diagnostics
        ));

        let events = transport.take();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].2, "error");
        let message = events[0].3.as_deref().expect("error event carries message");
        assert!(
            message.contains("gopls exited unexpectedly") && message.contains("Unknown binary"),
            "崩溃文案必须内联证据尾部: {message}"
        );
        assert_eq!(
            lifecycle.status("gopls"),
            LspSessionStatus::Error(message.to_string()),
            "快照与事件必须投影同一份写者文案"
        );
        assert!(
            diagnostics
                .snapshot_logs(0, 0)
                .iter()
                .any(|entry| entry.message == message),
            "崩溃文案必须同源进该键的日志证据"
        );
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
            "gopls",
            &diag()
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
        let diagnostics = diag();

        assert!(on_reader_exit(
            &lifecycle,
            transport.as_ref(),
            PROJECT,
            "go",
            "gopls",
            &diagnostics
        ));
        assert!(
            !on_reader_exit(
                &lifecycle,
                transport.as_ref(),
                PROJECT,
                "go",
                "gopls",
                &diagnostics
            ),
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
        // reader 线程退出时会写下崩溃相位与文案（此处直接落相位，等价于那一刻）。
        session
            .lifecycle
            .on_reader_exit(&crash_message(SERVER, None));

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

    /// `shutdown` 必须是 **request**（LSP 规范：服务器响应后才允许发 `exit`）。
    ///
    /// 事故形态（11-12 任务）：项目停用路径用 `send_notification_raw` 把 `shutdown` 当
    /// notification 发 —— 服务器永远不会回，紧接着的 `exit` 等于宣告「我不等你」，jdtls 的 Eclipse
    /// workspace checkpoint 遂被随后的 SIGKILL 截断，下次启动直接 `Application error`。
    #[test]
    fn shutdown_request_is_a_request_not_a_notification() {
        let transport = Arc::new(RecordingTransport::default());
        let (session, writer_rx) = stub_session_with_writer(
            Arc::clone(&transport) as Arc<dyn LspTransport>,
            PROJECT,
            LANG,
            SERVER,
        );

        let handle =
            thread::spawn(move || session.send_shutdown_request_bounded(Duration::from_millis(50)));

        let message = writer_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("关闭序列必须向服务器发出 shutdown");
        match message {
            Message::Request(req) => {
                assert_eq!(req.method, "shutdown", "第一条报文必须是 shutdown request");
            }
            other => panic!("shutdown 不得以 notification 形式发出: {other:?}"),
        }

        let error = handle
            .join()
            .expect("join")
            .expect_err("服务器不响应时必须失败而不是挂死");
        assert!(
            error.to_string().contains("no response received"),
            "失败原因必须指向无响应: {error}"
        );
    }

    /// 等待**必须有界**：`spawn_blocking` 线程不是无界资源。
    ///
    /// 服务器活着但沉默时，无界 `blocking_recv` 会永久占住线程（关闭永不收口）；
    /// 超时后必须同时摘除在途发送端，否则下一个关闭会复用脏 pending。
    #[test]
    fn shutdown_request_wait_is_bounded_and_drops_pending() {
        let transport = Arc::new(RecordingTransport::default());
        let (session, _writer_rx) = stub_session_with_writer(
            Arc::clone(&transport) as Arc<dyn LspTransport>,
            PROJECT,
            LANG,
            SERVER,
        );
        let pending = Arc::clone(&session.pending);

        let started = std::time::Instant::now();
        let error = session
            .send_shutdown_request_bounded(Duration::from_millis(40))
            .expect_err("无响应必须失败");

        assert!(
            started.elapsed() < Duration::from_secs(2),
            "等待必须有界返回，实际 {:?}",
            started.elapsed()
        );
        assert!(
            error.to_string().contains("no response received"),
            "失败原因必须指向无响应: {error}"
        );
        assert!(
            pending.lock().expect("pending lock").is_empty(),
            "超时后在途发送端必须被摘除（否则 pending 表泄漏、下次关闭误判）"
        );
    }
}
