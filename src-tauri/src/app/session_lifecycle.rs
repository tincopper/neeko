//! 会话生命周期**编排**：删除一条 live session 的唯一入口。
//!
//! # 为什么这一段属于组合根
//!
//! 「怎么结束一条会话」在每个领域里都**只有一份实现**，而它分属两个生产者：
//!
//! - 终端：`TerminalRouter::close_session`（PTY / SSH 后端各自收尾）；
//! - chat：队列里的 `SessionRequest::Cancel` + `AgentChatManager::unregister`。
//!
//! 要跨两者编排，只有组合根同时认得它们。放进 `live_sessions` 会让注册表反过来依赖
//! 进程生命周期，而它的分层承诺正是「只观察信号，不拥有进程」；放进任一生产者则要
//! 让 chat 认识终端（或反过来），那是跨域私有实现依赖。
//!
//! # 归属探测而不是 `kind` 分支
//!
//! 两个探测都是「这个 id 归你管吗」的**存在性判断**，不复制任何一条终止规则：
//! 命中哪一个就走哪个生产者现成的入口。于是「怎么停」永远只有一份，
//! 而「先问谁」这件事只在这里。
//!
//! # 与「关 tab」的差别
//!
//! 关 tab 走 `lifecycle::close_and_notify`：标 `Stopped` 但**保留**条目（「点回来」的入口）。
//! 删除是用户明确要扔掉这一行 —— 结束进程之后再 `unregister_and_notify` 摘掉条目。
//!
//! # 视图侧的前置条件
//!
//! 本命令**只动后端**。前端必须先关掉承载该会话的 tab（`closeEditorTab`）：
//! tab 是「这条会话的视图」，会话没了还留一个死终端面板就只是噪声；反过来（先删条目）
//! 会让 tab 的关闭路径再去关一个已不存在的进程。顺序由前端负责，见
//! `features/live-sessions/hooks/useSessionRowActions.ts` 与
//! `.trellis/spec/backend/agent-chat-transports.md`「删除」一节。

use crate::agent::chat::events::SessionRequest;
use crate::agent::chat::manager::AgentChatManager;
use crate::app_state::AppStateWrapper;
use crate::common::error::AppError;
use crate::live_sessions::lifecycle::unregister_and_notify;
use crate::live_sessions::Registry;
use crate::terminal::TerminalRouter;

/// 删除一条会话：**结束进程（若还活着）→ 摘掉注册表条目**。
///
/// 返回「是否真的删掉了一条」（幂等：未知 / 已删除的 id 返回 `false`，不 bump 版本）。
/// 归属为团队成员的会话**拒绝删除**（见 [`delete_session`]）。
///
/// 命令层只做拆参数与透传错误（红线 6）：编排与容错都在 [`delete_session`]。
#[tauri::command]
pub async fn delete_live_session(
    session_id: String,
    state: tauri::State<'_, AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<bool, AppError> {
    delete_session(
        &state.live_sessions,
        &state.terminal_router,
        &state.agent_chat_manager,
        Some(&app_handle),
        &session_id,
    )
    .await
}

/// 编排本体（依赖注入，可脱离 `AppStateWrapper` 直测）。
///
/// 顺序：先停进程，再摘条目。反过来的话，注册表已摘而进程还在跑，
/// 之后再没有任何入口能定位到它（泄漏一个看不见的进程）。
///
/// # 归属门：团队成员会话不出侧栏删
///
/// 成员的生命周期只能由团队域结束（`team_close` / 归档 / 花名册）—— 侧栏不是第二条路径。
/// 这里的拒绝必须在**停进程之前**：一旦 `close_session` 先跑，团队侧只剩「成员行
/// `session.live = false`」一个表现，与「CLI 自己崩了」无法区分。
///
/// 拒绝时**不结束进程、不摘条目**，返回可读的 `Conflict`（toast 是用户对「为什么
/// 这条删不掉」的唯一解释）。归属于 `User` 的会话行为完全不变。
pub(crate) async fn delete_session(
    registry: &Registry,
    terminal_router: &TerminalRouter,
    chat: &AgentChatManager,
    app: Option<&tauri::AppHandle>,
    session_id: &str,
) -> Result<bool, AppError> {
    let belongs_to_a_team_member = registry.entry(session_id).is_some_and(|entry| {
        matches!(
            entry.attribution,
            crate::live_sessions::SessionAttribution::TeamMember { .. }
        )
    });
    if belongs_to_a_team_member {
        return Err(AppError::Conflict(team_member_refusal().to_string()));
    }
    stop_owning_process(terminal_router, chat, app, session_id).await;
    Ok(unregister_and_notify(registry, app, session_id))
}

