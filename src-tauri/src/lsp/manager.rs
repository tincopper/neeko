//! LSP session manager: lifecycle, plugin discovery, diagnostics, and auto-start policies.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tauri::Emitter;

use crate::common::runtime::AppRuntime;
use crate::AppError;

use super::attempt_diagnostics::AttemptDiagnosticsStore;
use super::diag_bus::{DiagnosticBus, DiagnosticEvent};
use super::plugin::{LspAutoStart, LspPlugin, LspPluginRegistry, LspSettings};
use super::plugin_manager::LspPluginManager;
use super::profile::detect_project_profile_with_markers;
use super::session::{do_send_request, emit_session_error, LspSession, LOG_ENTRY_JSON_MAX_BYTES};
use super::session_factory::{IpcSessionFactory, SessionBuildRequest, SessionFactory};
use super::session_store::LspSessionStore;
use super::transport::{IpcTransport, LspTransport};
use super::types::{LspServerInfo, LspServerLogEntry, LspSessionInfo, LSP_PROFILE_EVENT};

// ── Re-exports ─────────────────────────────────────────────────────────

pub use super::profile::ProjectLanguageProfile;

// ── Constants ───────────────────────────────────────────────────────────

/// Maximum restart attempts before giving up on a session.
const MAX_RESTART_COUNT: u32 = 5;
/// Base delay for exponential backoff (ms).
const RESTART_BASE_DELAY_MS: u64 = 500;
/// Default: after a project is deactivated, wait this long before closing sessions.
const DEFAULT_DEACTIVATE_STOP_SECS: u64 = 30 * 60;

/// 应用退出时关闭全部 LSP 会话的**总**预算（各会话共享）。
///
/// 退出不能被 `N × 2 × grace` 拖住（jdtls 单语言就 20s）；同时不能回到「直接硬杀」
/// （那正是 workspace 快照被截断的成因）。这个值是两者之间的取舍：先让服务器收尾，
/// 超预算的部分逐会话兜底 kill。
const APP_QUIT_GRACE_BUDGET: Duration = Duration::from_secs(3);

/// 请求失败后允许对会话做的事 —— 区分**用户意图请求**与**观察请求**。
///
/// 拆成策略而不是再挂一个 bool：`is_probe` 已经表示"单飞桶语义"，两者正交，
/// 两个 bool 并列会让调用点无法自解释。新增调用场景时扩展本枚举即可（开闭）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RequestPolicy {
    /// 用户意图请求（导航 / 补全 / 定义…）：失败即重启会话后重试（既有行为）。
    RestartOnFailure,
    /// 观察请求（能力探测…）：失败只报错，**不重启、不新建**会话。
    Never,
}

/// Compute the restart delay with exponential backoff.
const fn compute_restart_delay(attempt: u32, base_ms: u64) -> Duration {
    Duration::from_millis(base_ms * 2_u64.saturating_pow(attempt))
}
/// Whether a session should be restarted based on current attempt count.
#[must_use]
pub const fn should_restart(current_count: u32, max_count: u32) -> bool {
    current_count < max_count
}

fn session_key(project_path: &str, language_id: &str) -> String {
    format!("{}:{}", project_path, language_id)
}

/// 单次 `lsp_get_server_logs` 的 **JSON 字节预算**（红线 4：序列化结果 ≤ 2MB）。
///
/// 条数上限（默认 500）**不能替代**字节上限：控制字符 JSON 转义最长 6×
/// （`\x01` → `\u0001`），一条 4KB 的行最坏可放大到 ~25KB —— 只有按真实序列化
/// 长度计账才守得住（口径与 [`crate::common::git::parsers::DIFF_PAYLOAD_MAX_BYTES`]
/// 一致：1.5MB 预算，给命令封装留 0.5MB 余量）。超预算时丢弃**更旧**的条目；
/// **最新一条无条件纳入**（证据下界），其单条上界见 [`LOG_ENTRY_JSON_MAX_BYTES`]。
pub(crate) const LSP_SERVER_LOGS_MAX_BYTES: usize = 1_500_000;

/// 编译期契约：IPC 预算必须 ≥ 单条最坏形态 —— 否则「最新一条无条件纳入」会让
/// 返回载荷的绝对上界偏离预算（红线 4 的兜底由本断言钉住）。
const _: () = assert!(LSP_SERVER_LOGS_MAX_BYTES >= LOG_ENTRY_JSON_MAX_BYTES);

/// didOpen 归一决策（抽纯函数以便直接单测两条关键路径：重复 didOpen / 版本回退）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DidOpenAction {
    /// 登记表无记录：直接 didOpen。
    PlainOpen,
    /// 登记表已有记录：先补 didClose 再 didOpen。
    ///
    /// `version_regressed`：本次版本**低于**登记版本 —— 真实回退（告警级）；
    /// 相等（编辑器在后端代开后以同版本接管，常见 v0==v0）或更高则非回退
    /// （debug 级记录，不误报）。
    Reopen { version_regressed: bool },
}

/// 由「登记表 previous 版本 + 本次版本」得出 didOpen 归一决策。
#[must_use]
const fn did_open_action(previous: Option<i64>, version: i64) -> DidOpenAction {
    match previous {
        None => DidOpenAction::PlainOpen,
        Some(prev) => DidOpenAction::Reopen {
            version_regressed: version < prev,
        },
    }
}

/// 会话关闭语义：决定要不要向状态栏宣告"该语言的会话就此结束"。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionCloseNotice {
    /// 会话结束（用户停止 / 项目停用 / 应用退出）：推 `stopped`。
    Announce,
    /// 会话即将被同 project+language 的新会话**替换**（重启）：静默，且**保留**该键的
    /// 文档登记表与编辑器所有权（`take_session`，见 `take_for_close`）。
    /// 详见 [`LspManager::close_session_for_restart`]。
    Silent,
}

// ── LspManager ──────────────────────────────────────────────────────────

/// Coordinates LSP session lifecycle, plugin management, and project profiles.
///
/// Owns an [`LspSessionStore`] for session state and an [`LspPluginManager`]
/// for plugin discovery. Cross-domain operations (e.g., deactivate closing
/// sessions) are orchestrated here.
pub struct LspManager {
    /// Business async executor (never bare `tokio::spawn`).
    runtime: Arc<AppRuntime>,
    /// Session lifecycle and document tracking.
    session_store: LspSessionStore,
    /// Plugin discovery, registration, and project execution targets.
    plugin_manager: LspPluginManager,
    /// Diagnostic event bus for pub/sub.
    diag_bus: DiagnosticBus,
    /// Tauri AppHandle for event emission.
    app_handle: Mutex<Option<tauri::AppHandle>>,
    /// Session assembly port (DIP): manager orchestrates lifecycle, the port owns
    /// transport/session construction. Swappable in tests to cover failure paths
    /// without a Tauri runtime.
    session_factory: Arc<dyn SessionFactory>,
    /// Cached language profiles per project path.
    profiles: Mutex<HashMap<String, ProjectLanguageProfile>>,
    /// 按身份键承载启动尝试的诊断证据（P1：证据宿主 = 键，不随进程存活与否变化）。
    /// 语义上与 `session_store` 正交：它管「活着的进程」，本 store 管「发生过什么」。
    attempt_diag: AttemptDiagnosticsStore,
    /// Generation counter per project path to cancel pending deactivate timers.
    deactivate_gens: Mutex<HashMap<String, u64>>,
    /// Seconds after deactivation before closing sessions (from settings).
    deactivate_stop_secs: Mutex<u64>,
    /// Definition-target uris pre-authorized for out-of-root reads (per session).
    preauth: Mutex<super::preauth::PreauthorizedTargets>,
    /// Per-key creation gates: serialize concurrent `get_or_create_session`
    /// for the same (project, language) so only one slow `LspSession::new`
    /// runs at a time. Lives on the manager rather than the store: the store
    /// owns pure session state (kept API-stable), while creation
    /// serialization is a manager-level orchestration concern. parking_lot
    /// (no poisoning) because the gate is held across the spawn.
    creation_locks: parking_lot::Mutex<HashMap<String, Arc<parking_lot::Mutex<()>>>>,
}

/// 关闭一个 LSP 会话的**唯一**序列（LSP 规范顺序，三步全部有界）：
/// `shutdown` **request** → 等响应 → `exit` notification → 等进程自行退出 → 兜底 kill。
///
/// 为什么必须是唯一实现：这两条入口各自拼装过一次，其中一条把 `shutdown` 当
/// notification 发、10ms 后就杀进程 —— jdtls 的 Eclipse workspace 快照因此在
/// checkpoint 窗口被 SIGKILL 截断，下次启动直接 `Application error` 退出
/// （现场见 `.trellis/tasks/11-12-lsp-graceful-shutdown/research/`）。
///
/// 阻塞语义：本函数最多阻塞**一个** `shutdown_grace`（该值是整个序列的总时长，
/// 不是每步各一份），**只能**在 `spawn_blocking` / 专用线程里调用（红线 3）。
/// 任一步失败都不得提前返回 —— 那会留下「终态已落、进程仍活着」的孤儿，继续持着
/// workspace 锁。
fn shutdown_and_exit(session: LspSession) {
    // 宽限是插件数据，创建会话时已落到会话上（关闭路径不回查插件表）。
    let grace = session.shutdown_grace;
    shutdown_and_exit_with(session, grace);
}

/// 同上，但用调用方给的**总**预算（应用退出路径要按剩余时间切片）。
///
/// 预算是整个序列的上界：进入时折成一次绝对 `deadline`，两步各取剩余额度。
/// 把同一个值分别喂给两步会把上界刷成 `2×budget`（审计 lifecycle #5 / channel D11）——
/// 退出窗口的真实上界必须与代码声明一致。
fn shutdown_and_exit_with(mut session: LspSession, budget: std::time::Duration) {
    let project_path = session.project_path.clone();
    let language_id = session.language_id.clone();
    let deadline = std::time::Instant::now() + budget;
    let remaining = || deadline.saturating_duration_since(std::time::Instant::now());

    match session.send_shutdown_request_bounded(remaining()) {
        Ok(_) => log::info!("[LSP] Shutdown request acknowledged for {project_path}:{language_id}"),
        Err(e) => log::warn!("[LSP] Shutdown request failed for {project_path}:{language_id}: {e}"),
    }

    // `exit` 是通知；服务器可能已经退出 → 写失败属正常，不得提前返回。
    if let Err(e) = session.send_notification_raw("exit", serde_json::json!({})) {
        log::debug!("[LSP] exit notification not delivered for {project_path}:{language_id}: {e}");
    }

    // 剩余额度可能已归零（响应等待吃满预算）：此时 `wait_exit(0)` 立即返回 false，
    // 直接进兜底 kill —— 序列仍是有界的。
    let grace = remaining();
    let exited_in_grace = match session.child.as_mut() {
        Some(child) => child.wait_exit(grace),
        // 无进程句柄（测试夹具 / 已收敛）→ 没有可杀的对象
        None => true,
    };
    if exited_in_grace {
        log::info!("[LSP] Server exited after exit notification: {project_path}:{language_id}");
    } else {
        log::warn!(
            "[LSP] Server still alive after {grace:?} grace; killing: {project_path}:{language_id}"
        );
        session.kill_child();
    }
    log::info!(
        "[LSP] Closed session in {:?}: {project_path}:{language_id}",
        budget.saturating_sub(remaining())
    );
}

impl LspManager {
    /// Create a manager that schedules work on the given business runtime.
    #[must_use]
    pub fn new(runtime: Arc<AppRuntime>) -> Self {
        Self::with_session_factory(runtime, Arc::new(IpcSessionFactory))
    }

    /// Create a manager with an injected session-assembly port.
    ///
    /// 测试据此在不依赖 Tauri 运行时（`tauri::AppHandle` 无法常驻 `#[cfg(test)]`）
    /// 的前提下驱动 `get_or_create_session` 的成功 / 失败路径。
    #[must_use]
    pub(crate) fn with_session_factory(
        runtime: Arc<AppRuntime>,
        session_factory: Arc<dyn SessionFactory>,
    ) -> Self {
        let diag_bus = DiagnosticBus::new();

        Self {
            runtime,
            session_store: LspSessionStore::new(),
            plugin_manager: LspPluginManager::new(),
            diag_bus,
            app_handle: Mutex::new(None),
            session_factory,
            profiles: Mutex::new(HashMap::new()),
            attempt_diag: AttemptDiagnosticsStore::new(),
            deactivate_gens: Mutex::new(HashMap::new()),
            deactivate_stop_secs: Mutex::new(DEFAULT_DEACTIVATE_STOP_SECS),
            preauth: Mutex::new(super::preauth::PreauthorizedTargets::new()),
            creation_locks: parking_lot::Mutex::new(HashMap::new()),
        }
    }

    /// Record which environment a project path uses (for PATH/binary checks).
    pub fn set_project_exec_target(
        &self,
        project_path: &str,
        target: crate::common::executor::factory::ExecTarget,
    ) {
        self.plugin_manager
            .set_project_exec_target(project_path, target);
    }

    /// Execution target previously recorded for a project path.
    pub fn project_exec_target(
        &self,
        project_path: &str,
    ) -> Option<crate::common::executor::factory::ExecTarget> {
        self.plugin_manager.project_exec_target(project_path)
    }

    /// Require a recorded execution target, or return a clear LSP error.
    pub fn require_project_exec_target(
        &self,
        project_path: &str,
    ) -> Result<crate::common::executor::factory::ExecTarget, AppError> {
        self.plugin_manager
            .require_project_exec_target(project_path)
    }

    /// Convenience constructor for tests / simple call sites.
    #[must_use]
    pub fn new_default() -> Self {
        Self::new(AppRuntime::shared_default())
    }

    /// Business executor used for session spawn / timers (Scheme C).
    pub fn runtime(&self) -> Arc<AppRuntime> {
        Arc::clone(&self.runtime)
    }

    /// Resolve language id for a file path from the live plugin registry (custom first).
    pub fn resolve_language_for_path(&self, file_path: &str) -> Option<String> {
        self.plugin_manager.resolve_language_for_path(file_path)
    }

    /// Apply LSP settings from config.json (`lsp` object).
    pub fn apply_settings(&self, settings: &LspSettings) {
        if let Err(e) = self._apply_settings_internal(settings) {
            log::warn!("[LSP] Failed to apply settings: {}", e);
        }
    }

    fn _apply_settings_internal(&self, settings: &LspSettings) -> Result<(), AppError> {
        *self
            .deactivate_stop_secs
            .lock()
            .map_err(|e| AppError::Lsp(e.to_string()))? =
            settings.deactivate_stop_minutes.saturating_mul(60).max(60);

        let policy = LspAutoStart::parse(&settings.auto_start);
        self.plugin_manager.set_default_auto_start(policy);

        self.plugin_manager.apply_settings(settings)?;

        Ok(())
    }

    /// Apply LSP settings from a full app config JSON value.
    pub fn apply_settings_from_json(&self, config: &serde_json::Value) {
        let settings = config
            .get("lsp")
            .cloned()
            .and_then(|v| serde_json::from_value::<LspSettings>(v).ok())
            .unwrap_or_default();
        self.apply_settings(&settings);
    }

    /// Get the extension-to-language map from the plugin registry.
    pub fn extension_map(&self) -> Vec<super::plugin::LspExtensionMapEntry> {
        self.plugin_manager.extension_map()
    }

    /// Extension conflicts from the live registry (later registration wins).
    pub fn extension_conflicts(&self) -> Vec<super::plugin::LspExtensionConflict> {
        self.plugin_manager.extension_conflicts()
    }

    /// Access the diagnostic bus (for hooking up transport subscribers).
    pub const fn diag_bus(&self) -> &DiagnosticBus {
        &self.diag_bus
    }

    /// Access the plugin manager.
    pub const fn plugin_manager(&self) -> &LspPluginManager {
        &self.plugin_manager
    }

