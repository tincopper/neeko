use std::path::Path;
use std::process::Command;

/// 在 Windows 上构建 reveal 命令：目录用 `explorer`，文件用 `explorer /select,`。
#[must_use]
pub fn build_reveal_command(path: &Path) -> Option<Command> {
    let path_str = path.to_str()?;
    let normalized = normalize_path(path_str);

    if path.is_dir() {
        let mut cmd = Command::new("explorer");
        cmd.arg(&normalized);
        Some(cmd)
    } else {
        let mut cmd = Command::new("explorer");
        cmd.arg(format!("/select,{}", normalized));
        Some(cmd)
    }
}

/// Windows 路径分隔符统一为反斜杠。
#[must_use]
pub fn normalize_path(path: &str) -> String {
    path.replace('/', "\\")
}
