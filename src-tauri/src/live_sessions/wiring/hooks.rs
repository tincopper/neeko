//! hooks 生产者：CLI hook 上报（[`HookEvent`]）→ 会话标题（`Native`）+ `has_user_input`。
//!
//! # 为什么这是**最权威**的标题源
//!
//! 模板（`agent/hooks/templates/`）上报的 `title` 是 CLI **自己的**会话主题：用户给会话起的
//! 名字（pi 的 `getSessionName`、claude 的 `session_title`）优先，退化到首条用户消息。
//! 这比我们从字节流里猜（OSC 标题 / 首条输入行）质量更高 —— 它正是 Codex 那类桌面端
//! 展示在会话列表里的东西，因此映射到 [`TitleSource::Native`]。
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
use crate::live_sessions::emit_changed;
use crate::live_sessions::entry::TitleSource;
use crate::live_sessions::registry::Registry;
use crate::AppStateWrapper;

/// 「用户确实在用了」的语义事件键。
///
/// 四者都意味着**有人对这条会话做了动作**：跑完一轮 / 请求审批 / 请求输入 / 会话失败。
/// 其余键（未知或纯信息类）只用来取标题，不置 `has_user_input`。
///
/// 键名直接引用 agent 域的**常量单一源**（`event_keys`）：模板与通知分类用的是同一份
/// 词汇表，这里再抄一遍字面量就会在模板改名时静默失效。
const ENGAGING_EVENTS: [&str; 4] = [
    event_keys::TURN_COMPLETED,
    event_keys::APPROVAL_REQUESTED,
    event_keys::INPUT_REQUESTED,
    event_keys::SESSION_FAILED,
];

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

/// 这条事件是否代表「用户在用了」。
#[must_use]
fn is_engaging(event_key: &str) -> bool {
    ENGAGING_EVENTS.contains(&event_key)
}

/// 把一条 hook 上报投影进注册表；返回「真的有变化」（调用方据此发一次变更事件）。
///
/// 标题与可见性同属一次上报，故只走一次 [`Registry::report`]：
/// - 有 `topic` ⇒ 尝试升级标题（`Native`；`User` 永不覆盖）；
/// - 语义键命中 ⇒ 顺手置位 `has_user_input`（侧栏据此列出该会话）。
///
/// 任一件没命中都是正常的（模板很多事件只带 detail）。
pub(crate) fn project(registry: &Registry, event: &HookEvent) -> bool {
    let Some(session_id) = attributed_session(event) else {
        return false;
    };
    registry.report(
        session_id,
        event.topic().map(|topic| (TitleSource::Native, topic)),
        is_engaging(event.event.as_str()),
    )
}

/// 投递入口（本域自己消费，见 [`on_hook_event`] 的调用方 sink）。
///
/// 未归属的上报直接返回 `false`，不打印（hook 可能来自并非本应用拉起的终端，
/// 那是常态而非缺陷；要排障时把 `is_usable` 一侧的日志打开即可）。
pub(crate) fn on_hook_event(
    registry: &Registry,
    app: &tauri::AppHandle,
    event: &HookEvent,
) -> bool {
    let changed = project(registry, event);
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
        on_hook_event(&state.live_sessions, app, event);
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
                (TitleSource::Placeholder, String::new()),
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
}
