//! `Registry` 不变量测试：重复 id 只 warn、迟到信号丢弃、状态未变不 bump、
//! 写穿保留 cursor 的既有字段、快照分组/排序、长轮询语义。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::*;
use crate::agent::chat::session_store::SessionStatus;
use crate::common::git::WorkspaceSession;
use crate::live_sessions::entry::{SessionKind, SessionState};
use crate::AppError;

/// 记录型 store：断言写穿了什么、关掉了谁（真正的 SQLite 由 `session_store` 自测）。
#[derive(Default)]
struct RecordingStore {
    cursors: Mutex<HashMap<String, ResumeCursor>>,
    closed: Mutex<Vec<String>>,
    /// 每次 `save_cursor` 落下的状态（写穿节流的判据：哪些变化**真的**会落盘）。
    saves: Mutex<Vec<SessionStatus>>,
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

    fn list_active(&self) -> Vec<ResumeCursor> {
        self.cursors
            .lock()
            .expect("infallible: cursors")
            .values()
            .filter(|c| c.status != SessionStatus::Closed)
            .cloned()
            .collect()
    }

    fn close_session(&self, session_id: &str) -> Result<(), AppError> {
        self.closed
            .lock()
            .expect("infallible: closed")
            .push(session_id.to_string());
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
}

fn registry() -> (Registry, Arc<RecordingStore>) {
    let store = Arc::new(RecordingStore::default());
    (Registry::new(store.clone()), store)
}

/// 夹具：生产路径经 `set_title` 写入标题；这里直接给字段，省掉每条用例一次额外写入。
/// 值必须满足 `title::admit` 的不变量（`Placeholder` ⇒ 空标题），否则夹具会造出
/// 生产不可能出现的状态。
fn entry(id: &str, cwd: &str) -> SessionEntry {
    let mut entry = SessionEntry::new(
        id,
        SessionKind::Chat,
        Some("pi".into()),
        WorkspaceSession::of("p1", None),
        cwd,
    );
    entry.title = format!("title-{id}");
    entry.title_source = TitleSource::Prompt;
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
    registry.register(entry("s1", "/proj"));
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
    let (registry, _store) = registry();
    let mut old = entry("old", "/proj");
    old.title = "修复登录竞态".into();
    old.title_source = TitleSource::Prompt;
    old.has_user_input = true;
    registry.register(old);
    registry.apply("old", Signal::TurnFinished);
    registry.apply("old", Signal::Stopped);

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

    // 幂等：旧条目已消失，再继承一次什么都不发生。
    assert!(!registry.adopt("old", "new"));
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

/// 原生会话 id：只写一次、未知会话不建条目、**不 bump 版本**（它不进 wire 契约）。
#[test]
fn native_session_id_is_recorded_once_without_bumping_the_version() {
    let (registry, _store) = registry();
    registry.register(entry("s1", "/proj"));
    let before = registry.version();

    assert!(registry.record_native_session_id("s1", " native-42 "));
    assert_eq!(
        registry.entry("s1").and_then(|e| e.native_session_id),
        Some("native-42".to_string()),
        "trim 后落库"
    );
    assert_eq!(registry.version(), before, "UI 看不见的字段不刷快照");

    assert!(
        !registry.record_native_session_id("s1", "another"),
        "同一条会话的原生 id 不变，重复写是噪声"
    );
    assert!(!registry.record_native_session_id("ghost", "native-9"));
    assert!(!registry.record_native_session_id("s1", "   "), "空白不写");
    assert_eq!(registry.snapshot().len(), 1, "不得为未知会话建条目");
}

#[test]
fn report_first_titles_and_engages_once_only() {
    let (registry, _store) = registry();
    registry.register(entry("s1", "/proj"));
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
    let mut silent = entry("s1", "/proj");
    silent.title = String::new();
    silent.title_source = TitleSource::Placeholder;
    registry.register(silent);

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

/// 写穿只发生在「DB 读者真的会读到」的变化上。
///
/// `SessionStore::list_active` 只按 `status != Closed` 过滤，没有任何代码把
/// `Ready/Running/AwaitingApproval` 读回 live 条目 —— 于是中间态不必落盘。这条判据
/// 同时把「每次状态转移都在异步执行器线程上同步写一次 SQLite」压回每回合一次
/// （红线 3 取向，见 `persistence-and-cache.md` §4b.3）。
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

    // 终态：`list_active` 的过滤依据 ⇒ 落盘。
    assert!(registry.apply("s1", Signal::Failed));
    let saved = store.cursor("s1").expect("cursor");
    assert_eq!(saved.status, SessionStatus::Closed, "终态落 Closed");
}

#[test]
fn terminal_entries_are_never_persisted() {
    let (registry, store) = registry();
    registry.register(terminal_entry("t1", "/proj-wt"));
    registry.apply("t1", Signal::TurnStarted);
    registry.apply("t1", Signal::TurnFinished);
    assert!(store.list_active().is_empty(), "terminal 不落 chat 表");
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
    assert!(registry.report_user_input("t1", ""));
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

    assert!(registry.report_user_input("t1", ""));
    assert_eq!(registry.snapshot()[0].state, SessionState::Running);
}

#[test]
fn unregister_removes_the_entry_and_closes_the_cursor() {
    let (registry, store) = registry();
    registry.register(entry("s1", "/proj"));
    registry.apply("s1", Signal::TurnStarted);
    let before = registry.version();

    assert!(registry.unregister("s1"));
    assert_eq!(registry.version(), before + 1);
    assert!(registry.snapshot().is_empty());
    assert_eq!(store.closed.lock().expect("infallible: closed").len(), 1);
    assert_eq!(
        store.cursor("s1").expect("cursor").status,
        SessionStatus::Closed
    );

    // 幂等：重复注销只返回 false，不重复关 cursor。
    assert!(!registry.unregister("s1"));
    assert_eq!(registry.version(), before + 1);
    assert_eq!(store.closed.lock().expect("infallible: closed").len(), 1);
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
