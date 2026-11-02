//! 两个正交判据：准入问「配不配」，覆盖序问「谁压谁」。
//!
//! 本文件**只做分派**，任何来源的具体策略都在 `prompt.rs` / `native.rs`：新增来源是加一条
//! `match` 臂 + 一个文件，不会把三个来源的判据混在一处。

use crate::live_sessions::entry::TitleSource;

use super::native::native_candidate;
use super::prompt::prompt_candidate;
use super::text::{budgeted, non_empty, truncate};
use super::MAX_TITLE_CHARS;

/// 新来源是否允许覆盖当前来源（同级允许，弱级拒绝）。
///
/// 同级允许覆盖：同一来源后到的那份可能更完整（例如 CLI 重绘出的任务标题比上一帧长）。
/// 反向永不发生：`User` 一旦设置，任何自动来源都不得改写它。
#[must_use]
pub fn should_upgrade(current: TitleSource, incoming: TitleSource) -> bool {
    incoming >= current
}

/// 一条候选是否配当标题；配则返回清理后的文本。
///
/// 这是标题系统的**唯一准入判据**：调用点只送「来源 + 原文 + 该会话的 agent」，
/// 不判断文本形状。返回 `None` 表示这条候选不携带会话主题信息 —— 注册表应当
/// **什么都不做**（不是写入空串），让已有标题粘住。
///
/// 各来源的判据见下表；`Native` 的子判据见 `native::native_candidate`。
///
/// | 来源 | 判据 |
/// | --- | --- |
/// | `Placeholder` | 永远 `None`：占位不是标题，由视图解释 |
/// | `User` | 非空白即可（用户说了算，不套任何清理） |
/// | `Prompt` | 含字母/数字、非斜杠命令、剥掉客套包装后仍非空 |
/// | `Native` | 剥装饰后非空、≥ 2 字符、含字母数字、非身份回显 / 状态词 / `Terminal N` / cwd |
#[must_use]
pub fn admit(source: TitleSource, raw: &str, agent_id: Option<&str>) -> Option<String> {
    let text = budgeted(raw);
    match source {
        TitleSource::Placeholder => None,
        TitleSource::User => non_empty(truncate(text, MAX_TITLE_CHARS)),
        TitleSource::Prompt => prompt_candidate(text),
        TitleSource::Native => native_candidate(text, agent_id),
    }
}