    /// Server binary name for a language id from the live plugin registry.
    pub fn plugin_server_binary(&self, language_id: &str) -> Option<String> {
        self.plugin_manager.plugin_server_binary(language_id)
    }

    /// Register a custom LSP plugin at runtime (e.g. from user settings).
    pub fn register_plugin(&self, plugin: LspPlugin) {
        self.plugin_manager.register_plugin(plugin);
    }

    /// Register an open document for session restart recovery.
    pub fn register_open_document(
        &self,
        project_path: &str,
        language_id: &str,
        uri: &str,
        text: &str,
        version: i64,
    ) {
        let key = session_key(project_path, language_id);
        self.session_store.register_open_document(
            key,
            super::session_store::OpenDocument {
                uri: uri.to_string(),
                language_id: language_id.to_string(),
                text: text.to_string(),
                version,
                // 刚拿到的文本就是 didOpen 发出的那份：干净。
                text_stale: false,
            },
        );
    }

    /// Record definition-target uris as pre-authorized for out-of-root reads.
    pub fn record_definition_targets(
        &self,
        project_path: &str,
        language_id: &str,
        uris: &[String],
    ) {
        if uris.is_empty() {
            return;
        }
        if let Ok(mut preauth) = self.preauth.lock() {
            preauth.record(project_path, language_id, uris);
        }
    }

    /// Whether the uri is a pre-authorized definition target for this session.
    #[must_use]
    pub fn is_preauthorized(&self, project_path: &str, language_id: &str, uri: &str) -> bool {
        self.preauth
            .lock()
            .map(|preauth| preauth.is_authorized(project_path, language_id, uri))
            .unwrap_or(false)
    }

    /// Check whether a document is already registered as open for this session.
    pub fn is_document_open(&self, project_path: &str, language_id: &str, uri: &str) -> bool {
        let key = session_key(project_path, language_id);
        self.session_store.is_document_open(&key, uri)
    }

    /// 前端视图声明持有该文档（挂载时）。
    pub fn claim_document(&self, project_path: &str, language_id: &str, uri: &str) {
        self.session_store
            .claim_document(session_key(project_path, language_id), uri.to_string());
    }

    /// 前端视图释放持有（最后一个视图卸载时）。
    pub fn release_document(&self, project_path: &str, language_id: &str, uri: &str) {
        self.session_store
            .release_document(&session_key(project_path, language_id), uri);
    }

    /// 该文档是否正被编辑器视图持有 —— 持有期间后端**不得**代开（否则会用磁盘文本
    /// 覆盖编辑器未保存的缓冲区，服务器随即按旧文本报出错位诊断）。
    #[must_use]
    pub fn is_editor_owned(&self, project_path: &str, language_id: &str, uri: &str) -> bool {
        self.session_store
            .is_editor_owned(&session_key(project_path, language_id), uri)
    }

    /// 已登记版本号（未登记为 `None`）—— 鉴定「第二个 client 的独立计数器」用。
    #[must_use]
    pub fn open_document_version(
        &self,
        project_path: &str,
        language_id: &str,
        uri: &str,
    ) -> Option<i64> {
        let key = session_key(project_path, language_id);
        self.session_store.open_document_version(&key, uri)
    }

