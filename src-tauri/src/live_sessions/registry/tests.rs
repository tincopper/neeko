//! `Registry` 不变量测试：重复 id 只 warn、迟到信号丢弃、状态未变不 bump、
//! 写穿保留 cursor 的既有字段、快照分组/排序、长轮询语义。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::*;
use crate::agent::chat::session_store::{
    PersistedSessionKind, PersistedTitleSource, SessionStatus,
};
use crate::common::git::WorkspaceSession;
use crate::live_sessions::entry::{SessionKind, SessionState};
use crate::AppError;

/// 记录型 store：断言写穿了什么、删掉了谁（真正的 SQLite 由 `session_store` 自测）。
#[derive(Default)]
struct RecordingStore {
    cursors: Mutex<HashMap<String, ResumeCursor>>,
    /// 每次 `save_cursor` 落下的状态（写穿节流的判据：哪些变化**真的**会落盘）。
    saves: Mutex<Vec<SessionStatus>>,
    /// 被 `delete_cursor` 删掉的会话 id（注册注销 / adopt 迁移 / 退出抑制的判据）。
    deleted: Mutex<Vec<String>>,
}

impl RecordingStore {
    fn cursor(&self, session_id: &str) -> Option<ResumeCursor> {
        self.cursors
            .lock()
            .expect("infallible: cursors")
            .get(session_id)
            .cloned()
    }

    fn seed(&self, cursor: ResumeCursor) {
        self.cursors
            .lock()
            .expect("infallible: cursors")
            .insert(cursor.session_id.clone(), cursor);
    }

    fn deleted_ids(&self) -> Vec<String> {
        self.deleted.lock().expect("infallible: deleted").clone()
    }

    /// 库里**所有**行（不按 status 过滤）：断言「根本没建行」时的判据。
    /// 只看 `list_restorable` 会漏掉「落了 Closed 行」的实现（那同样是 bug）。
    fn stored_ids(&self) -> Vec<String> {
        self.cursors
            .lock()
            .expect("infallible: cursors")
            .keys()
            .cloned()
            .collect()
    }
}

impl SessionStore for RecordingStore {
    fn save_cursor(&self, cursor: &ResumeCursor) -> Result<(), AppError> {
        self.saves
            .lock()
            .expect("infallible: saves")
            .push(cursor.status.clone());
        self.cursors
            .lock()
            .expect("infallible: cursors")
            .insert(cursor.session_id.clone(), cursor.clone());
        Ok(())
    }

    fn load_cursor(&self, session_id: &str) -> Option<ResumeCursor> {
        self.cursor(session_id)
    }

    /// 判据与 SQL 侧同源：[`ResumeCursor::is_restorable`]。测试替身不重写规则 ——
    /// 重写一份就会让「替身通过、真实库不通过」的差异只在生产上出现。
    fn list_restorable(&self) -> Vec<ResumeCursor> {
        self.cursors
            .lock()
            .expect("infallible: cursors")
            .values()
            .filter(|c| c.is_restorable())
            .cloned()
            .collect()
    }

    fn close_session(&self, session_id: &str) -> Result<(), AppError> {
        if let Some(cursor) = self
            .cursors
            .lock()
            .expect("infallible: cursors")
            .get_mut(session_id)
        {
            cursor.status = SessionStatus::Closed;
        }
        Ok(())
    }

    fn delete_cursor(&self, session_id: &str) -> Result<(), AppError> {
        self.deleted
            .lock()
            .expect("infallible: deleted")
            .push(session_id.to_string());
        self.cursors
            .lock()
            .expect("infallible: cursors")
            .remove(session_id);
        Ok(())
    }
}

fn registry() -> (Registry, Arc<RecordingStore>) {
    let store = Arc::new(RecordingStore::default());
    (Registry::new(store.clone()), store)
}

/// 夹具：生产路径经 `set_title` 写入标题；这里直接给字段，省掉每条用例一次额外写入。
/// 值必须满足 `title::admit` 的不变量（`Placeholder` ⇒ 空标题），否则夹具会造出
/// 生产不可能出现的状态。
///
/// 默认是**已列出**的会话（`has_user_input = true`）：只有列出的会话才落盘，
/// 需要验证「不落盘」的用例自己清掉它。
fn entry(id: &str, cwd: &str) -> SessionEntry {
    let mut entry = SessionEntry::new(
        id,
        SessionKind::Chat,
        Some("pi".into()),
        WorkspaceSession::of("p1", None),
        cwd,
    )
    .with_user_input(true);
    entry.title = format!("title-{id}");
    entry.title_source = TitleSource::Prompt;
    entry
}

/// 尚未进侧栏的 chat 会话（`Silent` 建连 / hook 纯信息事件前）。
fn unlisted_entry(id: &str, cwd: &str) -> SessionEntry {
    let mut entry = entry(id, cwd).with_user_input(false);
    entry.title = String::new();
    entry.title_source = TitleSource::Placeholder;
    entry
}

fn terminal_entry(id: &str, cwd: &str) -> SessionEntry {
    SessionEntry::new(
        id,
        SessionKind::Terminal,
        Some("pi".into()),
        WorkspaceSession::of("p1", Some(cwd.to_string())),
        cwd,
    )
    .with_state(SessionState::Running)
    .with_user_input(true)
}

