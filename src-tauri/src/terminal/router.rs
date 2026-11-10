//! 终端会话路由：把「按会话 id 的操作」分派到正确的后端（本地/WSL PTY 或 SSH）。
//!
//! 为什么单独成模块（原在组合根 `app_state.rs`）：
//! 1. **域私有状态归位**：路由表 `owners`（会话 → 归属后端）是终端域的实现细节，
//!    全仓不该看到它（原 `SessionOwner` 只在 `app_state.rs` 出现）；
//! 2. **组合根只组装**：`app_state.rs` 的职责是"集中组装所有 Manager"，
//!    分派策略属域内行为；
//! 3. **可测**：路由与超时钳制不再需要构造整个 `AppStateWrapper`（含 `AppHandle`）。
//!
//! 依赖方向：本模块**不认识 project** —— 调用方（`terminal/commands.rs`）提供
//! `(环境, 已解析运行根 cwd)` 快照，本模块只做"往哪个后端发"。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use crate::common::terminal::types::TerminalSession;
use crate::core::project::ProjectEnvironment;
use crate::live_sessions::lifecycle::close_and_notify;
use crate::live_sessions::wiring::pty::{LiveTerminal, TerminalRegistration};
use crate::live_sessions::Registry;
use crate::terminal::manager::TerminalManager;
use crate::terminal::remote::RemoteTerminalManager;
use crate::AppError;

/// 会话归属：该会话由哪个后端持有（仅 router 内部使用）。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum SessionOwner {
    /// 本地 / WSL PTY 会话。
    Pty,
    /// SSH 远端会话。
    Ssh,
}

/// long-poll drain 等待超时钳制区间。
const DRAIN_WAIT_MIN: Duration = Duration::from_secs(1);
const DRAIN_WAIT_MAX: Duration = Duration::from_secs(30);

/// 把请求的超时钳制进允许区间（纯函数，便于单测）。
#[must_use]
fn clamp_drain_timeout(timeout_ms: u64) -> Duration {
    Duration::from_millis(timeout_ms).clamp(DRAIN_WAIT_MIN, DRAIN_WAIT_MAX)
}

/// 终端会话路由器：持有两个后端 manager 与「会话 → 后端」路由表。
pub struct TerminalRouter {
    /// 本地 / WSL PTY 后端。
    local: TerminalManager,
    /// SSH 远端后端。
    remote: RemoteTerminalManager,
    /// 会话 → 归属后端。
    owners: Mutex<HashMap<String, SessionOwner>>,
    /// live-sessions 注册表（未注入时终端照常工作，只是侧栏看不到会话）。
    live_sessions: Option<std::sync::Arc<Registry>>,
    /// 纯 shell 终端历史日志的单一所有者，由组合根注入。三端共用一份 `prepare` 结果。
    history: Option<crate::common::terminal::history::SharedHistoryStore>,
}

impl Default for TerminalRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalRouter {
    /// 新建空路由器（两个后端各自新建），不接 live-sessions 注册表。
    #[must_use]
    pub fn new() -> Self {
        Self {
            local: TerminalManager::new(),
            remote: RemoteTerminalManager::new(),
            owners: Mutex::new(HashMap::new()),
            live_sessions: None,
            history: None,
        }
    }

    /// 注入终端历史日志所有者（组合根专用 builder）。未注入 = 不落盘不回放，
    /// 测试与「非纯 shell」路径零磁盘副作用。
    #[must_use]
    pub fn with_history(
        mut self,
        history: crate::common::terminal::history::SharedHistoryStore,
    ) -> Self {
        self.history = Some(history);
        self
    }

    /// 接上 live-sessions 注册表：会话创建 / 关闭与两个后端的进程退出都会同步登记。
    ///
    /// 注册表**只由 router 持有**（两个后端不存副本）：接线是每次调用带下去的
    /// [`LiveTerminal`]，于是「哪个后端持有注册表」不会成为第二个需要同步的事实。
    #[must_use]
    pub fn with_live_sessions(live_sessions: std::sync::Arc<Registry>) -> Self {
        Self {
            local: TerminalManager::new(),
            remote: RemoteTerminalManager::new(),
            owners: Mutex::new(HashMap::new()),
            live_sessions: Some(live_sessions),
            history: None,
        }
    }

