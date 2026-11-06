//! hooks 生产者：CLI hook 上报（[`HookEvent`]）→ 会话标题（`Native`）+ 权威状态。
//!
//! # 为什么这是**最权威**的标题源
//!
//! 模板（`agent/hooks/templates/`）上报的 `title` 是 CLI **自己的**会话主题：用户给会话起的
//! 名字（pi 的 `getSessionName`、claude 的 `session_title`）优先，退化到首条用户消息。
//! 这比我们从字节流里猜（OSC 标题 / 首条输入行）质量更高 —— 它正是 Codex 那类桌面端
//! 展示在会话列表里的东西，因此映射到 [`TitleSource::Native`]。
//!
//! # 终端 I/O 不是**通用**标题源（第 35 / 37 轮）
//!
//! OSC `onTitleChange` 整条断开（状态栏帧、协议应答、TUI 控件文本都走那条通道）；
//! `term.onData` 的行只对**纯 shell** 生效 —— 裁决在
//! `Registry::report_terminal_input`（`agent_id` 是唯一判据）。agent 会话的标题因此只来自
//! 四类事实源：用户改名、hook `topic`、conversation 缓存里的 provider title、chat 真实 prompt。
//!
//! 因此**没有 `topic` 的 hook 会回落**到 `ConversationManager::cached_title_for_native`
//! （按 registry 条目的 `agent_id` + `event.agent_session_id`）。该方法只读内存缓存，
//! **不扫盘、不触发扫描**（红线 3）—— 缓存刷新由既有 conversation scan 链路负责。
//!
//! # 归因只认 `hints.neeko_session_id`
//!
//! 会话身份由 PTY 子进程的 env（本地 `CommandBuilder::env` / WSL·SSH 的 shell `export`）
//! 下发，随进程树继承到 agent CLI 与它拉起的 hook shim。于是
//!
//! ```text
//! shell(我们 spawn、id 已注入) → agent CLI → hook shim(读 NEEKO_SESSION_ID → 上报)
//! ```
//!
//! 精确命中，零查询成本。**不按 cwd 猜**：同一项目里多会话是本应用的常态，猜错的表现是
//! 「另一个会话的标题被改写」—— 标题是用户直接读到的文字，宁可空着也不显示错的
//! （`has_user_input` 这种低代价判断可以容忍粗归因，标题不行）。
//!
//! 未知会话（会话已注销、或 id 来自嵌套 agent 的父会话）一律丢弃：注册表**绝不为它建条目**。

use std::sync::Arc;

use tauri::Manager;

use crate::agent::chat::notify::event_keys;
use crate::agent::hooks::ingest::dispatch::HookSink;
use crate::agent::hooks::ingest::event::HookEvent;
use crate::conversation::ConversationManager;
use crate::live_sessions::emit_changed;
use crate::live_sessions::entry::TitleSource;
use crate::live_sessions::registry::Registry;
use crate::live_sessions::state::Signal;
use crate::AppStateWrapper;

/// 语义事件 → 权威状态信号。
///
/// 这些事件来自 CLI 自己的生命周期，而不是对 PTY 字节流的推断：
/// - `turn_completed` ⇒ `Ready`；
/// - 审批 / 输入请求 ⇒ `AwaitingApproval`；
/// - 失败 ⇒ `Failed`（终止态吸收迟到信号）。
///
/// 返回 `None` 的是纯信息事件，只允许更新标题。
///
/// 键名直接引用 agent 域的**常量单一源**（`event_keys`）：模板与通知分类用的是同一份
/// 词汇表，这里再抄一遍字面量就会在模板改名时静默失效。
#[must_use]
fn authoritative_signal(event_key: &str) -> Option<Signal> {
    match event_key {
        event_keys::TURN_COMPLETED => Some(Signal::TurnFinished),
        event_keys::APPROVAL_REQUESTED | event_keys::INPUT_REQUESTED => {
            Some(Signal::ApprovalRequested)
        }
        event_keys::SESSION_FAILED => Some(Signal::Failed),
        _ => None,
    }
}