/// 刚登记的 agent 终端：用户还没敲过字（尚未进侧栏）。
fn new_agent_terminal(id: &str, cwd: &str) -> SessionEntry {
    let mut entry = terminal_entry(id, cwd);
    entry.has_user_input = false;
    entry
}

/// 刚登记的**纯 shell**终端：没有 agent，于是也没有 hook / conversation 标题通道。
fn new_plain_shell_terminal(id: &str, cwd: &str) -> SessionEntry {
    SessionEntry::new(
        id,
        SessionKind::Terminal,
        None,
        WorkspaceSession::of("p1", Some(cwd.to_string())),
        cwd,
    )
    .with_state(SessionState::Running)
}

fn cursor(runtime_mode: &str) -> ResumeCursor {
    ResumeCursor {
        session_id: "s1".into(),
        agent_kind: crate::agent::chat::adapter::AgentKind::Custom,
        agent_id: "pi".into(),
        cwd: "/proj".into(),
        model: "some-model".into(),
        runtime_mode: runtime_mode.into(),
        turn_count: 0,
        status: SessionStatus::Ready,
        last_activity: "2026-10-31T00:00:00+00:00".into(),
        kind: PersistedSessionKind::Chat,
        project_id: "p1".into(),
        worktree_path: None,
        title: "title-s1".into(),
        title_source: PersistedTitleSource::Prompt,
        has_user_input: true,
        native_session_id: None,
        started_at: "2026-10-30T00:00:00+00:00".into(),
    }
}

#[test]
fn duplicate_registration_overrides_without_panicking() {
    let (registry, _store) = registry();
    let mut second = entry("s1", "/proj");
    second.title = "second".into();
    assert!(registry.register(entry("s1", "/proj")), "首次登记 = 新增");
    assert!(
        !registry.register(second),
        "同 id 覆盖 = 非新增（只 warn 不 panic）"
    );
    let snapshot = registry.snapshot();
    assert_eq!(snapshot.len(), 1, "重复 id 只保留一条");
    assert_eq!(snapshot[0].title, "second", "覆盖后的内容生效");
}

#[test]
fn apply_on_unknown_session_is_dropped_and_creates_nothing() {
    let (registry, _store) = registry();
    let before = registry.version();
    assert!(!registry.apply("ghost", Signal::TurnStarted));
    assert!(registry.snapshot().is_empty(), "不得为未知会话建条目");
    assert_eq!(registry.version(), before, "丢弃的信号不得 bump 版本");
}

#[test]
fn apply_without_state_change_does_not_bump() {
    let (registry, _store) = registry();
    registry.register(entry("s1", "/proj"));
    let before = registry.version();
    // Ready + Created ⇒ Ready（幂等注册信号），状态没变。
    assert!(!registry.apply("s1", Signal::Created));
    // Ready + TurnFinished ⇒ Ready，同样没变。
    assert!(!registry.apply("s1", Signal::TurnFinished));
    assert!(
        !registry.apply("s1", Signal::ApprovalResolved),
        "Ready 下的审批回执是噪声"
    );
    assert_eq!(registry.version(), before, "状态未变不得 bump");
    assert_eq!(registry.snapshot()[0].state, SessionState::Ready);
}

#[test]
fn apply_bumps_only_on_real_transitions() {
    let (registry, _store) = registry();
    registry.register(entry("s1", "/proj"));
    let before = registry.version();
    assert!(registry.apply("s1", Signal::TurnStarted));
    assert_eq!(registry.version(), before + 1);
    assert_eq!(registry.snapshot()[0].state, SessionState::Running);

    assert!(registry.apply("s1", Signal::TurnFinished));
    let after_turn = registry.version();
    assert_eq!(after_turn, before + 2);
    let entry = &registry.snapshot()[0];
    assert_eq!(entry.state, SessionState::Ready);
    assert_eq!(entry.turn_count, 1, "回合结束累计一次");
}

#[test]
fn terminal_state_absorbs_late_signals() {
    let (registry, _store) = registry();
    registry.register(entry("s1", "/proj"));
    registry.apply("s1", Signal::TurnStarted);
    assert!(registry.apply("s1", Signal::Failed));
    let frozen = registry.version();
    // pi 实测：Error 之后还有 TurnEnd —— 不得把失败改写回 Ready。
    assert!(!registry.apply("s1", Signal::TurnFinished));
    assert!(!registry.apply("s1", Signal::TurnStarted));
    assert!(!registry.apply("s1", Signal::Exited));
    assert_eq!(registry.version(), frozen);
    assert_eq!(registry.snapshot()[0].state, SessionState::Failed);
}

#[test]
fn approval_round_trip_walks_through_awaiting() {
    let (registry, _store) = registry();
    registry.register(entry("s1", "/proj"));
    registry.apply("s1", Signal::TurnStarted);
    assert!(registry.apply("s1", Signal::ApprovalRequested));
    assert_eq!(registry.snapshot()[0].state, SessionState::AwaitingApproval);
    assert!(registry.apply("s1", Signal::ApprovalResolved));
    assert_eq!(registry.snapshot()[0].state, SessionState::Running);
}

