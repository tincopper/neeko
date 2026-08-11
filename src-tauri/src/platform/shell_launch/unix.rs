//! Unix Shell 任务命令构建。

use portable_pty::CommandBuilder;

/// 构建 Unix 任务命令:`sh -c <command>`。
#[must_use]
pub fn build_task_command(task_command: &str) -> CommandBuilder {
    let mut c = CommandBuilder::new("sh");
    c.args(["-c", task_command]);
    c
}

/// 应用 Unix locale 环境变量。
pub fn apply_locale_env(cmd: &mut CommandBuilder) {
    cmd.env("LANG", "en_US.UTF-8");
    cmd.env("LC_ALL", "en_US.UTF-8");
    cmd.env("LC_CTYPE", "en_US.UTF-8");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_task_command_uses_sh_dash_c() {
        let cmd = build_task_command("echo hi");
        let argv = cmd.get_argv();
        assert_eq!(argv[0].to_string_lossy(), "sh");
        assert_eq!(argv[1].to_string_lossy(), "-c");
        assert_eq!(argv[2].to_string_lossy(), "echo hi");
    }

    #[test]
    fn apply_locale_env_sets_utf8_locale() {
        let mut cmd = CommandBuilder::new("sh");
        apply_locale_env(&mut cmd);
        assert_eq!(
            cmd.get_env("LANG"),
            Some(std::ffi::OsStr::new("en_US.UTF-8"))
        );
        assert_eq!(
            cmd.get_env("LC_ALL"),
            Some(std::ffi::OsStr::new("en_US.UTF-8"))
        );
        assert_eq!(
            cmd.get_env("LC_CTYPE"),
            Some(std::ffi::OsStr::new("en_US.UTF-8"))
        );
    }
}
