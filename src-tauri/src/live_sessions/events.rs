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

/// 通知前端「注册表版本变了」。
///
/// 发射失败只 warn：事件是提示通道，正确性以 `list_live_sessions` 的版本比较为准。
pub fn emit_changed(app: &tauri::AppHandle, version: u64) {
    if let Err(e) = app.emit(SESSIONS_EVENT, SessionVersionPayload { version }) {
        log::warn!("[live_sessions] failed to emit {SESSIONS_EVENT}: {e}");
    }
}
