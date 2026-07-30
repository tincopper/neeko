//! Best-effort ISO-8601-ish local timestamp without pulling chrono.
pub(crate) fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Keep it simple and stable for the Console view.
    format!("{secs}")
}

/// Sample process RSS in megabytes (local host only; remote pids may miss).
pub(crate) fn sample_process_memory_mb(pid: u32) -> Option<f64> {
    #[cfg(target_os = "macos")]
    {
        // `ps -o rss=` reports kilobytes on macOS.
        let output = std::process::Command::new("ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        let kb: f64 = text.trim().parse().ok()?;
        Some(kb / 1024.0)
    }
    #[cfg(target_os = "linux")]
    {
        let status = std::fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
        for line in status.lines() {
            if let Some(rest) = line.strip_prefix("VmRSS:") {
                let kb: f64 = rest
                    .split_whitespace()
                    .next()
                    .and_then(|s| s.parse().ok())?;
                return Some(kb / 1024.0);
            }
        }
        None
    }
    #[cfg(target_os = "windows")]
    {
        // tasklist does not give RSS easily without PowerShell; skip for v1.
        let _ = pid;
        None
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = pid;
        None
    }
}