    /// `textDocument/didOpen` 的**唯一出口**：必要时先补 `didClose`，再发送、再登记。
    ///
    /// 为什么收敛到一处（2026-09-21 实证）：后端曾有第三条 didOpen 路径（`lsp_request`
    /// 的内联代开）绕过登记，造成同一 uri 两条 didOpen、且服务器与客户端的文档版本分叉
    /// —— 服务器用 v1 推诊断，客户端文档是 v0，被 `@codemirror/lsp-client` 的版本门整批
    /// 丢弃，表现为「Problems 面板有诊断、编辑器没有波浪线/灯泡」。任何新增的 didOpen
    /// 发送者都必须走本方法，禁止自行拼参数直发。
    pub fn send_did_open(
        &self,
        project_path: &str,
        language_id: &str,
        uri: &str,
        text: &str,
        version: i64,
    ) -> Result<(), AppError> {
        let previous = self.open_document_version(project_path, language_id, uri);
        log::debug!(
            "[LSP] didOpen {} v={} (previous={:?})",
            uri,
            version,
            previous
        );
        match did_open_action(previous, version) {
            DidOpenAction::PlainOpen => {}
            DidOpenAction::Reopen { version_regressed } => {
                if version_regressed {
                    // 真实回退：登记表版本高于本次 —— 保留告警（非单调写入者）。
                    log::warn!(
                        "[LSP] non-monotonic didOpen for {}: v={} < previous v={} \
                         (a second writer is tracking this document)",
                        uri,
                        version,
                        previous.expect("reopen implies a previous version")
                    );
                } else {
                    // 同版本（编辑器在后端代开后接管，v0==v0）或更高版本重开：
                    // 行为照旧（didClose+didOpen 使文本对齐），仅 debug 记录，不误报。
                    log::debug!(
                        "[LSP] didOpen for {} at v={} (editor re-open after backend pre-open)",
                        uri,
                        version
                    );
                }
                log::warn!(
                    "[LSP] duplicate didOpen for {} ({}); closing before reopening",
                    uri,
                    language_id
                );
                self.send_notification(
                    project_path,
                    language_id,
                    "textDocument/didClose",
                    serde_json::json!({ "textDocument": { "uri": uri } }),
                )?;
            }
        }
        self.send_notification(
            project_path,
            language_id,
            "textDocument/didOpen",
            serde_json::json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": language_id,
                    "version": version,
                    "text": text,
                }
            }),
        )?;
        self.register_open_document(project_path, language_id, uri, text, version);
        Ok(())
    }

    /// Unregister a closed document.
    pub fn unregister_open_document(&self, project_path: &str, language_id: &str, uri: &str) {
        let key = session_key(project_path, language_id);
        self.session_store.unregister_open_document(&key, uri);
    }

    /// 登记表与服务器**同源**：`lsp_transport` 转发的 `didChange` 落到这里。
    ///
    /// 写在生产唯一路径（前端 wrapper 零调用，didChange 只经 `lsp_transport` 通用
    /// 转发）上，而不是 `send_notification` 里 —— 后者会让所有内部通知都过一遍
    /// 载荷解析。
    ///
    /// - 全量同步（`full_text = Some`）→ 文本 + 版本都更新；
    /// - 增量同步（`None`）→ 只推版本，文本标记为可能陈旧；
    /// - 未登记的 uri → 不造条目（登记表 = 我们确实 didOpen 过的文档）。
    pub fn record_document_change(
        &self,
        project_path: &str,
        language_id: &str,
        uri: &str,
        version: i64,
        full_text: Option<&str>,
    ) {
        let key = session_key(project_path, language_id);
        if !self
            .session_store
            .update_open_document(&key, uri, version, full_text)
        {
            log::debug!(
                "[LSP] didChange for unregistered uri {uri} (registry only tracks didOpen'd docs)"
            );
        }
    }

    /// Set the Tauri AppHandle and connect the diagnostic bus to event emission.
    pub fn set_app_handle(&self, app_handle: tauri::AppHandle) {
        let ah = app_handle.clone();
        let diag_subscriber = self.diag_bus.subscribe(move |event: &DiagnosticEvent| {
            let transport = IpcTransport::new(ah.clone());
            transport.push_diagnostics(
                &event.project_path,
                &event.uri,
                event.diagnostics.clone(),
                event.version,
            );
        });
        std::mem::forget(diag_subscriber);

        if let Ok(mut handle) = self.app_handle.lock() {
            *handle = Some(app_handle);
        }
    }

    /// Return the creation gate for a session key, creating it on first use.
    /// Only the map lookup-or-insert holds the map lock (short critical
    /// section); the returned gate serializes the slow creation path below.
    fn creation_gate(&self, key: &str) -> Arc<parking_lot::Mutex<()>> {
        let mut gates = self.creation_locks.lock();
        Arc::clone(
            gates
                .entry(key.to_string())
                .or_insert_with(|| Arc::new(parking_lot::Mutex::new(()))),
        )
    }

    /// Get an existing session or create a new one for the given project and language.
    pub fn get_or_create_session(
        &self,
        project_path: &str,
        language_id: &str,
        document_uri: Option<&str>,
    ) -> Result<String, AppError> {
        let key = session_key(project_path, language_id);

        // Fast path: alive session returns without touching the gate.
        if self.session_store.is_alive(&key) {
            return Ok(key);
        }

        // Slow path: serialize per-key creation. The gate is held across the
        // whole `LspSession::new` below (this runs on a spawn_blocking
        // thread, so blocking is by design): a second concurrent caller for
        // the same key blocks here, then hits the recheck and returns without
        // spawning a duplicate server.
        let gate = self.creation_gate(&key);
        let _creation_guard = gate.lock();

        // Recheck under the gate (double-checked locking): the winner's
        // session is now visible.
        if self.session_store.is_alive(&key) {
            return Ok(key);
        }

        // Slow path: create the session holding only the per-key gate (never
        // the sessions lock, which `is_alive`/`insert` take briefly).
        //
        // `begin` 只允许出现在这里（慢路径、二次 recheck 之后、插件解析之前）：
        // fast path / 并发输家重置生代会清空活会话日志（每条 hover / didOpen /
        // didChange 都会先调本函数）。
        let diag = self.attempt_diag.begin(&key, project_path);

        let plugin = match self.plugin_manager.resolve_by_language(language_id) {
            Some(plugin) => plugin,
            None => {
                let error = AppError::Lsp(format!(
                    "No LSP plugin registered for language: {}",
                    language_id
                ));
                diag.record_failure(&error.to_string());
                return Err(error);
            }
        };

        // AppHandle 不再由 manager 强制：装配端口自行决定是否需要它
        //（生产实现缺失时报 "AppHandle not set"，行为与既有错误契约一致）。
        let app_handle = match self.app_handle.lock() {
            Ok(handle) => handle.clone(),
            Err(e) => {
                let error = AppError::Lsp(e.to_string());
                diag.record_failure(&error.to_string());
                return Err(error);
            }
        };

        let diag_bus = Arc::new(self.diag_bus.clone());
        // 先取 transport：装配失败时还要靠它把 error 事件送到前端。
        let transport = match self.session_factory.transport(app_handle.as_ref()) {
            Ok(transport) => transport,
            Err(e) => {
                diag.record_failure(&e.to_string());
                return Err(e);
            }
        };
        let exec_target = match self.require_project_exec_target(project_path) {
            Ok(target) => target,
            Err(e) => {
                diag.record_failure(&e.to_string());
                return Err(e);
            }
        };
        // 会话根由插件数据决定（`RootScope`）：文档定根的插件（如 TS 家族）会取
        // 文档所在的最近工程目录，让 typescript-language-server 能解析到
        // `node_modules/typescript`；其余插件保持项目根。
        let workspace_root =
            crate::lsp::session::root::resolve_session_root(project_path, document_uri, &plugin);

        let session = match self.session_factory.build(SessionBuildRequest {
            app_handle,
            plugin: &plugin,
            project_path,
            workspace_root: &workspace_root,
            diag_bus,
            transport: Arc::clone(&transport),
            exec_target,
            diagnostics: Arc::clone(&diag),
        }) {
            Ok(s) => s,
            // 创建失败（spawn / install / initialize）：`starting` 可能已发（init 失败
            // 时）也可能未发（spawn 失败时）——统一补发 `error`，前端据此展示
            // message + 重试入口（design.md M2 错误矩阵：启动异常 → failed + 重试）。
            Err(e) => {
                // 终态单写者：装配期失败由 manager 经**本次尝试的句柄**落账
                //（session 内部只写 log 证据，不写 outcome）。
                diag.record_failure(&e.to_string());
                emit_session_error(
                    transport.as_ref(),
                    project_path,
                    language_id,
                    &e.to_string(),
                );
                return Err(e);
            }
        };

        // Defensive: unreachable while the gate is held (no other thread can
        // be creating this key), but if a session appeared anyway, drop the
        // just-built one — its Drop→kill reaps the child — and use the key.
        if self.session_store.is_alive(&key) {
            return Ok(key);
        }
        let open_count = self
            .session_store
            .reopen_documents(&key, |uri, lang, ver, text| {
                let params = serde_json::json!({
                    "textDocument": {
                        "uri": uri,
                        "languageId": lang,
                        "version": ver,
                        "text": text,
                    }
                });
                session
                    .send_notification_raw("textDocument/didOpen", params)
                    .is_ok()
            });
        log::info!(
            "[LSP] Session {} created for {} (re-opened {} doc(s))",
            key,
            plugin.server_binary,
            open_count
        );
        self.session_store.insert(key.clone(), session);
        diag.record_success();
        Ok(key)
    }

    /// 该项目+语言是否仍有在途 progress（导入 / 索引进行中）。
    ///
    /// Java debug 能力探测的 `Warming` 判据（design §2.4）：`classpath` 空 **且**
    /// 此值为 `true` 才是"稍后可成"；无在途进度却返回空 classpath 属真损坏工程，
    /// 调用方必须直接报错而不是等待。缺会话视为无在途。
    #[must_use]
    pub fn has_inflight_progress(&self, project_path: &str, language_id: &str) -> bool {
        let key = session_key(project_path, language_id);
        self.session_store
            .with_session(&key, |s| {
                s.in_flight_progress
                    .lock()
                    .map(|set| !set.is_empty())
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    }

    /// 会话事件的出口：优先复用该键**活会话自带的** transport，否则向装配端口要一个。
    ///
    /// 预算耗尽 / 装配失败这类「会话可能已不在」的路径也需要一条通道把 error 送到
    /// 前端（重试入口的数据源）。装配端口缺失 `AppHandle` 时退化为 `None` —— 此时
    /// 错误仍经 `Err` 上抛，不会被静默吞掉。
    fn event_transport(&self, key: &str) -> Option<Arc<dyn LspTransport>> {
        if let Some(transport) = self
            .session_store
            .with_session(key, |s| Arc::clone(&s.transport))
        {
            return Some(transport);
        }
        let app_handle = self.app_handle.lock().ok().and_then(|h| h.clone());
        self.session_factory.transport(app_handle.as_ref()).ok()
    }

    /// Send an LSP request asynchronously, restarting the session if needed.
    ///
    /// `is_probe` marks best-effort decoration lookups (e.g. the link-highlight
    /// probe that reuses `textDocument/definition`): probes are single-flight
    /// under a dedicated bucket, while explicit navigation is never cancelled.
    pub async fn send_request_async(
        self: &Arc<Self>,
        project_path: &str,
        language_id: &str,
        method: &str,
        params: Value,
        is_probe: bool,
    ) -> Result<Value, AppError> {
        self.send_request_with_policy(
            project_path,
            language_id,
            method,
            params,
            is_probe,
            RequestPolicy::RestartOnFailure,
        )
        .await
    }

    /// Send an **observation** request: failures never restart (nor create) the session.
    ///
    /// 第一性原理：观测不得改变被观测系统的状态。能力探测（"这个项目现在能不能用某个
    /// 后端"）是观察，不是用户意图 —— 失败时重启语言服务器会产生三个实际损害：
    /// ① 重启是重量级、用户可见的状态变更（重新导入项目，数十秒）；
    /// ② 它消耗 `restart_count` —— 那是**真故障**的预算（`MAX_RESTART_COUNT` 用尽后该
    ///    项目语言服务永久不可用），把预期内的失败（如命令未注册）记进去等于让探测
    ///    把 LSP 用坏；
    /// ③ 它违反能力端口的契约（见 `dap::java_capability`：探测不得在内部启动服务器）。
    ///
    /// 会话缺失 / 请求失败都以 `Err` 原样返回，由调用方分类（如 `BundleMissing`）。
    pub async fn send_request_observed(
        self: &Arc<Self>,
        project_path: &str,
        language_id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, AppError> {
        self.send_request_with_policy(
            project_path,
            language_id,
            method,
            params,
            false,
            RequestPolicy::Never,
        )
        .await
    }

    /// Shared request body; `policy` decides what a failure may do to the session.
    async fn send_request_with_policy(
        self: &Arc<Self>,
        project_path: &str,
        language_id: &str,
        method: &str,
        params: Value,
        is_probe: bool,
        policy: RequestPolicy,
    ) -> Result<Value, AppError> {
        let key = session_key(project_path, language_id);

        // Fast path: extract session ingredients, drop lock before awaiting
        if self.session_store.is_alive(&key) {
            if let Some((pending, writer, inflight, budget)) =
                self.session_store.with_session(&key, |s| {
                    (
                        Arc::clone(&s.pending),
                        s.writer.clone(),
                        Arc::clone(&s.inflight),
                        s.request_timeout,
                    )
                })
            {
                match do_send_request(
                    pending,
                    writer,
                    inflight,
                    method,
                    params.clone(),
                    is_probe,
                    budget,
                )
                .await
                {
                    Ok(val) => {
                        // 一次成功请求就是「该会话可用」的证明 ⇒ streak 归零。
                        // 只在成功后清零（创造成功即清零会让崩溃循环永远绕过上限）。
                        self.session_store.clear_restart(&key);
                        return Ok(val);
                    }
                    // 请求级失败（服务器回错 / 预算内无响应）：会话健康，原样上抛。
                    // 观察类请求同样到此为止（见 `send_request_observed`）：失败不重启
                    // 会话，错误文本是探测分类的输入。
                    Err(failure)
                        if !failure.is_session_level() || policy == RequestPolicy::Never =>
                    {
                        log::warn!(
                            "[LSP] {} for {} is a request-level failure (no restart): {}",
                            method,
                            key,
                            failure
                        );
                        return Err(AppError::Lsp(failure.to_string()));
                    }
                    Err(failure) => {
                        // 只有通道不可用（会话级）才进重启路径：这是 `Will restart`
                        // 的**唯一**入口（Gate D 的 grep 判据）。
                        log::warn!(
                            "[LSP] send_request_async failed for {}, reason: {}. Will restart.",
                            key,
                            failure
                        );
                    }
                }
            }
        }

        // 观察类请求也不得"把服务器弄起来"：探测的语义是"现在能不能用"，
        // 而不是"把它弄成能用"。会话不在时直接报错，由调用方判为不可用。
        if policy == RequestPolicy::Never {
            return Err(AppError::Lsp(format!(
                "No live LSP session for {key}; the observation request was not retried"
            )));
        }

        // Restart path
        let prev_count = self.session_store.restart_count(&key);

        if prev_count >= MAX_RESTART_COUNT {
            let message = format!(
                "Max restart count ({}) exceeded for {}",
                MAX_RESTART_COUNT, key
            );
            log::warn!("[LSP] {message}");
            // 预算耗尽必须让前端可见：只有 warn 日志 + chip 仍显 Running 等于「静默
            // 把该语言弄坏」（用户既看不到文案也没有重试入口）。
            if let Some(transport) = self.event_transport(&key) {
                emit_session_error(transport.as_ref(), project_path, language_id, &message);
            }
            return Err(AppError::Lsp(message));
        }

        if prev_count > 0 {
            let delay = compute_restart_delay(prev_count, RESTART_BASE_DELAY_MS);
            log::warn!(
                "[LSP] Backoff: waiting {:?} before restart attempt {} for {}",
                delay,
                prev_count + 1,
                key
            );
            tokio::time::sleep(delay).await;
        }

        // **先关后建**：活会话会被 `get_or_create_session` 的快路径原样复用（那正是
        // 「计数器在涨、进程不换」的缺陷现场），且旧进程仍持 workspace 锁时新会话
        // 必然起不来（jdtls 的 `-data`）。序列有界且 await 收口后才返回。
        self.close_session_for_restart(project_path, language_id)
            .await;

        // Spawn session creation on the business AppRuntime blocking pool
        let this = Arc::clone(self);
        let pp = project_path.to_string();
        let lid = language_id.to_string();
        self.runtime
            .spawn_blocking(move || this.get_or_create_session(&pp, &lid, None))
            .await
            .map_err(|e| AppError::Lsp(format!("spawn_blocking join error: {}", e)))??;

        // 接账 streak：`prev_count` 是关闭前读到的值 —— 重启走 `take_session`
        // （不清 streak），而 `set_restart_count` 是**绝对值**写入，两条路径（清 / 不清）
        // 下都能把本次失败接上同一 episode。不能改成自增：一旦关闭序列里再新增清理，
        // 自增会让崩溃循环永远从 1 开始、`MAX_RESTART_COUNT` 形同虚设。
        self.session_store
            .set_restart_count(&key, prev_count.saturating_add(1));

        // Get session ingredients for the request
        if let Some((pending, writer, inflight, budget)) =
            self.session_store.with_session(&key, |s| {
                (
                    Arc::clone(&s.pending),
                    s.writer.clone(),
                    Arc::clone(&s.inflight),
                    s.request_timeout,
                )
            })
        {
            let value =
                do_send_request(pending, writer, inflight, method, params, is_probe, budget)
                    .await
                    .map_err(|e| AppError::Lsp(e.to_string()))?;
            // 重试成功同样是「会话可用」的证明 ⇒ streak 归零。
            self.session_store.clear_restart(&key);
            Ok(value)
        } else {
            Err(AppError::Lsp(format!(
                "Failed to create LSP session: {}",
                key
            )))
        }
    }

    /// Send an LSP notification to a session.
    pub fn send_notification(
        &self,
        project_path: &str,
        language_id: &str,
        method: &str,
        params: Value,
    ) -> Result<(), AppError> {
        let key = session_key(project_path, language_id);
        self.session_store
            .with_session(&key, |session| {
                session
                    .send_notification_raw(method, params)
                    .map_err(|e| AppError::Lsp(e.to_string()))
            })
            .unwrap_or_else(|| Err(AppError::Lsp(format!("No LSP session for: {}", key))))
    }

    /// Close an LSP session for a project and language.
    ///
    /// 宣告结束：前端收到 `stopped` 即清该项目的诊断副本（design.md M1 矩阵）。
    ///
    /// 接收器是 `&Arc<Self>`：关闭序列要拿 per-key 创建门并在阻塞池里跑完才释放，
    /// 门本身活在 manager 上（`creation_locks`），阻塞任务需要一份 `Arc` 才能持有它。
    pub fn close_session(
        self: &Arc<Self>,
        project_path: &str,
        language_id: &str,
    ) -> Result<(), AppError> {
        self.close_session_impl(project_path, language_id, SessionCloseNotice::Announce);
        Ok(())
    }

    /// 重启专用关闭：落终态、**不宣告** `stopped`、**保留**文档登记与所有权，且
    /// **等关闭序列收口**再返回。
    ///
    /// 第一性原理：`stopped` 是"该语言的会话就此结束"的宣告；而重启是**替换**——
    /// 该语言的服务从未真正缺席。若中途宣告结束：① 状态栏 chip 被过滤掉（stopped
    /// 不展示）再被 starting 拉起，用户看到闪断（jdtls 重启可达数十秒）；② 前端
    /// 把诊断整块清空，出现"旧会话已清、新会话未报"的空窗。终态仍必须落：reader
    /// 线程随后退出不得被误判为崩溃（否则闪 error）。
    ///
    /// **为何必须 await**：调用方紧接着创建新会话，而 LSP 服务器共享磁盘上的会话
    /// 数据目录（jdtls 的 `-data` 带 workspace 锁）。不等旧进程退出就建新的，等于
    /// 让两个 jdtls 抢同一把锁 —— 新会话必然起不来。序列本身有界，所以等待有界。
    pub async fn close_session_for_restart(&self, project_path: &str, language_id: &str) {
        let Some(session) =
            self.take_for_close(project_path, language_id, SessionCloseNotice::Silent)
        else {
            return;
        };
        if let Err(e) = self
            .runtime
            .spawn_blocking(move || shutdown_and_exit(session))
            .await
        {
            log::warn!("[LSP] Restart close task failed for {project_path}:{language_id}: {e}");
        }
    }

    /// 从 store 摘除会话并落终态（不跑序列）。
    ///
    /// 终态必须先于序列落下：reader 线程随后退出据此静默，否则优雅关闭会闪 error。
    ///
    /// **摘除粒度按 notice 分派**（这是「替换」与「结束」的差异所在）：
    /// - `Announce`（用户 stop / 项目停用）→ `close_session`：登记表 / 所有权 /
    ///   streak 全清，下次打开重新 didOpen。
    /// - `Silent`（重启 / 崩溃重试）→ `take_session`：**只摘会话对象**，登记表与
    ///   所有权活到新会话 —— 否则新会话建好后的 `reopen_documents` 恒重放 0 条
    ///   （服务器端文档消失 ⇒ 无诊断无补全），且所有权守卫失效（后端会按磁盘文本
    ///   代开编辑器里的未保存缓冲区 ⇒ 诊断坐标整体错位）。
    fn take_for_close(
        &self,
        project_path: &str,
        language_id: &str,
        notice: SessionCloseNotice,
    ) -> Option<LspSession> {
        let key = session_key(project_path, language_id);
        let session = match notice {
            SessionCloseNotice::Announce => self.session_store.close_session(&key),
            SessionCloseNotice::Silent => self.session_store.take_session(&key),
        }?;
        match notice {
            SessionCloseNotice::Announce => session.close(),
            // 静默替换：相位落终态（reader 退出据此静默），事件刻意不发。
            SessionCloseNotice::Silent => session.close_silently(),
        };
        Some(session)
    }

    fn close_session_impl(
        self: &Arc<Self>,
        project_path: &str,
        language_id: &str,
        notice: SessionCloseNotice,
    ) {
        let key = session_key(project_path, language_id);
        let this = Arc::clone(self);
        let project_path = project_path.to_string();
        let language_id = language_id.to_string();
        // 序列本体在 [`shutdown_and_exit`]（唯一实现）；阻塞只能在阻塞线程里。
        //
        // **持 per-key 创建门**（与 `get_or_create_session` 慢路径同一把）：
        // `take_for_close` 把会话从 store 摘除，而摘除就等于向后续请求宣告「可以重建
        // 了」。若不等序列收口就放行创建，新服务器会在旧进程仍持 workspace 锁时
        // spawn（jdtls 的两个实例抢同一把 `-data` 锁 → 新会话 initialize 无响应）。
        // 门必须在 `take_for_close` **之前**拿：否则「摘除 → 抢门」之间仍有窗口。
        self.runtime.spawn_blocking(move || {
            let gate = this.creation_gate(&key);
            let _gate_guard = gate.lock();
            if let Some(session) = this.take_for_close(&project_path, &language_id, notice) {
                shutdown_and_exit(session);
            }
            // `_gate_guard` 随闭包结束（= 序列收口后）释放。
        });
    }

    /// Close every LSP session belonging to `project_path`.
    ///
    /// 每个 key 各自持**创建门**（与 `get_or_create_session` 同一把）跑完序列，
    /// 保证「停用 → 立刻重开」不会让新旧服务器在同一个 workspace 锁上相遇
    /// （审计 lifecycle #3）。
    pub fn close_sessions_for_project(self: &Arc<Self>, project_path: &str) {
        let languages = self
            .session_store
            .session_language_ids_for_project(project_path);

        if !languages.is_empty() {
            let this = Arc::clone(self);
            let project_path_owned = project_path.to_string();
            // 串行复用同一条有界序列：并发关闭只会把多个 JVM 的 checkpoint 挤在同一窗口。
            self.runtime.spawn_blocking(move || {
                for language_id in languages {
                    let key = session_key(&project_path_owned, &language_id);
                    let gate = this.creation_gate(&key);
                    let gate_guard = gate.lock();
                    // 优雅关闭（项目停用）：落终态 + 发 `stopped`（同 close_session）。
                    if let Some(session) = this.take_for_close(
                        &project_path_owned,
                        &language_id,
                        SessionCloseNotice::Announce,
                    ) {
                        shutdown_and_exit(session);
                    }
                    drop(gate_guard);
                }
            });
        }

        if let Ok(mut profiles) = self.profiles.lock() {
            profiles.remove(project_path);
        }
        // 确定性驱逐（与 `profiles.remove` 同一调用点，单点清理）：该项目的诊断键
        // 全部摘除；此后旧句柄的迟到写入落进孤儿条目，不会复活键（生代隔离）。
        self.attempt_diag.evict_project(project_path);
        log::info!(
            "[LSP] Closed all sessions for deactivated project: {}",
            project_path
        );
    }

    /// Invalidate any pending deactivate timer for this project.
    pub fn cancel_deactivate(&self, project_path: &str) {
        if let Ok(mut gens) = self.deactivate_gens.lock() {
            let entry = gens.entry(project_path.to_string()).or_insert(0);
            *entry = entry.saturating_add(1);
        }
        log::debug!("[LSP] Cancelled deactivate timer for {}", project_path);
    }

    /// After leaving a project, schedule session teardown in DEACTIVATE_STOP_SECS.
    pub fn schedule_deactivate(self: &Arc<Self>, project_path: String) {
        let my_gen = {
            if let Ok(mut gens) = self.deactivate_gens.lock() {
                let entry = gens.entry(project_path.clone()).or_insert(0);
                *entry = entry.saturating_add(1);
                *entry
            } else {
                0
            }
        };

        let stop_secs = self
            .deactivate_stop_secs
            .lock()
            .map(|x| *x)
            .unwrap_or(DEFAULT_DEACTIVATE_STOP_SECS);
        let this = Arc::clone(self);
        let pp = project_path.clone();
        self.runtime.spawn(async move {
            tokio::time::sleep(Duration::from_secs(stop_secs)).await;
            let current = this
                .deactivate_gens
                .lock()
                .map(|g| g.get(&pp).copied().unwrap_or(0))
                .unwrap_or(0);
            if current == my_gen {
                this.close_sessions_for_project(&pp);
            }
        });
        log::info!(
            "[LSP] Scheduled deactivate in {}s for project {}",
            stop_secs,
            project_path
        );
    }

    /// Broadcast the detected language profile to the frontend.
    ///
    /// 无 `AppHandle`（测试 / 早期启动）、锁中毒或 emit 失败都只记日志 —— 广播是尽力
    /// 而为，不得中断项目激活流程。
    fn emit_profile(&self, profile: &ProjectLanguageProfile) {
        let Ok(handle) = self.app_handle.lock() else {
            log::warn!("[LSP] app_handle lock poisoned; profile event skipped");
            return;
        };
        let Some(app) = handle.as_ref() else {
            return;
        };
        if let Err(e) = app.emit(LSP_PROFILE_EVENT, profile) {
            log::warn!("[LSP] Failed to emit global profile event: {e}");
        }
    }

    /// Detect profile, cancel stop timer, emit profile event. Call when project becomes active.
    pub fn activate_project(
        self: &Arc<Self>,
        project_path: &str,
        primary_override: Option<&str>,
    ) -> ProjectLanguageProfile {
        self.cancel_deactivate(project_path);
        let markers = self.plugin_manager.detection_markers();
        let profile = detect_project_profile_with_markers(project_path, &markers, primary_override);
        if let Ok(mut map) = self.profiles.lock() {
            map.insert(project_path.to_string(), profile.clone());
        }

        self.emit_profile(&profile);

        if let Some(ref primary) = profile.primary {
            let policy = self.plugin_manager.resolve_auto_start(&primary.language_id);
            // 文档定根的插件必须等文档打开（会话根按文档所在工程解析），故此处不启动。
            // 判据取自插件数据，manager 不按语言名分支。
            let needs_document = self
                .plugin_manager
                .resolve_by_language(&primary.language_id)
                .is_some_and(|p| p.root_scope.walk_markers().is_some());
            if policy == LspAutoStart::OnProjectSelect && !needs_document {
                let this = Arc::clone(self);
                let pp = project_path.to_string();
                let lid = primary.language_id.clone();
                self.runtime.spawn_blocking(move || {
                    if let Err(e) = this.get_or_create_session(&pp, &lid, None) {
                        log::warn!(
                            "[LSP] onProjectSelect failed to start {} for {}: {}",
                            lid,
                            pp,
                            e
                        );
                    }
                });
            }
        }

        log::info!(
            "[LSP] Project profile for {}: primary={:?} candidates={}",
            project_path,
            profile.primary.as_ref().map(|p| &p.language_id),
            profile.candidates.len()
        );
        profile
    }

    /// Cached profile if available.
    pub fn get_profile(&self, project_path: &str) -> Option<ProjectLanguageProfile> {
        self.profiles
            .lock()
            .ok()
            .and_then(|m| m.get(project_path).cloned())
    }

    /// Close all active LSP sessions（**应用退出**路径）。
    ///
    /// 与其它入口共用同一条序列，但预算与时机不同：
    /// 1. **同步跑完**：上层 `run_cleanup_and_exit` 在 join 完所有清理任务后立刻
    ///    `process::exit(0)`，在这里 spawn 出去的工作根本来不及跑（"退出即硬杀"
    ///    就是这么形成的）；本函数已经在专用 `shutdown-lsp` 线程上，可以阻塞。
    /// 2. **共享总预算**：退出不能被 `N × 2 × grace` 拖住（jdtls 单个就 20s），
    ///    按剩余时间切片；预算用尽则兜底 kill（磁盘上的 workspace 宁可下次重建，
    ///    也不能让用户等半分钟退出）。
    pub fn close_all_sessions(&self) {
        let sessions = self.session_store.close_all();
        if sessions.is_empty() {
            return;
        }
        let started = std::time::Instant::now();
        let deadline = started + APP_QUIT_GRACE_BUDGET;
        for session in sessions {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                let mut session = session;
                log::warn!(
                    "[LSP] quit budget exhausted; killing {}:{}",
                    session.project_path,
                    session.language_id
                );
                session.kill_child();
                continue;
            }
            let budget = session.shutdown_grace.min(remaining);
            shutdown_and_exit_with(session, budget);
        }
        log::info!(
            "[LSP] Closed all sessions for app exit in {:?}",
            started.elapsed()
        );
    }

    /// List all active LSP sessions.
    pub fn list_sessions(&self) -> Vec<LspSessionInfo> {
        self.session_store.list()
    }

    /// Runtime metadata for a session.
    ///
    /// 纯查询：会话不存在（从未尝试 / 启动失败）时返回 `unknown` 形态 + 该键的
    /// 最近一次尝试终态（`outcome`），**不**返回 `Err` —— 证据宿主是身份键，
    /// 不随进程存活与否变化。
    pub fn get_server_info(
        &self,
        project_path: &str,
        language_id: &str,
    ) -> Result<LspServerInfo, AppError> {
        let key = session_key(project_path, language_id);
        let outcome = self.attempt_diag.with(&key, |d| d.outcome()).flatten();
        let mut info = self
            .session_store
            .with_session(&key, |s| s.snapshot_server_info())
            .unwrap_or_else(LspServerInfo::unknown);
        info.outcome = outcome;
        Ok(info)
    }

    /// Recent stderr log lines for a key (newest last) —— 该键**最近一次启动尝试**
    /// 的证据（未尝试过 → 空数组，不返回 `Err`）。
    ///
    /// 载荷封顶落在本入口（红线 4 的唯一落实点）：条数 + 字节双预算，超预算丢更旧的。
    pub fn get_server_logs(
        &self,
        project_path: &str,
        language_id: &str,
        limit: Option<usize>,
    ) -> Result<Vec<LspServerLogEntry>, AppError> {
        let key = session_key(project_path, language_id);
        Ok(self
            .attempt_diag
            .with(&key, |d| {
                d.snapshot_logs(limit.unwrap_or(500), LSP_SERVER_LOGS_MAX_BYTES)
            })
            .unwrap_or_default())
    }

    /// Language ids of all active sessions for a project path.
    pub fn session_language_ids_for_project(&self, project_path: &str) -> Vec<String> {
        self.session_store
            .session_language_ids_for_project(project_path)
    }

    /// Stop every active session for a project (keeps profile cache).
    pub fn stop_all_sessions_for_project(self: &Arc<Self>, project_path: &str) {
        let languages = self
            .session_store
            .session_language_ids_for_project(project_path);
        for lid in languages {
            let _ = self.close_session(project_path, &lid);
        }
    }

    /// Get cached server capabilities for a session.
    pub fn get_capabilities(&self, project_path: &str, language_id: &str) -> Option<Value> {
        let key = session_key(project_path, language_id);
        self.session_store
            .with_session(&key, |s| s.server_capabilities.clone())
    }

    /// Resolve a file path to an LSP language id via extension lookup.
    #[must_use]
    pub fn language_for_path(path: &str) -> Option<String> {
        let ext = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let registry = LspPluginRegistry::with_defaults();
        registry
            .resolve_by_extension(ext)
            .map(|p| p.language_id.to_string())
    }
}

impl Default for LspManager {
    fn default() -> Self {
        Self::new_default()
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsp::attempt_diagnostics::AttemptDiagnostics;
    use crate::lsp::plugin::CustomLspServerConfig;
    use crate::lsp::session::lifecycle::Lifecycle;
    use crate::lsp::session::status::LspSessionStatus;
    use crate::lsp::session::testing::{live_stub_session, LiveReader, RecordingTransport};
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn test_session_key() {
        let key = session_key("/home/user/project", "rust");
        assert_eq!(key, "/home/user/project:rust");
    }

    #[test]
    fn test_restart_delay() {
        let d0 = compute_restart_delay(0, 500);
        assert_eq!(d0, Duration::from_millis(500));
        let d2 = compute_restart_delay(2, 500);
        assert_eq!(d2, Duration::from_millis(2000));
        let d4 = compute_restart_delay(4, 500);
        assert_eq!(d4, Duration::from_millis(8000));
    }

    /// 缺会话 / 未启动 → 无在途进度（能力探测据此把空 classpath 判为硬错误
    /// 而不是 `Warming`，避免把损坏工程拖成超时错误）。
    #[test]
    fn has_inflight_progress_is_false_without_session() {
        let manager = LspManager::new_default();
        assert!(!manager.has_inflight_progress("/no/such/project", "java"));
    }

    /// **观察请求的护栏**：不得重启、不得新建会话、不得消耗重启预算。
    ///
    /// 反例后果（修复前的行为）：能力探测失败走重启通道 → 每点一次 Debug 就重启 jdtls
    /// 并累加 `restart_count`，5 次后该项目 Java LSP 永久不可用（`MAX_RESTART_COUNT`）。
    #[tokio::test]
    async fn observation_request_never_restarts_or_spends_the_budget() {
        let manager = Arc::new(LspManager::new_default());
        let key = session_key("/no/such/project", "java");
        let before = manager.session_store.restart_count(&key);

        let err = manager
            .send_request_observed(
                "/no/such/project",
                "java",
                "workspace/executeCommand",
                serde_json::json!({ "command": "vscode.java.startDebugSession" }),
            )
            .await
            .expect_err("no live session must fail");
        assert!(err.to_string().contains("was not retried"), "{err}");
        assert_eq!(
            manager.session_store.restart_count(&key),
            before,
            "观察请求不得消耗重启预算"
        );
        assert!(
            manager.session_store.with_session(&key, |_| ()).is_none(),
            "观察请求不得新建会话"
        );
    }

    #[test]
    fn test_should_restart_within_limit() {
        assert!(should_restart(0, 5));
        assert!(should_restart(4, 5));
        assert!(!should_restart(5, 5));
        assert!(!should_restart(10, 5));
    }

    #[test]
    fn test_language_for_path_via_registry() {
        assert_eq!(
            LspManager::language_for_path("/some/path/main.rs"),
            Some("rust".to_string())
        );
        assert_eq!(
            LspManager::language_for_path("/some/path/app.py"),
            Some("python".to_string())
        );
        assert_eq!(LspManager::language_for_path("/some/path/no_ext"), None);
    }

    #[test]
    fn test_plugin_registry_integration() {
        let manager = LspManager::new_default();
        assert!(manager.plugin_manager.resolve_by_language("rust").is_some());
        assert!(manager
            .plugin_manager
            .resolve_by_language("python")
            .is_some());
        assert!(manager.plugin_manager.resolve_by_language("go").is_some());
    }

    #[test]
    fn test_diag_bus_creation() {
        let manager = LspManager::new_default();
        assert_eq!(manager.diag_bus().subscriber_count(), 0);
    }

    #[test]
    fn should_resolve_language_from_live_registry_including_custom() {
        let manager = LspManager::new_default();
        assert_eq!(
            manager.resolve_language_for_path("/repo/main.go"),
            Some("go".into())
        );
        manager.register_plugin(LspPlugin::from_custom(&CustomLspServerConfig {
            id: "proto".into(),
            language_id: "protobuf".into(),
            display_name: None,
            command: vec!["buf".into(), "lsp".into()],
            file_extensions: vec!["proto".into()],
            root_markers: vec![],
            auto_start: None,
            initialization_options: None,
        }));
        assert_eq!(
            manager.resolve_language_for_path("api/v1.proto"),
            Some("protobuf".into())
        );
    }

    #[test]
    fn test_custom_plugin_registration() {
        let manager = LspManager::new_default();
        manager.register_plugin(LspPlugin::from_custom(&CustomLspServerConfig {
            id: "testlang".into(),
            language_id: "testlang".into(),
            display_name: None,
            command: vec!["test-lsp".into()],
            file_extensions: vec!["tl".into()],
            root_markers: vec![],
            auto_start: None,
            initialization_options: None,
        }));
        assert!(manager
            .plugin_manager
            .resolve_by_language("testlang")
            .is_some());
    }

    #[test]
    fn test_session_info_has_status_field() {
        let info = LspSessionInfo {
            language_id: "rust".into(),
            project_path: "/test".into(),
            server_name: "rust-analyzer".into(),
            status: "ready".into(),
            status_message: None,
            progress_pct: None,
        };
        assert_eq!(info.status, "ready");
        assert_eq!(info.language_id, "rust");
    }

    #[test]
    fn test_session_info_serialization_includes_status() {
        let info = LspSessionInfo {
            language_id: "go".into(),
            project_path: "/workspace".into(),
            server_name: "gopls".into(),
            status: "starting".into(),
            status_message: None,
            progress_pct: None,
        };
        let json = serde_json::to_string(&info).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["status"].as_str(), Some("starting"));
        assert_eq!(parsed["connected"].as_bool(), None);
        assert!(parsed.get("connected").is_none());
    }
    #[test]
    fn creation_gate_same_key_returns_shared_arc() {
        let manager = LspManager::new_default();
        let a = manager.creation_gate("proj:rust");
        let b = manager.creation_gate("proj:rust");
        assert!(Arc::ptr_eq(&a, &b), "same key must share one gate");
    }

    #[test]
    fn creation_gates_are_isolated_per_key() {
        let manager = LspManager::new_default();
        let a = manager.creation_gate("proj:rust");
        let b = manager.creation_gate("proj:java");
        assert!(!Arc::ptr_eq(&a, &b), "different keys must not share a gate");
    }

    /// Models `get_or_create_session`'s double-checked shape against the gate:
    /// fast miss → hold per-key gate → recheck → create once. Without the
    /// gate the critical sections overlap (`max_active > 1`) and the counter
    /// exceeds 1 — the duplicate-jdtls-spawn race.
    #[test]
    fn creation_gate_serializes_concurrent_creation() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let manager = Arc::new(LspManager::new_default());
        let slot = Arc::new(parking_lot::Mutex::new(None::<String>));
        let active = Arc::new(AtomicUsize::new(0));
        let max_active = Arc::new(AtomicUsize::new(0));
        let creations = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let manager = Arc::clone(&manager);
                let slot = Arc::clone(&slot);
                let active = Arc::clone(&active);
                let max_active = Arc::clone(&max_active);
                let creations = Arc::clone(&creations);
                std::thread::spawn(move || {
                    if slot.lock().is_some() {
                        return; // fast path: already created
                    }
                    let gate = manager.creation_gate("proj:rust");
                    let _guard = gate.lock();
                    if slot.lock().is_some() {
                        return; // recheck under gate: loser returns
                    }
                    let cur = active.fetch_add(1, Ordering::SeqCst) + 1;
                    max_active.fetch_max(cur, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(5));
                    *slot.lock() = Some("proj:rust".to_string());
                    creations.fetch_add(1, Ordering::SeqCst);
                    active.fetch_sub(1, Ordering::SeqCst);
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        // 判据写成「至少一次 + 不超过一次」而不是 `== 1`：本文件含 `wait_until`
        // （重新装配 / 门收口的观察窗），被 `check_nondeterministic_event_assertions`
        // 纳入非确定性域 —— 域内禁止观察者读取与整数字面量做相等断言。
        // 语义等价且更强：`> 0` 证明真的跑了，`<= 1` 证明没有重叠 / 重复装配。
        let max_active = max_active.load(Ordering::SeqCst);
        assert!(
            max_active > 0,
            "临界区必须真的被进入过（否则用例什么都没测）"
        );
        assert!(
            max_active <= 1,
            "creation critical sections must not overlap（观测到 {max_active} 个并发）"
        );
        let creations = creations.load(Ordering::SeqCst);
        assert!(creations > 0, "同 key 并发创建必须至少发生一次");
        assert!(
            creations <= 1,
            "concurrent same-key creation must happen exactly once（观测到 {creations} 次）"
        );
    }

    /// Slow-path errors must release the gate: concurrent same-key failures
    /// (unknown language → no spawn attempted) all return, and a follow-up
    /// call still proceeds instead of deadlocking on a wedged gate.
    #[test]
    fn concurrent_failed_creation_never_wedges_gate() {
        let manager = Arc::new(LspManager::new_default());
        let handles: Vec<_> = (0..4)
            .map(|_| {
                let manager = Arc::clone(&manager);
                std::thread::spawn(move || {
                    manager
                        .get_or_create_session("/test/project", "no-such-lang-xyz", None)
                        .is_err()
                })
            })
            .collect();
        // 逐线程取回结果而不是累加全局计数：判据是「每个并发调用都返回 Err」，
        // 而不是「恰好失败 N 次」（后者在真实源类断言里是绝对零 / 精确集合同罪）。
        let all_failed: Vec<bool> = handles
            .into_iter()
            .map(|h| h.join().expect("creator thread"))
            .collect();
        assert!(
            all_failed.iter().all(|failed| *failed),
            "并发失败创建必须每个都返回 Err（挂死或成功都不行）: {all_failed:?}"
        );
        assert!(manager
            .get_or_create_session("/test/project", "no-such-lang-xyz", None)
            .is_err());
    }

    /// Known language without AppHandle fails after the gate (no spawn), and
    /// the gate is released so the next call proceeds identically.
    #[test]
    fn get_or_create_without_app_handle_errors_and_releases_gate() {
        let manager = LspManager::new_default();
        assert!(manager
            .get_or_create_session("/test/project", "rust", None)
            .is_err());
        assert!(manager
            .get_or_create_session("/test/project", "rust", None)
            .is_err());
    }

    // ── M2 会话健康度：停止路径（design.md M2：进程退出 → stopped）──

    /// 测试用会话身份（store 键 + 事件断言共用，避免散落字面量漂移）。
    const TEST_PROJECT: &str = "/tmp/proj";
    const TEST_LANG: &str = "go";
    const TEST_SERVER: &str = "gopls";

    /// 本项目桩会话（复用 session 域共享夹具，字段变更只改夹具一处）。
    fn stub_session(transport: Arc<dyn LspTransport>) -> LspSession {
        crate::lsp::session::testing::stub_session(transport, TEST_PROJECT, TEST_LANG, TEST_SERVER)
    }

    /// 构造一个无真实进程的 go 会话并插入 store（生命周期初始 Ready）。
    ///
    /// 返回生命周期句柄：会话被 close 路径接管（move 进 spawn_blocking）后，外部
    /// 只能靠共享 Arc 观察「是否已落终态」，这是关闭路径的关键不变量。
    fn insert_test_session(
        manager: &LspManager,
        transport: Arc<dyn LspTransport>,
    ) -> Arc<Lifecycle> {
        insert_test_session_with_writer(manager, transport).0
    }

    /// 同上，但把 writer 接收端也交出来：关闭序列的**报文时序**必须可断言。
    fn insert_test_session_with_writer(
        manager: &LspManager,
        transport: Arc<dyn LspTransport>,
    ) -> (
        Arc<Lifecycle>,
        crossbeam_channel::Receiver<lsp_server::Message>,
    ) {
        let (session, writer_rx) = crate::lsp::session::testing::stub_session_with_writer(
            transport,
            TEST_PROJECT,
            TEST_LANG,
            TEST_SERVER,
        );
        let lifecycle = Arc::clone(&session.lifecycle);
        manager
            .session_store
            .insert(session_key(TEST_PROJECT, TEST_LANG), session);
        (lifecycle, writer_rx)
    }

    /// 项目停用（优雅关闭）必须落终态并推 `stopped` 事件（前端据此清诊断）。
    ///
    /// 关闭序列现持 per-key 创建门、在阻塞池里跑（T0-3），因此终态与事件由该任务产生：
    /// 断言等它收口（有界等待，不堆真实秒数）。
    #[test]
    fn close_sessions_for_project_emits_stopped() {
        let manager = Arc::new(LspManager::new_default());
        let transport = Arc::new(RecordingTransport::default());
        let lifecycle =
            insert_test_session(&manager, Arc::clone(&transport) as Arc<dyn LspTransport>);

        manager.close_sessions_for_project(TEST_PROJECT);

        assert!(
            wait_until(|| transport.has(TEST_PROJECT, TEST_LANG, "stopped")),
            "close_sessions_for_project 必须推 stopped 事件: {:?}",
            transport.take()
        );
        assert!(
            wait_until(|| lifecycle.status(TEST_SERVER) == LspSessionStatus::Stopped),
            "close_sessions_for_project 必须先落终态：reader 退出据此静默，否则优雅关闭会闪错误"
        );
    }

    // ── 关闭序列（11-12-lsp-graceful-shutdown）────────────────────────────

    /// 报文标签：`request:<method>` / `notification:<method>`。
    fn label(message: &lsp_server::Message) -> String {
        match message {
            lsp_server::Message::Request(r) => format!("request:{}", r.method),
            lsp_server::Message::Notification(n) => format!("notification:{}", n.method),
            lsp_server::Message::Response(r) => format!("response:{:?}", r.id),
        }
    }

    /// 从 writer 接收端取前 `n` 条报文（超时即失败），并确认其后**再无**报文。
    fn take_sequence(
        rx: &crossbeam_channel::Receiver<lsp_server::Message>,
        n: usize,
        context: &str,
    ) -> Vec<String> {
        let mut out = Vec::with_capacity(n);
        for _ in 0..n {
            let message = rx
                .recv_timeout(Duration::from_secs(5))
                .unwrap_or_else(|e| panic!("{context}: 缺少第 {} 条报文（{e}）", out.len() + 1));
            out.push(label(&message));
        }
        assert!(
            rx.try_recv().is_err(),
            "{context}: 关闭序列只允许这两条报文，实际多出 {:?}",
            rx.try_recv()
        );
        out
    }

    /// 项目停用必须按 LSP 规范顺序：`shutdown` **request** → 等响应 → `exit` notification。
    ///
    /// 事故形态：旧实现用 `send_notification_raw` 把 `shutdown` 当 notification 发、
    /// `sleep(10ms)` 后 `kill`，
    /// jdtls 的 Eclipse workspace checkpoint 因此被 SIGKILL 截断，下次启动
    /// `Application error` 直接退出（现场见 11-12 任务 research）。
    #[test]
    fn project_deactivate_follows_protocol_order() {
        let manager = Arc::new(LspManager::new_default());
        let transport = Arc::new(RecordingTransport::default());
        let (_lifecycle, writer_rx) = insert_test_session_with_writer(
            &manager,
            Arc::clone(&transport) as Arc<dyn LspTransport>,
        );

        manager.close_sessions_for_project(TEST_PROJECT);

        let sequence = take_sequence(&writer_rx, 2, "项目停用");
        assert_eq!(
            sequence,
            vec!["request:shutdown".to_string(), "notification:exit".to_string()],
            "项目停用必须发 shutdown request → exit notification（不得以 notification 发 shutdown、\
             也不得跳过等待直接 exit）"
        );
    }

    /// R1/AC1 的数据化表达：单会话关闭与项目停用**走同一条**关闭序列。
    ///
    /// 两条入口各自拼装是本次事故的结构性原因（一条发 request、另一条发 notification）。
    #[test]
    fn both_close_paths_emit_the_same_protocol_sequence() {
        let manager_single = Arc::new(LspManager::new_default());
        let transport_single = Arc::new(RecordingTransport::default());
        let (_lc, rx_single) = insert_test_session_with_writer(
            &manager_single,
            Arc::clone(&transport_single) as Arc<dyn LspTransport>,
        );
        manager_single
            .close_session(TEST_PROJECT, TEST_LANG)
            .expect("close_session");
        let single = take_sequence(&rx_single, 2, "单会话关闭");

        let manager_project = Arc::new(LspManager::new_default());
        let transport_project = Arc::new(RecordingTransport::default());
        let (_lc, rx_project) = insert_test_session_with_writer(
            &manager_project,
            Arc::clone(&transport_project) as Arc<dyn LspTransport>,
        );
        manager_project.close_sessions_for_project(TEST_PROJECT);
        let project = take_sequence(&rx_project, 2, "项目停用");

        assert_eq!(
            single, project,
            "两条关闭入口必须走同一个实现（否则迟早再漂移出一条硬杀路径）"
        );
    }

    /// `exit` 必须等 `shutdown` **响应**到达之后才发：先发 `exit` 等于宣告「我不等你」，
    /// 服务器会认为会话被强拆。
    #[test]
    fn exit_is_withheld_until_shutdown_response_arrives() {
        let transport = Arc::new(RecordingTransport::default());
        let (mut session, writer_rx) = crate::lsp::session::testing::stub_session_with_writer(
            Arc::clone(&transport) as Arc<dyn LspTransport>,
            TEST_PROJECT,
            TEST_LANG,
            TEST_SERVER,
        );
        // 响应超时窗口拉大到 5s：负面断言需要一个**真实**的观察窗，而夹具默认的
        // 20ms 宽限会在窗口内自主超时并发出 `exit`，把这条断言变成恒假。
        session.shutdown_grace = Duration::from_secs(5);
        let pending = Arc::clone(&session.pending);

        let handle = std::thread::spawn(move || shutdown_and_exit(session));

        let first = writer_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("必须发出 shutdown request");
        assert_eq!(label(&first), "request:shutdown");
        // shutdown 的 id 由唯一 allocator 分配（不再硬编码 1000），只能从报文里取。
        let id = match &first {
            lsp_server::Message::Request(req) => req.id.clone(),
            other => panic!("shutdown 必须以 request 形式发出: {other:?}"),
        };
        // 观察窗而非瞬时快照：瞬时 `try_recv` 在「实现立刻发 exit」时几乎必然
        // 通过（exit 还在路上），等于没断言。
        assert!(
            matches!(
                writer_rx.recv_timeout(Duration::from_millis(100)),
                Err(crossbeam_channel::RecvTimeoutError::Timeout)
            ),
            "响应未到达前不得发 exit（否则等于不等服务器响应）"
        );

        let responder = pending
            .lock()
            .expect("pending lock")
            .remove(&id)
            .expect("shutdown 的发送端必须在 pending 里等响应");
        responder
            .send(lsp_server::Message::Response(lsp_server::Response {
                id: id.clone(),
                result: Some(serde_json::json!({})),
                error: None,
            }))
            .expect("送响应");

        let second = writer_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("响应到达后必须发 exit");
        assert_eq!(label(&second), "notification:exit");

        handle.join().expect("关闭序列线程");
    }

    /// 已按协议退出的服务器**不得**再被强杀（旧实现无条件 `kill_child()`）。
    #[test]
    fn exited_server_is_not_killed() {
        let transport = Arc::new(RecordingTransport::default());
        let (mut session, _writer_rx) = crate::lsp::session::testing::stub_session_with_writer(
            Arc::clone(&transport) as Arc<dyn LspTransport>,
            TEST_PROJECT,
            TEST_LANG,
            TEST_SERVER,
        );
        let killed = Arc::new(AtomicBool::new(false));
        session.child = Some(crate::lsp::process::LspProcess::test_stub(
            true,
            Arc::clone(&killed),
        ));

        shutdown_and_exit(session);

        assert!(
            !killed.load(Ordering::SeqCst),
            "服务器已在宽限内自行退出时必须免于强杀（硬杀正是 checkpoint 截断的成因）"
        );
    }

    /// 卡死的服务器仍必须在宽限用尽后收口 —— 关闭路径不能因为「等不到退出」而永远挂着。
    #[test]
    fn hung_server_is_killed_after_grace() {
        let transport = Arc::new(RecordingTransport::default());
        let (mut session, _writer_rx) = crate::lsp::session::testing::stub_session_with_writer(
            Arc::clone(&transport) as Arc<dyn LspTransport>,
            TEST_PROJECT,
            TEST_LANG,
            TEST_SERVER,
        );
        session.shutdown_grace = Duration::from_millis(20);
        let killed = Arc::new(AtomicBool::new(false));
        session.child = Some(crate::lsp::process::LspProcess::test_stub(
            false,
            Arc::clone(&killed),
        ));

        let started = std::time::Instant::now();
        shutdown_and_exit(session);

        assert!(
            killed.load(Ordering::SeqCst),
            "宽限用尽仍存活的服务器必须被兜底 kill（否则留下持锁的孤儿进程）"
        );
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "关闭序列必须有界返回，实际 {:?}",
            started.elapsed()
        );
    }

    /// T0-2（审计 lifecycle #5 / channel D11）：退出预算是**总计**，不是每步各一份。
    ///
    /// 事故形态：`close_all_sessions` 算出剩余额度传给序列，而序列把同一个额度分别
    /// 喂给「等 shutdown 响应」与「等进程退出」⇒ 3s 预算实际可拖到 6s，兼底 kill 还在
    /// deadline 之外 —— 退出窗口的真实上界与代码声明不一致。
    #[test]
    fn exit_budget_is_a_total_not_per_step() {
        let transport = Arc::new(RecordingTransport::default());
        let (mut session, _writer_rx) = crate::lsp::session::testing::stub_session_with_writer(
            Arc::clone(&transport) as Arc<dyn LspTransport>,
            TEST_PROJECT,
            TEST_LANG,
            TEST_SERVER,
        );
        // 沉默服务器（无人回 shutdown 响应，writer 接收端被持有但不产生 Response）
        // + 永不退出的进程 ⇒ 两步各自都必须等满自己的额度。
        session.shutdown_grace = Duration::from_secs(30);
        let killed = Arc::new(AtomicBool::new(false));
        session.child = Some(crate::lsp::process::LspProcess::test_stub(
            false,
            Arc::clone(&killed),
        ));

        let started = std::time::Instant::now();
        shutdown_and_exit_with(session, Duration::from_millis(120));
        let elapsed = started.elapsed();

        assert!(
            killed.load(Ordering::SeqCst),
            "预算耗尽仍存活的服务器必须兜底 kill（否则留下持锁的孤儿进程）"
        );
        assert!(
            elapsed < Duration::from_millis(200),
            "120ms 预算必须是整个序列的总时长；按步各给一份会 >=240ms，实际 {elapsed:?}"
        );
    }

    /// 有界轮询等待（不堆真实秒数）：谓词成立返回 true，超时返回 false。
    fn wait_until(mut predicate: impl FnMut() -> bool) -> bool {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if predicate() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        predicate()
    }

    /// T0-3（审计 lifecycle #3 / orchestration §3）：关闭必须与创建共用 per-key 门。
    ///
    /// 事故形态：`close_session` 只把会话从 store 摘除，把序列丢给阻塞池就返回。
    /// 用户立刻敲键 → `ensure_session_async` 走慢路径 → **第二个 jdtls 在旧进程尚未
    /// 退出时 spawn**，两者抢同一把 `-data` workspace 锁 → 新会话 initialize 无响
    /// 应（正是本任务要消灭的现场，只是触发者从「硬杀」换成了「立刻重建」）。
    ///
    /// 判据：另起线程抢同一把创建门 —— 它只能在**序列收口之后**拿到门，即晚于
    /// `notification:exit` 被写下（并在进程退出宽限耗完之后）。
    #[test]
    fn stop_holds_the_creation_gate_until_the_sequence_finishes() {
        let key = session_key(TEST_PROJECT, TEST_LANG);
        let manager = Arc::new(LspManager::new_default());
        let transport = Arc::new(RecordingTransport::default());
        let (mut session, writer_rx) = crate::lsp::session::testing::stub_session_with_writer(
            Arc::clone(&transport) as Arc<dyn LspTransport>,
            TEST_PROJECT,
            TEST_LANG,
            TEST_SERVER,
        );
        let pending = Arc::clone(&session.pending);
        // 预算拉大是为了制造一个**可观察**的收口窗口：响应立即回，`exit` 写下后
        // 才开始等进程退出（假进程永不退）→ 门在这整段里必须一直被持有。
        session.shutdown_grace = Duration::from_millis(500);
        let killed = Arc::new(AtomicBool::new(false));
        session.child = Some(crate::lsp::process::LspProcess::test_stub(
            false,
            Arc::clone(&killed),
        ));
        manager.session_store.insert(key.clone(), session);

        manager
            .close_session(TEST_PROJECT, TEST_LANG)
            .expect("close_session");

        // 竞争者**必须晚于关闭序列持门才能启动**：先观测 `shutdown` request，
        // 它是在持门区间内写下的 ⇒ 此时门已被关闭序列拿下。先起竞争者会让它
        // 抢先拿到门（全量并跑时调度一抖动即翻红），那是测试自己在跟实现抢赛跑，
        // 断言的就不再是「门被持有到收口」。
        let first = writer_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("必须发出 shutdown request");
        assert_eq!(label(&first), "request:shutdown");
        // shutdown 的 id 由唯一 allocator 分配（不再硬编码 1000），只能从报文里取。
        let shutdown_id = match &first {
            lsp_server::Message::Request(req) => req.id.clone(),
            other => panic!("shutdown 必须以 request 形式发出: {other:?}"),
        };

        let gate = manager.creation_gate(&key);
        let acquired_at: Arc<Mutex<Option<std::time::Instant>>> = Arc::new(Mutex::new(None));
        let acquirer = {
            let gate = Arc::clone(&gate);
            let acquired_at = Arc::clone(&acquired_at);
            std::thread::spawn(move || {
                let _guard = gate.lock();
                if let Ok(mut slot) = acquired_at.lock() {
                    *slot = Some(std::time::Instant::now());
                }
            })
        };

        // ① 立刻回响应（让序列进到「等进程退出」阶段）。
        let responder = pending
            .lock()
            .expect("pending lock")
            .remove(&shutdown_id)
            .expect("shutdown 的发送端必须在 pending 里等响应");
        responder
            .send(lsp_server::Message::Response(lsp_server::Response {
                id: shutdown_id.clone(),
                result: Some(serde_json::json!({})),
                error: None,
            }))
            .expect("送响应");

        // ② `exit` 已写下，但序列还在等进程退出。
        let second = writer_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("响应到达后必须发 exit");
        assert_eq!(label(&second), "notification:exit");
        let exit_written_at = std::time::Instant::now();
        assert!(
            gate.try_lock().is_none(),
            "`exit` 已写下但进程退出宽限尚未耗完：per-key 门必须仍被关闭序列持有 \
             （否则新会话会在旧进程存活期内 spawn，两个服务器抢同一把 workspace 锁）"
        );

        // ③ 宽限用尽 → 兼底 kill → 序列收口 → 门才释放。
        assert!(
            wait_until(|| killed.load(Ordering::SeqCst)),
            "宽限用尽仍存活的服务器必须被兼底 kill"
        );
        assert!(
            wait_until(|| acquired_at.lock().is_ok_and(|slot| slot.is_some())),
            "关闭序列收口后必须释放 per-key 门（否则该 key 的创建永久卡住）"
        );
        let acquired = acquired_at
            .lock()
            .expect("acquired_at lock")
            .expect("acquired_at 已写入");
        assert!(
            acquired >= exit_written_at,
            "竞争者拿到门的时刻必须晚于 `exit` 写入: {acquired:?} < {exit_written_at:?}"
        );
        acquirer.join().expect("acquirer thread");
    }

    /// 单语言关闭（`lsp_restart_session` / `lsp_stop_session` / 状态栏崩溃重试按钮
    /// 都走这条）：与项目停用同构 —— 落终态 + 推 `stopped`。
    #[test]
    fn close_session_emits_stopped_and_marks_closed_terminal() {
        let manager = Arc::new(LspManager::new_default());
        let transport = Arc::new(RecordingTransport::default());
        let lifecycle =
            insert_test_session(&manager, Arc::clone(&transport) as Arc<dyn LspTransport>);

        manager.close_session(TEST_PROJECT, TEST_LANG).unwrap();

        assert!(
            wait_until(|| transport.has(TEST_PROJECT, TEST_LANG, "stopped")),
            "close_session 必须推 stopped 事件: {:?}",
            transport.take()
        );
        assert!(
            wait_until(|| lifecycle.status(TEST_SERVER) == LspSessionStatus::Stopped),
            "close_session 必须先落终态，否则 reader 线程随后退出会被误判为崩溃（error）"
        );
        assert!(
            wait_until(|| !manager
                .session_store
                .is_alive(&session_key(TEST_PROJECT, TEST_LANG))),
            "close_session 必须把会话从 store 摘除（否则 snapshot 会把已关闭会话报成 error）"
        );
    }

    /// 重启路径（`lsp_restart_session` / Restart All / 状态栏崩溃重试）走静默关闭：
    /// **不得**推 `stopped`。
    ///
    /// 第一性原理：`stopped` 是"该语言的会话就此结束"的宣告，前端据此清诊断；
    /// 而重启是**替换**——该语言的服务从未真正缺席。若中途宣告结束，状态栏 chip
    /// 会先被过滤掉（stopped 不展示）再被 starting 拉起，用户看到闪断（jdtls 重启
    /// 可达数十秒）。静默关闭仍必须落终态：reader 线程随后退出不得被误判为崩溃。
    #[tokio::test]
    async fn restart_close_is_silent_but_still_terminal() {
        let manager = LspManager::new_default();
        let transport = Arc::new(RecordingTransport::default());
        let lifecycle =
            insert_test_session(&manager, Arc::clone(&transport) as Arc<dyn LspTransport>);

        manager
            .close_session_for_restart(TEST_PROJECT, TEST_LANG)
            .await;

        assert!(
            transport.take().is_empty(),
            "重启关闭不得产生任何生命周期事件: {:?}",
            transport.take()
        );
        assert_eq!(
            lifecycle.status(TEST_SERVER),
            LspSessionStatus::Stopped,
            "静默关闭仍必须落终态（否则 reader 退出会被误判为崩溃 → 闪错误）"
        );
        assert!(
            !manager
                .session_store
                .is_alive(&session_key(TEST_PROJECT, TEST_LANG)),
            "静默关闭仍必须把会话从 store 摘除"
        );
    }

    /// 重启关闭必须**等到序列收口**才返回：调用方紧接着建新会话，而服务器共享
    /// 磁盘上的会话数据目录（jdtls 的 `-data` 带 workspace 锁）。不等收口就建新的，
    /// 等于让两个 jdtls 抢同一把锁 —— 新会话必然起不来。
    #[tokio::test]
    async fn restart_close_finishes_the_sequence_before_returning() {
        let manager = LspManager::new_default();
        let transport = Arc::new(RecordingTransport::default());
        let (_lifecycle, writer_rx) = insert_test_session_with_writer(
            &manager,
            Arc::clone(&transport) as Arc<dyn LspTransport>,
        );

        manager
            .close_session_for_restart(TEST_PROJECT, TEST_LANG)
            .await;

        // await 返回时序列已经跑完（不需要任何额外等待就能拿到两条报文）。
        let sequence = take_sequence(&writer_rx, 2, "重启关闭");
        assert_eq!(
            sequence,
            vec![
                "request:shutdown".to_string(),
                "notification:exit".to_string()
            ],
            "重启关闭必须在返回前完成 shutdown request → exit notification"
        );
    }

    /// 桩装配端口（带 writer 观察窗）：会话「造得出来」且出站报文可断言。
    ///
    /// `StubSessionFactory` 丢弃 writer 接收端（只验证编排是否走到装配），而重放
    /// 判据恰恰要看**报文内容**（哪些 uri、哪个版本、哪份文本）。
    struct WriterCapturingFactory {
        transport: Arc<RecordingTransport>,
        writers: Mutex<Vec<crossbeam_channel::Receiver<lsp_server::Message>>>,
    }

    impl WriterCapturingFactory {
        fn new(transport: Arc<RecordingTransport>) -> Self {
            Self {
                transport,
                writers: Mutex::new(Vec::new()),
            }
        }

        /// 最近一次装配的会话 writer 接收端。
        fn latest_writer(&self) -> crossbeam_channel::Receiver<lsp_server::Message> {
            self.writers
                .lock()
                .expect("writers lock")
                .pop()
                .expect("a session must have been built")
        }
    }

    impl SessionFactory for WriterCapturingFactory {
        fn transport(
            &self,
            _: Option<&tauri::AppHandle>,
        ) -> Result<Arc<dyn LspTransport>, AppError> {
            Ok(Arc::clone(&self.transport) as Arc<dyn LspTransport>)
        }

        fn build(&self, request: SessionBuildRequest<'_>) -> Result<LspSession, AppError> {
            let (session, rx) = crate::lsp::session::testing::stub_session_with_writer(
                request.transport,
                request.project_path,
                TEST_LANG,
                TEST_SERVER,
            );
            self.writers.lock().expect("writers lock").push(rx);
            Ok(session)
        }
    }

    /// writer 中的 didOpen 载荷：`(uri, version, text)`。
    fn did_open_payloads(
        rx: &crossbeam_channel::Receiver<lsp_server::Message>,
    ) -> Vec<(String, i64, String)> {
        rx.try_iter()
            .filter_map(|m| match m {
                lsp_server::Message::Notification(n) if n.method == "textDocument/didOpen" => {
                    let td = &n.params["textDocument"];
                    Some((
                        td["uri"].as_str()?.to_string(),
                        td["version"].as_i64()?,
                        td["text"].as_str()?.to_string(),
                    ))
                }
                _ => None,
            })
            .collect()
    }

    /// AC1 + AC2：重启后 `reopen_documents` 必须真的重放已打开文档，且登记版本不回退。
    ///
    /// 缺陷现场（本用例钉死）：重启关闭复用 `close_session` 把登记表一起清掉 ⇒ 新会话
    /// 建好后的重放恒 0 条（机制形同死代码）⇒ 服务器端该文档消失、编辑器不重发
    /// didOpen ⇒ hover / definition / 诊断全无，直到用户编辑才被 didChange 带回。
    #[tokio::test]
    async fn restart_replays_open_documents() {
        let transport = Arc::new(RecordingTransport::default());
        let factory = Arc::new(WriterCapturingFactory::new(Arc::clone(&transport)));
        let manager = manager_with_factory(Arc::clone(&factory) as Arc<dyn SessionFactory>);
        let key = session_key(TEST_PROJECT, TEST_LANG);

        // 旧会话（writer 接收端存活 ⇒ `send_did_open` 能真的发送并登记）。
        let (old_session, _old_rx) =
            session_with_writer(Arc::clone(&transport) as Arc<dyn LspTransport>);
        manager.session_store.insert(key.clone(), old_session);
        manager
            .send_did_open(TEST_PROJECT, TEST_LANG, "file:///a.rs", "fn a() {}", 3)
            .unwrap();
        manager
            .send_did_open(TEST_PROJECT, TEST_LANG, "file:///b.rs", "fn b() {}", 6)
            .unwrap();
        manager.claim_document(TEST_PROJECT, TEST_LANG, "file:///a.rs");

        // 重启：静默关闭（替换），登记表与所有权必须活下来。
        manager
            .close_session_for_restart(TEST_PROJECT, TEST_LANG)
            .await;
        assert!(
            manager.is_editor_owned(TEST_PROJECT, TEST_LANG, "file:///a.rs"),
            "AC2：重启后编辑器所有权必须仍为真（否则后端拿磁盘文本代开未保存缓冲区）"
        );

        manager
            .get_or_create_session(TEST_PROJECT, TEST_LANG, None)
            .expect("桩装配应当成功");

        let mut replayed = did_open_payloads(&factory.latest_writer());
        replayed.sort();
        assert_eq!(
            replayed,
            vec![
                ("file:///a.rs".to_string(), 3, "fn a() {}".to_string()),
                ("file:///b.rs".to_string(), 6, "fn b() {}".to_string()),
            ],
            "AC1：新会话建好后必须重放 2 条 didOpen（版本不得低于登记版本，文本取登记表）"
        );
    }

    /// 应用退出路径（`close_all_sessions`）也走同一序列，且**同步跑完**：
    /// 上层 `run_cleanup_and_exit` join 完就 `process::exit(0)`，spawn 出去的工作跑不到。
    #[test]
    fn app_quit_closes_through_the_same_sequence() {
        let manager = LspManager::new_default();
        let transport = Arc::new(RecordingTransport::default());
        let (_lifecycle, writer_rx) = insert_test_session_with_writer(
            &manager,
            Arc::clone(&transport) as Arc<dyn LspTransport>,
        );

        manager.close_all_sessions();

        let sequence = take_sequence(&writer_rx, 2, "应用退出");
        assert_eq!(
            sequence,
            vec![
                "request:shutdown".to_string(),
                "notification:exit".to_string()
            ],
            "退出路径不得回到「直接硬杀」（那正是 workspace 快照被截断的成因）"
        );
    }

    // ── 装配端口（DIP）：manager 只编排，装配细节可注入 ──

    /// 用桩装配端口建一个不依赖 Tauri 运行时的 manager（已绑定项目 exec target）。
    fn manager_with_factory(factory: Arc<dyn SessionFactory>) -> LspManager {
        let manager = LspManager::with_session_factory(AppRuntime::shared_default(), factory);
        manager.set_project_exec_target(
            TEST_PROJECT,
            crate::common::executor::factory::ExecTarget::Local,
        );
        manager
    }

    /// 装配端口桩：transport 用 recording，`build` 固定失败
    /// （等价于 spawn / auto-install / initialize 失败）。
    struct FailingSessionFactory {
        transport: Arc<RecordingTransport>,
    }

    impl SessionFactory for FailingSessionFactory {
        fn transport(
            &self,
            _: Option<&tauri::AppHandle>,
        ) -> Result<Arc<dyn LspTransport>, AppError> {
            Ok(Arc::clone(&self.transport) as Arc<dyn LspTransport>)
        }

        fn build(&self, _: SessionBuildRequest<'_>) -> Result<LspSession, AppError> {
            Err(AppError::Lsp("Failed to spawn gopls".to_string()))
        }
    }

    /// AC2「启动异常 → failed + 重试」：装配失败必须补发 error 事件并把错误上抛。
    ///
    /// 该路径原先零覆盖 —— `LspSession::new` 需要真实 `tauri::AppHandle`，
    /// 单测无法触达；装配端口让这段编排逻辑脱离 Tauri 运行时受测。
    #[test]
    fn session_creation_failure_emits_error_event() {
        let transport = Arc::new(RecordingTransport::default());
        let manager = manager_with_factory(Arc::new(FailingSessionFactory {
            transport: Arc::clone(&transport),
        }));

        let result = manager.get_or_create_session(TEST_PROJECT, TEST_LANG, None);

        assert!(
            matches!(result, Err(AppError::Lsp(_))),
            "装配失败必须把错误原样上抛: {result:?}"
        );
        let events = transport.take();
        assert!(
            events
                .iter()
                .any(|(pp, lid, status, msg, _)| pp == TEST_PROJECT
                && lid == TEST_LANG
                && status == "error"
                // message 即前端 chip 上展示的文案：必须携带失败原因（非空泛错误）。
                && msg.as_deref().is_some_and(|m| m.contains("Failed to spawn gopls"))),
            "装配失败必须经注入的 transport 发 error（状态栏重试入口的数据源）: {events:?}"
        );
    }

    /// AC1a（事故直接复现）：「LSP 启动失败」后，状态栏「View logs」必须仍能读到
    /// 该次尝试的证据与失败原因 —— 不再因「会话不存在」而报错。
    ///
    /// 事故现场文案：`No LSP session for: <project>:<lang>`（读路径把证据宿主
    /// 挂在「成功后才有」的进程对象上）。
    #[test]
    fn failed_creation_keeps_diagnostics_readable() {
        let transport = Arc::new(RecordingTransport::default());
        let manager = manager_with_factory(Arc::new(FailingSessionFactory {
            transport: Arc::clone(&transport),
        }));

        let result = manager.get_or_create_session(TEST_PROJECT, TEST_LANG, None);
        assert!(matches!(result, Err(AppError::Lsp(_))));

        let logs = manager
            .get_server_logs(TEST_PROJECT, TEST_LANG, None)
            .expect("装配失败后读取日志不得再因缺会话报错（R1）");
        assert!(
            logs.iter()
                .any(|entry| entry.message.contains("Failed to spawn gopls")),
            "失败原因必须出现在该键的诊断证据里: {logs:?}"
        );

        let info = manager
            .get_server_info(TEST_PROJECT, TEST_LANG)
            .expect("装配失败后读取信息不得因缺会话报错（R1）");
        assert_eq!(
            info.outcome.as_ref().map(|o| o.status.as_str()),
            Some("error"),
            "终态必须记录为 error: {info:?}"
        );
    }

    /// AC2：从未尝试过的键是**纯查询** —— 空数组 / unknown，两者都不得返回 `Err`。
    #[test]
    fn never_attempted_key_reads_empty_not_error() {
        let manager = LspManager::new_default();

        let logs = manager
            .get_server_logs(TEST_PROJECT, TEST_LANG, None)
            .expect("未尝试的键必须返回空数组而非 Err");
        assert!(logs.is_empty(), "未尝试的键不得有日志: {logs:?}");

        let info = manager
            .get_server_info(TEST_PROJECT, TEST_LANG)
            .expect("未尝试的键必须返回 unknown 而非 Err");
        assert_eq!(info, LspServerInfo::unknown());
        assert!(info.outcome.is_none(), "未尝试的键不得有终态记录");
    }

    /// 护栏（钉死 `begin` 落点）：命中共用快路径时**不得切换生代** ——
    /// `begin` 一旦出现在 fast path / 并发输家路径，等价的重复 `begin` 会让每条
    /// hover / didOpen / didChange 清空活会话日志（本条即该事故的回归钉）。
    ///
    /// 与 `attempt_diagnostics.rs` 的生代用例互补：那里钉「谁在写」，这里钉
    /// 「谁**不**该铸造新代」。
    #[test]
    fn alive_session_fast_path_does_not_reset_diagnostics() {
        use std::sync::atomic::Ordering;

        let transport = Arc::new(RecordingTransport::default());
        let factory = Arc::new(LiveSessionFactory::new(Arc::clone(&transport)));
        let manager = manager_with_factory(Arc::clone(&factory) as Arc<dyn SessionFactory>);

        let key = manager
            .get_or_create_session(TEST_PROJECT, TEST_LANG, None)
            .expect("首次装配应当成功");
        assert!(
            manager.session_store.is_alive(&key),
            "夹具必须是活会话（reader 存活），否则本用例退化为慢路径"
        );

        // 扮演 stderr 泵：经「本次尝试的句柄」写入证据。
        let diag = factory
            .diagnostics
            .lock()
            .expect("diagnostics lock")
            .clone()
            .expect("装配期必须交出诊断句柄");
        diag.push_line("info", "live session stderr evidence");

        let again = manager
            .get_or_create_session(TEST_PROJECT, TEST_LANG, None)
            .expect("快路径复用");
        assert_eq!(again, key);
        // 同域约束（见 `creation_gate_serializes_concurrent_creation`）：写成区间而不是 `== 1`。
        let builds = factory.builds.load(Ordering::SeqCst);
        assert!(builds > 0, "首次调用必须真的装配过一次");
        assert!(
            builds <= 1,
            "快路径不得再次装配（再次装配 = 切换生代 = 清空日志），观测到 {builds} 次"
        );
        let logs = manager
            .get_server_logs(TEST_PROJECT, TEST_LANG, None)
            .expect("日志可读");
        assert!(
            logs.iter()
                .any(|e| e.message.contains("live session stderr evidence")),
            "快路径不得清空活会话日志: {logs:?}"
        );
    }

    /// 红线 4：单次 `lsp_get_server_logs` 的返回必须落在字节预算内 —— 条数上限
    /// 不能替代字节上限（控制字符转义最长 6×，按内容字节近似会被击穿）。
    ///
    /// 证据经装配期交出的**句柄**写入（与 stderr 泵同构）——`begin` 的调用点因此
    /// 全仓只剩 `get_or_create_session` 慢路径一处，可被 grep 直接钉死。
    #[test]
    fn server_logs_read_stays_within_ipc_budget() {
        let transport = Arc::new(RecordingTransport::default());
        let factory = Arc::new(LiveSessionFactory::new(Arc::clone(&transport)));
        let manager = manager_with_factory(Arc::clone(&factory) as Arc<dyn SessionFactory>);
        manager
            .get_or_create_session(TEST_PROJECT, TEST_LANG, None)
            .expect("装配成功后才轮到读路径");

        let diag = factory
            .diagnostics
            .lock()
            .expect("diagnostics lock")
            .clone()
            .expect("装配期必须交出诊断句柄");
        let line = format!("{} {}", "y".repeat(1024), "x".repeat(1024));
        for i in 0..3_000 {
            diag.push_line("info", &format!("line {i} {line}"));
        }

        let logs = manager
            .get_server_logs(TEST_PROJECT, TEST_LANG, None)
            .expect("日志可读");
        assert!(!logs.is_empty(), "预算必须至少容纳一条");
        assert!(logs.len() < 3_000, "超预算时更旧的条目必须被丢弃");
        let serialized: usize = logs
            .iter()
            .map(|e| serde_json::to_string(e).expect("serialize").len() + 1)
            .sum();
        assert!(
            serialized <= LSP_SERVER_LOGS_MAX_BYTES,
            "单次读的 JSON（{serialized}）必须落在预算（{LSP_SERVER_LOGS_MAX_BYTES}）内"
        );
        assert!(
            logs.last()
                .expect("newest")
                .message
                .starts_with("line 2999 "),
            "保留的必须是最近的条目"
        );
    }

    /// 活会话装配桩：返回 reader 存活的桩会话（快路径可命中），并把**本次尝试的
    /// 诊断句柄**交给用例 —— 写只走句柄，用例据此扮演 stderr 泵。
    struct LiveSessionFactory {
        transport: Arc<RecordingTransport>,
        diagnostics: std::sync::Mutex<Option<Arc<AttemptDiagnostics>>>,
        /// reader 存活凭据：随工厂存活（工厂 Drop 即 reader 线程退出）。
        _reader: std::sync::Mutex<Option<LiveReader>>,
        builds: std::sync::atomic::AtomicUsize,
    }

    impl LiveSessionFactory {
        fn new(transport: Arc<RecordingTransport>) -> Self {
            Self {
                transport,
                diagnostics: std::sync::Mutex::new(None),
                _reader: std::sync::Mutex::new(None),
                builds: std::sync::atomic::AtomicUsize::new(0),
            }
        }
    }

    impl SessionFactory for LiveSessionFactory {
        fn transport(
            &self,
            _: Option<&tauri::AppHandle>,
        ) -> Result<Arc<dyn LspTransport>, AppError> {
            Ok(Arc::clone(&self.transport) as Arc<dyn LspTransport>)
        }

        fn build(&self, request: SessionBuildRequest<'_>) -> Result<LspSession, AppError> {
            self.builds
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            *self.diagnostics.lock().expect("diagnostics lock") =
                Some(Arc::clone(&request.diagnostics));
            let (session, reader) = live_stub_session(
                Arc::clone(&self.transport) as Arc<dyn LspTransport>,
                TEST_PROJECT,
                TEST_LANG,
                TEST_SERVER,
            );
            *self._reader.lock().expect("reader lock") = Some(reader);
            Ok(session)
        }
    }

    /// 装配端口桩：`build` 成功返回桩会话（验证注入端口下编排语义不变）。
    struct StubSessionFactory {
        transport: Arc<RecordingTransport>,
    }

    impl SessionFactory for StubSessionFactory {
        fn transport(
            &self,
            _: Option<&tauri::AppHandle>,
        ) -> Result<Arc<dyn LspTransport>, AppError> {
            Ok(Arc::clone(&self.transport) as Arc<dyn LspTransport>)
        }

        fn build(&self, request: SessionBuildRequest<'_>) -> Result<LspSession, AppError> {
            Ok(stub_session(request.transport))
        }
    }

    /// 装配成功：会话登记进 store，且不发 error（编排路径与具体装配实现解耦）。
    #[test]
    fn session_creation_success_registers_session_from_injected_factory() {
        let transport = Arc::new(RecordingTransport::default());
        let manager = manager_with_factory(Arc::new(StubSessionFactory {
            transport: Arc::clone(&transport),
        }));

        let key = manager
            .get_or_create_session(TEST_PROJECT, TEST_LANG, None)
            .expect("桩装配应当成功");

        assert_eq!(key, session_key(TEST_PROJECT, TEST_LANG));
        assert!(
            // 桩会话无 reader，故用「已登记」而非 `is_alive`（后者语义是 reader 存活）。
            manager.session_store.with_session(&key, |_| ()).is_some(),
            "装配成功的会话必须登记进 store"
        );
        assert!(
            !transport.has(TEST_PROJECT, TEST_LANG, "error"),
            "成功路径不得发 error 事件: {:?}",
            transport.take()
        );
    }

    // ── W3：send_did_open 归一（唯一出口）的直接单测 ────────────────────────

    /// 构造 writer 接收端存活的桩会话：`send_notification_raw` 会把消息送进通道，
    /// 测试据此断言 didOpen / didClose 的实际发送序列（`stub_session` 丢弃接收端、
    /// 无法观察协议消息）。
    ///
    /// 夹具本体在 `session::testing`（关闭序列测试也要用同一份）；这里只是本项目
    /// 身份的简写，避免第二份手写构造随字段变更而腐坏。
    fn session_with_writer(
        transport: Arc<dyn LspTransport>,
    ) -> (LspSession, crossbeam_channel::Receiver<lsp_server::Message>) {
        crate::lsp::session::testing::stub_session_with_writer(
            transport,
            TEST_PROJECT,
            TEST_LANG,
            TEST_SERVER,
        )
    }

    /// 通道中已发出的 LSP 通知方法名（按顺序）。
    fn notif_methods(rx: &crossbeam_channel::Receiver<lsp_server::Message>) -> Vec<String> {
        rx.try_iter()
            .filter_map(|m| match m {
                lsp_server::Message::Notification(n) => Some(n.method),
                _ => None,
            })
            .collect()
    }

    const TEST_URI: &str = "file:///a.rs";

    /// 重复 didOpen → 先补 didClose 再 didOpen（钉死关键路径 ①）。
    #[test]
    fn send_did_open_duplicate_sends_close_before_reopen() {
        let manager = LspManager::new_default();
        let transport = Arc::new(RecordingTransport::default());
        let (session, rx) = session_with_writer(Arc::clone(&transport) as Arc<dyn LspTransport>);
        manager
            .session_store
            .insert(session_key(TEST_PROJECT, TEST_LANG), session);

        // 首开 v0：仅 didOpen。
        manager
            .send_did_open(TEST_PROJECT, TEST_LANG, TEST_URI, "a", 0)
            .unwrap();
        // 重复 v0（编辑器在后端代开后以同版本接管）：先补 didClose 再 didOpen。
        manager
            .send_did_open(TEST_PROJECT, TEST_LANG, TEST_URI, "b", 0)
            .unwrap();

        assert_eq!(
            notif_methods(&rx),
            vec![
                "textDocument/didOpen".to_string(),
                "textDocument/didClose".to_string(),
                "textDocument/didOpen".to_string(),
            ],
            "重复 didOpen 必须先补 didClose 再 didOpen（否则服务器报 duplicate DidOpenTextDocument）"
        );
        assert_eq!(
            manager.open_document_version(TEST_PROJECT, TEST_LANG, TEST_URI),
            Some(0),
            "登记表以本次版本推进"
        );
    }

    /// 版本回退（v5→v3）：行为照旧（didClose+didOpen），登记表推进到新版本。
    #[test]
    fn send_did_open_version_regression_still_reopens_and_advances() {
        let manager = LspManager::new_default();
        let transport = Arc::new(RecordingTransport::default());
        let (session, rx) = session_with_writer(Arc::clone(&transport) as Arc<dyn LspTransport>);
        manager
            .session_store
            .insert(session_key(TEST_PROJECT, TEST_LANG), session);

        manager
            .send_did_open(TEST_PROJECT, TEST_LANG, TEST_URI, "a", 5)
            .unwrap();
        manager
            .send_did_open(TEST_PROJECT, TEST_LANG, TEST_URI, "b", 3)
            .unwrap();

        assert_eq!(
            notif_methods(&rx),
            vec![
                "textDocument/didOpen".to_string(),
                "textDocument/didClose".to_string(),
                "textDocument/didOpen".to_string(),
            ],
            "版本回退仍必须先补 didClose 再 didOpen"
        );
        assert_eq!(
            manager.open_document_version(TEST_PROJECT, TEST_LANG, TEST_URI),
            Some(3),
            "回退后登记表推进到新版本，文本以本次为准"
        );
    }

    /// 归一决策（纯函数，钉死关键路径 ② 的决策层）：登记表无记录 → 直接打开。
    #[test]
    fn did_open_action_first_open_is_plain() {
        assert_eq!(did_open_action(None, 0), DidOpenAction::PlainOpen);
        assert_eq!(did_open_action(None, 7), DidOpenAction::PlainOpen);
    }

    /// 重复 didOpen（同版本 = 编辑器在后端代开后接管 / 更高版本）→ Reopen 且非回退。
    #[test]
    fn did_open_action_duplicate_is_reopen_without_regression() {
        assert_eq!(
            did_open_action(Some(0), 0),
            DidOpenAction::Reopen {
                version_regressed: false
            }
        );
        assert_eq!(
            did_open_action(Some(2), 3),
            DidOpenAction::Reopen {
                version_regressed: false
            }
        );
    }

    /// 版本回退（version < previous）→ Reopen 且标记回退（告警分支）。
    #[test]
    fn did_open_action_version_regression_is_flagged() {
        assert_eq!(
            did_open_action(Some(5), 3),
            DidOpenAction::Reopen {
                version_regressed: true
            }
        );
    }

    /// AC4：`lsp_transport` 转发的 didChange 必须让登记表与服务器**同源**。
    ///
    /// 缺陷现场：登记表的 `text/version` 只在 didOpen 时写入 ⇒ 即使重启重放修好，
    /// 重放出去的也是 didOpen 时刻的旧文本（服务器按旧文本算诊断 ⇒ 坐标错位）。
    ///
    /// 为何不直接驱动 `lsp_transport` 命令：`AppStateWrapper` 需要整个应用依赖树
    /// （DB / 终端 / agent），单测构造不出来。本用例驱动的是**同一调用链**：
    /// `did_change_full_text`（全量/增量判定）+ `record_document_change`（登记表同步），
    /// 与 `lsp_transport` 通知分支里的两行完全一致。
    #[test]
    fn did_change_through_transport_updates_registry() {
        let manager = LspManager::new_default();
        let transport = Arc::new(RecordingTransport::default());
        let (session, _rx) = session_with_writer(Arc::clone(&transport) as Arc<dyn LspTransport>);
        manager
            .session_store
            .insert(session_key(TEST_PROJECT, TEST_LANG), session);
        manager
            .send_did_open(TEST_PROJECT, TEST_LANG, TEST_URI, "fn a() {}", 1)
            .unwrap();

        // ① 全量同步（`contentChanges` 无 `range`）：文本 + 版本都可信。
        let full = serde_json::json!({
            "textDocument": { "uri": TEST_URI, "version": 2 },
            "contentChanges": [{ "text": "fn a() { /* edited */ }" }],
        });
        let version = full
            .pointer("/textDocument/version")
            .and_then(|v| v.as_i64());
        manager.record_document_change(
            TEST_PROJECT,
            TEST_LANG,
            TEST_URI,
            version.expect("version"),
            crate::lsp::commands::did_change_full_text(&full),
        );

        assert_eq!(
            manager.open_document_version(TEST_PROJECT, TEST_LANG, TEST_URI),
            Some(2),
            "didChange 必须推进登记表版本（否则重放会与服务器分叉）"
        );
        assert_eq!(
            replay_of(&manager),
            vec![(
                TEST_URI.to_string(),
                2,
                "fn a() { /* edited */ }".to_string()
            )],
            "全量同步后重放必须用最新文本，而不是 didOpen 时刻的旧文本"
        );

        // ② 增量同步（`contentChanges` 带 `range`）：后端重建不出全文 ⇒ 只推版本。
        let incremental = serde_json::json!({
            "textDocument": { "uri": TEST_URI, "version": 3 },
            "contentChanges": [{
                "range": {
                    "start": { "line": 0, "character": 5 },
                    "end": { "line": 0, "character": 6 },
                },
                "text": "b",
            }],
        });
        let version = incremental
            .pointer("/textDocument/version")
            .and_then(|v| v.as_i64());
        manager.record_document_change(
            TEST_PROJECT,
            TEST_LANG,
            TEST_URI,
            version.expect("version"),
            crate::lsp::commands::did_change_full_text(&incremental),
        );

        assert_eq!(
            manager.open_document_version(TEST_PROJECT, TEST_LANG, TEST_URI),
            Some(3),
            "增量同步也必须推版本"
        );
        assert_eq!(
            replay_of(&manager),
            vec![(
                TEST_URI.to_string(),
                3,
                "fn a() { /* edited */ }".to_string()
            )],
            "增量同步不得改文本（重放的应停在最后一次全量文本，并另有 warn）"
        );
    }

    /// 重放实际会发出的 `(uri, version, text)`：直接观察 `reopen_documents` 的输入。
    fn replay_of(manager: &LspManager) -> Vec<(String, i64, String)> {
        let seen = std::sync::Mutex::new(Vec::new());
        manager.session_store.reopen_documents(
            &session_key(TEST_PROJECT, TEST_LANG),
            |uri, _, ver, text| {
                seen.lock()
                    .expect("seen lock")
                    .push((uri.to_string(), ver, text.to_string()));
                true
            },
        );
        seen.into_inner().expect("seen lock")
    }

    // ── S4：请求级失败 vs 会话级失败（错误响应不得重启服务器）──────────────

    /// 假 reader 的应答方式。
    #[derive(Clone, Copy)]
    enum Answer {
        /// 回一个合法结果。
        Ok,
        /// 回 JSON-RPC error（`-32602` 文档未打开是 didClose/definition 交错的常态）。
        Error { code: i32, message: &'static str },
    }

    /// 单次 `build` 的装配规格（按序消费，用尽后沿用最后一项）。
    #[derive(Clone)]
    enum BuildSpec {
        /// 通道已死（writer 接收端被丢弃）⇒ 任何请求都是 `RequestFailure::Channel`。
        DeadWriter,
        /// reader 存活 + 假服务器按 [`Answer`] 应答。
        Answer(Answer),
    }

    /// 假 reader：从 writer 通道取请求，直接 resolve `pending` 里的等待者。
    ///
    /// 与真实 reader 线程同构（唯一区别：它不解析 JSON，只按规格应答），因此这里
    /// 验证的是**编排层**的分类与重建决策，不重复 request 域的报文测试。
    struct FakeReader {
        stop: crossbeam_channel::Sender<()>,
        handle: Option<std::thread::JoinHandle<()>>,
    }

    impl FakeReader {
        fn spawn(
            writer_rx: crossbeam_channel::Receiver<lsp_server::Message>,
            pending: Arc<Mutex<HashMap<lsp_server::RequestId, PendingSender>>>,
            answer: Answer,
        ) -> Self {
            let (stop, stop_rx) = crossbeam_channel::bounded::<()>(1);
            let handle = std::thread::Builder::new()
                .name("lsp-fake-reader".to_string())
                .spawn(move || loop {
                    match writer_rx.recv_timeout(Duration::from_millis(10)) {
                        Ok(lsp_server::Message::Request(req)) => {
                            let reply = match answer {
                                Answer::Ok => {
                                    lsp_server::Message::Response(lsp_server::Response::new_ok(
                                        req.id.clone(),
                                        serde_json::json!({ "uri": "file:///target.rs" }),
                                    ))
                                }
                                Answer::Error { code, message } => {
                                    lsp_server::Message::Response(lsp_server::Response::new_err(
                                        req.id.clone(),
                                        code,
                                        message.to_string(),
                                    ))
                                }
                            };
                            if let Some(tx) = pending.lock().expect("pending lock").remove(&req.id)
                            {
                                let _ = tx.send(reply);
                            }
                        }
                        Ok(_) => {}
                        Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                            if stop_rx.try_recv().is_ok() {
                                return;
                            }
                        }
                        Err(crossbeam_channel::RecvTimeoutError::Disconnected) => return,
                    }
                })
                .expect("spawn fake reader");
            Self {
                stop,
                handle: Some(handle),
            }
        }

        fn shutdown(&mut self) {
            let _ = self.stop.send(());
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }

    impl Drop for FakeReader {
        fn drop(&mut self) {
            self.shutdown();
        }
    }

    /// 装配端口桩：按 [`BuildSpec`] 造「reader 存活」的会话，并记录每次 build 的
    /// 生命周期句柄与装配次数 —— 「重启是否真的换了进程」的判据只有这两个观测点。
    struct RespondingSessionFactory {
        transport: Arc<RecordingTransport>,
        specs: Vec<BuildSpec>,
        builds: std::sync::atomic::AtomicUsize,
        lifecycles: Mutex<Vec<Arc<Lifecycle>>>,
        readers: Mutex<Vec<FakeReader>>,
        /// reader 存活凭据：随工厂存活（工厂 Drop 即 reader 线程退出）。
        liveness: Mutex<Vec<LiveReader>>,
    }

    impl RespondingSessionFactory {
        fn new(transport: Arc<RecordingTransport>, specs: Vec<BuildSpec>) -> Self {
            Self {
                transport,
                specs,
                builds: std::sync::atomic::AtomicUsize::new(0),
                lifecycles: Mutex::new(Vec::new()),
                readers: Mutex::new(Vec::new()),
                liveness: Mutex::new(Vec::new()),
            }
        }

        fn builds(&self) -> usize {
            self.builds.load(std::sync::atomic::Ordering::SeqCst)
        }

        /// 第 `index` 次装配的会话生命周期句柄。
        fn lifecycle(&self, index: usize) -> Arc<Lifecycle> {
            Arc::clone(&self.lifecycles.lock().expect("lifecycles lock")[index])
        }
    }

    impl SessionFactory for RespondingSessionFactory {
        fn transport(
            &self,
            _: Option<&tauri::AppHandle>,
        ) -> Result<Arc<dyn LspTransport>, AppError> {
            Ok(Arc::clone(&self.transport) as Arc<dyn LspTransport>)
        }

        fn build(&self, _: SessionBuildRequest<'_>) -> Result<LspSession, AppError> {
            let index = self
                .builds
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let spec = self
                .specs
                .get(index)
                .or_else(|| self.specs.last())
                .cloned()
                .unwrap_or(BuildSpec::DeadWriter);
            let (session, writer_rx, live) =
                crate::lsp::session::testing::live_stub_session_with_writer(
                    Arc::clone(&self.transport) as Arc<dyn LspTransport>,
                    TEST_PROJECT,
                    TEST_LANG,
                    TEST_SERVER,
                );
            self.lifecycles
                .lock()
                .expect("lifecycles lock")
                .push(Arc::clone(&session.lifecycle));
            match spec {
                // 接收端就地丢弃 ⇒ 之后的 send 全部失败（通道已死）。
                BuildSpec::DeadWriter => drop(writer_rx),
                BuildSpec::Answer(answer) => {
                    let reader = FakeReader::spawn(writer_rx, Arc::clone(&session.pending), answer);
                    self.readers.lock().expect("readers lock").push(reader);
                }
            }
            self.liveness.lock().expect("liveness lock").push(live);
            Ok(session)
        }
    }

    use crate::lsp::session::PendingSender;

    /// 装好一个「项目 exec target 已绑定 + 可注入装配质量」的 manager。
    fn responding_manager(
        transport: &Arc<RecordingTransport>,
        specs: Vec<BuildSpec>,
    ) -> (Arc<LspManager>, Arc<RespondingSessionFactory>) {
        let factory = Arc::new(RespondingSessionFactory::new(Arc::clone(transport), specs));
        let manager = Arc::new(manager_with_factory(
            Arc::clone(&factory) as Arc<dyn SessionFactory>
        ));
        (manager, factory)
    }

    /// R1/AC1/D2：服务器回 `-32602`（文档未打开）是**请求级**失败 ——
    /// 不得重建会话、不得消耗重启预算、不得发 error 事件，错误原样上抛。
    ///
    /// 反例（修复前）：`bail!("LSP error …")` 一律进重启分支 ⇒ 一次 didClose 与
    /// definition 的常规交错就重启整台 jdts（数十秒 + 重新导入），5 次后该 key 永久
    /// `Max restart count exceeded`，而 chip 仍显示 Running。
    #[tokio::test]
    async fn server_error_does_not_consume_restart_budget() {
        let transport = Arc::new(RecordingTransport::default());
        let (manager, factory) = responding_manager(
            &transport,
            vec![BuildSpec::Answer(Answer::Error {
                code: -32602,
                message: "Document not open",
            })],
        );
        let key = session_key(TEST_PROJECT, TEST_LANG);
        manager
            .get_or_create_session(TEST_PROJECT, TEST_LANG, None)
            .expect("首次装配应当成功");
        // 基线：把「首次装配」产生的计数清掉，断言只关心本次失败的影响。
        manager.session_store.clear_restart(&key);
        let before = manager.session_store.restart_count(&key);

        let error = manager
            .send_request_async(
                TEST_PROJECT,
                TEST_LANG,
                "textDocument/definition",
                serde_json::json!({}),
                false,
            )
            .await
            .expect_err("服务器回错必须上抛给调用方");

        assert!(
            error.to_string().contains("LSP error (-32602)"),
            "错误必须原样上抛（能力探测按码分类）: {error}"
        );
        assert_eq!(
            manager.session_store.restart_count(&key),
            before,
            "请求级失败不得消耗重启预算（否则 5 次普通错误就永久废掉该语言）"
        );
        let builds = factory.builds();
        assert!(
            builds <= 1,
            "错误响应不得重建会话（会话完全健康），观测到 {builds} 次装配"
        );
        assert!(
            !transport.has(TEST_PROJECT, TEST_LANG, "error"),
            "请求级失败不是会话故障，前端不得收到 error: {:?}",
            transport.take()
        );
    }

    /// R2/AC2：restart 计数是**连续失败 streak** —— 一次成功请求即清零。
    ///
    /// 反例（修复前）：计数只增不减 ⇒ 长跑会话的历史错误永久占用预算，5 次后该
    /// `project:lang` 再也无法自动恢复。
    #[tokio::test]
    async fn successful_request_resets_restart_streak() {
        let transport = Arc::new(RecordingTransport::default());
        let (manager, _factory) =
            responding_manager(&transport, vec![BuildSpec::Answer(Answer::Ok)]);
        let key = session_key(TEST_PROJECT, TEST_LANG);
        manager
            .get_or_create_session(TEST_PROJECT, TEST_LANG, None)
            .expect("装配应当成功");

        // 制造「有失败史」的基线（3 次连续失败）。
        manager.session_store.set_restart_count(&key, 3);
        assert!(
            manager.session_store.restart_count(&key) > 0,
            "基线必须是「已经有过失败」"
        );

        let value = manager
            .send_request_async(
                TEST_PROJECT,
                TEST_LANG,
                "textDocument/definition",
                serde_json::json!({}),
                false,
            )
            .await
            .expect("健康会话必须成功");
        assert!(value.get("uri").is_some(), "必须拿到真实结果");

        assert_eq!(
            manager.session_store.restart_count(&key),
            0,
            "一次成功请求必须清零 streak（成功的请求证明该会话可用）"
        );
    }

    /// R2/AC1：通道故障必须**真的重建**（旧会话先关、再建），而不是复用坏会话。
    ///
    /// 反例（修复前）：`get_or_create_session` 的快路径看到活会话就复用 ⇒ 计数器
    /// 在涨、进程不换（`channel_failure` 的「重启」是空操作），重试仍在坏通道上失败。
    #[tokio::test]
    async fn channel_failure_rebuilds_the_session() {
        let transport = Arc::new(RecordingTransport::default());
        let (manager, factory) = responding_manager(
            &transport,
            vec![BuildSpec::DeadWriter, BuildSpec::Answer(Answer::Ok)],
        );
        // 先装配出「通道已死的活会话」：快路径会命中它，这正是缺陷现场
        // （旧实现会原样复用同一台坏会话）。
        manager
            .get_or_create_session(TEST_PROJECT, TEST_LANG, None)
            .expect("首次装配应当成功");

        let value = manager
            .send_request_async(
                TEST_PROJECT,
                TEST_LANG,
                "textDocument/definition",
                serde_json::json!({}),
                false,
            )
            .await
            .expect("通道故障后必须在新会话上重试成功");
        assert!(value.get("uri").is_some(), "重试必须拿到真实结果");

        let builds = factory.builds();
        assert!(
            builds >= 2,
            "通道故障必须重新装配（活会话会被快路径复用 = 重启是空操作），观测到 {builds} 次"
        );
        assert!(
            factory.lifecycle(0).is_terminal(),
            "重建前必须先关掉旧会话（否则两个服务器抢同一 workspace 锁）"
        );
    }

    /// R2：真故障（通道不可用）必须**消耗**重启预算 —— 否则「连续失败」没有成本，
    /// `MAX_RESTART_COUNT` 形同虚设（新会话仍坏 ⇒ 失败必须累计）。
    #[tokio::test]
    async fn channel_failure_consumes_the_restart_budget() {
        let transport = Arc::new(RecordingTransport::default());
        let (manager, factory) = responding_manager(
            &transport,
            vec![BuildSpec::DeadWriter, BuildSpec::DeadWriter],
        );
        let key = session_key(TEST_PROJECT, TEST_LANG);
        manager
            .get_or_create_session(TEST_PROJECT, TEST_LANG, None)
            .expect("首次装配应当成功");
        manager.session_store.clear_restart(&key);
        let before = manager.session_store.restart_count(&key);

        manager
            .send_request_async(
                TEST_PROJECT,
                TEST_LANG,
                "textDocument/definition",
                serde_json::json!({}),
                false,
            )
            .await
            .expect_err("新会话的通道仍不可用 ⇒ 重试必须失败");

        let builds = factory.builds();
        assert!(builds >= 2, "必须真的重建过（观测到 {builds} 次装配）");
        assert!(
            manager.session_store.restart_count(&key) > before,
            "通道故障必须消耗重启预算（streak 只在成功后清零）"
        );
    }

    /// R2：streak 必须**跨重启**累计 ——「先关后建」会顺带清空计数（用户 stop 的
    /// 语义是「从头开始」），重启是同一故障 episode 的延续，必须接账。
    ///
    /// 反例（本实现若不接账）：每次重启都把计数抹成 1 ⇒ 崩溃循环永远绕过
    /// `MAX_RESTART_COUNT`，用户侧表现是「无限重启、永远起不来、也没有上限提示」。
    ///
    /// 基线取 1（已有一次失败）而不是 4：`prev_count > 0` 的退避是 1s，这是能区分
    /// 「接账（2）」与「从头开始（1）」的最小代价。
    #[tokio::test]
    async fn restart_streak_is_carried_across_the_rebuild() {
        let transport = Arc::new(RecordingTransport::default());
        let (manager, _factory) = responding_manager(
            &transport,
            vec![BuildSpec::DeadWriter, BuildSpec::DeadWriter],
        );
        let key = session_key(TEST_PROJECT, TEST_LANG);
        manager
            .get_or_create_session(TEST_PROJECT, TEST_LANG, None)
            .expect("首次装配应当成功");
        manager.session_store.set_restart_count(&key, 1);

        manager
            .send_request_async(
                TEST_PROJECT,
                TEST_LANG,
                "textDocument/definition",
                serde_json::json!({}),
                false,
            )
            .await
            .expect_err("新会话的通道仍不可用 ⇒ 重试必须失败");

        assert_eq!(
            manager.session_store.restart_count(&key),
            2,
            "历史失败（1）+ 本次失败（1）必须接账；1 表示被关闭路径抹平（崩溃循环绕过上限）"
        );
    }

    /// R2：命中 `MAX_RESTART_COUNT` 时状态栏必须可见 —— 只有 warn 日志 + chip 仍显
    /// Running 等于「静默把该语言弄坏」（前端既无文案也无重试入口）。
    #[tokio::test]
    async fn max_restart_count_is_visible_to_the_frontend() {
        let transport = Arc::new(RecordingTransport::default());
        let (manager, _factory) = responding_manager(&transport, vec![BuildSpec::DeadWriter]);
        let key = session_key(TEST_PROJECT, TEST_LANG);
        manager
            .session_store
            .set_restart_count(&key, MAX_RESTART_COUNT);

        let error = manager
            .send_request_async(
                TEST_PROJECT,
                TEST_LANG,
                "textDocument/definition",
                serde_json::json!({}),
                false,
            )
            .await
            .expect_err("预算用尽必须失败");

        assert!(
            error.to_string().contains("Max restart count"),
            "错误文案必须点明上限: {error}"
        );
        let events = transport.take();
        let errors: Vec<_> = events.iter().filter(|e| e.2 == "error").collect();
        assert_eq!(
            errors.len(),
            1,
            "命中上限必须让前端可见（恰好一条 error，复用既有 emit_session_error）: {events:?}"
        );
        assert!(
            errors[0]
                .3
                .as_deref()
                .is_some_and(|m| m.contains("Max restart count")),
            "error 文案必须说明重试预算已用尽: {events:?}"
        );
    }
}
