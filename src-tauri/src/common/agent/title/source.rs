//! 标题来源词表。**`Ord` 即质量顺序**（靠前者弱、靠后者强）：
//! `Placeholder < Prompt < Native < User`。
//!
//! 它同时是**一切标题判决的输入**：`should_upgrade` 用它定覆盖序，`admit` 按它分派
//! 来源策略。刻意放在标题域而不是 `live_sessions::entry`：`conversation`（历史列表）
//! 与 `live_sessions`（实时侧栏）共用同一份判据，而前者不能反向依赖后者。

use serde::{Deserialize, Serialize};

/// 标题来源。**`Ord` 即质量顺序**（靠前者弱、靠后者强）：
/// `Placeholder < Prompt < Native < User`。
///
/// 它决定「谁可以覆盖谁」（由 [`super::should_upgrade`] 消费），也是前端
/// `isNamedSession` 的唯一判据（`≠ Placeholder` = 已有真标题）。
///
/// **不要把它降级成「标题是否非空」**：wire 上的 `title` 永远非空（无真标题时是身份标签），
/// 用非空判会让占位标签冒充真标题 —— 那正是「打开 CLI 就冒出一行」的旧事故。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TitleSource {
    /// 创建期占位（agent 名 / `Terminal`）。
    Placeholder,
    /// 真实用户消息：chat 注册时的 prompt、**纯 shell** 终端的首条输入，或 Claude 兼容面
    /// hook 上报的 `prompt` 字段（`UserPromptSubmit`）。
    ///
    /// agent 终端的字节流不是标题源（TUI 面板过滤词也在里面，见第 35 轮）。
    Prompt,
    /// agent 原生标题（CLI hook topic、conversation 缓存里的 provider title）。
    /// OSC 0/2 仅作展示态，不再是生产者。
    Native,
    /// 用户改名（自动来源永不覆盖）。
    User,
}