    /// 会话创建前的唯一历史决策点。三端共用这个方法，天然保证 Local / WSL / SSH
    /// 落盘与回放行为完全一致；`run_blocking` 把阻塞 fs 移出 async command 链（红线 3）。
    async fn prepare_history(
        &self,
        resume_from: Option<String>,
        plain_shell: bool,
    ) -> Result<Option<crate::common::terminal::history::HistoryPlan>, AppError> {
        let Some(store) = self.history.as_ref() else {
            return Ok(None);
        };
        if !plain_shell {
            return Ok(None);
        }
        let store = std::sync::Arc::clone(store);
        crate::common::runtime::run_blocking(move || store.prepare(resume_from.as_deref())).await
    }

    /// 本地 / WSL PTY 后端（需直连后端语义的调用方使用，如任务终端的 input 写入）。
    #[must_use]
    pub const fn local(&self) -> &TerminalManager {
        &self.local
    }

    /// SSH 远端后端（如连接测试）。
    #[must_use]
    pub const fn remote(&self) -> &RemoteTerminalManager {
        &self.remote
    }

    // 路由表查询：锁中毒视为不可恢复而 expect —— 中毒后继续跑只会产出误诊的 NotFound
    // （把存活会话判成不存在），不如显式 panic 让问题暴露。
    //
    /// 这个 id 背后**有没有** PTY 会话。
    ///
    /// 唯一外部用途是「要不要先结束进程」的判断（删除会话 / 收尾幂等）。
    /// `SessionOwner` 仍是私有的 —— 探测方拿不到归属细节，也就无法在别处复制路由判定。
    #[must_use]
    pub fn owns_terminal_session(&self, session_id: &str) -> bool {
        self.owner_of(session_id).is_some()
    }

    #[allow(clippy::expect_used)]
    fn owner_of(&self, session_id: &str) -> Option<SessionOwner> {
        self.owners
            .lock()
            .expect("infallible: terminal session owners")
            .get(session_id)
            .copied()
    }

    #[allow(clippy::expect_used)]
    fn take_owner(&self, session_id: &str) -> Option<SessionOwner> {
        self.owners
            .lock()
            .expect("infallible: terminal session owners")
            .remove(session_id)
    }

    /// 登记会话归属（三个后端分支共用的唯一写入点）。
    #[allow(clippy::expect_used)]
    fn register(&self, session_id: &str, owner: SessionOwner) {
        self.owners
            .lock()
            .expect("infallible: terminal session owners")
            .insert(session_id.to_string(), owner);
    }

    /// 只登记归属、不起进程（测试用）。
    ///
    /// 「删除会话」的编排要验证「探测 → 派发 → 释放归属」整条链路，而起一条真实 PTY
    /// 会把单元测试变成进程集成测试（`check_unit_tests_spawn_real_binaries` 不允许）。
    /// 与 `common/file/watcher` 的 `revoke_dead_mount_for_test` 同一条先例。
    #[cfg(test)]
    pub(crate) fn register_owner_for_test(&self, session_id: &str) {
        self.register(session_id, SessionOwner::Pty);
    }

