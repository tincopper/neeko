//! **通知投影**：把 [`HookEvent`] 映射成通知域的 [`NotificationSignal`]（源 B 的一个消费者）。
//!
//! # 为什么与事件模型分开
//!
//! [`HookEvent`] 是公共数据资产（`event.rs`），而「它如何变成一条通知」是**通知消费者自己的
//! 词汇**：`NotificationClass` / `event_key` / `topic` 都是通知域概念。后续新增消费者
//! （如 Agent 实时状态）时，它读同一份 [`HookEvent`]，但**不应被迫理解通知域**，也不应
//! 复用本文件。
//!
//! 故：新增消费者 = 新建一个投影文件（`state.rs` 之类），不动采集侧、不动本文件。
//!
//! # 与源 A 同命名空间
//!
//! `event_key` 与 `agent/chat/notify.rs`（源 A）共用 `event_keys` 常量 —— 节流 / 合并 /
//! 设置键因此天然统一，不会出现「同一个语义事件有两套键」。

use crate::agent::chat::notify::event_keys;
use crate::notification::{NotificationClass, NotificationSignal, SourceRef};

use super::attribution::Attribution;
use super::event::HookEvent;

/// 语义事件键 → (class, event_key, label)。与源 A 同命名空间。
///
/// 未知事件 → `None`（fail-open：模板版本漂移不产生错误噪音，也不阻塞其他消费者）。
fn classify(event: &str) -> Option<(NotificationClass, &'static str, &'static str)> {
    match event {
        event_keys::TURN_COMPLETED => Some((
            NotificationClass::Completed,
            event_keys::TURN_COMPLETED,
            "Agent turn completed",
        )),
        event_keys::APPROVAL_REQUESTED => Some((
            NotificationClass::ActionRequired,
            event_keys::APPROVAL_REQUESTED,
            "Agent needs approval",
        )),
        event_keys::INPUT_REQUESTED => Some((
            NotificationClass::ActionRequired,
            event_keys::INPUT_REQUESTED,
            "Agent needs input",
        )),
        // 2026-10-16 补：Claude 兼容面的 `StopFailure`（以及 Codex 将来的等价事件）
        // 投影到会话异常。此前缺此 arm → 该类上报被 fail-open 静默吞掉（通知缺失）。
        event_keys::SESSION_FAILED => Some((
            NotificationClass::Failed,
            event_keys::SESSION_FAILED,
            "Agent session failed",
        )),
        _ => None,
    }
}

