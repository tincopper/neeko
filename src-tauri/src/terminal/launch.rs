//! 终端会话启动参数值对象。
//!
//! `commands → router → manager → services` 层层转发同一批启动参数，散成位置参数会让
//! 新增一个字段要改 4 处签名（且极易错位）。收成值对象后新增字段只改这里一处，符合
//! 开闭原则与高内聚：这些字段有同一个改变理由 —— 「怎么启动这个 PTY」。

/// 一次终端创建的完整启动参数。命令层（IPC 边界）保持扁平是 Tauri 反序列化的硬约束；
/// 内部三层统一传这个值对象，字段全部由命令层一次成型，内部三层只读转发。
#[derive(Debug, Clone)]
pub struct TerminalLaunch {
    /// PTY 列数。
    pub cols: u16,
    /// PTY 行数。
    pub rows: u16,
    /// shell 覆盖（仅本地；WSL / SSH 由远端决定）。
    pub shell: Option<String>,
    /// 任务命令（有值 = 任务终端，主题准备据此跳过）。
    pub command: Option<String>,
    /// 纯 shell 会话恢复时的旧 `session_id`；由 router 用它准备回放计划。
    pub resume_from: Option<String>,
}