    /// 按项目环境创建会话，并登记归属。
    ///
    /// `workspace_root` 是**该 Workspace 的根**（`repo.root()`）—— 项目级产物（主题等）
    /// 的权威落点；`cwd` 是**进程运行目录**（根，或 Workspace 内子目录覆盖）——
    /// 三个传输分支统一承接同一个 `cwd`（环境是传输维度，红线 10）。
    /// `command` 有值表示这是**任务终端**（由 task 域创建）—— 主题准备据此跳过。
    pub(crate) async fn create_session(
        &self,
        env: &ProjectEnvironment,
        registration: &TerminalRegistration,
        workspace_root: &str,
        launch: crate::terminal::launch::TerminalLaunch,
        app_handle: tauri::AppHandle,
    ) -> Result<TerminalSession, AppError> {
        // 主题产物属主题域，由该域按环境准备（见 `theme::service::prepare_project_theme`）。
        // 项目级配置落在 Workspace 根，**不**随语言 runner 的模块子目录覆盖漂移。
        crate::theme::service::prepare_project_theme(env, workspace_root, launch.command.is_some())
            .await;

        // 原生事实（地址 + 运行根 + agent + 展示名）由命令层一次成型传进来；router 只转发。
        // 登记本身发生在进程创建处（PTY pipeline / SSH 建连内），**不**在这里 —— 否则退出
        // 信号的生产者会早于登记上线（顺序不变量见 `live_sessions::wiring::pty`）。
        // `LiveTerminal` 是 Copy：三个分支各取一份，不克隆注册表。
        let cwd = registration.cwd.as_str();
        let live = LiveTerminal::new(self.live_sessions.as_ref(), Some(registration));

        // 终端历史：**唯一**的会话创建前决策点。三端（Local / WSL / SSH）共用同一份
        // `HistoryPlan`，且所有阻塞 fs 都在这一个 `run_blocking` 里完成（红线 3）。
        // `is_plain_shell` 单点裁决，前后端、三端不再各判一次。
        let plain_shell = live.is_some_and(|l| l.is_plain_shell());
        let history = self
            .prepare_history(launch.resume_from.clone(), plain_shell)
            .await?;

        let session = match env {
            ProjectEnvironment::Local => {
                let session = self
                    .local
                    .create_session(cwd, &launch, history, live, app_handle)
                    .map_err(AppError::from)?;
                self.register(&session.id, SessionOwner::Pty);
                session
            }
            #[cfg(target_os = "windows")]
            ProjectEnvironment::Wsl { distro } => {
                let session = self
                    .local
                    .create_wsl_session(distro, cwd, &launch, history, live, app_handle)
                    .map_err(AppError::from)?;
                self.register(&session.id, SessionOwner::Pty);
                session
            }
            ProjectEnvironment::Remote {
                host,
                port,
                username,
                auth,
            } => {
                let session = self
                    .remote
                    .create_session(
                        host,
                        *port,
                        username,
                        auth,
                        workspace_root,
                        cwd,
                        &launch,
                        history,
                        live,
                        app_handle,
                    )
                    .await
                    .map_err(AppError::from)?;
                self.register(&session.id, SessionOwner::Ssh);
                session
            }
        };

        Ok(session)
    }

    /// Resize a terminal session, dispatching to the correct backend.
    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        match self.owner_of(session_id) {
            Some(SessionOwner::Pty) => self
                .local
                .resize_session(session_id, cols, rows)
                .map_err(AppError::from),
            Some(SessionOwner::Ssh) => self
                .remote
                .resize_session(session_id, cols, rows)
                .map_err(AppError::from),
            None => Err(unknown_session(session_id)),
        }
    }

    /// Drain buffered terminal output, dispatching to the correct backend.
    pub fn drain(&self, session_id: &str) -> Result<tauri::ipc::Response, AppError> {
        let bytes = match self.owner_of(session_id) {
            Some(SessionOwner::Pty) => self.local.take_drain(session_id),
            Some(SessionOwner::Ssh) => self.remote.take_drain(session_id),
            None => return Err(unknown_session(session_id)),
        };
        bytes.map(tauri::ipc::Response::new).ok_or_else(|| {
            AppError::NotFound(format!("Terminal drain queue not found: {session_id}"))
        })
    }

    /// 切换会话的分离态（关 tab 后台运行 / 重新接回界面）。
    ///
    /// 会话已结束（drain 不存在）返回 `false` —— 调用方据此知道「它已经不在跑了」，
    /// 不需要再问用户要不要后台运行。
    pub fn set_drain_detached(&self, session_id: &str, detached: bool) -> bool {
        match self.owner_of(session_id) {
            Some(SessionOwner::Pty) => self.local.set_drain_detached(session_id, detached),
            Some(SessionOwner::Ssh) => self.remote.set_drain_detached(session_id, detached),
            None => false,
        }
    }

    /// Long-poll drain: 无数据时挂起至 push/close/超时，而非立即返回空。
    /// `timeout_ms` 后端钳制 1–30s；drain 不存在或已关闭返回 `NotFound`
    ///（前端据此终止该 session 的挂起循环；debug 日志便于排查 dispose 泄漏）。
    pub async fn drain_wait(
        &self,
        session_id: &str,
        timeout_ms: u64,
    ) -> Result<tauri::ipc::Response, AppError> {
        let timeout = clamp_drain_timeout(timeout_ms);
        let data = match self.owner_of(session_id) {
            Some(SessionOwner::Pty) => self.local.wait_drain(session_id, timeout).await,
            Some(SessionOwner::Ssh) => self.remote.wait_drain(session_id, timeout).await,
            None => None,
        };
        match data {
            Some(bytes) => Ok(tauri::ipc::Response::new(bytes)),
            None => {
                log::debug!("[Terminal] drain_wait stopped: session gone or closed: {session_id}");
                Err(unknown_session(session_id))
            }
        }
    }

    /// Close a terminal session, dispatching to the correct backend.
    ///
    /// **不注销** live-sessions 条目，只把它标成 `Stopped`：关 tab 是收起视图，那条会话
    /// 仍是侧栏里「点回来」的入口（点击时按会话重建，能续写就续写）。
    /// `app_handle` 为 `None` 的调用方（退出清理 / 测试）只改状态不发事件 ——
    /// 那时没有前端在听。
    ///
    /// # 幂等：归属探测与后端关闭在**同一个**临界区里
    ///
    /// 早先的调用方是「先 `owns_terminal_session`、再 `close_session`」，两步之间会话可能
    /// 已经结束 —— 那时 `take_owner` 返回 `None`，只留一条误导性的「unknown session」告警。
    /// 现在探测（`take_owner`）与派发是同一个动作，返回「是否由本路由处理」：
    /// `false` 是**正常路径**（这本来就不是终端会话，或者已经被关过了），不是错误。
    pub fn close_session(&self, session_id: &str, app_handle: Option<&tauri::AppHandle>) -> bool {
        let Some(owner) = self.take_owner(session_id) else {
            return false;
        };
        // 只有真的归本路由管，才动注册表：否则会把一条 chat 会话错标成 `Stopped`。
        if let Some(registry) = self.live_sessions.as_deref() {
            close_and_notify(registry, app_handle, session_id);
        }
        match owner {
            SessionOwner::Pty => self.local.close_session_in_background(session_id),
            SessionOwner::Ssh => self.remote.close_session(session_id),
        }
        true
    }
}

