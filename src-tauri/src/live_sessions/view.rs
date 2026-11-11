//! Wire DTO：注册表快照的 IPC 形态。
//!
//! 载荷规模：100 条会话 × ~200B ≈ 20KB，远低于红线 4 的 2MB 上界 ⇒ 不分页
//! （若将来破 1MB 再按单元分页，不预做）。

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::live_sessions::entry::{SessionEntry, SessionKind, SessionState, TitleSource};
use crate::live_sessions::registry::Registry;
use crate::live_sessions::title::placeholder_label;

/// 一条会话的前端形态。
///
/// 地址只以 **key 字符串**出现在 wire 上（与 git / file 事件同形）：分量化的
/// `{projectId, worktreePath}` 会让两段可独立缺失/错配。前端经
/// `WorkspaceSession.fromKeyOrId` 这一个 codec 取分量。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    /// 会话 id（chat：激活 tab 用 `data.sessionId`；terminal：用 `data.ptySessionId`）。
    pub session_id: String,
    /// 会话种类。
    pub kind: SessionKind,
    /// 该会话的 agent（纯 shell terminal 为 `None`；前端图标据此回落 `cli.svg`）。
    pub agent_id: Option<String>,
    /// 执行地址 key（`WorkspaceSession::key()`）。
    pub workspace_key: String,
    /// 派生后的标题。**永远非空**：没有真标题时是身份标签（`title::placeholder_label`）。
    pub title: String,
    /// 标题来源（**不进 UI**：只表达「有真标题 / 占位」，见 design §10）。
    pub title_source: TitleSource,
    /// 当前状态。
    pub state: SessionState,
    /// 会话开始时刻（ISO8601）。
    pub started_at: DateTime<Utc>,
    /// 最后一次状态 / 标题变化时刻（ISO8601，UI 的相对时间用它）。
    pub updated_at: DateTime<Utc>,
    /// 已完成回合数。
    pub turn_count: u32,
    /// 用户是否已经开始在这个会话里输入（侧栏只列 `true` 的条目）。
    pub has_user_input: bool,
}

impl SessionView {
    /// 条目 → wire DTO（`workspace_key` 由地址的唯一 key 铸造点产出，不在这里拼分隔符）。
    ///
    /// 标题在这一层**补齐**：`SessionEntry.title` 仍是「只有真标题」的形状（空串 +
    /// `Placeholder`，这是注册表与持久化的既有不变量），wire 则永远携带一个可渲染的字符串。
    /// 于是「空标题」不再是一个能被前端观察到的状态（红线 17 的三份前端兜底因此没有存在理由）。
    #[must_use]
    pub fn from_entry(entry: &SessionEntry) -> Self {
        let title = if entry.has_real_title() {
            entry.title.clone()
        } else {
            placeholder_label(entry.agent_id.as_deref(), &entry.cwd, &entry.session_id)
        };
        Self {
            session_id: entry.session_id.clone(),
            kind: entry.kind,
            agent_id: entry.agent_id.clone(),
            workspace_key: entry.workspace.key(),
            title,
            title_source: entry.title_source,
            state: entry.state,
            started_at: entry.started_at,
            updated_at: entry.updated_at,
            turn_count: entry.turn_count,
            has_user_input: entry.has_user_input,
        }
    }
}

/// 快照回包（`list_live_sessions`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSessionsSnapshot {
    /// 该快照对应的注册表版本（长轮询的比较基准）。
    pub version: u64,
    /// 会话列表（已按单元 / 时间排序）。
    pub sessions: Vec<SessionView>,
}

/// 长轮询回包（`wait_live_sessions`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSessionsWait {
    /// 当前版本号（`changed == false` 时等于请求里的 `since`）。
    pub version: u64,
    /// 版本是否已经变化（`false` = 超时）。
    pub changed: bool,
}

impl Registry {
    /// 快照 + 版本号的 wire 形态。
    ///
    /// **版本先读**：任何发生在读取之后的变更都会 bump 到更大的版本号，于是前端
    /// 一定会再收到一次变更事件并重拉 —— 宁可多拉一次，不可漏一次（漏一次就是
    /// 侧栏永久停在旧状态，且没有任何机制能自愈）。
    #[must_use]
    pub fn snapshot_view(&self) -> LiveSessionsSnapshot {
        let version = self.version();
        let mut sessions: Vec<SessionView> = self
            .snapshot()
            .iter()
            .map(SessionView::from_entry)
            .collect();
        disambiguate_placeholder_titles(&mut sessions);
        LiveSessionsSnapshot { version, sessions }
    }
}

