//! DAP → frontend 事件名的单一事实源。
//!
//! 前端镜像：`src/shared/events.ts`（`DAP_EVENT` / `DAP_SESSION_STATUS_EVENT`）。
//! 禁止在业务代码中硬编码事件字符串（AGENTS.md 规则 #5 / #12）。

/// 调试会话状态变更事件：`dap-session-status`
pub const DAP_SESSION_STATUS_EVENT: &str = "dap-session-status";

/// 调试事件载荷（断点命中 / 输出 / terminated 等）：`dap-event`
pub const DAP_EVENT: &str = "dap-event";

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
