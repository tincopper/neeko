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
use crate::terminal::manager::{TerminalLaunch, TerminalManager};
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

/// 创建一个终端会话的完整输入（值对象：一次构造、一次传递）。
///
/// # 为什么不是八个位置参数
///
/// 其中三个是 `Option` / 切片（`shell` / `launch` / `extra_env`），位置调用点读不出语义
/// —— `&[]` 到底是「没有身份要注入」还是「忘了传」？字段名让每个调用点自解释；新增一项
/// 输入时也只需给字段一个默认值，不必改遍所有调用方。
///
/// # 字段分组
///
/// `env` / `workspace_root` / `cwd` 是**路由维度**（传输 + 落点）；`launch` / `extra_env`
/// 是**启动维度**（起什么、带什么身份）；`cols` / `rows` 是尺寸。三组互不依赖。
pub struct SessionSpec {
    /// 执行环境（传输维度：Local / WSL / SSH，红线 10）。
    pub env: ProjectEnvironment,
    /// 该 Workspace 的根（项目级产物的权威落点）。
    pub workspace_root: String,
    /// 进程运行目录（根，或 Workspace 内子目录覆盖）。
    pub cwd: String,
    /// 初始列数。
    pub cols: u16,
    /// 初始行数。
    pub rows: u16,
    /// 交互 shell 覆盖（`None` = 平台默认）。
    pub shell: Option<String>,
    /// 起什么：`None` = 交互 shell；`Some(Shell)` = 任务终端；`Some(Argv)` = 精确 argv。
    pub launch: Option<TerminalLaunch>,
    /// 要注入子进程的身份变量（不透明，本域不认识其语义）。
    pub extra_env: Vec<(String, String)>,
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
    /// 输入全部装在 [`SessionSpec`] 里（理由见该结构）。两条**前置约束**在这里兑现：
    ///
    /// - `launch = Some(Argv)` 必须是非空列表（见 [`ensure_launch_valid`]）；
    /// - `extra_env` 只能注入 Local 路径（见 [`ensure_env_injectable`]）。
    ///
    /// 两条都是「拒绝而不是降级」：静默回退到交互 shell / 静默丢掉身份变量，都会让调用方
    /// 拿到一个看起来正常、实际不可用的会话。
    pub async fn create_session(
        &self,
        spec: SessionSpec,
        app_handle: tauri::AppHandle,
    ) -> Result<TerminalSession, AppError> {
        let SessionSpec {
            env,
            workspace_root,
            cwd,
            cols,
            rows,
            shell,
            launch,
            extra_env,
        } = spec;
        ensure_launch_valid(&launch)?;
        ensure_env_injectable(&env, &extra_env)?;
        // 主题产物属主题域，由该域按环境准备（见 `theme::service::prepare_project_theme`）。
        // 项目级配置落在 Workspace 根，**不**随语言 runner 的模块子目录覆盖漂移。
        crate::theme::service::prepare_project_theme(&env, &workspace_root, launch.is_some()).await;

        match env {
            ProjectEnvironment::Local => {
                let session = self
                    .local
                    .create_session(&cwd, cols, rows, shell, launch, &extra_env, app_handle)
                    .map_err(AppError::from)?;
                self.register(&session.id, SessionOwner::Pty);
                Ok(session)
            }
            #[cfg(target_os = "windows")]
            ProjectEnvironment::Wsl { distro } => {
                let session = self
                    .local
                    .create_wsl_session(&distro, &cwd, cols, rows, app_handle)
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
                        &host,
                        port,
                        &username,
                        &auth,
                        &workspace_root,
                        &cwd,
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

/// 身份 env 只能注入 **Local** 路径。
///
/// # 为什么拒绝而不是忽略
///
/// WSL 走 `CommandBuilder` 的 `wsl.exe -- bash -c`（env 进不了内层 bash），SSH 走远端 shell
/// （env 在另一个进程树里）。把 `extra_env` 静默丢掉的结果是：成员在花名册里、进程也活着，
/// 但它的上报**没有身份** —— 而归因失败在团队上下文里是**拒绝归属**（design §5.4），
/// 表现为「成员永远不产出」。这种失败离家太远，宁可让调用方在 spawn 时就拿到
/// `Unsupported`。
fn ensure_env_injectable(
    env: &ProjectEnvironment,
    extra_env: &[(String, String)],
) -> Result<(), AppError> {
    if extra_env.is_empty() || matches!(env, ProjectEnvironment::Local) {
        return Ok(());
    }
    Err(AppError::Unsupported(
        "identity env can only be injected into a local PTY session; the WSL and SSH paths \
         run the process in a different shell, so the variables would be dropped and the \
         session would report without an identity"
            .to_string(),
    ))
}

/// `Argv` 形态必须至少含一个元素（程序名）。
///
/// 校验在**域边界**而不是在 `TerminalManager` 里：那里只能返回 `anyhow::Error`，
/// 会被 `From<anyhow::Error>` 归成 `Unknown` —— 一个调用方的编程错误被报成未知错误，
/// 排查方向会跑偏。（`TerminalManager` 仍保留同义守卫，它面对的是直接调它的代码。）
fn ensure_launch_valid(launch: &Option<TerminalLaunch>) -> Result<(), AppError> {
    match launch {
        Some(TerminalLaunch::Argv(argv)) if argv.is_empty() => Err(AppError::InvalidInput(
            "an argv launch needs a program as its first element; an empty argv would silently \
             fall back to an interactive shell"
                .to_string(),
        )),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::connection::types::AuthMethod;

    /// `Argv` 形态的**非空约束**在这里兑现：空列表是调用方的编程错误（`InvalidInput`），
    /// 不是「回退到交互 shell」的理由。
    ///
    /// 反例：静默回退会让团队成员「起来了但没连上工具面」—— 花名册上看不出来。
    #[test]
    fn an_empty_argv_launch_is_invalid_input() {
        let err = ensure_launch_valid(&Some(TerminalLaunch::Argv(Vec::new())))
            .expect_err("空 argv 必须拒绝");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
        assert!(err.to_string().contains("program"), "{err}");

        // 其余三形态都合法。
        assert!(ensure_launch_valid(&None).is_ok());
        assert!(ensure_launch_valid(&Some(TerminalLaunch::Shell("cargo test".into()))).is_ok());
        assert!(ensure_launch_valid(&Some(TerminalLaunch::Argv(vec!["claude".into()]))).is_ok());
    }

    /// 身份 env 的注入只对 Local 成立；其余传输必须显式拒绝而不是静默丢弃。
    #[test]
    fn identity_env_is_only_injectable_on_the_local_path() {
        let env = vec![("NEEKO_TEAM_ID".to_string(), "tm_1".to_string())];
        assert!(ensure_env_injectable(&ProjectEnvironment::Local, &env).is_ok());
        // 空 env 对任何传输都无害（普通终端会话走这条）。
        assert!(ensure_env_injectable(&ProjectEnvironment::Local, &[]).is_ok());
        assert!(
            ensure_env_injectable(
                &ProjectEnvironment::Remote {
                    host: "h".into(),
                    port: 22,
                    username: "u".into(),
                    auth: AuthMethod::Password(String::new()),
                },
                &[],
            )
            .is_ok(),
            "没有要注入的东西时不得因为传输是 SSH 就拒绝"
        );
        let err = ensure_env_injectable(
            &ProjectEnvironment::Remote {
                host: "h".into(),
                port: 22,
                username: "u".into(),
                auth: AuthMethod::Password(String::new()),
            },
            &env,
        )
        .expect_err("SSH 路径注入身份 env 必须是 Unsupported");
        assert!(matches!(err, AppError::Unsupported(_)), "{err:?}");
        assert!(err.to_string().contains("local PTY"), "{err}");
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

        router.close_session(id);

        // 登记已摘除 ⇒ 重复关闭走 None 分支（幂等告警，不重复下发后端）。
        assert_eq!(
            router.owner_of(id),
            None,
            "close must take (not peek) the owner"
        );
        router.close_session(id);
        assert_eq!(router.owner_of(id), None);
    }
}