/// `report(None, true)`：幂等，只在第一次真的改变时 bump；未知会话不建条目。
#[test]
fn engaging_without_a_title_is_idempotent_and_drops_unknown_sessions() {
    let (registry, _store) = registry();
    registry.register(unlisted_entry("s1", "/proj"));
    let before = registry.version();
    assert!(
        !registry.snapshot()[0].has_user_input,
        "刚登记 = 还没人用过"
    );

    assert!(registry.report("s1", None, true));
    assert!(registry.snapshot()[0].has_user_input);
    assert_eq!(registry.version(), before + 1);

    assert!(!registry.report("s1", None, true), "第二次不改变");
    assert_eq!(registry.version(), before + 1);

    assert!(!registry.report("ghost", None, true));
    assert_eq!(registry.snapshot().len(), 1, "不为未知会话建条目");
}

/// `report_first` 只在**第一次**生效：`Silent` 会话被用起来时补标题 + 置位，
/// 而续聊（已用过）既不改名也不 bump。
/// 恢复：新条目继承旧条目的标题与「已使用」，旧条目退场。
///
/// 不继承的话，新会话要等用户敲第一条输入才会被侧栏列出 —— 表现是「点了恢复，
/// 那一行反而消失了」。
#[test]
fn adopt_moves_identity_from_a_stopped_session() {
    let (registry, store) = registry();
    let mut old = entry("old", "/proj");
    old.title = "修复登录竞态".into();
    old.title_source = TitleSource::Prompt;
    old.has_user_input = true;
    registry.register(old);
    registry.apply("old", Signal::TurnFinished);
    registry.apply("old", Signal::Stopped);
    assert!(store.cursor("old").is_some(), "旧行在库里");

    let mut fresh = terminal_entry("new", "/proj");
    fresh.title = String::new();
    fresh.title_source = TitleSource::Placeholder;
    registry.register(fresh);

    assert!(registry.adopt("old", "new"));
    let into = registry.entry("new").expect("新条目仍在");
    assert_eq!(into.title, "修复登录竞态");
    assert_eq!(into.title_source, TitleSource::Prompt);
    assert!(into.has_user_input, "继承「已使用」，否则侧栏不列它");
    assert!(registry.entry("old").is_none(), "旧条目退场");
    assert_eq!(registry.snapshot().len(), 1);

    // 库里的行也要「搬家」：旧行删掉、新行拿到继承后的标题 —— 否则重启后
    // 侧栏会同时出现「已停止的旧会话」与「没名字的新会话」。
    assert_eq!(store.deleted_ids(), vec!["old".to_string()]);
    let migrated = store.cursor("new").expect("新行必须落盘");
    assert_eq!(migrated.title, "修复登录竞态");
    assert!(migrated.has_user_input);
    assert!(store
        .list_restorable()
        .iter()
        .any(|c| c.session_id == "new"));

    // 幂等：旧条目已消失，再继承一次什么都不发生。
    assert!(!registry.adopt("old", "new"));
    assert_eq!(store.deleted_ids(), vec!["old".to_string()]);
}

/// 活着的会话**不得**被一次点击合并掉（否则用户点一下丢一条正在跑的会话）。
#[test]
fn adopt_refuses_a_live_source() {
    let (registry, _store) = registry();
    registry.register(entry("live", "/proj"));
    registry.register(terminal_entry("new", "/proj"));

    assert!(!registry.adopt("live", "new"));
    assert!(registry.entry("live").is_some());
    assert_eq!(registry.snapshot().len(), 2);
}

/// 继承是否发生与「新条目是否已进侧栏」是两件事：`from` 没进过侧栏（`has_user_input = false`）
/// 时也要真正继承并 bump，只是不需要写库 —— 不能把「无可落盘快照」误当成「没继承」。
#[test]
fn adopt_of_an_unlisted_source_still_adopts_and_bumps() {
    let (registry, store) = registry();
    let mut old = unlisted_entry("old", "/proj");
    old.kind = SessionKind::Terminal;
    old.state = SessionState::Stopped;
    registry.register(old);
    registry.register(unlisted_entry("new", "/proj"));
    let before = registry.version();

    assert!(registry.adopt("old", "new"));
    assert_eq!(registry.version(), before + 1, "继承是一次可见变更");
    assert!(registry.entry("old").is_none(), "旧条目必须退场");
    assert!(
        store.deleted_ids().contains(&"old".to_string()),
        "旧行尝试删除（幂等）"
    );
    assert!(store.cursor("new").is_none(), "未列出的新条目不落盘");
}

/// 原生会话 id：只写一次、未知会话不建条目、**不 bump 版本**（它不进 wire 契约）。
#[test]
fn native_session_id_is_recorded_once_without_bumping_the_version() {
    let (registry, store) = registry();
    registry.register(entry("s1", "/proj"));
    let before = registry.version();

    assert!(registry.record_native_session_id("s1", " native-42 "));
    assert_eq!(
        registry.entry("s1").and_then(|e| e.native_session_id),
        Some("native-42".to_string()),
        "trim 后落库"
    );
    assert_eq!(registry.version(), before, "UI 看不见的字段不刷快照");
    assert_eq!(
        store.cursor("s1").and_then(|c| c.native_session_id),
        Some("native-42".to_string()),
        "原生 id 必须落盘：它是点击恢复（--resume）的唯一入参"
    );

    assert!(
        !registry.record_native_session_id("s1", "another"),
        "同一条会话的原生 id 不变，重复写是噪声"
    );
    assert!(!registry.record_native_session_id("ghost", "native-9"));
    assert!(!registry.record_native_session_id("s1", "   "), "空白不写");
    assert_eq!(registry.snapshot().len(), 1, "不得为未知会话建条目");
    assert_eq!(
        store.cursor("s1").and_then(|c| c.native_session_id),
        Some("native-42".to_string()),
        "晚到的上报不得覆盖已记下的原生 id"
    );
}