/// 路由表未命中 → 统一的 `NotFound` 文案。
fn unknown_session(session_id: &str) -> AppError {
    AppError::NotFound(format!("Terminal session not found: {session_id}"))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    /// 三端对称护栏：`prepare_history` 是唯一入口，未注入 history / agent TUI 都降级为
    /// 「不落盘不回放」。这样 Local / WSL / SSH 不可能出现「前端传了 resumeFrom、
    /// 后端静默忽略」的不一致。
    #[tokio::test]
    async fn prepare_history_is_single_gate_for_all_three_transports() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Arc::new(crate::common::terminal::history::HistoryStore::new(
            tmp.path().to_path_buf(),
        ));
        // 先落一份旧日志，验证同一份计划可被三端共用。
        let writer = store
            .start_writer("old", b"$ pwd\r\n/neeko\r\n".to_vec())
            .unwrap();
        writer.record(b"\r\n");
        drop(writer);
        for _ in 0..50 {
            if store.read_tail("old").ends_with(b"/neeko\r\n") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let router = TerminalRouter::new().with_history(Arc::clone(&store));

        // 纯 shell + 有旧历史 ⇒ 有回放；agent TUI ⇒ None（单点裁决）。
        let plan = router
            .prepare_history(Some("old".into()), true)
            .await
            .unwrap()
            .expect("纯 shell 必须有计划");
        assert!(plan.replay().starts_with(b"$ pwd"));
        assert!(router
            .prepare_history(Some("old".into()), false)
            .await
            .unwrap()
            .is_none());

        // 未注入 history 的 router（测试默认）⇒ 三端一律 None，零磁盘副作用。
        let bare = TerminalRouter::new();
        assert!(bare
            .prepare_history(Some("old".into()), true)
            .await
            .unwrap()
            .is_none());
    }

    /// 超时钳制：低于下限抬到 1s、高于上限压到 30s、区间内原样。
    #[test]
    fn drain_timeout_is_clamped_into_the_allowed_range() {
        assert_eq!(clamp_drain_timeout(0), DRAIN_WAIT_MIN);
        assert_eq!(clamp_drain_timeout(500), DRAIN_WAIT_MIN);
        assert_eq!(clamp_drain_timeout(5_000), Duration::from_millis(5_000));
        assert_eq!(clamp_drain_timeout(60_000), DRAIN_WAIT_MAX);
        assert_eq!(clamp_drain_timeout(u64::MAX), DRAIN_WAIT_MAX);
    }

    /// 路由表未命中：三个返回 `Result` 的操作都必须是 `NotFound`（不进任何后端），
    /// `close_session` 只告警不 panic。
    #[tokio::test]
    async fn unknown_session_is_not_found_on_every_route() {
        let router = TerminalRouter::new();
        let id = "no-such-session";

        // 注意：`Response` 未实现 `Debug`，故 `drain*` 用 match 取错误而非 `expect_err`。
        let resize_err = router.resize_session(id, 80, 24).expect_err("resize");
        let Err(drain_err) = router.drain(id) else {
            panic!("drain must fail for an unknown session");
        };
        let Err(drain_wait_err) = router.drain_wait(id, 1_000).await else {
            panic!("drain_wait must fail for an unknown session");
        };

        for err in [resize_err, drain_err, drain_wait_err] {
            assert!(
                matches!(err, AppError::NotFound(_)),
                "未登记会话必须 NotFound，实为 {err:?}"
            );
        }

        // 未知会话关闭：不得 panic，且如实回答「不是我处理的」（不是错误路径）。
        assert!(!router.close_session(id, None), "未登记会话不属于本路由");
    }

    /// 「这个 id 背后有没有 PTY」—— 删除会话时据此决定要不要先结束进程。
    #[test]
    fn owns_terminal_session_answers_by_registration_only() {
        let router = TerminalRouter::new();
        assert!(!router.owns_terminal_session("nope"));

        router.register("ssh-session-1", SessionOwner::Ssh);
        assert!(router.owns_terminal_session("ssh-session-1"));

        // 关闭后归属释放 ⇒ 探测随之变假（不会留下「还存在」的假信号）。
        assert!(
            router.close_session("ssh-session-1", None),
            "归我管的由我处理"
        );
        assert!(!router.owns_terminal_session("ssh-session-1"));

        // 再关一次是幂等 no-op：`false` 表示「已经不在我这儿了」，不是失败。
        assert!(!router.close_session("ssh-session-1", None));
    }

    /// 关闭只认**归本路由管**的会话：一个 chat 会话的 id 不该把注册表条目错标成 `Stopped`。
    ///
    /// 早先的实现是「先 `owns_terminal_session`、再 `close_session`」两步，探测与派发之间
    /// 会话可能已经结束，于是留下一条误导性的「unknown session」告警；现在两者同一个临界区。
    #[test]
    fn closing_a_session_it_does_not_own_touches_nothing() {
        let store = Arc::new(
            crate::agent::chat::session_store::SqliteSessionStore::open_in_memory()
                .expect("in-memory store"),
        );
        let registry = Arc::new(crate::live_sessions::Registry::new(store));
        registry.register(
            crate::live_sessions::SessionEntry::new(
                "chat-1",
                crate::live_sessions::SessionKind::Chat,
                None,
                crate::common::git::WorkspaceSession::of("p1", None),
                "/proj",
            )
            .with_state(crate::live_sessions::SessionState::Running),
        );
        let router = TerminalRouter::with_live_sessions(Arc::clone(&registry));

        assert!(
            !router.close_session("chat-1", None),
            "终端不认领 chat 会话"
        );
        assert_eq!(
            registry.entry("chat-1").expect("条目仍在").state,
            crate::live_sessions::SessionState::Running,
            "不归我管就不能改它的状态"
        );
    }

    /// 后端访问器暴露的必须是**同一实例**（Arc 内部共享）：关闭后再次查询仍路由一致。
    #[test]
    fn backend_accessors_expose_the_shared_instances() {
        let router = TerminalRouter::new();
        // 同一 manager 的两次取用行为一致（不 panic、不产生新实例语义）。
        router.local().close_session("absent");
        router.remote().close_session("absent");
    }

    /// 拆除必须**释放归属登记**（`close_session` 取 `take_owner` 而非 `owner_of`）。
    ///
    /// 回归钉子：绕过 `close_session` 直连某个后端（如 `router.local().close_session(..)`）
    /// 不会摘表，于是 SSH 会话既关不掉、归属登记又永久泄漏；而只读归属的后端访问器拿不到
    /// `take_owner` 的摘除语义。本用例钉住「走 router 关闭 = 路由到后端 + 释放登记」。
    #[test]
    fn close_session_releases_the_owner_registration() {
        let router = TerminalRouter::new();
        let id = "ssh-session-1";
        router.register(id, SessionOwner::Ssh);
        assert_eq!(router.owner_of(id), Some(SessionOwner::Ssh));

        router.close_session(id, None);

        // 登记已摘除 ⇒ 重复关闭走 None 分支（幂等告警，不重复下发后端）。
        assert_eq!(
            router.owner_of(id),
            None,
            "close must take (not peek) the owner"
        );
        router.close_session(id, None);
        assert_eq!(router.owner_of(id), None);
    }
}