/// 同一单元里两条无真标题的会话经常共享同一个身份标签（同 cwd、同 agent）：
/// 追加 `#2` / `#3` 让它们仍可区分。
///
/// 只给 `Placeholder` 编号（有真标题的行本来就可区分，且用户记得住自己的名字）；
/// 编号按快照顺序（注册表已稳定排序）⇒ 同一组会话反复快照得到同一组标签。
///
/// 分组键是 `(单元 key, 标签)` **元组**而不是拼接串：拼分隔符会造出第二个地址编码
/// （红线 12 的同形风险，`check_workspace_identity` 也会拦）。
///
/// 两趟（先计数、再改写）而不是一趟：一趟要在遍历中同时读标题和写标题，只能靠 clone 键；
/// 第一趟只借 `&str`，第二趟才落盘新标签 —— 快照是热路径（每次变更都全量重算）。
fn disambiguate_placeholder_titles(sessions: &mut [SessionView]) {
    let mut numbered: Vec<(usize, String)> = Vec::new();
    {
        let mut seen: HashMap<(&str, &str), u32> = HashMap::new();
        for (index, session) in sessions.iter().enumerate() {
            if session.title_source != TitleSource::Placeholder {
                continue;
            }
            let count = seen
                .entry((session.workspace_key.as_str(), session.title.as_str()))
                .or_insert(0);
            *count += 1;
            if *count > 1 {
                numbered.push((index, format!("{} #{count}", session.title)));
            }
        }
    }
    for (index, label) in numbered {
        sessions[index].title = label;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::git::WorkspaceSession;
    use crate::live_sessions::state::Signal;
    use crate::live_sessions::title::MAX_TITLE_CHARS;
    use std::sync::Arc;

    fn registry() -> Registry {
        Registry::new(Arc::new(
            crate::agent::chat::session_store::SqliteSessionStore::open_in_memory()
                .expect("in-memory session store"),
        ))
    }

    fn entry(id: &str, cwd: &str, worktree: Option<&str>) -> SessionEntry {
        SessionEntry::new(
            id,
            SessionKind::Terminal,
            None,
            WorkspaceSession::of("p1", worktree.map(str::to_string)),
            cwd,
        )
        .with_state(SessionState::Running)
    }

    /// `workspace_key` 必须来自地址的唯一 key 铸造点（主 checkout 尾段为空）。
    #[test]
    fn view_uses_the_address_key_not_a_hand_made_prefix() {
        let registry = registry();
        registry.register(entry("t1", "/proj", None));
        registry.register(entry("t2", "/proj-wt", Some("/proj-wt")));
        let keys: Vec<String> = registry
            .snapshot_view()
            .sessions
            .iter()
            .map(|s| s.workspace_key.clone())
            .collect();
        assert!(keys.contains(&WorkspaceSession::main("p1").key()));
        assert!(keys.contains(&WorkspaceSession::of("p1", Some("/proj-wt".into())).key()));
        // 手拼分隔符的产物（`:` 是最可能的形态）不会命中。
        assert!(!keys.contains(&"p1:/proj-wt".to_string()), "{keys:?}");
    }

    #[test]
    fn snapshot_view_carries_the_registry_version() {
        let registry = registry();
        registry.register(entry("t1", "/proj", None));
        let before = registry.version();
        registry.apply("t1", Signal::TurnFinished);
        let view = registry.snapshot_view();
        assert!(view.version > before);
        assert_eq!(view.version, registry.version());
    }

    /// 注册表不二次加工标题：截断只发生在写入侧（`title::admit`），
    /// wire 形态原样携带 —— 否则前端会拿到「省略号叠省略号」。
    #[test]
    fn view_carries_the_title_verbatim() {
        let registry = registry();
        let long = "标".repeat(MAX_TITLE_CHARS + 10);
        let mut entry = entry("t1", "/proj", None);
        entry.title = long.clone();
        entry.title_source = TitleSource::Prompt;
        registry.register(entry);
        let view = registry.snapshot_view();
        assert_eq!(view.sessions[0].title, long);
    }

    /// wire 形态：camelCase 键 + 枚举小驼峰值（前端 TS 镜像照这个形状声明）。
    #[test]
    fn view_serializes_with_camel_case_fields_and_enum_values() {
        let registry = registry();
        registry.register(entry("t1", "/proj", None));
        let view = registry.snapshot_view();
        let json = serde_json::to_value(&view).expect("serialize snapshot");
        let session = &json["sessions"][0];
        assert_eq!(session["sessionId"], "t1");
        assert_eq!(session["kind"], "terminal");
        assert_eq!(session["state"], "running");
        assert_eq!(session["titleSource"], "placeholder");
        assert_eq!(session["turnCount"], 0);
        assert_eq!(session["hasUserInput"], false, "刚登记 = 还没人用过");
        assert!(session["workspaceKey"].is_string());
        assert_eq!(session["agentId"], serde_json::Value::Null);
        assert!(json["version"].is_u64());
    }

    /// wire 上的标题**永远非空**：没有真标题时是身份标签，而不是空串。
    ///
    /// 变异验证：把 `SessionView::from_entry` 的补齐分支删掉（退回 `entry.title.clone()`）
    /// 本用例必红 —— 那正是「三源标题不显示」能被前端观察到的机制。
    #[test]
    fn placeholder_session_still_carries_a_renderable_title() {
        let registry = registry();
        registry.register(entry("t1", "/proj/neeko", None));
        let view = registry.snapshot_view();
        let session = &view.sessions[0];
        assert_eq!(session.title_source, TitleSource::Placeholder);
        assert_eq!(session.title, "neeko", "纯 shell 取 cwd 末段");
    }

    /// agent 会话的占位标签带 agent slug（行内 meta 已显示 agent 名，所以只用 slug）。
    #[test]
    fn placeholder_title_includes_the_agent_slug() {
        let registry = registry();
        let mut terminal = entry("t1", "/proj/neeko", None);
        terminal.agent_id = Some("claude-code".into());
        registry.register(terminal);
        assert_eq!(
            registry.snapshot_view().sessions[0].title,
            "claude-code · neeko"
        );
    }

    /// 同单元里同身份的两条会话必须可区分：第二条起追加序号。
    #[test]
    fn duplicate_placeholder_titles_are_numbered() {
        let registry = registry();
        registry.register(entry("t1", "/proj/neeko", None));
        registry.register(entry("t2", "/proj/neeko", None));
        let titles: Vec<String> = registry
            .snapshot_view()
            .sessions
            .iter()
            .map(|s| s.title.clone())
            .collect();
        assert_eq!(titles, vec!["neeko".to_string(), "neeko #2".to_string()]);
    }

    /// 有真标题的行不参与编号（用户起的名字不该被改写成 `名字 #2`）。
    #[test]
    fn real_titles_are_never_numbered() {
        let registry = registry();
        let mut named = entry("t1", "/proj/neeko", None);
        named.title = "neeko".into();
        named.title_source = TitleSource::Prompt;
        registry.register(named);
        registry.register(entry("t2", "/proj/neeko", None));
        let titles: Vec<String> = registry
            .snapshot_view()
            .sessions
            .iter()
            .map(|s| s.title.clone())
            .collect();
        assert_eq!(titles, vec!["neeko".to_string(), "neeko".to_string()]);
    }

    /// 单元隔离：不同单元各从 `#1` 开始，不互相挤号。
    #[test]
    fn placeholder_numbering_is_per_unit() {
        let registry = registry();
        registry.register(entry("t1", "/proj/neeko", None));
        // 同一个 cwd 末段，但属于另一个单元（worktree）：两边都应保持 `neeko`。
        registry.register(entry("t2", "/proj/neeko", Some("/proj/.worktrees/a")));
        let titles: Vec<String> = registry
            .snapshot_view()
            .sessions
            .iter()
            .map(|s| s.title.clone())
            .collect();
        assert_eq!(titles, vec!["neeko".to_string(), "neeko".to_string()]);
    }

    /// 快照是**全量**的：单元过滤在前端 selector（按 `workspaceKey` 等值），后端不分单元切片。
    #[test]
    fn snapshot_view_returns_every_unit() {
        let registry = registry();
        registry.register(entry("main", "/proj", None));
        registry.register(entry(
            "wt",
            "/proj/.worktrees/dev",
            Some("/proj/.worktrees/dev"),
        ));
        let keys: Vec<String> = registry
            .snapshot_view()
            .sessions
            .iter()
            .map(|s| s.workspace_key.clone())
            .collect();
        assert_eq!(keys.len(), 2, "两个单元的会话都在同一份快照里：{keys:?}");
        assert!(keys.contains(&WorkspaceSession::main("p1").key()));
    }
}