#[test]
fn report_first_titles_and_engages_once_only() {
    let (registry, _store) = registry();
    registry.register(unlisted_entry("s1", "/proj"));
    let before = registry.version();

    assert!(registry.report_first("s1", &[(TitleSource::Prompt, "第一条消息")]));
    assert_eq!(registry.version(), before + 1);
    assert!(registry.snapshot()[0].has_user_input);
    assert_eq!(registry.snapshot()[0].title, "第一条消息");

    assert!(
        !registry.report_first("s1", &[(TitleSource::Prompt, "第二条消息")]),
        "续聊不改名"
    );
    assert_eq!(registry.version(), before + 1, "续聊不 bump");
    assert_eq!(registry.snapshot()[0].title, "第一条消息");

    assert!(!registry.report_first("ghost", &[]), "未知会话不建条目");
    assert_eq!(registry.snapshot().len(), 1);
}

/// hook 的纯语义事件可能先置位但没有标题；首条 prompt 仍必须补名字，
/// 否则会话会以「已输入 + 空标题」的状态永久从侧栏消失。
#[test]
fn report_first_fills_a_missing_title_after_hook_engagement() {
    let (registry, _store) = registry();
    registry.register(unlisted_entry("s1", "/proj"));

    assert!(registry.report("s1", None, true));
    assert_eq!(registry.snapshot()[0].title, "");

    assert!(
        registry.report_first("s1", &[(TitleSource::Prompt, "first prompt")]),
        "已置位但无标题时仍应补标题"
    );
    assert_eq!(registry.snapshot()[0].title, "first prompt");
}

/// `register_if_absent`：已存在 ⇒ 不覆盖、不 bump（「登记 = 首次出现」只在锁内成立一次）。
#[test]
fn register_if_absent_never_overrides() {
    let (registry, _store) = registry();
    assert!(registry.register_if_absent(entry("s1", "/proj")));
    registry.set_title("s1", TitleSource::User, "我的名字");
    let before = registry.version();

    assert!(!registry.register_if_absent(entry("s1", "/proj")));
    assert_eq!(registry.version(), before, "重复登记不 bump");
    assert_eq!(registry.snapshot().len(), 1);
    assert_eq!(registry.snapshot()[0].title, "我的名字", "已存在的不被重置");
}

#[test]
fn set_title_upgrades_but_never_downgrades() {
    let (registry, _store) = registry();
    registry.register(entry("s1", "/proj"));
    assert!(registry.set_title("s1", TitleSource::Prompt, "fix the parser"));
    assert!(!registry.set_title("s1", TitleSource::Placeholder, "pi"));
    assert_eq!(registry.snapshot()[0].title, "fix the parser");

    assert!(registry.set_title("s1", TitleSource::Native, "Parser bug"));
    assert_eq!(registry.snapshot()[0].title, "Parser bug");
}

#[test]
fn set_title_same_value_does_not_bump() {
    let (registry, _store) = registry();
    registry.register(entry("s1", "/proj"));
    registry.set_title("s1", TitleSource::Native, "Parser bug");
    let before = registry.version();
    assert!(!registry.set_title("s1", TitleSource::Native, "Parser bug"));
    assert!(!registry.set_title("s1", TitleSource::Native, "  Parser   bug  "));
    assert_eq!(registry.version(), before);
}

#[test]
fn user_title_survives_automatic_sources() {
    let (registry, _store) = registry();
    registry.register(entry("s1", "/proj"));
    assert!(registry.set_title("s1", TitleSource::User, "Mine"));
    for source in [
        TitleSource::Placeholder,
        TitleSource::Prompt,
        TitleSource::Native,
    ] {
        assert!(!registry.set_title("s1", source, "automatic"));
    }
    assert_eq!(registry.snapshot()[0].title, "Mine");
}

#[test]
fn blank_title_candidates_are_ignored() {
    let (registry, _store) = registry();
    registry.register(entry("s1", "/proj"));
    let before = registry.version();
    assert!(!registry.set_title("s1", TitleSource::User, "   "));
    assert_eq!(registry.version(), before);
    assert_eq!(registry.snapshot()[0].title, "title-s1");
}

#[test]
fn persist_keeps_fields_the_registry_does_not_know() {
    let (registry, store) = registry();
    store.seed(cursor("confirm"));
    registry.register(entry("s1", "/proj"));
    registry.apply("s1", Signal::TurnStarted);
    registry.apply("s1", Signal::TurnFinished);

    let saved = store.cursor("s1").expect("cursor must be written through");
    assert_eq!(saved.status, SessionStatus::Ready, "状态写穿");
    assert_eq!(saved.model, "some-model", "model 不被投影覆盖");
    assert_eq!(
        saved.runtime_mode, "confirm",
        "用户选择的运行时模式不得被一次状态变化改写回默认值"
    );
}

