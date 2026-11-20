//! 团队事件投递的**生产实现**（`TeamNotifier` 的唯一 impl）。
//!
//! # 为什么在组合根（`app/`）而不是团队域
//!
//! 它只做一件事：把域给的 `rev` 变成一次 `AppHandle::emit`。把这一行放进 `agent/team/`
//! 就等于让整个域认识 `tauri` —— 而团队域被单测驱动的前提正是它**不认识** `AppHandle`
//! （同 [`super::team_executor`] 的那条判据：组合根是唯一同时认识两端的地方）。
//!
//! # 事件语义（读这里之前先读 `agent/team/events.rs`）
//!
//! 载荷是**失效脉冲** `TeamPulse { rev }`，不是增量：前端收到它只做「要不要重取快照」的
//! 判断，不解释内容。所以这里没有「补播」「重试」「排序」逻辑 —— 这些都建立在「快照是唯一
//! 真相」之上：丢一次事件不会让任何人错下去，只是晚一个触发点。
//!
//! # `emit` 失败只记日志
//!
//! webview 关闭 / 正在重载时 `emit` 会返回 `Err`。那**不是**团队域的写失败：把错误上抛会
//! 让一次正常的写操作因为「没有前端在听」而失败（并且 `TeamNotifier::pulse` 的契约明确
//! 要求实现方不上抛）。同 [`crate::dap::events::TauriEventSink`] 的取舍。

use tauri::{AppHandle, Emitter};

use crate::agent::team::events::{TeamNotifier, TeamPulse, TEAM_EVENT};

/// 生产事件端口：只持 `AppHandle`。
pub struct TauriTeamNotifier {
    app: AppHandle,
}

impl TauriTeamNotifier {
    /// 由组合根构造（只有它才有 `AppHandle`）。
    #[must_use]
    pub const fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl TeamNotifier for TauriTeamNotifier {
    fn pulse(&self, rev: u64) {
        // `emit` 是同步的（Tauri 内部入队），而本函数在**写路径的锁守卫 `Drop`** 里被调用 ——
        // 那一刻 `inner` 锁已释放、`notifier` 读锁也已释放（见 `WriteGuard::drop`），
        // 所以这里就算阻塞也不会把写路径钉死。
        if let Err(err) = self.app.emit(TEAM_EVENT, TeamPulse { rev }) {
            log::warn!("[agent-team] emit {TEAM_EVENT} failed: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 端口实现必须是 `Send + Sync`：组合根把它装进 `Arc<dyn TeamNotifier>` 挂在
    /// `TeamManager` 上，从任意线程的写路径都会被调用。
    ///
    /// 这是一条**编译期**判据（`AppHandle` 不满足时这里就编译失败），也是本文件唯一能不走
    /// Tauri 运行时就能验证的东西 —— `emit` 本身需要真实 `AppHandle`，而它只是转发。
    /// 事件名与载荷形状的断言在 `agent/team/events.rs`（域侧，单一源）。
    #[test]
    fn the_notifier_is_shareable_across_threads() {
        fn assert_shareable<T: TeamNotifier + 'static>() {}
        assert_shareable::<TauriTeamNotifier>();
    }
}
