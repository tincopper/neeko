//! `Placeholder` 身份标签：**没有真标题时的显示名，永远非空**。
//!
//! 为什么必须有它（第一性原理）：空串把「还没观测到主题」变成了**不可渲染状态**，于是每个
//! 消费方只能各编一个兜底 —— 侧栏干脆不列行、tab 停在自己的创建期标题、History 用
//! `agent <id8>`。三份兜底互相矛盾，且都让「缺少观测」这件事隐形。
//!
//! 这里只用**身份事实**（cwd 名 / agent / 短 id）合成标签：不猜测主题、不做语义改写、
//! 也不把 agent 名复制成第二个真值源 —— 它就是该会话的显示身份，随后由
//! [`super::should_upgrade`] 单调升级成 Prompt / Native / User（红线 17）。
//!
//! 稳定性要求：同一会话在同一目录下反复取标签必须逐字相同（侧栏行不能跳）。

use super::text::truncate;
use super::MAX_TITLE_CHARS;

/// 路径分隔符：`/`（POSIX / WSL）与 `\\`（Windows）。**不按平台门控**：
/// 判据是对字符串的形态识别，不是平台行为（红线 10 的反面例子是 `#[cfg]` 分支）。
const PATH_SEPARATORS: &[char] = &['/', '\\'];

/// 无真标题时的显示标签。
///
/// 组成优先级（越靠前越有辨识度，且都不依赖任何 CLI 写入的内容）：
///
/// 1. `agent · <cwd 末段>`：默认形态（同一项目里多会话靠序号区分，见 `view::snapshot_view`）；
/// 2. `<cwd 末段>`：纯 shell（`agent_id == None`）—— 没有 agent 可拼，项目名就是身份；
/// 3. `agent <短 id>`：cwd 无末段（`/`、空串）时退回 —— 与 History 列表的兜底同形，
///    免得同一会话在两个视图里长得完全不同；
/// 4. `<短 id>`：连 agent 都没有的极端形态。
#[must_use]
pub fn placeholder_label(agent_id: Option<&str>, cwd: &str, session_id: &str) -> String {
    let agent = agent_id.map(str::trim).filter(|id| !id.is_empty());
    if let Some(name) = cwd_basename(cwd) {
        let label = match agent {
            Some(agent) => format!("{agent} · {name}"),
            None => name.to_string(),
        };
        return truncate(&label, MAX_TITLE_CHARS);
    }
    let short = short_id(session_id);
    let label = match agent {
        Some(agent) => format!("{agent} {short}"),
        None => short.to_string(),
    };
    truncate(&label, MAX_TITLE_CHARS)
}

/// cwd 的最后一段非空路径分量（`/a/b/` → `b`，`C:\\a\\b` → `b`）。
///
/// 末尾分隔符必须被忽略：恢复路径常带尾斜杠，否则标签会变成 `agent · `（末尾空白）。
fn cwd_basename(cwd: &str) -> Option<&str> {
    cwd.split(PATH_SEPARATORS)
        .rev()
        .map(str::trim)
        .find(|segment| !segment.is_empty())
}

/// 会话 id 的前 8 个字符（后端铸造的 id 非空；空则给一个恒非空的兜底串）。
fn short_id(session_id: &str) -> &str {
    let trimmed = session_id.trim();
    if trimmed.is_empty() {
        return "session";
    }
    let end = trimmed
        .char_indices()
        .map(|(i, c)| i + c.len_utf8())
        .take_while(|&end| end <= 8)
        .last()
        .unwrap_or_else(|| trimmed.chars().next().map_or(0, char::len_utf8));
    &trimmed[..end]
}