/// `apply` / `apply_activity` 的写穿节流：只有 `turn_count` 变化与终态落盘。
///
/// 判据是「这一列有没有读者」，而不是「状态是不是重要」——`status` 列**没有**真读者：
/// 启动恢复把每一行都投影成 `Stopped`（`cursor::into_entry`），没有任何读者按
/// `status != Closed` 查询（旧的 `list_active` 已无消费者，已删）。因此中间态
/// （`Running` / `AwaitingApproval`）写进去只会在 chat 的 16ms 合帧 emit 与 PTY 活动 tick
/// 上多做一次同步 SQLite 写（红线 3 取向，见 `persistence-and-cache.md` §4b.3b）。
///
/// 注意这条节流只适用于本路径：`report_authoritative` / `set_title` 等报告类写入**会**
/// 落盘中间态，因为它们同时携带标题 / 可见性 / 原生 id（那些列有真读者）。
#[test]
fn persist_is_throttled_to_reader_relevant_transitions() {
    let (registry, store) = registry();
    registry.register(entry("s1", "/proj"));
    let after_register = store.saves.lock().expect("infallible: saves").len();
    assert_eq!(after_register, 1, "登记必须建出 cursor 行");

    // 中间态：不落盘。
    assert!(registry.apply("s1", Signal::TurnStarted));
    assert!(registry.apply("s1", Signal::ApprovalRequested));
    assert!(registry.apply("s1", Signal::ApprovalResolved));
    assert_eq!(
        store.saves.lock().expect("infallible: saves").len(),
        after_register,
        "Running / AwaitingApproval 不落盘"
    );

    // 回合结束：turn_count 变化 ⇒ 落盘一次。
    assert!(registry.apply("s1", Signal::TurnFinished));
    assert_eq!(
        store.saves.lock().expect("infallible: saves").len(),
        after_register + 1
    );

    // 终态：携带「结局」这一事实 ⇒ 落盘。
    assert!(registry.apply("s1", Signal::Failed));
    let saved = store.cursor("s1").expect("cursor");
    assert_eq!(saved.status, SessionStatus::Closed, "终态落 Closed");
}

#[test]
fn terminal_rows_are_persisted_only_once_they_are_listed() {
    let (registry, store) = registry();

    // 未列出：打开 tab / 起进程都不算「在用」。
    let unlisted = SessionEntry::new(
        "t0",
        SessionKind::Terminal,
        Some("pi".into()),
        WorkspaceSession::of("p1", Some("/proj-wt".into())),
        "/proj-wt",
    )
    .with_state(SessionState::Running);
    registry.register(unlisted);
    registry.apply("t0", Signal::TurnFinished);
    registry.apply("t0", Signal::Failed);
    assert!(
        store.stored_ids().is_empty(),
        "未列出的 terminal 一行都不落"
    );

    // 列出：行出现的那一刻开始持久化，之后状态转移沿用既有节流。
    registry.register(terminal_entry("t1", "/proj-wt"));
    let saved = store.cursor("t1").expect("列出的 terminal 必须落盘");
    assert_eq!(saved.kind, PersistedSessionKind::Terminal);
    assert_eq!(saved.project_id, "p1");
    assert_eq!(saved.worktree_path.as_deref(), Some("/proj-wt"));
    assert!(saved.has_user_input);

    registry.apply("t1", Signal::TurnStarted);
    registry.apply("t1", Signal::TurnFinished);
    assert_eq!(store.cursor("t1").expect("cursor").turn_count, 1);
}

/// hook 的完成态是权威事实：之后 Codex TUI 重绘产生的 PTY 输出不得把 Ready 推回 Running。
/// 只有用户提交下一条输入才重新进入 Running。
#[test]
fn authoritative_completion_ignores_output_until_user_input() {
    let (registry, _store) = registry();
    registry.register(terminal_entry("t1", "/proj-wt"));

    assert!(registry.report_authoritative("t1", None, Signal::TurnFinished));
    assert_eq!(registry.snapshot()[0].state, SessionState::Ready);

    // 进入 CLI / TUI 重绘 / 光标刷新都只是输出，不得复活为活跃态。
    assert!(!registry.apply_activity("t1", Signal::TurnStarted));
    assert!(!registry.apply_activity("t1", Signal::TurnFinished));
    assert_eq!(registry.snapshot()[0].state, SessionState::Ready);

    // 用户真正提交输入：清除权威完成门，进入 Running。
    assert!(registry.report_terminal_input("t1", ""));
    assert_eq!(registry.snapshot()[0].state, SessionState::Running);
    assert!(
        registry.apply_activity("t1", Signal::TurnFinished),
        "用户输入后恢复 PTY 活动推断"
    );
    assert_eq!(registry.snapshot()[0].state, SessionState::Ready);
}

/// 审批等待同样是权威状态；PTY 的普通输出不得把它改回 Running。
#[test]
fn authoritative_approval_waits_for_user_activity() {
    let (registry, _store) = registry();
    registry.register(terminal_entry("t1", "/proj-wt"));

    assert!(registry.report_authoritative("t1", None, Signal::ApprovalRequested));
    assert_eq!(registry.snapshot()[0].state, SessionState::AwaitingApproval);
    assert!(!registry.apply_activity("t1", Signal::TurnStarted));
    assert_eq!(registry.snapshot()[0].state, SessionState::AwaitingApproval);

    assert!(registry.report_terminal_input("t1", ""));
    assert_eq!(registry.snapshot()[0].state, SessionState::Running);
}

