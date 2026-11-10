//! `SessionEntry` ⇄ `ResumeCursor` 的**唯一**投影点（写穿持久化 + 启动恢复）。
//!
//! 正向：运行时条目 → 持久化行。只落**已出现在侧栏**的会话（`has_user_input`）；
//! 数据库存的是「列表出现过什么」，不是「哪些进程还活着」。
//!
//! 反向：持久化行 → 运行时条目，且 `state` **固定为 `Stopped`** —— 启动时进程已经没了，
//! 凭空造一条 `Ready` 会话就是侧栏幽灵行。反向只用于**回填侧栏列表**，不建 tab、不起进程。
//!
//! 位置说明：映射写在 `live_sessions` 里而不是 `agent/chat/session_store.rs`，是为了让
//! 「运行时词表 ⇄ 持久化词表」的映射与被映射的运行时词汇住在一起（`session_store`
//! 不需要认识 `SessionState` / `TitleSource`），依赖方向保持 `live_sessions → agent::chat`。

use std::collections::HashMap;

use chrono::{DateTime, Utc};

use crate::agent::chat::adapter::AgentKind;
use crate::agent::chat::session_store::{
    PersistedSessionKind, PersistedTitleSource, ResumeCursor, SessionStatus,
};
use crate::common::git::WorkspaceSession;
use crate::live_sessions::entry::{SessionEntry, SessionKind, SessionState, TitleSource};

impl From<SessionState> for SessionStatus {
    fn from(state: SessionState) -> Self {
        match state {
            SessionState::Ready => Self::Ready,
            SessionState::Running => Self::Running,
            SessionState::AwaitingApproval => Self::AwaitingApproval,
            // 运行时区分「失败」与「正常结束」，持久化不需要 —— 两者都已不在运行。
            SessionState::Failed | SessionState::Stopped => Self::Closed,
        }
    }
}

impl From<SessionKind> for PersistedSessionKind {
    fn from(kind: SessionKind) -> Self {
        match kind {
            SessionKind::Chat => Self::Chat,
            SessionKind::Terminal => Self::Terminal,
        }
    }
}

impl TryFrom<PersistedSessionKind> for SessionKind {
    type Error = ();

    fn try_from(kind: PersistedSessionKind) -> Result<Self, Self::Error> {
        match kind {
            PersistedSessionKind::Chat => Ok(Self::Chat),
            PersistedSessionKind::Terminal => Ok(Self::Terminal),
        }
    }
}

impl From<TitleSource> for PersistedTitleSource {
    fn from(source: TitleSource) -> Self {
        match source {
            TitleSource::Placeholder => Self::Placeholder,
            TitleSource::Prompt => Self::Prompt,
            TitleSource::Native => Self::Native,
            TitleSource::User => Self::User,
        }
    }
}

impl TryFrom<PersistedTitleSource> for TitleSource {
    type Error = ();

    fn try_from(source: PersistedTitleSource) -> Result<Self, Self::Error> {
        match source {
            PersistedTitleSource::Placeholder => Ok(Self::Placeholder),
            PersistedTitleSource::Prompt => Ok(Self::Prompt),
            PersistedTitleSource::Native => Ok(Self::Native),
            PersistedTitleSource::User => Ok(Self::User),
        }
    }
}

impl ResumeCursor {
    /// 从 live 条目投影出恢复游标；**未出现在侧栏的条目返回 `None`**。
    ///
    /// 判据只有 `has_user_input` 一条（**写门**）：行存在与否 = 「这条会话在侧栏出现过」。
    /// chat 与 terminal（含纯 shell）一视同仁 —— 落盘的是**行**，不是「可恢复的 agent 进程」。
    /// 行能不能**读回**是另一个问题，判据在 [`ResumeCursor::is_restorable`]（读门）。
    #[must_use]
    pub fn from_entry(entry: &SessionEntry) -> Option<Self> {
        if !entry.has_user_input {
            return None;
        }
        // 纯 shell 终端的 agent 为空串：`AgentKind::from_agent_id` 会降为 `Custom`，
        // 反向投影时再还原成 `None`（不要造出一个名叫 "" 的 agent）。
        let agent_id = entry.agent_id.clone().unwrap_or_default();
        Some(Self {
            session_id: entry.session_id.clone(),
            agent_kind: AgentKind::from_agent_id(&agent_id),
            agent_id,
            cwd: entry.cwd.clone(),
            model: String::new(),
            runtime_mode: "auto".into(),
            turn_count: entry.turn_count,
            status: SessionStatus::from(entry.state),
            last_activity: entry.updated_at.to_rfc3339(),
            kind: entry.kind.into(),
            project_id: entry.workspace.project_id.clone(),
            worktree_path: entry.workspace.worktree_path.clone(),
            title: entry.title.clone(),
            title_source: entry.title_source.into(),
            has_user_input: entry.has_user_input,
            native_session_id: entry.native_session_id.clone(),
            started_at: entry.started_at.to_rfc3339(),
        })
    }

