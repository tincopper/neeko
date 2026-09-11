//! Unix 本地进程启动标志。

use tokio::process::Command;

/// 为子进程(piped stdio)应用 Unix 平台标志。
///
/// `kill_tree = true` 时让子进程自成进程组:其拉起的后代(包装器脚本 exec 出的
/// 服务进程,如 jdtls 包装器 -> JVM)继承同组,`kill_process_tree` 按组号即可连带
/// 清理;否则杀掉包装器只会让后代孤儿化,继续持锁/占内存。
///
/// `kill_tree = false`(默认)时**不改进程组**:短命令(git / 探测 / 克隆)无需树杀,
/// 不应被无条件改 `pgid`(会改变信号传播语义)。
pub fn apply_child_flags(command: &mut Command, kill_tree: bool) {
    if kill_tree {
        command.process_group(0);
    }
}

/// 杀死 `pid` 及其全部后代(SIGKILL,按进程组)。
///
/// 仅对经 [`apply_child_flags`](自组)启动的子进程安全:组号 = -pid,
/// 后代继承同组。对已退出的 pid 有理论上的组号复用窗口,调用方
/// 应在确认子进程仍存活时调用(见 `LocalExecutor` 的 kill 路径)。
pub fn kill_process_tree(pid: u32) {
    unsafe {
        libc::kill(-pid.cast_signed(), libc::SIGKILL);
    }
}

/// 为分离进程(null stdio)应用 Unix 平台标志:创建新进程组防止信号传播。
pub fn apply_detached_flags(command: &mut Command) {
    command.process_group(0);
}