#[test]
fn unregister_removes_the_entry_and_deletes_the_cursor() {
    let (registry, store) = registry();
    registry.register(entry("s1", "/proj"));
    registry.apply("s1", Signal::TurnStarted);
    let before = registry.version();
    assert!(store.cursor("s1").is_some());

    assert!(registry.unregister("s1"));
    assert_eq!(registry.version(), before + 1);
    assert!(registry.snapshot().is_empty());
    assert_eq!(store.deleted_ids(), vec!["s1".to_string()]);
    assert!(
        store.cursor("s1").is_none(),
        "注销 = 删行（不是标 Closed）：否则重启后侧栏会复活已删除的会话"
    );

    // 幂等：重复注销只返回 false，不重复删行。
    assert!(!registry.unregister("s1"));
    assert_eq!(registry.version(), before + 1);
    assert_eq!(store.deleted_ids(), vec!["s1".to_string()]);
}

/// 退出不能等价于「清空列表」：`begin_shutdown` 之后只摘内存。
/// 崩溃 / 强杀天然满足（根本没走到 `unregister`）。
#[test]
fn begin_shutdown_suppresses_cursor_deletion() {
    let (registry, store) = registry();
    registry.register(entry("s1", "/proj"));
    let before = registry.version();

    registry.begin_shutdown();
    assert!(registry.unregister("s1"));
    assert_eq!(registry.version(), before + 1, "内存条目照常摘掉");
    assert!(registry.snapshot().is_empty());
    assert!(store.deleted_ids().is_empty(), "退出期间不删行");
    assert!(store.cursor("s1").is_some(), "行留给下次启动");
}

/// 启动恢复：只回填侧栏列表，状态一律 `Stopped`（没有进程在跑）。
///
/// 第 35 轮：**无名行也要回填**（可见性 ≠ 命名）；只有无法定位单元的行被挡。
#[test]
fn restore_from_store_rebuilds_stopped_rows_in_one_bump() {
    let (registry, store) = registry();
    let mut original = entry("s1", "/proj");
    original.title = "修复登录竞态".into();
    original.title_source = TitleSource::Prompt;
    original.native_session_id = Some("native-42".into());
    store.seed(ResumeCursor::from_entry(&original).expect("listed entry"));
    // 不可恢复的行（无单元）不得进表。
    store.seed(ResumeCursor {
        project_id: String::new(),
        ..ResumeCursor::from_entry(&entry("orphan", "/proj")).expect("listed entry")
    });
    // 已输入但还没有名字：**要**回填（终端首条输入不再产生标题后的常态）。
    store.seed(ResumeCursor {
        title: String::new(),
        title_source: PersistedTitleSource::Placeholder,
        ..ResumeCursor::from_entry(&entry("nameless", "/proj")).expect("listed entry")
    });

    let before = registry.version();
    assert_eq!(registry.restore_from_store(), 2);

    let restored = registry.entry("s1").expect("侧栏行必须回来");
    assert_eq!(restored.state, SessionState::Stopped, "没有进程在跑");
    assert!(!restored.awaiting_user_activity);
    assert_eq!(restored.title, "修复登录竞态");
    assert_eq!(restored.title_source, TitleSource::Prompt);
    assert_eq!(restored.native_session_id.as_deref(), Some("native-42"));
    assert_eq!(restored.workspace, original.workspace);
    assert!(registry.entry("orphan").is_none());
    let nameless = registry.entry("nameless").expect("无名行也要回来");
    assert_eq!(nameless.title, "");
    assert_eq!(nameless.title_source, TitleSource::Placeholder);
    assert!(nameless.has_user_input, "已输入 ⇒ 侧栏列它");
    assert_eq!(registry.version(), before + 1, "一次插表只 bump 一次");

    // 重复恢复不产生重复条目，也不再 bump / 不再写库。
    assert_eq!(registry.restore_from_store(), 0);
    assert_eq!(registry.version(), before + 1);
    assert_eq!(registry.snapshot().len(), 2);
}

#[test]
fn restore_from_an_empty_store_does_not_bump() {
    let (registry, _store) = registry();
    let before = registry.version();
    assert_eq!(registry.restore_from_store(), 0);
    assert_eq!(registry.version(), before);
    assert!(registry.snapshot().is_empty());
}

/// 本次运行已经登记的会话是**更新的事实**，恢复不得覆盖它（也不得退回 `Stopped`）。
#[test]
fn restore_never_overwrites_a_live_session() {
    let (registry, store) = registry();
    store.seed(cursor("auto"));
    registry.register(entry("s1", "/proj"));
    registry.apply("s1", Signal::TurnStarted);

    assert_eq!(registry.restore_from_store(), 0);
    let live = registry.entry("s1").expect("仍是被登记的那条");
    assert_eq!(live.state, SessionState::Running, "不得被恢复成 Stopped");
}

