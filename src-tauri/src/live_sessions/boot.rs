//! 启动恢复入口：把 `agent_sessions.db` 里的侧栏行投影回注册表。
//!
//! # 只回填列表，不恢复运行态
//!
//! 恢复出来的条目状态**一律 `Stopped`**：进程已经没了，任何非终止态都是假数据。本层不建 tab、
//! 不起进程、不续接对话 —— 真正的恢复发生在用户点击那一行之后（前端 `useActivateSession`：
//! terminal 有 `native_session_id` 就 `--resume`，否则新建同 agent 终端；chat 打开新 tab）。
//!
//! # 不 emit 事件
//!
//! 此刻前端尚未挂载，没有监听者；`useLiveSessionsBridge` 挂载后立即拉一次快照即可。因此本层
//! 也不需要新命令或新事件名 —— 事件通道维持「单一常量源」（红线 5）。
//!
//! # 失败只降级
//!
//! 读盘失败 = 侧栏从空开始（注册表仍是本次运行的唯一事实），不让启动失败：`setup` 返回
//! `Err` 会终止进程，而「要不要看到上次的会话列表」不是致命依赖。

use crate::live_sessions::registry::Registry;

/// 把持久化的侧栏行回填注册表，返回新插入的行数（`0` = 没有可恢复的记录）。
///
/// **纯函数**：只动注册表，没有任何文件系统副作用。附属资源的 GC 属于组合根
/// （`app/boot.rs::on_setup` 在 restore 之后调用 `HistoryStore::prune`）——
/// 曾把 GC 塞进这里，导致三个单测直接删掉真实用户 `~/.neeko/terminal_history/`
/// 下的日志。职责单一也让「回填」可脱离磁盘直测。
pub fn restore(registry: &Registry) -> usize {
    let restored = registry.restore_from_store();
    if restored > 0 {
        log::info!("[live_sessions] restored {restored} sidebar row(s) from the store");
    }
    restored
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::agent::chat::session_store::{ResumeCursor, SessionStore, SqliteSessionStore};
    use crate::common::git::WorkspaceSession;
    use crate::live_sessions::entry::{SessionEntry, SessionKind, SessionState, TitleSource};

    fn listed_terminal() -> SessionEntry {
        let mut entry = SessionEntry::new(
            "s1",
            SessionKind::Terminal,
            Some("pi".into()),
            WorkspaceSession::of("p1", Some("/proj-wt".into())),
            "/proj-wt",
        )
        .with_state(SessionState::Running)
        .with_user_input(true);
        entry.title = "构建日志".into();
        entry.title_source = TitleSource::Prompt;
        entry
    }

    /// 真实 store（内存库）→ 注册表：行回来、状态是 `Stopped`、重复恢复不重复插入。
    #[test]
    fn restore_rebuilds_sidebar_rows_from_the_real_store() {
        let store = Arc::new(SqliteSessionStore::open_in_memory().expect("in-memory store"));
        let entry = listed_terminal();
        store
            .save_cursor(&ResumeCursor::from_entry(&entry).expect("listed entry"))
            .expect("seed cursor");

        let registry = Registry::new(store);
        assert_eq!(restore(&registry), 1);

        let restored = registry.entry("s1").expect("侧栏行必须回来");
        assert_eq!(restored.state, SessionState::Stopped, "没有进程在跑");
        assert_eq!(restored.title, "构建日志");
        assert_eq!(restored.kind, SessionKind::Terminal);
        assert_eq!(restored.workspace, entry.workspace);

        assert_eq!(restore(&registry), 0, "重复恢复不产生重复条目");
        assert_eq!(registry.snapshot().len(), 1);
    }

    #[test]
    fn restore_on_an_empty_store_is_a_no_op() {
        let store = Arc::new(SqliteSessionStore::open_in_memory().expect("in-memory store"));
        let registry = Registry::new(store);
        assert_eq!(restore(&registry), 0);
        assert!(registry.snapshot().is_empty());
    }

    /// Block 级回归护栏：`restore()` 是纯回填，**绝不**触发附属资源的生命周期事件。
    /// 曾把 `prune_orphans(terminal_history_dir())` 塞进这里，跑单测直接删光真实用户
    /// `~/.neeko/terminal_history/` 下的日志。用计数 spy 结构性钉住「零副作用」。
    #[test]
    fn restore_never_touches_session_history_side_effects() {
        struct CountingHistory(std::sync::atomic::AtomicUsize);
        impl crate::common::terminal::history::SessionHistory for CountingHistory {
            fn on_adopt(&self, _: &str, _: &str) {
                self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            fn on_unregister(&self, _: &str) {
                self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
        }

        let store = Arc::new(SqliteSessionStore::open_in_memory().expect("in-memory store"));
        let spy = Arc::new(CountingHistory(std::sync::atomic::AtomicUsize::new(0)));
        let registry = Registry::new(store)
            .with_history(Arc::clone(&spy) as crate::common::terminal::history::SharedHistory);
        assert_eq!(restore(&registry), 0);
        assert_eq!(
            spy.0.load(std::sync::atomic::Ordering::SeqCst),
            0,
            "restore 不得触发任何附属资源副作用；GC 归组合根"
        );
    }

    /// 同一条原生会话被 `--resume` 多次会留下多行 cursor：恢复时收敛成一行，
    /// 并把多余的持久化行删掉（否则每次启动都还是一串同名行）。
    #[test]
    fn restore_collapses_duplicate_rows_for_one_native_session() {
        let store = Arc::new(SqliteSessionStore::open_in_memory().expect("in-memory store"));
        for (id, activity) in [
            ("old", "2026-11-08T10:00:00Z"),
            ("new", "2026-11-10T02:14:38Z"),
        ] {
            let mut entry = listed_terminal();
            entry.session_id = id.into();
            entry.native_session_id = Some("native-1".into());
            let cursor = ResumeCursor {
                last_activity: activity.into(),
                ..ResumeCursor::from_entry(&entry).expect("listed entry")
            };
            store.save_cursor(&cursor).expect("seed cursor");
        }
        assert_eq!(store.list_restorable().len(), 2);

        let registry = Registry::new(store.clone());
        assert_eq!(restore(&registry), 1, "只回填一行");
        let restored = registry.snapshot();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].session_id, "new", "留 activity 最新的那条");
        assert_eq!(
            store.list_restorable().len(),
            1,
            "多余的持久化行必须被删掉，否则下次启动又出现"
        );
        assert_eq!(restore(&registry), 0, "重复恢复不产生重复条目");
    }
}
