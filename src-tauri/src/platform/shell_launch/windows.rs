//! Windows Shell 任务命令构建。

use portable_pty::CommandBuilder;

/// Windows 无 POSIX `sh`（非目标平台 no-op stub，与 unix 实现同签名）。
#[must_use]
pub const fn posix_sh() -> Option<&'static str> {
    None
}

/// 构建 Windows 任务命令:`cmd /c <command>`。
#[must_use]
pub fn build_task_command(task_command: &str) -> CommandBuilder {
    let mut c = CommandBuilder::new("cmd");
    c.args(["/c", task_command]);
    c
}

/// Windows 无需 locale 环境变量。
pub const fn apply_locale_env(_cmd: &mut CommandBuilder) {}

/// 命令执行（非 PTY）的 shell 选择：Windows `cmd /C <script>`。
///
/// 与 [`build_task_command`] 同主题、同平台判据，区别只是不构造 portable-pty 的
/// `CommandBuilder`。调用方一律经 `core::exec::collect_script` 使用它，业务层零 `#[cfg]`。
#[must_use]
pub const fn shell_argv(script: &str) -> (&'static str, [&str; 2]) {
    ("cmd", ["/C", script])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_task_command_uses_cmd_slash_c() {
        let cmd = build_task_command("echo hi");
        let argv = cmd.get_argv();
        assert_eq!(argv[0].to_string_lossy(), "cmd");
        assert_eq!(argv[1].to_string_lossy(), "/c");
        assert_eq!(argv[2].to_string_lossy(), "echo hi");
    }

    #[test]
    fn apply_locale_env_is_noop_on_windows() {
        let mut cmd = CommandBuilder::new("cmd");
        apply_locale_env(&mut cmd);
        assert!(cmd.get_env("LANG").is_none());
    }

    #[test]
    fn shell_argv_uses_cmd_slash_c() {
        assert_eq!(shell_argv("echo hi"), ("cmd", ["/C", "echo hi"]));
    }
}