/// 标题变化（首次命名 / 用户改名 / OSC 原生标题）都要活过重启。
#[test]
fn title_changes_are_written_through() {
    let (registry, store) = registry();
    registry.register(unlisted_entry("s1", "/proj"));
    assert!(store.stored_ids().is_empty(), "未列出不落盘");

    // 用户第一次提交：行出现 + 标题落盘（发送即出现在侧栏，不等跑完）。
    assert!(registry.report_user_input("s1", "修复登录竞态"));
    let saved = store.cursor("s1").expect("首次提交即落盘");
    assert!(saved.has_user_input);
    assert_eq!(saved.title, "修复登录竞态");
    assert_eq!(saved.title_source, PersistedTitleSource::Prompt);

    // 用户改名：更强来源覆盖，且必须落盘（用户改过的名字优先级最高）。
    assert!(registry.set_title("s1", TitleSource::User, "我的会话"));
    let saved = store.cursor("s1").expect("改名必须活过重启");
    assert_eq!(saved.title, "我的会话");
    assert_eq!(saved.title_source, PersistedTitleSource::User);

    // CLI 的 OSC / 主题上报（`report`，不置位）同样落盘标题 —— 但 `User` 不被自动来源覆盖。
    assert!(!registry.report("s1", Some((TitleSource::Native, "Parser bug")), false));
    assert_eq!(
        store.cursor("s1").expect("cursor").title,
        "我的会话",
        "User 不被自动来源覆盖"
    );
}

/// 没有用户改名时，CLI 自报的原生标题（OSC 0/2 / hook 主题）升级后立即落盘。
#[test]
fn native_titles_are_written_through() {
    let (registry, store) = registry();
    registry.register(unlisted_entry("s2", "/proj"));
    registry.report_user_input("s2", "fix the parser");
    assert!(registry.report("s2", Some((TitleSource::Native, "Parser bug")), false));
    let saved = store.cursor("s2").expect("原生标题也要活过重启");
    assert_eq!(saved.title, "Parser bug");
    assert_eq!(saved.title_source, PersistedTitleSource::Native);
}

/// 快照是**全量**的：单元分组在前端 selector（按 `workspaceKey` 等值），后端不切片。
///
/// 曾经的 `snapshot(Some(&UnitScope))` 与前端 `sessionsOfUnit` 是同一件事的两套判据
/// （cwd 最深根 vs key 等值），而带 scope 的调用方一个也没有 —— 两套判据只会各自漂移。
#[test]
fn snapshot_returns_every_unit_and_keeps_the_address_key() {
    let (registry, _store) = registry();
    registry.register(entry("main", "/proj"));
    registry.register(terminal_entry("wt", "/proj/.worktrees/dev"));

    let snapshot = registry.snapshot();
    let ids: Vec<&str> = snapshot.iter().map(|e| e.session_id.as_str()).collect();
    assert_eq!(ids.len(), 2, "两个单元的会话都在同一份快照里：{ids:?}");

    // 分组所需的身份只有 `workspace.key()` 一个（前端不做路径判定）。
    let keys: Vec<String> = snapshot.iter().map(|e| e.workspace.key()).collect();
    assert!(keys.contains(&WorkspaceSession::main("p1").key()));
    assert!(keys.contains(&WorkspaceSession::of("p1", Some("/proj/.worktrees/dev".into())).key()));
}

#[test]
fn snapshot_orders_by_unit_then_newest_first() {
    let (registry, _store) = registry();
    let mut older = entry("older", "/proj");
    older.started_at = Utc::now() - chrono::Duration::seconds(60);
    older.updated_at = older.started_at;
    let newer = entry("newer", "/proj");
    let mut other_unit = entry("other", "/elsewhere");
    other_unit.workspace = WorkspaceSession::of("p2", None);

    registry.register(newer);
    registry.register(older);
    registry.register(other_unit);

    let ids: Vec<String> = registry
        .snapshot()
        .into_iter()
        .map(|e| e.session_id)
        .collect();
    assert_eq!(
        ids,
        vec![
            "newer".to_string(),
            "older".to_string(),
            "other".to_string()
        ],
        "先按单元 key，再按开始时刻倒序"
    );
}

#[tokio::test]
async fn wait_returns_immediately_when_the_version_already_moved() {
    let (registry, _store) = registry();
    let current = registry.version();
    let long = std::time::Duration::from_secs(5);
    let started = std::time::Instant::now();
    let version = registry.wait_for_change(current + 1, long).await;
    assert_eq!(version, current);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(1),
        "版本已不同必须立即返回"
    );
}

#[tokio::test]
async fn wait_times_out_without_spinning() {
    let (registry, _store) = registry();
    let current = registry.version();
    let timeout = std::time::Duration::from_millis(40);
    let started = std::time::Instant::now();
    let version = registry.wait_for_change(current, timeout).await;
    assert_eq!(version, current);
    assert!(started.elapsed() >= timeout, "必须真的挂起而不是空转返回");
}

#[tokio::test]
async fn wait_wakes_up_on_state_change() {
    let (registry, _store) = registry();
    let registry = Arc::new(registry);
    registry.register(entry("s1", "/proj"));
    let since = registry.version();

    let waiter = {
        let registry = Arc::clone(&registry);
        tokio::spawn(async move {
            registry
                .wait_for_change(since, std::time::Duration::from_secs(5))
                .await
        })
    };
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    registry.apply("s1", Signal::TurnStarted);

    let version = waiter.await.expect("waiter task panicked");
    assert!(version > since, "状态变化必须唤醒挂起的长轮询");
}

