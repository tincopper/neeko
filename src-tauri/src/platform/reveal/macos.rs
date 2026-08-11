use std::path::Path;
use std::process::Command;

/// 在 macOS 上构建 reveal 命令：目录用 `open`，文件用 `open -R`。
#[must_use]
pub fn build_reveal_command(path: &Path) -> Option<Command> {
    let path_str = path.to_str()?;
    let normalized = normalize_path(path_str);

    if path.is_dir() {
        let mut cmd = Command::new("open");
        cmd.arg(&normalized);
        Some(cmd)
    } else {
        let mut cmd = Command::new("open");
        cmd.arg("-R").arg(&normalized);
        Some(cmd)
    }
}

/// macOS 路径分隔符即正斜杠，无需转换。
#[must_use]
pub fn normalize_path(path: &str) -> String {
    path.to_string()
}
