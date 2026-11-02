//! 应用生命周期命令（与前端 `settingsApi.ts` 的 `invoke` 名一一对应）。
//!
//! 命令层保持极薄（红线 6）：只做参数接收 + 转调，规则在 `app::close` /
//! `app::session_lifecycle` / 各域服务里。
//!
//! 会话生命周期**不在本文件**：它跨终端与 chat 两个生产者，属编排（见
//! `app::session_lifecycle`）。本文件只放「进程自身」的生命周期（退出窗口）。

use crate::common::error::AppError;

/// 用户确认退出：销毁主窗口。
///
/// 使用 `destroy` 而非 `close`：destroy 跳过 `CloseRequested`（避免与
/// 确认弹框循环），直接触发 `Destroyed` → `shutdown_background_and_exit`
/// （见 [`super::close`] 的三级关闭路径）。
#[tauri::command]
pub fn confirm_app_exit(window: tauri::Window) -> Result<(), AppError> {
    window
        .destroy()
        .map_err(|e| AppError::Unknown(format!("Failed to destroy window: {e}")))
}
