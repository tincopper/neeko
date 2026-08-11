/// macOS：`ps -o rss=` 报告 KB，转为 MB。
#[must_use]
pub fn sample_process_memory_mb(pid: u32) -> Option<f64> {
    let output = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let kb: f64 = text.trim().parse().ok()?;
    Some(kb / 1024.0)
}
