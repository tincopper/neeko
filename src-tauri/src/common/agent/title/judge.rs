//! 两个正交判据：准入问「配不配」，覆盖序问「谁压谁」。
//!
//! 本文件**只做分派**，任何来源的具体策略都在 `prompt.rs` / `native.rs`：新增来源是加一条
//! `match` 臂 + 一个文件，不会把三个来源的判据混在一处。

use super::TitleSource;

use super::clean::clean;
use super::native::native_candidate;
use super::prompt::prompt_candidate;
use super::text::{
    budgeted, non_empty, truncate, TITLE_CLEAN_BUDGET_CHARS, TITLE_SCAN_BUDGET_CHARS,
};
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
///
/// # 两段预算（都在净化/判决**之前**，分配上界与判据口径分开）
///
/// 标题是预览：一条 200KB 的粘贴 prompt 不该在事件泵线程上被 `clean` 拷成几份。所以
/// - 净化只看 `TITLE_CLEAN_BUDGET_CHARS` 窗口（宽到能跨过一个真实隐藏块）；
/// - 判据只看 `TITLE_SCAN_BUDGET_CHARS` 前缀（净化只会变短，此后无需再截）。
#[must_use]
pub fn admit(source: TitleSource, raw: &str, agent_id: Option<&str>) -> Option<String> {
    // `User` 是用户亲手写的名字：不套任何清理（含净化）。
    if matches!(source, TitleSource::User) {
        return non_empty(truncate(
            budgeted(raw, TITLE_SCAN_BUDGET_CHARS),
            MAX_TITLE_CHARS,
        ));
    }
    // 其余来源都先过**同一份净化**（隐藏块 / 图片引用 / harness 套话 / markdown 标记），
    // 再交给来源策略判决。净化与判决分两步：前者只删非语义文本，后者只回答配不配。
    let cleaned = clean(budgeted(raw, TITLE_CLEAN_BUDGET_CHARS));
    let text = budgeted(&cleaned, TITLE_SCAN_BUDGET_CHARS);
    match source {
        TitleSource::Placeholder => None,
        TitleSource::Prompt => prompt_candidate(text),
        TitleSource::Native => native_candidate(text, agent_id),
        TitleSource::User => unreachable!("User handled above"),
    }
}
