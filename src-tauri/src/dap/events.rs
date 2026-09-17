//! DAP → frontend 事件出口：事件名常量 + 投递端口 + Tauri 实现。
//!
//! 前端镜像：`src/shared/events.ts`（`DAP_EVENT` / `DAP_SESSION_STATUS_EVENT`）。
//! 禁止在业务代码中硬编码事件字符串（AGENTS.md 规则 #5 / #12）。
//!
//! **本模块是 DAP 域内唯一允许引用 `tauri` 的模块**（neeko-check Pillar 2：业务层
//! 不得强耦合 `AppHandle`）。`session` / `manager` 只依赖 [`DapEventSink`] 端口，
//! 因此可以在 `#[cfg(test)]` 里注入记录器（见 `dap/testing.rs`）验证事件语义，
//! 而不需要常驻 Tauri 运行时。

use tauri::{AppHandle, Emitter};

use super::types::{DapEventPayload, DapSessionInfo};

/// 调试会话状态变更事件：`dap-session-status`
pub const DAP_SESSION_STATUS_EVENT: &str = "dap-session-status";

/// 调试事件载荷（断点命中 / 输出 / terminated 等）：`dap-event`
pub const DAP_EVENT: &str = "dap-event";

/// DAP 事件投递端口（依赖倒置：domain 定义端口，Tauri 实现留在本模块）。
///
/// 两个方法而非一个泛型方法：泛型会破坏 object safety，而 manager 需要
/// `Arc<dyn DapEventSink>` 持有。类型化入参也让"哪个载荷配哪个事件名"由编译器
/// 约束，不会在调用点配错。
pub trait DapEventSink: Send + Sync {
    /// 投递一个调试事件（断点命中 / 输出 / terminated …）—— 走 `DAP_EVENT`。
    fn debug_event(&self, payload: DapEventPayload);

    /// 投递会话状态快照 —— 走 `DAP_SESSION_STATUS_EVENT`。
    fn session_status(&self, info: DapSessionInfo);
}

/// 生产实现：把事件投到 Tauri 前端（`AppHandle::emit`）。
///
/// `emit` 本身同步；失败只记日志，不向调用方上抛 —— 事件是**尽力而为**的通知，
/// 不该因为前端窗口已关闭而中断会话生命周期。
pub struct TauriEventSink {
    app: AppHandle,
}

impl TauriEventSink {
    /// Wrap an `AppHandle` as a DAP event sink.
    #[must_use]
    pub const fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl DapEventSink for TauriEventSink {
    fn debug_event(&self, payload: DapEventPayload) {
        if let Err(e) = self.app.emit(DAP_EVENT, &payload) {
            log::warn!("[DAP] emit failed: {e}");
        }
    }

    fn session_status(&self, info: DapSessionInfo) {
        if let Err(e) = self.app.emit(DAP_SESSION_STATUS_EVENT, info) {
            log::warn!("[DAP] emit status failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 与前端 `src/shared/events.ts` 镜像的线上格式（漂移 = 前端静默失联）。
    #[test]
    fn event_names_match_frontend_mirror() {
        assert_eq!(DAP_EVENT, "dap-event");
        assert_eq!(DAP_SESSION_STATUS_EVENT, "dap-session-status");
    }
}
