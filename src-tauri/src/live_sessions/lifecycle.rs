//! 会话生命周期转移：**关 tab / 注销 / 退出**的注册表侧入口。
//!
//! # 为什么这一层存在
//!
//! 「转移 + 只有真变了才通知」的判据属注册表域，**不属于任何生产者**。它原先长在
//! `wiring::pty`（终端是第一个调用方），于是 chat 侧、组合根侧想复用只能
//! `use ...::wiring::pty::unregister_and_notify` —— 一个 chat 命令依赖终端模块，
//! 而 `pty` 里的实现又不能被替换（它顺带管 PTY 的 watcher 语义）。第一条例外出现时，
//! 「通知只此一份」就只剩注释。
//!
//! 这里只做三件**转移**，一行进程控制都没有：
//!
//! | 入口 | 转移 | 侧栏 |
//! | --- | --- | --- |
//! | [`close_and_notify`] | `apply(Stopped)`，**保留**条目 | 行留着（「点回来」的入口） |
//! | [`unregister_and_notify`] | `unregister`（摘条目 + 关游标） | 行消失 |
//!
//! 进程怎么结束不在这里 —— 那是各生产者自己的知识（终端路由 / chat 管理器），
//! 组合根按归属把它们接起来（见 `app::session_lifecycle`）。
//!
//! # 与 [`super::wiring::pty::exit_and_notify`] 的分工
//!
//! 进程**自己**退出时先落终止态再注销（两条转移、一条语义），且要认「主动关闭的尾巴」，
//! 因此它留在 PTY 的退出路径里。本模块只管「外部要求它停」的两条转移。

use tauri::AppHandle;

use crate::live_sessions::notify_if_changed;
use crate::live_sessions::registry::Registry;
use crate::live_sessions::state::Signal;

/// 关闭 tab：把会话标成 `Stopped` 并**保留**条目（唯一「关 tab」入口）。
///
/// 与 `wiring::pty::exit_and_notify` 的唯一差别就是**留不留**：
///
/// - 进程自己退出（用户敲 `exit` / agent 崩了）⇒ 会话结束了，条目跟着消失；
/// - 用户关掉 tab ⇒ 只是收起视图。那条会话仍是「可以点回来」的入口 —— 侧栏不该因为
///   关 tab 就少一行（点击时按会话重建，能续写就续写，见 `useActivateSession`）。
///
/// 不注销的副作用是条目会留到本次运行结束（注册表是内存态）。这是刻意的：它是「恢复点」，
/// 不是垃圾。`wiring::pty::on_exit` 认得这个标记，不会再补一次注销。
pub fn close_and_notify(registry: &Registry, app: Option<&AppHandle>, session_id: &str) -> bool {
    let changed = registry.apply(session_id, Signal::Stopped);
    notify_if_changed(app, registry.version(), changed)
}

/// 销毁会话（删单元 / 清 tab 空间 / 用户删除）：注销 + 通知。
///
/// 只是 [`Registry::unregister`] 的通知收尾 —— 转移本身属注册表，本模块不复制它。
///
/// `app` 为 `None` 的调用方（退出清理 / 测试）只做注销不发事件 —— 那时没有前端在听。
pub fn unregister_and_notify(
    registry: &Registry,
    app: Option<&AppHandle>,
    session_id: &str,
) -> bool {
    let removed = registry.unregister(session_id);
    notify_if_changed(app, registry.version(), removed)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::agent::chat::session_store::SqliteSessionStore;
    use crate::common::git::WorkspaceSession;
    use crate::live_sessions::{SessionEntry, SessionKind, SessionState};

    fn fresh_registry() -> Registry {
        Registry::new(Arc::new(
            SqliteSessionStore::open_in_memory().expect("in-memory session store"),
        ))
    }

    fn register(registry: &Registry, session_id: &str) {
        registry.register(
            SessionEntry::new(
                session_id,
                SessionKind::Terminal,
                None,
                WorkspaceSession::of("p1", None),
                "/proj",
            )
            .with_state(SessionState::Running),
        );
    }

    /// 关 tab **不摘条目**：只标 `Stopped`，侧栏那一行留着当「点回来」的入口。
    #[test]
    fn closing_a_tab_keeps_the_session_as_stopped() {
        let registry = fresh_registry();
        register(&registry, "t1");
        let before = registry.version();

        assert!(close_and_notify(&registry, None, "t1"));
        let entry = registry.entry("t1").expect("关 tab 后条目仍在");
        assert_eq!(entry.state, SessionState::Stopped);
        assert!(registry.version() > before, "状态变了要通知一次");

        // 幂等：再关一次什么都不变（不重复 bump）。
        let after = registry.version();
        assert!(!close_and_notify(&registry, None, "t1"));
        assert_eq!(registry.version(), after);
    }

    /// 删除 = 摘条目（与关 tab 的唯一差别就是**留不留**）；幂等，重复删除不再 bump。
    #[test]
    fn deleting_removes_the_entry_and_is_idempotent() {
        let registry = fresh_registry();
        register(&registry, "t1");
        let before = registry.version();

        assert!(unregister_and_notify(&registry, None, "t1"));
        assert!(registry.entry("t1").is_none(), "删除后行必须消失");
        assert!(registry.version() > before);

        let after = registry.version();
        assert!(
            !unregister_and_notify(&registry, None, "t1"),
            "重复删除是 no-op"
        );
        assert_eq!(registry.version(), after, "no-op 不得 bump 版本");
    }

    /// 未知会话：两个入口都返回 `false`，不得凭空建条目、不得 bump。
    #[test]
    fn unknown_session_is_a_no_op() {
        let registry = fresh_registry();
        assert!(!unregister_and_notify(&registry, None, "ghost"));
        assert!(!close_and_notify(&registry, None, "ghost"));
        assert!(registry.snapshot().is_empty());
        assert_eq!(registry.version(), 0);
    }
}