    /// 持久化行 → 运行时条目（启动恢复用）；**不可定位 / 不可显示的行返回 `None`**。
    ///
    /// 持久化行 → 运行时条目（启动恢复用）；**不可定位 / 不可显示的行返回 `None`**。
    ///
    /// 判据只有一份：[`ResumeCursor::is_restorable`]（读门）。本方法不重写那三条规则 ——
    /// 否则 SQL 粗筛、读门与本方法会各自漂移，表现是「写了不显示」或「显示了不该有的行」。
    ///
    /// 时间戳可降级（旧行的 `datetime('now')` 不是 RFC3339）：时间不准可以忍，
    /// 整行不出现不行。
    #[must_use]
    pub fn into_entry(&self) -> Option<SessionEntry> {
        if !self.is_restorable() {
            return None;
        }
        let kind = SessionKind::try_from(self.kind).ok()?;
        let title_source = TitleSource::try_from(self.title_source).ok()?;
        // 旧行的 `datetime('now')` 不是 RFC3339：时间不准可以忍，整行不出现不行。
        let updated_at = parse_rfc3339(&self.last_activity).unwrap_or_else(Utc::now);
        let started_at = parse_rfc3339(&self.started_at).unwrap_or(updated_at);
        Some(SessionEntry {
            session_id: self.session_id.clone(),
            kind,
            agent_id: (!self.agent_id.is_empty()).then(|| self.agent_id.clone()),
            workspace: WorkspaceSession::of(self.project_id.clone(), self.worktree_path.clone()),
            cwd: self.cwd.clone(),
            // 没有进程在跑：任何非终止态都是假数据。
            state: SessionState::Stopped,
            title: self.title.clone(),
            title_source,
            native_session_id: self.native_session_id.clone(),
            started_at,
            updated_at,
            turn_count: self.turn_count,
            has_user_input: self.has_user_input,
            awaiting_user_activity: false,
        })
    }
}

