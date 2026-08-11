//! Timestamp and process memory sampling utilities.

/// ISO-8601 local timestamp for the Console view.
pub(crate) fn iso_timestamp_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

/// Sample process RSS in megabytes (local host only; remote pids may miss).
/// 平台差异已集中到 `crate::platform::process_memory`。
pub(crate) fn sample_process_memory_mb(pid: u32) -> Option<f64> {
    crate::platform::process_memory::sample_process_memory_mb(pid)
}
