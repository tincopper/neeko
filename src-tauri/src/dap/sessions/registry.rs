//! 会话注册表：DAP 会话的所有权、per-project 查找与清理。
//!
//! ## 两条硬约束（都由本模块保证，调用点不必再各自小心）
//!
//! 1. **会话与 debuggee 同生共死**：合并进 [`ManagedSession`] 单一表是刻意的 ——
//!    停止/替换只有 [`ManagedSession::shutdown`] 一条清理路径（原双 map 需 4 处手写
//!    同步，漏一处即 JVM 泄漏）。
//! 2. **绝不在持锁期间 await 会话方法**：注册表锁的临界区只有 HashMap 查表/插入/移除。
//!    需要 `session.info()` / `session.stop()` 的调用点一律先取 **Arc 快照**、放锁、
//!    再 await（原实现在 `active_for_project` / `list_sessions` 里持 manager 级锁跨
//!    await，把整张会话表串行化在 2N 次 await 上，并留下"`info()` 将来若需要注册表锁
//!    即死锁"的隐性契约）。

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use super::super::session::DapSession;
use crate::common::executor::ProcessGuard;

/// 会话条目：DAP 会话 + 其附属 debuggee（Java attach-first 的测试 JVM）。
///
/// go/lldb 会话的 `debuggee` 为 `None`。
pub(crate) struct ManagedSession {
    session: Arc<DapSession>,
    /// Java attach-first 的 debuggee；`None` 表示无附属进程。
    debuggee: Option<ProcessGuard>,
}

impl ManagedSession {
    /// 组装一个条目（会话与 debuggee 同一插入点落库，消除
    /// 「先插会话、后挂 debuggee」之间的并发停止泄漏窗口）。
    #[must_use]
    pub(crate) const fn new(session: Arc<DapSession>, debuggee: Option<ProcessGuard>) -> Self {
        Self { session, debuggee }
    }

    /// 先停 DAP 会话，再终止 debuggee —— attach 模式的 disconnect 只 detach、
    /// 不杀 debuggee，必须由 Neeko 兜底。
    pub(crate) async fn shutdown(self) {
        self.session.stop().await;
        if let Some(debuggee) = self.debuggee {
            debuggee.terminate().await;
        }
    }
}

/// 会话注册表（`session_id → ManagedSession`）。
#[derive(Default)]
pub(crate) struct SessionRegistry {
    sessions: Mutex<HashMap<String, ManagedSession>>,
}

impl SessionRegistry {
    /// Create an empty registry.
    #[must_use]
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// 登记一个会话（与它的 debuggee 一起）。
    pub(crate) async fn insert(&self, session: Arc<DapSession>, debuggee: Option<ProcessGuard>) {
        self.sessions.lock().await.insert(
            session.session_id.clone(),
            ManagedSession::new(session, debuggee),
        );
    }

    /// 取出并移除一个会话（停止路径：调用方在放锁后 `shutdown`）。
    pub(crate) async fn take(&self, session_id: &str) -> Option<ManagedSession> {
        self.sessions.lock().await.remove(session_id)
    }

    /// 取出并移除某项目的**全部**会话。
    ///
    /// 两趟遍历（先收 id 再 remove）是 stable `HashMap` 的硬约束：`retain` 只给
    /// `&mut V`，无法把条目移出去；`extract_if` 尚未稳定。会话数量是个位数，
    /// 两趟 O(n) 无实际代价。
    pub(crate) async fn take_project(&self, project_id: &str) -> Vec<ManagedSession> {
        let mut sessions = self.sessions.lock().await;
        let ids: Vec<String> = sessions
            .iter()
            .filter(|(_, m)| m.session.project_id == project_id)
            .map(|(id, _)| id.clone())
            .collect();
        ids.into_iter()
            .filter_map(|id| sessions.remove(&id))
            .collect()
    }

    /// 按 id 取会话句柄（**只拿 Arc，不 await 会话方法**）。
    pub(crate) async fn get(&self, session_id: &str) -> Option<Arc<DapSession>> {
        self.sessions
            .lock()
            .await
            .get(session_id)
            .map(|m| Arc::clone(&m.session))
    }

