//! live-sessions 变更事件（红线 5：事件名只允许来自单一常量源）。
//!
//! **不推全量快照**：状态变只 emit 一个版本号，前端凭它拉一次快照。
//! 原因与终端 drain 同源 —— macOS WebKit 上每次事件送达 = 一次 `evaluateJavaScript`
//! 且无条件克隆完成值，高频推送只会让 RSS 只增不减。

use serde::Serialize;
use tauri::Emitter;

/// 注册表版本变更事件名。
///
/// 前端必须从 `src/shared/events.ts` 的同名常量引用（跨栈一致性用例守护两端同值）。
pub const SESSIONS_EVENT: &str = "live-sessions://changed";

/// 事件载荷：只有版本号（前端 `version > localVersion` 才拉快照）。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionVersionPayload {
    version: u64,
}

/// 通知前端「注册表版本变了」——**生命周期转移的唯一收尾入口**。
///
/// 三条转移（关 tab / 进程退出 / 注销）都以「注册表说变了才发」为判据，判据本身留在
/// `Registry` 的方法里；本函数只负责「变了就通知」这一件事。
///
/// `app` 为 `None` 的调用方（退出清理 / 测试）只做转移不发事件 —— 那时没有前端在听。
///
/// 为什么在这里而不是各调用点：分散写 `if changed { emit_changed(..) }` 的话，第 N 个
/// 生产者忘写通知的表现是「侧栏不刷新、无报错、无日志」，属于最难定位的一类。
#[must_use]
pub fn notify_if_changed(app: Option<&tauri::AppHandle>, version: u64, changed: bool) -> bool {
    if let (true, Some(app)) = (changed, app) {
        emit_changed(app, version);
    }
    changed
}

/// 通知前端「注册表版本变了」。
///
/// 发射失败只 warn：事件是提示通道，正确性以 `list_live_sessions` 的版本比较为准。
pub fn emit_changed(app: &tauri::AppHandle, version: u64) {
    if let Err(e) = app.emit(SESSIONS_EVENT, SessionVersionPayload { version }) {
        log::warn!("[live_sessions] failed to emit {SESSIONS_EVENT}: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 无宿主（退出清理 / 测试）时转移照做、通知不发：返回的是转移结果本身，不是「发了几次」。
    #[test]
    fn no_host_means_transfer_without_notification() {
        assert!(notify_if_changed(None, 7, true));
        assert!(!notify_if_changed(None, 7, false));
    }
}