/// 上报归属的会话 id（`hints.neeko_session_id`，trim 后非空）。
#[must_use]
fn attributed_session(event: &HookEvent) -> Option<&str> {
    event
        .hints
        .neeko_session_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
}

/// 把一条 hook 上报投影进注册表；返回「真的有变化」（调用方据此发一次变更事件）。
///
/// 标题、可见性与状态同属一次上报，故**只走一次注册表写入**（一次 hook 只
/// [`emit_changed`] 一次）：
/// - 有 `topic` ⇒ 直接用它做 `Native` 标题；
/// - **只有** `topic` 缺失且 registry 尚无真标题时才回落 `cached_title_for`
///   （registry 条目的 `agent_id` + `event.agent_session_id`）查 conversation 缓存；
/// - 权威事件 ⇒ 置位 `has_user_input`、应用状态并开启输出推断门；
/// - 纯信息事件 ⇒ 只更新标题。
///
/// 回落标题同样是 `Native`：`should_upgrade` 保证用户改名（`User`）永不被覆盖。
/// `cached_title_for` 由调用方注入，生产实现只读内存缓存（**不触发扫描 / 不读盘**，
/// 红线 3）；测试可注入固定值而不碰 Tauri 运行时。
pub(crate) fn project(
    registry: &Registry,
    event: &HookEvent,
    cached_title_for: &dyn Fn(&str, &str) -> Option<String>,
) -> bool {
    let Some(session_id) = attributed_session(event) else {
        return false;
    };
    // 原生会话 id：`resume_command` 的唯一入参，点击恢复时用（不进 wire 契约）。
    registry.record_native_session_id(session_id, &event.agent_session_id);
    let title: Option<String> = match event.topic() {
        Some(topic) => Some(topic.to_string()),
        None => registry.entry(session_id).and_then(|entry| {
            // 缓存是扫描快照，不是事件时刻的事实；已有真标题的会话不能被它同级改回旧值。
            // 判据复用 `SessionEntry::has_real_title`（与注册表同一份），不在这里再造一个。
            if entry.has_real_title() {
                return None;
            }
            let agent_id = entry.agent_id?;
            cached_title_for(&agent_id, &event.agent_session_id)
        }),
    };
    let title = title.as_deref().map(|topic| (TitleSource::Native, topic));
    match authoritative_signal(event.event.as_str()) {
        Some(signal) => registry.report_authoritative(session_id, title, signal),
        None => registry.report(session_id, title, false),
    }
}

/// 投递入口（本域自己消费，见 [`on_hook_event`] 的调用方 sink）。
///
/// 未归属的上报直接返回 `false`，不打印（hook 可能来自并非本应用拉起的终端，
/// 那是常态而非缺陷；要排障时把 `is_usable` 一侧的日志打开即可）。
///
/// 回落只调 [`ConversationManager::cached_title_for_native`]：纯内存查表。缓存刷新
/// 由既有 conversation scan 链路负责，hook 的阻塞池线程**不做磁盘扫描**（红线 3）。
pub(crate) fn on_hook_event(
    registry: &Registry,
    conversation: &ConversationManager,
    app: &tauri::AppHandle,
    event: &HookEvent,
) -> bool {
    let changed = project(registry, event, &|agent_id, native_id| {
        let title = conversation
            .cached_title_for_native(agent_id, native_id)
            .unwrap_or_else(|err| {
                log::warn!("[live_sessions] conversation cache lookup failed: {err:#}");
                None
            });
        if title.is_none() {
            // 回落是**机会性**的：缓存未命中是常态（没扫到 / 该 adapter 的原生 id 与 hook 的
            // `agent_session_id` 不同名）。记一行 debug，排障时能区分「没命」与「没调」。
            log::debug!("[live_sessions] no cached title for {agent_id}:{native_id}");
        }
        title
    });
    if changed {
        emit_changed(app, registry.version());
    }
    changed
}