fn parse_rfc3339(raw: &str) -> Option<chrono::DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// 启动恢复时的**去重**：同一条 CLI 原生会话被恢复多次，会留下多行 `ResumeCursor`
/// （每次 `--resume` 都是一个新 `session_id`，但 hook 上报的 `native_session_id` 相同）。
/// 侧栏只该有一行：按「单元地址 + native id」分组，留 `last_activity` 最新的那条，
/// 其余的 id 交给调用方从库里删掉。
///
/// `native_session_id` 为空的行（纯 shell / 没装 hook 的 agent）没有可合并的标识，
/// 它们本来就是彼此独立的会话，原样保留。`has_user_input = false` 的行同理不参与竞争。
///
/// 时间戳不可解析的旧行按 `DateTime::MIN_UTC` 处理：宁可被判为旧，也不能因为
/// 解析失败就「永远最新」把真正在用的那条挤掉。
pub(crate) fn dedupe_restorable(cursors: Vec<ResumeCursor>) -> (Vec<ResumeCursor>, Vec<String>) {
    fn activity_of(cursor: &ResumeCursor) -> DateTime<Utc> {
        parse_rfc3339(&cursor.last_activity).unwrap_or(DateTime::<Utc>::MIN_UTC)
    }

    let mut best: HashMap<(String, Option<String>, String), usize> = HashMap::new();
    let mut kept: Vec<ResumeCursor> = Vec::new();
    let mut stale: Vec<String> = Vec::new();

    for cursor in cursors {
        // 没列出过的行（`cursor::from_entry` 的写门）不该参与竞争：它们本来就不进侧栏，
        // 若因 activity 更新而挤掉真正列出过的那条，重启后反而少了一行。
        let Some(native) = cursor
            .has_user_input
            .then(|| cursor.native_session_id.clone())
            .flatten()
            .filter(|id| !id.trim().is_empty())
        else {
            kept.push(cursor);
            continue;
        };
        let key = (
            cursor.project_id.clone(),
            cursor.worktree_path.clone(),
            native,
        );
        match best.get(&key).copied() {
            None => {
                best.insert(key, kept.len());
                kept.push(cursor);
            }
            Some(idx) if activity_of(&cursor) > activity_of(&kept[idx]) => {
                let replaced = std::mem::replace(&mut kept[idx], cursor);
                stale.push(replaced.session_id);
            }
            Some(_) => stale.push(cursor.session_id),
        }
    }
    (kept, stale)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::chat::session_store::{
        PersistedSessionKind, PersistedTitleSource, SessionStatus,
    };
    use crate::common::git::WorkspaceSession;

    fn entry(kind: SessionKind, agent_id: Option<&str>, state: SessionState) -> SessionEntry {
        SessionEntry::new(
            "s1",
            kind,
            agent_id.map(str::to_string),
            WorkspaceSession::of("p1", Some("/proj-wt".into())),
            "/proj-wt",
        )
        .with_state(state)
        .with_user_input(true)
    }

    /// 列出的 chat 会话可持久化：身份 / 地址 / 状态 / 回合数逐项投影。
    #[test]
    fn chat_entry_projects_into_a_resume_cursor() {
        let cursor =
            ResumeCursor::from_entry(&entry(SessionKind::Chat, Some("pi"), SessionState::Running))
                .expect("listed chat entry must be persistable");
        assert_eq!(cursor.session_id, "s1");
        assert_eq!(cursor.agent_id, "pi");
        assert_eq!(cursor.cwd, "/proj-wt");
        assert_eq!(cursor.status, SessionStatus::Running);
        assert_eq!(cursor.turn_count, 0);
        assert_eq!(cursor.kind, PersistedSessionKind::Chat);
        assert_eq!(cursor.project_id, "p1");
        assert_eq!(cursor.worktree_path.as_deref(), Some("/proj-wt"));
        assert!(cursor.has_user_input);
    }

    /// **列出的** terminal（含纯 shell，`agent_id = None`）同样落盘：
    /// 侧栏要恢复的是「这一行」，不是「一个可恢复的 agent 进程」。
    #[test]
    fn listed_terminal_entries_are_persistable() {
        for agent in [None, Some("pi")] {
            let mut entry = entry(SessionKind::Terminal, agent, SessionState::Running);
            entry.title = "构建日志".into();
            entry.title_source = TitleSource::Prompt;
            let cursor = ResumeCursor::from_entry(&entry)
                .unwrap_or_else(|| panic!("列出的 terminal 必须落盘：agent={agent:?}"));
            assert_eq!(cursor.kind, PersistedSessionKind::Terminal);
            assert_eq!(cursor.agent_id, agent.unwrap_or_default());
            assert_eq!(cursor.title, "构建日志");
        }
    }

    /// 没进侧栏的会话不落盘 —— 数据库存的是「列表出现过什么」。
    #[test]
    fn unlisted_entries_are_not_persisted() {
        for kind in [SessionKind::Chat, SessionKind::Terminal] {
            let entry = SessionEntry::new(
                "s1",
                kind,
                Some("pi".into()),
                WorkspaceSession::main("p1"),
                "/proj",
            );
            assert!(
                ResumeCursor::from_entry(&entry).is_none(),
                "未置位 has_user_input 的 {kind:?} 不落盘"
            );
        }
    }

    /// 双向穷举：两个词表的每个 variant 都能往返（漏一个会让侧栏行恢复成错种类）。
    #[test]
    fn kind_and_title_source_maps_are_bijective() {
        for kind in [SessionKind::Chat, SessionKind::Terminal] {
            let persisted = PersistedSessionKind::from(kind);
            assert_eq!(SessionKind::try_from(persisted), Ok(kind), "{kind:?}");
        }
        for source in [
            TitleSource::Placeholder,
            TitleSource::Prompt,
            TitleSource::Native,
            TitleSource::User,
        ] {
            let persisted = PersistedTitleSource::from(source);
            assert_eq!(TitleSource::try_from(persisted), Ok(source), "{source:?}");
        }
    }

    /// 列出的条目全字段往返：标题 / kind / 地址 / native id / 时间戳 / 回合数。
    #[test]
    fn entry_survives_a_projection_round_trip() {
        let mut original = entry(
            SessionKind::Terminal,
            Some("claude-code"),
            SessionState::Failed,
        );
        original.title = "修复登录竞态".into();
        original.title_source = TitleSource::User;
        original.native_session_id = Some("native-42".into());
        original.turn_count = 7;

        let restored = ResumeCursor::from_entry(&original)
            .expect("listed entry")
            .into_entry()
            .expect("restorable cursor");

        assert_eq!(restored.session_id, original.session_id);
        assert_eq!(restored.kind, original.kind);
        assert_eq!(restored.agent_id, original.agent_id);
        assert_eq!(restored.workspace, original.workspace);
        assert_eq!(restored.cwd, original.cwd);
        assert_eq!(restored.title, original.title);
        assert_eq!(restored.title_source, original.title_source);
        assert_eq!(restored.native_session_id, original.native_session_id);
        assert_eq!(restored.turn_count, original.turn_count);
        assert_eq!(restored.has_user_input, original.has_user_input);
        assert_eq!(restored.started_at, original.started_at, "开始时刻可往返");
        assert_eq!(restored.updated_at, original.updated_at, "最后活动可往返");
        // 恢复出来的一定是「没有进程在跑」的那一档。
        assert_eq!(restored.state, SessionState::Stopped);
        assert!(!restored.awaiting_user_activity);
    }

    /// 纯 shell 终端（`agent_id = None`）往返后仍是 `None`（不是空串 agent）。
    #[test]
    fn shell_terminal_round_trip_keeps_no_agent() {
        let mut original = entry(SessionKind::Terminal, None, SessionState::Stopped);
        original.title = "日志".into();
        original.title_source = TitleSource::Prompt;
        let restored = ResumeCursor::from_entry(&original)
            .unwrap()
            .into_entry()
            .unwrap();
        assert_eq!(restored.agent_id, None);
    }

    /// 无法定位单元的行不恢复；**无名行要恢复**（第 35 轮：可见性 ≠ 命名）。
    ///
    /// 旧行扩列后正是「有单元、无名字」的形态 —— 那些行必须能回到侧栏（画成占位行）。
    #[test]
    fn cursor_without_a_unit_is_not_restorable_but_unnamed_is() {
        let base =
            ResumeCursor::from_entry(&entry(SessionKind::Chat, Some("pi"), SessionState::Ready))
                .unwrap();

        let no_title = ResumeCursor {
            title: String::new(),
            title_source: PersistedTitleSource::Placeholder,
            ..base.clone()
        };
        assert!(
            no_title.into_entry().is_some(),
            "无名但有单元 ⇒ 仍要回填（侧栏画占位行）"
        );

        let no_unit = ResumeCursor {
            project_id: String::new(),
            ..base.clone()
        };
        assert!(no_unit.into_entry().is_none(), "无法定位单元的行不恢复");

        // `Placeholder ⟺ 空标题` 不变量：占位来源却有标题 => 数据损坏，不猜。
        let inconsistent = ResumeCursor {
            title: "有人手改了库".into(),
            title_source: PersistedTitleSource::Placeholder,
            ..base
        };
        assert!(inconsistent.into_entry().is_none(), "占位来源不得携带标题");
    }

    /// 旧行的 `datetime('now')` 时间戳不是 RFC3339：`last_activity` 退化为当前时刻，
    /// `started_at` 再退化到 `updated_at` —— 宁可时间不准，不可整行不出现。
    #[test]
    fn non_rfc3339_timestamps_fall_back_instead_of_dropping_the_row() {
        let mut original = entry(SessionKind::Chat, Some("pi"), SessionState::Ready);
        original.title = "修复登录竞态".into();
        original.title_source = TitleSource::Prompt;
        let cursor = ResumeCursor {
            last_activity: "2025-01-01 00:00:00".into(),
            started_at: "2025-01-01 00:00:00".into(),
            ..ResumeCursor::from_entry(&original).unwrap()
        };
        let restored = cursor.into_entry().expect("时间格式不影响可否恢复");
        assert_eq!(restored.started_at, restored.updated_at);
    }

    fn cursor(id: &str, native: Option<&str>, last_activity: &str) -> ResumeCursor {
        let mut source = entry(SessionKind::Terminal, Some("pi"), SessionState::Stopped);
        source.session_id = id.to_string();
        source.title = "bug修复".into();
        source.title_source = TitleSource::User;
        source.native_session_id = native.map(str::to_string);
        let base = ResumeCursor::from_entry(&source).expect("listed entry");
        ResumeCursor {
            last_activity: last_activity.to_string(),
            ..base
        }
    }

    /// 恢复同一条原生会话会留下多行 cursor：只留 activity 最新的那一行。
    #[test]
    fn dedupe_keeps_the_newest_row_per_native_session() {
        let rows = vec![
            cursor("old", Some("native-1"), "2026-11-08T10:00:00Z"),
            cursor("new", Some("native-1"), "2026-11-10T02:14:38Z"),
            cursor("middle", Some("native-1"), "2026-11-09T09:00:00Z"),
        ];
        let (kept, stale) = dedupe_restorable(rows);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].session_id, "new");
        assert_eq!(stale.len(), 2);
        assert!(stale.contains(&"old".to_string()));
        assert!(stale.contains(&"middle".to_string()));
    }

    /// 不同单元 / 不同原生会话 / 无 native id 的行都是**独立会话**，不得合并。
    #[test]
    fn dedupe_does_not_merge_distinct_sessions() {
        let mut other_unit = cursor("other-unit", Some("native-1"), "2026-11-10T03:00:00Z");
        other_unit.project_id = "p2".into();
        let rows = vec![
            cursor("a", Some("native-1"), "2026-11-10T02:00:00Z"),
            cursor("b", Some("native-2"), "2026-11-10T02:00:00Z"),
            cursor("plain-1", None, "2026-11-10T02:00:00Z"),
            cursor("plain-2", None, "2026-11-10T02:00:00Z"),
            other_unit,
        ];
        let (kept, stale) = dedupe_restorable(rows);
        assert_eq!(kept.len(), 5, "{kept:?}");
        assert!(stale.is_empty());
    }

    /// 没列出过的行不得参与竞争（否则会把真正在侧栏的那条挤掉）。
    #[test]
    fn dedupe_ignores_unlisted_rows() {
        let mut unlisted = cursor("unlisted", Some("native-1"), "2026-11-10T09:00:00Z");
        unlisted.has_user_input = false;
        let (kept, stale) = dedupe_restorable(vec![
            cursor("listed", Some("native-1"), "2026-11-09T09:00:00Z"),
            unlisted,
        ]);
        assert_eq!(kept.len(), 2, "unlisted 行原样保留");
        assert!(stale.is_empty());
    }

    /// 时间戳不可解析的旧行不能因为退化值而被判为「永远最新」。
    #[test]
    fn dedupe_treats_unparseable_activity_as_oldest() {
        let rows = vec![
            cursor("legacy", Some("native-1"), "2026-11-10 02:00:00"),
            cursor("rfc3339", Some("native-1"), "2026-11-09T02:00:00Z"),
        ];
        let (kept, _stale) = dedupe_restorable(rows);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].session_id, "rfc3339");
    }

    /// 状态投影穷举：运行时 5 态 → 持久化 4 态。
    #[test]
    fn every_runtime_state_projects_to_a_persisted_status() {
        let cases = [
            (SessionState::Ready, SessionStatus::Ready),
            (SessionState::Running, SessionStatus::Running),
            (
                SessionState::AwaitingApproval,
                SessionStatus::AwaitingApproval,
            ),
            (SessionState::Failed, SessionStatus::Closed),
            (SessionState::Stopped, SessionStatus::Closed),
        ];
        for (runtime, persisted) in cases {
            assert_eq!(SessionStatus::from(runtime), persisted, "{runtime:?}");
        }
    }
}
