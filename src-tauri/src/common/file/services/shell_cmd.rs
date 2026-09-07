//! WSL/Remote shell 命令共享构建：shell 选择与参数引号转义的单一事实源。

use crate::common::executor::factory::ExecTarget;

/// 根据 ExecTarget 选择 POSIX shell（WSL 使用 bash，Remote 使用 sh）
pub(super) const fn remote_shell_name(target: &ExecTarget) -> &'static str {
    if matches!(target, ExecTarget::Wsl { .. }) {
        "bash"
    } else {
        "sh"
    }
}

/// 构建 WSL/Remote 的 mkdir -p 命令（路径已 safe_path 转义）
pub(super) fn build_mkdir_command(safe_path: &str) -> String {
    format!("mkdir -p '{safe_path}'")
}

/// 构建 WSL/Remote 的存在性检查命令（输出 "yes"/"no"）
pub(super) fn build_exists_check_command(safe_path: &str) -> String {
    format!("test -e '{safe_path}' && echo yes || echo no")
}

/// 构建 WSL/Remote 的 rm -rf 命令
pub(super) fn build_rm_command(safe_path: &str) -> String {
    format!("rm -rf '{safe_path}'")
}

/// 构建 WSL/Remote 的 mv 命令
pub(super) fn build_mv_command(safe_old: &str, safe_new: &str) -> String {
    format!("mv '{safe_old}' '{safe_new}'")
}
