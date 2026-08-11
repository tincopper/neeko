use std::path::Path;
use std::process::Command;

/// 在 Linux 上构建 reveal 命令：目录用 `xdg-open`，文件 reveal 其父目录。
#[must_use]
pub fn build_reveal_command(path: &Path) -> Option<Command> {
    let path_str = path.to_str()?;
    let normalized = normalize_path(path_str);

    if path.is_dir() {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(&normalized);
        Some(cmd)
    } else {
        path.parent().map(|parent| {
            let mut cmd = Command::new("xdg-open");
            cmd.arg(parent);
            cmd
        })
    }
}

/// Linux 路径分隔符即正斜杠，无需转换。
#[must_use]
pub fn normalize_path(path: &str) -> String {
    path.to_string()
}