/// 装配用的消费者入口（组合根把它与通知 sink 并列传给 `agent::hooks::boot`）。
///
/// 让 ingest 层**不知道**谁在消费：它只拿一组 `HookSink` 按序投递，本域的投影逻辑
/// 留在本域（依赖方向：组合根 → 各域，而不是 agent ↔ live_sessions 互指）。
#[must_use]
pub(crate) fn sink() -> HookSink {
    Arc::new(|app, _source, event| {
        let state = app.state::<AppStateWrapper>();
        on_hook_event(
            &state.live_sessions,
            &state.conversation_manager,
            app,
            event,
        );
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::chat::session_store::SqliteSessionStore;
    use crate::common::git::WorkspaceSession;
    use crate::live_sessions::entry::{SessionEntry, SessionKind, SessionState};
    use std::sync::Arc;

    fn fresh_registry() -> Registry {
        Registry::new(Arc::new(
            SqliteSessionStore::open_in_memory().expect("in-memory session store"),
        ))
    }

    /// 注册一条终端会话（与 PTY 生产者的形状一致：占位空标题、未 has_user_input）。
    fn registry_with_terminal(session_id: &str) -> Registry {
        let registry = fresh_registry();
        registry.register(
            SessionEntry::new(
                session_id,
                SessionKind::Terminal,
                Some("claude-code".into()),
                WorkspaceSession::of("p1", Some("/proj-wt".into())),
                "/proj-wt",
            )
            .with_state(SessionState::Running),
        );
        registry
    }

    fn event(key: &str, hints_id: Option<&str>, title: Option<&str>) -> HookEvent {
        HookEvent {
            agent_session_id: "agent-1".into(),
            event: key.into(),
            cwd: Some("/proj-wt".into()),
            detail: None,
            title: title.map(str::to_string),
            hints: crate::agent::hooks::ingest::attribution::EnvHints {
                neeko_session_id: hints_id.map(str::to_string),
                project_id: Some("p1".into()),
            },
        }
    }

    /// 既有用例不关心 conversation 回落：注入一个「缓存未命中」解析器。
    /// 局部定义遮蔽 `use super::*` 带来的同名 glob 导入。
    fn project(registry: &Registry, event: &HookEvent) -> bool {
        super::project(registry, event, &|_agent_id, _native_id| None)
    }

    /// 精确归因（`hints.neeko_session_id`）⇒ 标题落到 `Native`，且 `has_user_input` 置位。
    #[test]
    fn report_names_the_session_and_engages_it() {
        let registry = registry_with_terminal("pty-1");
        assert!(project(
            &registry,
            &event("turn_completed", Some("pty-1"), Some("修复登录竞态"))
        ));

        let entry = &registry.snapshot()[0];
        assert_eq!(entry.title, "修复登录竞态");
        assert_eq!(entry.title_source, TitleSource::Native);
        assert!(entry.has_user_input);
    }

    /// Codex 的 `turn_completed` 必须把状态落到 Ready；随后仅由 PTY 重绘产生的
    /// 输出活动不得再把它推回 Running。
    #[test]
    fn turn_completed_settles_status_against_output_activity() {
        let registry = registry_with_terminal("pty-1");
        assert!(project(
            &registry,
            &event("turn_completed", Some("pty-1"), Some("修复登录竞态"))
        ));
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.state, SessionState::Ready);

        assert!(!registry.apply_activity("pty-1", crate::live_sessions::state::Signal::TurnStarted));
        assert_eq!(registry.snapshot()[0].state, SessionState::Ready);
    }

    /// 迟到的纯信息事件只允许补标题，不得关闭权威门或改写完成态。
    #[test]
    fn informational_event_after_completion_keeps_the_authority_gate() {
        let registry = registry_with_terminal("pty-1");
        assert!(project(
            &registry,
            &event("turn_completed", Some("pty-1"), Some("first title"))
        ));
        assert!(project(
            &registry,
            &event("session_started", Some("pty-1"), Some("richer title"))
        ));

        let entry = &registry.snapshot()[0];
        assert_eq!(entry.state, SessionState::Ready);
        assert_eq!(entry.title, "richer title");
        assert!(entry.awaiting_user_activity);
        assert!(!registry.apply_activity("pty-1", Signal::TurnStarted));
        assert_eq!(registry.snapshot()[0].state, SessionState::Ready);
    }

    /// 审批 / 等待输入都是权威状态；普通 PTY 输出不能覆盖。
    #[test]
    fn approval_events_settle_status_against_output_activity() {
        let registry = registry_with_terminal("pty-1");
        assert!(project(
            &registry,
            &event("approval_requested", Some("pty-1"), None)
        ));
        assert_eq!(registry.snapshot()[0].state, SessionState::AwaitingApproval);
        assert!(!registry.apply_activity("pty-1", crate::live_sessions::state::Signal::TurnStarted));
        assert_eq!(registry.snapshot()[0].state, SessionState::AwaitingApproval);
    }

    /// 失败事件是终止态；迟到输出不得复活。
    #[test]
    fn failure_event_settles_status_against_output_activity() {
        let registry = registry_with_terminal("pty-1");
        assert!(project(
            &registry,
            &event("session_failed", Some("pty-1"), None)
        ));
        assert_eq!(registry.snapshot()[0].state, SessionState::Failed);
        assert!(
            !registry.snapshot()[0].awaiting_user_activity,
            "终止态由状态机永久吸收，不需要额外的输出门"
        );
        assert!(!registry.apply_activity("pty-1", crate::live_sessions::state::Signal::TurnStarted));
        assert_eq!(registry.snapshot()[0].state, SessionState::Failed);
    }

    /// 占位标题（opencode 的 `New session - <ISO>`）不算主题：不写标题，但 `has_user_input` 照置。
    #[test]
    fn placeholder_topic_only_engages() {
        let registry = registry_with_terminal("pty-1");
        assert!(project(
            &registry,
            &event(
                "turn_completed",
                Some("pty-1"),
                Some("New session - 2026-10-31T10:00:00.000Z")
            )
        ));
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.title, "", "占位标题不写进注册表");
        assert!(entry.has_user_input, "但用户确实用过了");
    }

    /// 没有标题的上报只置 `has_user_input`（不把标题改成空串）。
    #[test]
    fn report_without_topic_keeps_the_existing_title() {
        let registry = registry_with_terminal("pty-1");
        registry.set_title("pty-1", TitleSource::Prompt, "npm test");
        assert!(project(
            &registry,
            &event("turn_completed", Some("pty-1"), None)
        ));
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.title, "npm test", "已有标题不被空值覆盖");
        assert!(entry.has_user_input);
    }

    /// 用户改名永不被 hook 改写（`User` 比 `Native` 强）。
    #[test]
    fn user_title_survives_hook_reports() {
        let registry = registry_with_terminal("pty-1");
        registry.set_title("pty-1", TitleSource::User, "我的会话");
        assert!(project(
            &registry,
            &event("turn_completed", Some("pty-1"), Some("别的名字"))
        ));
        assert_eq!(registry.snapshot()[0].title, "我的会话");
    }

    /// 只取标题、不置 `has_user_input` 的未知语义键（模板可独立发版）。
    #[test]
    fn informational_event_titles_without_engaging() {
        let registry = registry_with_terminal("pty-1");
        assert!(project(
            &registry,
            &event("session_started", Some("pty-1"), Some("标题"))
        ));
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.title, "标题");
        assert!(!entry.has_user_input, "信息类事件不代表用户在用");
    }

    /// 没有 `neeko_session_id`（非本应用拉起的终端）⇒ 全部丢弃，且不按 cwd 猜。
    #[test]
    fn unattributed_report_is_ignored_even_with_matching_cwd() {
        let registry = registry_with_terminal("pty-1");
        assert!(!project(
            &registry,
            &event("turn_completed", None, Some("不该出现的标题"))
        ));
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.title, "", "cwd 相同也不猜");
        assert!(!entry.has_user_input);
    }

    /// 未知会话 id（已注销 / 父会话残留）⇒ 丢弃，不凭空建条目。
    #[test]
    fn unknown_session_is_dropped_without_creating_an_entry() {
        let registry = registry_with_terminal("pty-1");
        assert!(!project(
            &registry,
            &event("turn_completed", Some("ghost"), Some("标题"))
        ));
        assert_eq!(registry.snapshot().len(), 1);
    }

    /// 重复上报不改变版本号（`turn_completed` 会随每轮重复到达）。
    #[test]
    fn repeated_report_is_idempotent() {
        let registry = registry_with_terminal("pty-1");
        let report = event("turn_completed", Some("pty-1"), Some("同一个标题"));
        assert!(project(&registry, &report));
        let version = registry.version();
        assert!(!project(&registry, &report), "同值不重复写");
        assert_eq!(registry.version(), version);
    }

    /// 第 35 轮：hook 没带 `topic` ⇒ 按 registry 条目的 `agent_id` + hook 的
    /// `agent_session_id` 回落 conversation 缓存里的 provider title（`Native`）。
    ///
    /// 变异验证：把 `project` 里的 `None =>` 回落分支删掉，本用例必须转红。
    #[test]
    fn missing_topic_falls_back_to_conversation_cache() {
        let registry = registry_with_terminal("pty-1");
        let lookup: std::cell::RefCell<Vec<(String, String)>> = std::cell::RefCell::new(Vec::new());
        let changed = super::project(
            &registry,
            &event("turn_completed", Some("pty-1"), None),
            &|agent_id, native_id| {
                lookup
                    .borrow_mut()
                    .push((agent_id.to_string(), native_id.to_string()));
                Some("缓存里的会话标题".to_string())
            },
        );

        assert!(changed);
        assert_eq!(
            lookup.into_inner(),
            vec![("claude-code".to_string(), "agent-1".to_string())],
            "只用 registry 条目的 agent + hook 原生 id 定址，不按 cwd 猜"
        );
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.title, "缓存里的会话标题");
        assert_eq!(entry.title_source, TitleSource::Native);
        assert!(entry.has_user_input);
    }

    /// `topic` 存在时缓存**不得**参与（topic 优先，且不查缓存）。
    #[test]
    fn topic_present_never_consults_the_cache() {
        let registry = registry_with_terminal("pty-1");
        let consulted = std::cell::Cell::new(false);
        assert!(super::project(
            &registry,
            &event("turn_completed", Some("pty-1"), Some("hook 主题")),
            &|_agent_id, _native_id| {
                consulted.set(true);
                Some("缓存里的会话标题".to_string())
            },
        ));
        assert!(!consulted.get(), "有 topic 时不得回落缓存");
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.title, "hook 主题");
        assert_eq!(entry.title_source, TitleSource::Native);
    }

    /// 用户改名（`User`）不被缓存回落改写 —— `should_upgrade` 的唯一裁决点。
    #[test]
    fn user_title_survives_cache_fallback() {
        let registry = registry_with_terminal("pty-1");
        registry.set_title("pty-1", TitleSource::User, "我的会话");
        assert!(super::project(
            &registry,
            &event("turn_completed", Some("pty-1"), None),
            &|_agent_id, _native_id| Some("缓存里的会话标题".to_string()),
        ));
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.title, "我的会话");
        assert_eq!(entry.title_source, TitleSource::User);
    }

    /// 已有 `Native` 标题不被较旧的 conversation 缓存快照改写。
    #[test]
    fn existing_native_title_survives_cache_fallback() {
        let registry = registry_with_terminal("pty-1");
        registry.set_title("pty-1", TitleSource::Native, "hook 当时的标题");
        let consulted = std::cell::Cell::new(false);
        assert!(super::project(
            &registry,
            &event("turn_completed", Some("pty-1"), None),
            &|_agent_id, _native_id| {
                consulted.set(true);
                Some("缓存里的旧标题".to_string())
            },
        ));
        assert!(!consulted.get(), "已有真标题时不得再查扫描缓存");
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.title, "hook 当时的标题");
        assert_eq!(entry.title_source, TitleSource::Native);
    }

    /// 缓存未命中 / 条目无 agent（纯 shell）⇒ 不写标题，但仍完成状态与可见性转移。
    #[test]
    fn cache_miss_never_fabricates_a_title() {
        let registry = registry_with_terminal("pty-1");
        assert!(super::project(
            &registry,
            &event("turn_completed", Some("pty-1"), None),
            &|_agent_id, _native_id| None,
        ));
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.title, "");
        assert_eq!(entry.title_source, TitleSource::Placeholder);
        assert!(entry.has_user_input);
        assert_eq!(entry.state, SessionState::Ready);
    }
}
