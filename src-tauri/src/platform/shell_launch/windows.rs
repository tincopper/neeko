//! Windows Shell 任务命令构建。

use portable_pty::CommandBuilder;

/// 构建 Windows 任务命令:`cmd /c <command>`。
#[must_use]
pub fn build_task_command(task_command: &str) -> CommandBuilder {
    let mut c = CommandBuilder::new("cmd");
    c.args(["/c", task_command]);
    c
}

/// Windows 无需 locale 环境变量。
pub const fn apply_locale_env(_cmd: &mut CommandBuilder) {}

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
}
