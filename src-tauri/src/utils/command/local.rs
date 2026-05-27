use std::process::Command;

/// Windows 进程创建标志常量
#[cfg(target_os = "windows")]
pub mod flags {
    pub const CREATE_NO_WINDOW: u32 = 0x08000000;
    pub const DETACHED_PROCESS: u32 = 0x00000008;
    pub const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
}

/// 创建无窗口进程命令（Windows 下隐藏控制台窗口）
pub fn exec(program: &str) -> Command {
    let cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(flags::CREATE_NO_WINDOW);
    }
    cmd
}

/// 创建无窗口且与当前进程完全分离的进程命令
/// 适用于启动 GUI 应用（如 IDE）：不继承控制台、不随父进程退出
#[cfg(target_os = "windows")]
pub fn exec_detached(program: &str) -> Command {
    let mut cmd = Command::new(program);
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(
            flags::CREATE_NO_WINDOW | flags::DETACHED_PROCESS | flags::CREATE_NEW_PROCESS_GROUP,
        );
    }
    cmd
}