/// 把 hook 上报投影为通知域信号。
///
/// `source` 是路由段（`/hook/{source}`）—— 白名单**不在此处**，由受管事实表
/// [`crate::agent::hooks::targets::HOOK_TARGETS`] 派生（`super::validation::hook_source`
/// 只认表里的行）。故新增一个 CLI 无需改本函数。
#[must_use]
pub fn project(
    source: &str,
    event: &HookEvent,
    attribution: &Attribution,
) -> Option<NotificationSignal> {
    let (class, event_key, event_label) = classify(&event.event)?;
    Some(NotificationSignal {
        source: SourceRef {
            domain: "agent",
            instance_id: attribution.instance_id.clone(),
            // 文案区分来源形态（外部终端 CLI），仍是纯数据。
            origin_label: format!("{source} (CLI)"),
            group_label: attribution.group_label.clone(),
        },
        class,
        event_key: event_key.to_string(),
        event_label: event_label.to_string(),
        detail: event.detail_trimmed().map(str::to_string),
        topic: event.topic().map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(name: &str) -> HookEvent {
        HookEvent {
            agent_session_id: "agent-1".into(),
            event: name.into(),
            cwd: None,
            detail: None,
            title: None,
            title_source: None,
            hints: Default::default(),
        }
    }

    fn attribution() -> Attribution {
        Attribution {
            instance_id: "cli:agent-1".into(),
            group_label: "neeko".into(),
        }
    }

    /// 四类语义事件投影到与源 A 相同的 event_key（跨源节流/设置键统一的前提）。
    #[test]
    fn semantic_events_share_namespace_with_pipeline_source() {
        for (name, class) in [
            (event_keys::TURN_COMPLETED, NotificationClass::Completed),
            (
                event_keys::APPROVAL_REQUESTED,
                NotificationClass::ActionRequired,
            ),
            (
                event_keys::INPUT_REQUESTED,
                NotificationClass::ActionRequired,
            ),
            (event_keys::SESSION_FAILED, NotificationClass::Failed),
        ] {
            let sig = project("opencode", &event(name), &attribution()).expect("mapped");
            assert_eq!(sig.class, class);
            assert_eq!(sig.event_key, name);
            assert_eq!(sig.source.domain, "agent");
            assert_eq!(sig.source.instance_id, "cli:agent-1");
            assert_eq!(sig.source.origin_label, "opencode (CLI)");
        }
    }

    /// 未知事件名 → None（模板与服务端版本错配时 fail-open）。
    #[test]
    fn unknown_event_is_ignored() {
        assert!(project("pi", &event("session.idle"), &attribution()).is_none());
    }

    /// `turn_started` 是**状态**信号，不是通知：它只被 `live_sessions::wiring::hooks` 消费。
    ///
    /// 这条断言防的是「顺手把它加进 `event_keys`」：那张表与 `NotificationClass` 一一对应，
    /// 后端通知设置页按它生成清单 —— 加进去就会多出一个永远不弹的死开关。
    #[test]
    fn turn_started_is_a_state_signal_not_a_notification() {
        use crate::live_sessions::wiring::hooks::EVENT_TURN_STARTED;
        assert!(
            project("pi", &event(EVENT_TURN_STARTED), &attribution()).is_none(),
            "turn_started 不得投影成通知（它是状态腿，加进 event_keys 会造出死开关）"
        );
    }

    /// 会话异常事件的标签与类别：`session_failed` → Failed 类 + 「Agent session failed」文案。
    #[test]
    fn session_failed_maps_to_failed_class_with_label() {
        let (class, key, label) =
            classify(event_keys::SESSION_FAILED).expect("session_failed must be mapped");
        assert_eq!(class, NotificationClass::Failed);
        assert_eq!(key, event_keys::SESSION_FAILED);
        assert_eq!(label, "Agent session failed");
    }

    /// 上报的 title 成为信号 topic（模板侧已判定优先级，服务端只做透传+过滤）。
    #[test]
    fn reported_title_becomes_topic() {
        let mut e = event(event_keys::TURN_COMPLETED);
        e.title = Some("  修复登录竞态  ".into());
        let sig = project("opencode", &e, &attribution()).expect("mapped");
        assert_eq!(sig.topic.as_deref(), Some("修复登录竞态"));
    }

    /// 占位标题不算主题；形近的正常标题不得被误杀。
    #[test]
    fn placeholder_titles_are_not_topics() {
        for placeholder in [
            "New session - 2026-10-13T02:08:07.973Z",
            "New session - 2026-10-12T14:05:45.381Z",
        ] {
            let mut e = event(event_keys::TURN_COMPLETED);
            e.title = Some(placeholder.into());
            let sig = project("opencode", &e, &attribution()).expect("mapped");
            assert_eq!(sig.topic, None, "{placeholder} 是占位标题，不应作为主题");
        }
        for real in ["neeko-probe", "New session handling refactor"] {
            let mut e = event(event_keys::TURN_COMPLETED);
            e.title = Some(real.into());
            let sig = project("opencode", &e, &attribution()).expect("mapped");
            assert_eq!(sig.topic.as_deref(), Some(real));
        }
    }

    /// 缺省 / 空白 title → 无主题（不回退成空串占位）。
    #[test]
    fn missing_or_blank_title_yields_no_topic() {
        let sig =
            project("pi", &event(event_keys::TURN_COMPLETED), &attribution()).expect("mapped");
        assert_eq!(sig.topic, None);

        let mut blank = event(event_keys::TURN_COMPLETED);
        blank.title = Some("   ".into());
        let sig = project("pi", &blank, &attribution()).expect("mapped");
        assert_eq!(sig.topic, None);
    }

    /// 空白 detail 归一为 None（核心域落类别兜底文案）。
    #[test]
    fn blank_detail_normalized() {
        let mut e = event(event_keys::APPROVAL_REQUESTED);
        e.detail = Some("   ".into());
        assert_eq!(project("pi", &e, &attribution()).unwrap().detail, None);
    }
}
