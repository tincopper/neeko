//! shell_cmd：远程 shell 命令构建测试。

use super::super::shell_cmd::{
    build_exists_check_command, build_mkdir_command, build_mv_command, build_rm_command,
    remote_shell_name,
};
use crate::common::connection::types::AuthMethod;
use crate::common::executor::factory::ExecTarget;
use crate::common::utils::command::local::safe_path;

#[test]
fn remote_shell_selects_bash_for_wsl_and_sh_for_remote() {
    let wsl = ExecTarget::Wsl {
        distro: "Ubuntu-22.04".to_string(),
    };
    let remote = ExecTarget::Remote {
        host: "example.com".to_string(),
        port: 22,
        username: "root".to_string(),
        auth: AuthMethod::Password("x".to_string()),
    };
    assert_eq!(remote_shell_name(&wsl), "bash");
    assert_eq!(remote_shell_name(&remote), "sh");
}

#[test]
fn build_commands_quote_escaped_paths() {
    // safe_path 会把单引号转义为 '\''，命令拼接后保持转义完整性
    let raw = "/home/user/it's dir/文件";
    let safe = safe_path(raw);
    assert_eq!(safe, "/home/user/it'\\''s dir/文件");

    let mkdir = build_mkdir_command(&safe);
    assert_eq!(mkdir, "mkdir -p '/home/user/it'\\''s dir/文件'");

    let exists = build_exists_check_command(&safe);
    assert_eq!(
        exists,
        "test -e '/home/user/it'\\''s dir/文件' && echo yes || echo no"
    );

    let rm = build_rm_command(&safe);
    assert_eq!(rm, "rm -rf '/home/user/it'\\''s dir/文件'");

    let mv = build_mv_command(&safe, "/target/新名");
    assert_eq!(mv, "mv '/home/user/it'\\''s dir/文件' '/target/新名'");
}

#[test]
fn build_exists_check_command_outputs_yes_no() {
    assert_eq!(
        build_exists_check_command("/plain/path"),
        "test -e '/plain/path' && echo yes || echo no"
    );
}
