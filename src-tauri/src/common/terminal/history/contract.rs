//! 会话生命周期事件的抽象（依赖倒置）。
//!
//! `live_sessions::Registry` 是「会话身份」的唯一事实，但它**不该知道**终端历史日志
//! 存在、存在哪个目录、怎么删。这里定义它唯一需要的通知端口，实现由组合根注入
//! （`app_state.rs` 把 [`crate::common::terminal::history::HistoryStore`] 接进来）。
//!
//! 默认实现是空操作：测试里的 `Registry::new` 不注入 → 零文件系统副作用。

use std::sync::Arc;

/// 会话生命周期事件。所有方法必须 best-effort：日志是缓存，绝不能阻断状态转移。
pub trait SessionHistory: Send + Sync {
    /// 新 PTY 接管旧会话身份成功，旧资源可以回收。
    fn on_adopt(&self, from_session_id: &str, into_session_id: &str);
    /// 会话注销（用户删除 / 进程自然结束），回收附属资源。
    fn on_unregister(&self, session_id: &str);
}

/// 空实现：未接线时的安全默认，让 `Registry` 不必到处判 `Option`。
pub struct NoopHistory;

impl SessionHistory for NoopHistory {
    fn on_adopt(&self, _from_session_id: &str, _into_session_id: &str) {}
    fn on_unregister(&self, _session_id: &str) {}
}

/// 组合根注入点。用 `Arc` 是为了让 `Registry` 与 router 共享同一份所有者。
pub type SharedHistory = Arc<dyn SessionHistory>;
