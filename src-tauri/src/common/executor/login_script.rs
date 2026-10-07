//! WSL / SSH 登录脚本渲染 —— 两个 executor 共用的**单一实现**。
//!
//! 登录 shell 的职责固定为三段：`export <env>; cd <dir> && <body>`。argv 形态的
//! `<body>` 是 `exec <cmd> <args>`；script 形态的 `<body>` 就是调用方给的脚本本身。
//! 把前缀渲染抽到这里，避免 WSL 与 SSH 两份复制各自漂移（历史上正是这种复制让
//! 「换环境要重写一遍」的代码散落）。

use crate::common::utils::command::local::{join_quoted_command, quote_shell_arg};

/// 渲染 `export K=V; …; cd <dir> && ` 前缀（无 env / cwd 时为空串）。
pub(crate) fn render_env_and_cd(env: &[(&str, &str)], current_dir: Option<&str>) -> String {
    let mut out = String::new();
    for (key, value) in env {
        out.push_str("export ");
        out.push_str(key);
        out.push('=');
        out.push_str(&quote_shell_arg(value));
        out.push_str("; ");
    }
    if let Some(dir) = current_dir {
        out.push_str("cd ");
        out.push_str(&quote_shell_arg(dir));
        out.push_str(" && ");
    }
    out
}

/// argv 形态的登录脚本体：`export …; cd …; exec <cmd> <args>`。
pub(crate) fn render_argv_script(
    env: &[(&str, &str)],
    current_dir: Option<&str>,
    cmd: &str,
    args: &[&str],
) -> String {
    let mut script = render_env_and_cd(env, current_dir);
    script.push_str("exec ");
    script.push_str(&join_quoted_command(cmd, args));
    script
}

/// script 形态的登录脚本体：`export …; cd …; <script>`（脚本即执行体，无额外 shell）。
pub(crate) fn render_script(
    env: &[(&str, &str)],
    current_dir: Option<&str>,
    script: &str,
) -> String {
    let mut out = render_env_and_cd(env, current_dir);
    out.push_str(script);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argv_script_prefixes_env_and_cd_then_execs() {
        let script = render_argv_script(
            &[("FOO", "a b")],
            Some("/work dir"),
            "git",
            &["status", "--porcelain"],
        );
        assert_eq!(
            script,
            "export FOO='a b'; cd '/work dir' && exec 'git' 'status' '--porcelain'"
        );
    }

    #[test]
    fn script_wraps_body_verbatim_after_env_and_cd() {
        let script = render_script(&[("HOME", "/root")], Some("/repo"), "echo $HOME | cat");
        assert_eq!(
            script,
            "export HOME='/root'; cd '/repo' && echo $HOME | cat"
        );
    }

    #[test]
    fn no_env_or_cwd_yields_bare_body() {
        assert_eq!(render_script(&[], None, "printf hi"), "printf hi");
    }
}