    /// 项目的活动会话句柄（mute 即时下发等场景）。
    pub(crate) async fn first_for_project(&self, project_id: &str) -> Option<Arc<DapSession>> {
        let sessions = self.sessions.lock().await;
        sessions
            .values()
            .find(|m| m.session.project_id == project_id)
            .map(|m| Arc::clone(&m.session))
    }

    /// 全部会话句柄快照（调用方放锁后再 `await info()` 等会话方法）。
    pub(crate) async fn snapshot(&self) -> Vec<Arc<DapSession>> {
        self.sessions
            .lock()
            .await
            .values()
            .map(|m| Arc::clone(&m.session))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dap::testing::{go_launch_config, FakeAdapter, RecordingSink};

    /// 起一个真实会话（对着假适配器完成握手）——注册表测试只关心所有权语义，
    /// 但用真会话才能保证 `shutdown` 走的是真实 disconnect 路径。
    async fn session(adapter: &FakeAdapter, project_id: &str) -> Arc<DapSession> {
        DapSession::connect(
            adapter.addr(),
            RecordingSink::new(),
            project_id.to_string(),
            "/proj".to_string(),
            go_launch_config("Go"),
            Vec::new(),
        )
        .await
        .expect("connect")
    }

    #[tokio::test]
    async fn insert_then_get_and_first_for_project() {
        let registry = SessionRegistry::new();
        let adapter = FakeAdapter::start().await;
        let s = session(&adapter, "p1").await;
        let id = s.session_id.clone();
        registry.insert(Arc::clone(&s), None).await;

        assert!(registry.get(&id).await.is_some());
        assert!(registry.get("missing").await.is_none());
        assert_eq!(
            registry
                .first_for_project("p1")
                .await
                .expect("project session")
                .session_id,
            id
        );
        assert!(registry.first_for_project("p2").await.is_none());
        assert_eq!(registry.snapshot().await.len(), 1);
    }

    /// `take` 移出后 `get` 必须为空（重复停止 → `NotFound` 的前提），
    /// 且 `shutdown` 真的走了适配器 disconnect。
    #[tokio::test]
    async fn take_removes_entry_and_shutdown_disconnects() {
        let registry = SessionRegistry::new();
        let adapter = FakeAdapter::start().await;
        let s = session(&adapter, "p1").await;
        let id = s.session_id.clone();
        registry.insert(s, None).await;

        let entry = registry.take(&id).await.expect("taken");
        assert!(registry.get(&id).await.is_none());
        assert!(registry.take(&id).await.is_none());

        entry.shutdown().await;
        assert!(
            adapter.seen_commands().iter().any(|c| c == "disconnect"),
            "清理路径必须 disconnect: {:?}",
            adapter.seen_commands()
        );
    }

    /// `take_project` 只动目标项目，且一次取走该项目全部会话。
    #[tokio::test]
    async fn take_project_removes_only_that_project() {
        let registry = SessionRegistry::new();
        let a1 = FakeAdapter::start().await;
        let a2 = FakeAdapter::start().await;
        let b1 = FakeAdapter::start().await;
        let p1a = session(&a1, "p1").await;
        let p1b = session(&a2, "p1").await;
        let p2 = session(&b1, "p2").await;
        let (id1a, id1b, id2) = (
            p1a.session_id.clone(),
            p1b.session_id.clone(),
            p2.session_id.clone(),
        );
        registry.insert(p1a, None).await;
        registry.insert(p1b, None).await;
        registry.insert(p2, None).await;

        let taken = registry.take_project("p1").await;
        assert_eq!(taken.len(), 2, "同一项目多条会话必须一次取走");
        assert!(registry.get(&id1a).await.is_none());
        assert!(registry.get(&id1b).await.is_none());
        assert!(
            registry.get(&id2).await.is_some(),
            "其他项目的会话不得被误删"
        );

        for entry in taken {
            entry.shutdown().await;
        }
        assert_eq!(registry.snapshot().await.len(), 1);
        assert!(registry.take_project("nope").await.is_empty());
    }
}