/// 拒绝删除团队成员会话时的文案。
///
/// 会被 `AppError::Conflict` 渲染成 `Conflict: {这句}`，且是用户看到的唯一解释 ——
/// 必须能独立读懂，并指向真正可行的入口。
const fn team_member_refusal() -> &'static str {
    "This session belongs to a team member. Close it from the Team panel instead."
}

/// 让拥有这个 id 的生产者停掉它。**两个探测都不命中 ⇒ 什么都不做**。
///
/// 探测顺序固定（终端在前）：一个 id 不可能同时是 PTY 会话与 chat 会话，
/// 两条分支是互斥的归属判断，不是优先级策略。
///
/// 「怎么停」由生产者自己的入口定义（[`TerminalRouter::close_session`] 幂等地返回
/// 是否由它处理；chat 走 `Cancel` + `unregister`），本函数不复制任何一条规则。
async fn stop_owning_process(
    terminal_router: &TerminalRouter,
    chat: &AgentChatManager,
    app: Option<&tauri::AppHandle>,
    session_id: &str,
) {
    if terminal_router.close_session(session_id, app) {
        return;
    }
    if chat.get(session_id).is_none() {
        return;
    }
    // 失败可忽略：会话可能在这一刻刚好结束（管理器已摘条目）。
    // 与 `agent_stream_cancel` 同一条容错口径 —— 两者都是「停止 chat 会话」的同一语义。
    let _ = chat.send(session_id, SessionRequest::Cancel).await;
    chat.unregister(session_id);
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use tokio::sync::mpsc;

    use super::*;
    use crate::agent::chat::manager::SessionHandle;
    use crate::agent::chat::session_store::SqliteSessionStore;
    use crate::common::git::WorkspaceSession;
    use crate::live_sessions::{SessionEntry, SessionKind, SessionState};

    /// 只组装这条编排用得到的三件东西（不构造整个 `AppStateWrapper`：它需要
    /// 数据库 / 运行时 / 通知中心，而本编排的正确性与它们无关）。
    struct Fixture {
        registry: Registry,
        router: TerminalRouter,
        chat: AgentChatManager,
    }

    fn fixture() -> Fixture {
        let store = Arc::new(SqliteSessionStore::open_in_memory().expect("in-memory store"));
        let registry = Registry::new(store.clone());
        // router 接同一个注册表：它关会话时也会走 `close_and_notify`。
        let router = TerminalRouter::with_live_sessions(Arc::new(Registry::new(store.clone())));
        Fixture {
            registry,
            router,
            chat: AgentChatManager::with_store(store),
        }
    }

    fn registered(registry: &Registry, session_id: &str, kind: SessionKind) {
        registry.register(
            SessionEntry::new(
                session_id,
                kind,
                None,
                WorkspaceSession::of("p1", None),
                "/proj",
            )
            .with_state(SessionState::Running),
        );
    }

    /// 团队成员起的 PTY（生产路径：`app/team_executor` 在起进程那一刻写入归属）。
    fn registered_for_a_member(registry: &Registry, session_id: &str) {
        registry.register(
            SessionEntry::new(
                session_id,
                SessionKind::Terminal,
                Some("pi".into()),
                WorkspaceSession::of("p1", None),
                "/proj",
            )
            .with_state(SessionState::Running)
            .with_user_input(true)
            .with_attribution(crate::live_sessions::SessionAttribution::TeamMember {
                team_id: "tm_1".into(),
                member_id: "w1@tm_1".into(),
            }),
        );
    }

    fn chat_session(chat: &AgentChatManager, session_id: &str) {
        chat.register(
            session_id.into(),
            SessionHandle {
                agent_id: "opencode".into(),
                workspace: WorkspaceSession::of("p1", None),
                request_tx: mpsc::channel(8).0,
            },
            None,
        );
    }

    /// 两个生产者都不认领 ⇒ 只摘条目，幂等（第二次返回 `false`，不 bump）。
    #[tokio::test]
    async fn unknown_id_only_unregisters() {
        let f = fixture();
        registered(&f.registry, "s1", SessionKind::Terminal);
        let before = f.registry.version();

        assert!(
            delete_session(&f.registry, &f.router, &f.chat, None, "s1")
                .await
                .expect("unknown id 不是错误，是幂等 no-op"),
            "未登记的生产者仍要走摘条目这条路径"
        );
        assert!(f.registry.entry("s1").is_none(), "条目必须摘掉");
        assert!(f.registry.version() > before, "摘条目是一次可见变更");

        let after = f.registry.version();
        assert!(
            !delete_session(&f.registry, &f.router, &f.chat, None, "s1")
                .await
                .expect("重复删除也不是错误"),
            "重复删除是 no-op"
        );
        assert_eq!(f.registry.version(), after, "no-op 不得 bump 版本");
    }

    /// chat 会话：Cancel + unregister，管理器不再持有它（不留下无主的请求通道）。
    #[tokio::test]
    async fn chat_session_is_cancelled_and_unregistered() {
        let f = fixture();
        registered(&f.registry, "c1", SessionKind::Chat);
        chat_session(&f.chat, "c1");

        assert!(delete_session(&f.registry, &f.router, &f.chat, None, "c1")
            .await
            .expect("chat 会话可删"));
        assert!(f.chat.get("c1").is_none(), "chat 管理器条目必须摘掉");
        assert!(f.registry.entry("c1").is_none());
    }

    /// 终端会话：走 router 的关闭入口（它同时把条目标 `Stopped`），随后删除把它摘掉。
    #[tokio::test]
    async fn terminal_session_is_closed_then_removed() {
        let f = fixture();
        registered(&f.registry, "t1", SessionKind::Terminal);
        // 只登记归属，不起真实进程：路由判定与终止派发都是纯表操作。
        f.router.register_owner_for_test("t1");

        assert!(delete_session(&f.registry, &f.router, &f.chat, None, "t1")
            .await
            .expect("terminal 会话可删"));
        assert!(!f.router.owns_terminal_session("t1"), "关闭后归属必须释放");
        assert!(f.registry.entry("t1").is_none());
    }

    /// 团队成员会话：侧栏删除**必须判负**，且一步都不能动 ——
    /// 进程不停（router 仍拥有它）、条目不摘（侧栏行不消失）。
    ///
    /// 成员的生命周期只能由团队域结束（`team_close` / 归档 / 花名册）。
    #[tokio::test]
    async fn a_team_members_session_is_refused_and_left_untouched() {
        let f = fixture();
        registered_for_a_member(&f.registry, "m1");
        f.router.register_owner_for_test("m1");
        let before = f.registry.version();

        let err = delete_session(&f.registry, &f.router, &f.chat, None, "m1")
            .await
            .expect_err("团队成员会话不得从侧栏删除");
        assert!(
            matches!(err, AppError::Conflict(_)),
            "拒绝必须是 Conflict（可读的业务冲突），实际：{err:?}"
        );
        assert!(
            err.to_string().contains("Team panel"),
            "文案要指向真正可行的入口：{err}"
        );

        assert!(
            f.router.owns_terminal_session("m1"),
            "进程不得被停（否则团队侧只剩 session.live=false，与 CLI 自己崩了无法区分）"
        );
        assert!(f.registry.entry("m1").is_some(), "侧栏行不得消失");
        assert_eq!(f.registry.version(), before, "拒绝不是一次可见变更");
    }
}
