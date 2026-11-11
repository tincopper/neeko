//! Claude 兼容面的**事件映射表**（claude / codebuddy / qoder 三源共用一份）。
//!
//! 独立成文件的理由：它是一张会被三个 `HookTarget` 行**按指针共享**的表
//! （`targets/tests.rs` 有 `std::ptr::eq` 判据）。与 `HookEntry` 类型定义分开，
//! 「类型」与「这张具体表」两个变化频率不同的东西因此不互相牵连。

use super::shape::HookEntry;
use crate::agent::chat::notify::event_keys;
use crate::agent::hooks::ingest::event::EVENT_TURN_STARTED;

/// Claude Code 规范事件面 → 语义键。**三源共用一份**（claude / codebuddy / qoder）。
///
/// 为什么可以共用：Qoder 官方自带 `hooks migrate --from-claude` 子命令，其迁移逻辑把
/// Claude hooks **结构 1:1 写入**自己的 settings.json（`g.set(["hooks", eventName, ...])`）；
/// CodeBuddy 的类型定义亦明写 `Format matches Claude Code hooks specification exactly`。
/// 故三源共享同一份表，不复制三份（父任务 AC3「无重复实现」）。
///
/// **不含 `Notification`（2026-10-16 spike U4 修正）**：Claude 规范明确
/// `UserPromptSubmit` / `Notification` / `Stop` / `SubagentStop` **不使用 matcher**。
/// 若给 `Notification` 配 `matcher: "permission_prompt"`，matcher 不生效 →
/// **所有** Notification（含 `idle_prompt` 类空闲提示）都会被映射为 `input_requested` = 误报。
/// 故不映射（宁缺勿误报）；「等待用户行动」由 `PermissionRequest` 覆盖。
///
/// 声明为 **static 数组**（而非 `const` / `static &[...]`）：取址处一律写 `&CLAUDE_COMPAT_ENTRIES`。
/// `const` 的初值在每个使用点被重新求值，`&[...]` 会产生多个提升分配；`static X: &[T]`
/// 则把「指向提升数组的引用」存进 X，在 const 初始化器里读它同样可能落到不同的提升副本。
/// 实测（2026-10-16）：两种写法下 `std::ptr::eq` 均判为不相等 —— 而「三源共享同一份而非
/// 各复制一份」正是本表要防的漂移源（父任务 AC3），必须有机器判据。
/// 用 static 数组后地址恒为 static 自身，指针判据稳定成立。
pub static CLAUDE_COMPAT_ENTRIES: [HookEntry; 4] = [
    // 权限门 = 等待用户行动（主路径）。
    HookEntry {
        native_event: "PermissionRequest",
        matcher: Some("*"),
        event_key: event_keys::APPROVAL_REQUESTED,
    },
    // 用户提交 prompt：**唯一携带会话主题文本的事件**（载荷字段 `prompt`）。
    //
    // 为什么必需：claude / codebuddy / qoder 的侧栏标题只有两条来路 —— hook 的 `topic`，
    // 或 conversation 缓存回落（那条要求「先扫过盘」，开机后没打开过 History 就必然 miss）。
    // 少了这一条，三源的标题恒为空，实测表现为「会话根本不进侧栏」。
    // 事件键用 `EVENT_TURN_STARTED`（提交 prompt 就是「这一轮开始」，语义与状态机一致，
    // 不新造键）：常量与模板的 argv 契约同源，改名由编译器而不是测试兜住。
    HookEntry {
        native_event: "UserPromptSubmit",
        // 规范明确 `UserPromptSubmit` 不使用 matcher（与 Notification / Stop 同类）。
        matcher: None,
        event_key: EVENT_TURN_STARTED,
    },
    // 主 agent 结束响应 = 本轮完成。
    HookEntry {
        native_event: "Stop",
        matcher: None,
        event_key: event_keys::TURN_COMPLETED,
    },
    // Stop hook 自身失败 = 异常终止。
    HookEntry {
        native_event: "StopFailure",
        matcher: None,
        event_key: event_keys::SESSION_FAILED,
    },
];
