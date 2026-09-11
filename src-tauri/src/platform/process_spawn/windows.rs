//! Windows 本地进程启动标志。

use tokio::process::Command;

/// 为子进程(piped stdio)应用 Windows 平台标志:隐藏控制台窗口。
///
/// `kill_tree` 在 Windows 不体现为进程组:树杀由 `taskkill /F /T`(按父 pid 遍历)
/// 完成,故此处只需隐藏控制台窗口。
pub fn apply_child_flags(command: &mut Command, kill_tree: bool) {
    let _ = kill_tree;
    // tokio::process::Command 的 creation_flags 为 inherent 方法，无需 CommandExt。
    command.creation_flags(crate::common::utils::command::local::flags::CREATE_NO_WINDOW);
}

/// 杀死 `pid` 及其全部后代:`taskkill /F /T /PID`(fire-and-forget)。
pub fn kill_process_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/T", "/PID"])
        .arg(pid.to_string())
        .creation_flags(crate::common::utils::command::local::flags::CREATE_NO_WINDOW)
        .spawn();
}

/// 为分离进程(null stdio)应用 Windows 平台标志:隐藏控制台窗口 + 分离进程。
pub fn apply_detached_flags(command: &mut Command) {
    use crate::common::utils::command::local::flags;
    command.creation_flags(
        flags::CREATE_NO_WINDOW | flags::DETACHED_PROCESS | flags::CREATE_NEW_PROCESS_GROUP,
    );
}
