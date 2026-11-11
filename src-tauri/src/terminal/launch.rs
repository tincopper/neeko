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
    /// **直接 argv**（不经 shell）：与 [`Self::command`] 互斥，互斥性在
    /// `router::create_session` 的边界守卫里判成 `InvalidInput`。
    ///
    /// 存在的理由只有一条：团队成员会话要带 `--mcp-config` 这类含 JSON 引号的参数。
    /// 走 `command`（`sh -c` / `cmd /c`）就得自己定一套引号/转义规则，而那正是红线 2
    /// 要消灭的平台差异。`argv[0]` 是程序，其余是参数。
    pub argv: Option<Vec<String>>,
    /// 调用方注入的环境变量（不透明的键值对，**仅本地传输生效**）。
    ///
    /// terminal 域不认识 `NEEKO_TEAM_*`：env 名的组装在 `agent::team::identity::member_env`，
    /// 这里只转发（依赖方向 team → terminal）。IPC 边界恒传空 —— 前端不拥有环境注入能力。
    pub extra_env: Vec<(String, String)>,
}
