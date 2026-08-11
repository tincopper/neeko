//! Unix 本地进程启动标志。

use tokio::process::Command;

/// 为子进程(piped stdio)应用 Unix 平台标志:无需特殊处理。
pub const fn apply_child_flags(_command: &mut Command) {}

/// 为分离进程(null stdio)应用 Unix 平台标志:创建新进程组防止信号传播。
pub fn apply_detached_flags(command: &mut Command) {
    command.process_group(0);
}
