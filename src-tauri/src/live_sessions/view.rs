//! Wire DTO：注册表快照的 IPC 形态。
//!
//! 载荷规模：100 条会话 × ~200B ≈ 20KB，远低于红线 4 的 2MB 上界 ⇒ 不分页
//! （若将来破 1MB 再按单元分页，不预做）。

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::live_sessions::entry::{SessionEntry, SessionKind, SessionState, TitleSource};
use crate::live_sessions::registry::Registry;

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
    /// 派生后的标题。
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
}

impl SessionView {
    /// 条目 → wire DTO（`workspace_key` 由地址的唯一 key 铸造点产出，不在这里拼分隔符）。
    #[must_use]
    pub fn from_entry(entry: &SessionEntry) -> Self {
        Self {
            session_id: entry.session_id.clone(),
            kind: entry.kind,
            agent_id: entry.agent_id.clone(),
            workspace_key: entry.workspace.key(),
            title: entry.title.clone(),
            title_source: entry.title_source,
            state: entry.state,
            started_at: entry.started_at,
            updated_at: entry.updated_at,
            turn_count: entry.turn_count,
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
        LiveSessionsSnapshot {
            version,
            sessions: self
                .snapshot()
                .iter()
                .map(SessionView::from_entry)
                .collect(),
        }
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
            (TitleSource::Placeholder, "Terminal".into()),
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

    /// 注册表不二次加工标题：截断只发生在写入侧（`title::pick` / `set_title`），
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
        assert!(session["workspaceKey"].is_string());
        assert_eq!(session["agentId"], serde_json::Value::Null);
        assert!(json["version"].is_u64());
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
