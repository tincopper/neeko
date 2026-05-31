/// 获取系统等宽字体列表（跨平台实现）
pub fn get_monospace_fonts() -> Vec<String> {
    let mut fonts = get_system_fonts();
    fonts.sort_by_key(|a| a.to_lowercase());
    fonts.dedup();
    fonts
}

#[cfg(target_os = "windows")]
fn get_system_fonts() -> Vec<String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            r#"[System.Reflection.Assembly]::LoadWithPartialName('System.Drawing') | Out-Null;
(New-Object System.Drawing.Text.InstalledFontCollection).Families |
Where-Object { $_.IsStyleAvailable('Regular') } |
Select-Object -ExpandProperty Name"#,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        Err(e) => {
            log::warn!("Failed to get Windows fonts via PowerShell: {e}");
            vec![]
        }
    }
}

#[cfg(target_os = "macos")]
fn get_system_fonts() -> Vec<String> {
    use std::process::Command;
    use std::time::Duration;

    let child = Command::new("system_profiler")
        .args(["SPFontsDataType", "-json"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn();
    match child {
        Ok(mut child) => {
            let timeout = Duration::from_secs(10);
            let start = std::time::Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => {
                        if start.elapsed() > timeout {
                            let _ = child.kill();
                            let _ = child.wait();
                            return vec![];
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    Err(e) => {
                        log::warn!("Failed to check system_profiler process: {e}");
                        return vec![];
                    }
                }
            }
            let output = child.wait_with_output();
            match output {
                Ok(o) => {
                    let text = String::from_utf8_lossy(&o.stdout);
                    let mut fonts = Vec::new();
                    for line in text.lines() {
                        let line = line.trim();
                        if line.starts_with("\"full_name\"") {
                            if let Some(v) = line.split(':').nth(1) {
                                let name = v.trim().trim_matches('"').trim_matches(',').to_string();
                                if !name.is_empty() {
                                    fonts.push(name);
                                }
                            }
                        }
                    }
                    fonts
                }
                Err(e) => {
                    log::warn!("Failed to read system_profiler output: {e}");
                    vec![]
                }
            }
        }
        Err(e) => {
            log::warn!("Failed to spawn system_profiler: {e}");
            vec![]
        }
    }
}

#[cfg(target_os = "linux")]
fn get_system_fonts() -> Vec<String> {
    use std::process::Command;
    let output = Command::new("fc-list")
        .args(["--format=%{family[0]}\n"])
        .output();
    match output {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout);
            let mut fonts: Vec<String> = text
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect();
            fonts = fonts
                .into_iter()
                .map(|f| f.split(',').next().unwrap_or(&f).trim().to_string())
                .filter(|f| !f.is_empty())
                .collect();
            fonts
        }
        Err(e) => {
            log::warn!("Failed to get Linux fonts via fc-list: {e}");
            vec![]
        }
    }
}
