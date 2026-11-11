//! 标题判据（纯函数）：`admit`（准入）+ `should_upgrade`（覆盖序）。
//!
//! 两个判据**正交**，缺一即失效：
//!
//! - [`admit`] 回答「这条候选配不配当标题」—— 否定式，按来源分派；
//! - [`should_upgrade`] 回答「谁能覆盖谁」—— 来源质量序。
//!
//! # 为什么在 `common/agent/` 而不是 `live_sessions/`
//!
//! 标题判据有**两个**消费者：实时侧栏（`live_sessions`）与历史列表（`conversation`）。
//! 后者不能反向依赖前者（前者的 `cached_title_for_native` 已经依赖 conversation 域），
//! 所以判据与来源词表落在中立域；`live_sessions::title` 只是 re-export（保持既有路径）。
//!
//! # 为什么准入是必需的（而不只是覆盖序）
//!
//! 单调升级（弱级永不覆盖强级）会把任何**已进入**注册表的噪声**粘住**：一条 `Native`
//! 噪声一旦写入，后续正确的 `Prompt` 再也改不回来。所以准入必须发生在**写入之前**，
//! 且只发生在唯一写路径 [`crate::live_sessions::registry::Registry`] 的 `upgrade_title` 上。
//!
//! # 客户端只做「拒绝」，不做「生成」
//!
//! 语义浓缩只能发生在源头（provider 自己命名 / 用户自述）。所有候选来源都是别人产出的、
//! 带噪声的，本模块能做的只有判定「这串字不携带会话主题信息」并返回 `None` ——
//! 不摘要、不改写、不猜。
//!
//! # 文件边界
//!
//! 一个文件一件事，新增判据只加不改：
//!
//! | 文件 | 内容 |
//! | --- | --- |
//! | `judge.rs` | 两个正交判据（准入分派 + 覆盖序），只做分派不含策略 |
//! | `text.rs` | 与来源无关的文本工具（预算 / 折叠 / 截断） |
//! | `prompt.rs` | `Prompt` 来源的策略（斜杠命令 / 客套包装） |
//! | `native.rs` | `Native` 来源的策略（装饰 / 状态词 / cwd / 身份回显），CLI 差异以常量表承载 |
//! | `placeholder.rs` | `Placeholder` 的身份标签（无真标题时的显示名，**永远非空**） |
//! | `source.rs` | 来源词表 `TitleSource`（`Ord` 即质量序，两个域共用） |
//! | `candidate.rs` | 候选值对象 `TitleCandidate` + 阶梯取值 `admit_candidates` |
//! | `clean.rs` | 与来源无关的**净化**（标题特有的一步 + 对 `transcript_noise` 的编排） |
//!
//! 「哪些字节不是语义」的词表与剥离实现不在本模块：它在
//! [`crate::common::agent::transcript_noise`]（预览管线消费同一份）。

mod candidate;
mod clean;
mod judge;
mod native;
mod placeholder;
mod prompt;
mod source;
mod text;

pub use candidate::{admit_candidates, TitleCandidate};
pub use judge::{admit, should_upgrade};
pub use placeholder::placeholder_label;
pub use source::TitleSource;
pub use text::MAX_TITLE_CHARS;

#[cfg(test)]
mod tests;
