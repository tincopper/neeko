//! Windows 本地进程启动标志。

use tokio::process::Command;

/// 为子进程(piped stdio)应用 Windows 平台标志:隐藏控制台窗口。
pub fn apply_child_flags(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    // 与旧 `common::utils::command::local::exec` 对齐：隐藏控制台窗口。
    command.creation_flags(crate::common::utils::command::local::flags::CREATE_NO_WINDOW);
}

/// 为分离进程(null stdio)应用 Windows 平台标志:隐藏控制台窗口 + 分离进程。
pub fn apply_detached_flags(command: &mut Command) {
    use crate::common::utils::command::local::flags;
    use std::os::windows::process::CommandExt;
    command.creation_flags(
        flags::CREATE_NO_WINDOW | flags::DETACHED_PROCESS | flags::CREATE_NEW_PROCESS_GROUP,
    );
}
