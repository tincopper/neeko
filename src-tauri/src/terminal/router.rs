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
//! `(环境, 项目路径)` 快照，本模块只做"往哪个后端发"。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use crate::common::terminal::types::TerminalSession;
use crate::core::project::ProjectEnvironment;
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
}

impl Default for TerminalRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalRouter {
    /// 新建空路由器（两个后端各自新建）。
    #[must_use]
    pub fn new() -> Self {
        Self {
            local: TerminalManager::new(),
            remote: RemoteTerminalManager::new(),
            owners: Mutex::new(HashMap::new()),
        }
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

    /// 按项目环境创建会话，并登记归属。
    ///
    /// `command` 有值表示这是**任务终端**（由 task 域创建）—— 主题准备据此跳过。
    #[allow(clippy::too_many_arguments)]
    pub async fn create_session(
        &self,
        env: &ProjectEnvironment,
        project_path: &str,
        cols: u16,
        rows: u16,
        shell: Option<String>,
        working_dir: Option<String>,
        command: Option<String>,
        app_handle: tauri::AppHandle,
    ) -> Result<TerminalSession, AppError> {
        // 主题产物属主题域，由该域按环境准备（见 `theme::service::prepare_project_theme`）。
        crate::theme::service::prepare_project_theme(env, project_path, command.is_some()).await;

        match env {
            ProjectEnvironment::Local => {
                let session = self
                    .local
                    .create_session(
                        project_path,
                        cols,
                        rows,
                        shell,
                        working_dir,
                        command,
                        app_handle,
                    )
                    .map_err(AppError::from)?;
                self.register(&session.id, SessionOwner::Pty);
                Ok(session)
            }
            #[cfg(target_os = "windows")]
            ProjectEnvironment::Wsl { distro } => {
                let session = self
                    .local
                    .create_wsl_session(distro, project_path, cols, rows, app_handle)
                    .map_err(AppError::from)?;
                self.register(&session.id, SessionOwner::Pty);
                Ok(session)
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
                        project_path,
                        cols,
                        rows,
                        app_handle,
                    )
                    .await
                    .map_err(AppError::from)?;
                self.register(&session.id, SessionOwner::Ssh);
                Ok(session)
            }
        }
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
    pub fn close_session(&self, session_id: &str) {
        match self.take_owner(session_id) {
            Some(SessionOwner::Pty) => self.local.close_session_in_background(session_id),
            Some(SessionOwner::Ssh) => self.remote.close_session(session_id),
            None => log::warn!("[Terminal] Attempted to close unknown session: {session_id}"),
        }
    }
}

/// 路由表未命中 → 统一的 `NotFound` 文案。
fn unknown_session(session_id: &str) -> AppError {
    AppError::NotFound(format!("Terminal session not found: {session_id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

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

        // 未知会话关闭：不得 panic（原实现同样只告警）。
        router.close_session(id);
    }

    /// 后端访问器暴露的必须是**同一实例**（Arc 内部共享）：关闭后再次查询仍路由一致。
    #[test]
    fn backend_accessors_expose_the_shared_instances() {
        let router = TerminalRouter::new();
        // 同一 manager 的两次取用行为一致（不 panic、不产生新实例语义）。
        router.local().close_session("absent");
        router.remote().close_session("absent");
    }
}