/// 终端字节流通道的裁决（`report_terminal_input`）。
///
/// 判据是会话自己的登记事实 `agent_id`，不是字节形状：agent 终端的 `onData` 里混着
/// TUI 面板输入（`/model` 的过滤词），纯 shell 则除这行之外没有任何标题通道。
/// 变异验证：把 `report_terminal_input` 里的 `agent_id` 分流删掉，前两条用例必须转红。
mod terminal_input {
    use super::*;

    /// agent 终端：只置位 / 清权威门，**不写标题** —— 名字要等 hook / conversation / 改名。
    #[test]
    fn agent_terminal_engages_without_naming() {
        let (registry, _store) = registry();
        registry.register(new_agent_terminal("t1", "/proj-wt"));

        assert!(registry.report_terminal_input("t1", "deep"));
        let entry = &registry.snapshot()[0];
        assert!(entry.has_user_input, "用户确实提交过输入");
        assert_eq!(
            entry.title, "",
            "agent 会话只认 hook topic / conversation 标题"
        );
        assert_eq!(entry.title_source, TitleSource::Placeholder);
    }

    /// 纯 shell：首条输入就是它唯一的标题素材（`admit` 仍会拒掉斜杠命令 / 纯符号）。
    #[test]
    fn plain_shell_first_input_names_the_session() {
        let (registry, _store) = registry();
        registry.register(new_plain_shell_terminal("t1", "/proj-wt"));

        assert!(registry.report_terminal_input("t1", "  npm  test \t"));
        let entry = &registry.snapshot()[0];
        assert_eq!(
            entry.title, "npm test",
            "空白折叠 + 去首尾（`title::truncate`）"
        );
        assert_eq!(entry.title_source, TitleSource::Prompt);
        assert!(entry.has_user_input);
    }

    /// 纯 shell 有名字后，后续输入不改名、不重复 bump。
    #[test]
    fn plain_shell_later_input_keeps_the_first_title() {
        let (registry, _store) = registry();
        registry.register(new_plain_shell_terminal("t1", "/proj-wt"));
        assert!(registry.report_terminal_input("t1", "ls"));
        let version = registry.version();

        assert!(
            !registry.report_terminal_input("t1", "pwd"),
            "第二次提交不改变"
        );
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.title, "ls");
        assert_eq!(entry.title_source, TitleSource::Prompt);
        assert_eq!(registry.version(), version);
    }

    /// 斜杠命令不是主题（`title::admit` 判负），但仍算一次用户提交。
    #[test]
    fn plain_shell_slash_command_does_not_name_the_session() {
        let (registry, _store) = registry();
        registry.register(new_plain_shell_terminal("t1", "/proj-wt"));

        assert!(registry.report_terminal_input("t1", "/model"));
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.title, "", "斜杠命令不是主题");
        assert!(entry.has_user_input);
    }

    /// CLI 已经命名的会话不被终端输入改写（`should_upgrade` 是唯一覆盖序判据）。
    #[test]
    fn terminal_input_never_downgrades_a_cli_title() {
        let (registry, _store) = registry();
        registry.register(new_plain_shell_terminal("t1", "/proj-wt"));
        assert!(registry.set_title("t1", TitleSource::Native, "Parser bug"));

        assert!(registry.report_terminal_input("t1", "npm test"));
        let entry = &registry.snapshot()[0];
        assert_eq!(entry.title, "Parser bug");
        assert_eq!(entry.title_source, TitleSource::Native);
        assert!(entry.has_user_input);
    }

    /// 未知会话不建条目（终端活动可能在注销之后才到）。
    #[test]
    fn terminal_input_for_unknown_sessions_is_dropped() {
        let (registry, _store) = registry();
        assert!(!registry.report_terminal_input("ghost", "ls"));
        assert!(!registry.set_title("ghost", TitleSource::Native, "Parser bug"));
        assert!(registry.snapshot().is_empty());
    }
}

/// 同级可覆盖：同一条 `Native` 后到的可能更完整（CLI 每回合重绘任务标题）。
#[test]
fn native_title_replaces_another_native_title() {
    let (registry, _store) = registry();
    registry.register(unlisted_entry("s1", "/proj"));
    assert!(registry.set_title("s1", TitleSource::Native, "Fix login bug"));
    assert!(registry.set_title("s1", TitleSource::Native, "Fix login bug in the parser"));

    let entry = &registry.snapshot()[0];
    assert_eq!(entry.title, "Fix login bug in the parser");
    assert_eq!(entry.title_source, TitleSource::Native);
}

/// 改名（`User`）只写标题，不置位可见性 —— 侧栏的「用过」只由输入与 hook 翻转。
#[test]
fn user_rename_does_not_engage_the_session() {
    let (registry, _store) = registry();
    registry.register(new_plain_shell_terminal("t1", "/proj-wt"));

    assert!(registry.set_title("t1", TitleSource::User, "/model"));
    let entry = &registry.snapshot()[0];
    assert_eq!(entry.title, "/model", "用户改名不套任何清理 / 准入拒绝");
    assert_eq!(entry.title_source, TitleSource::User);
    assert!(!entry.has_user_input, "改名不是「用过」");
}
