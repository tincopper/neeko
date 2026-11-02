//! 应用组合根：启动序列（[`boot`]）与关闭协议（[`close`]）。
//!
//! 边界（与 `app_state.rs` 同一条判据：写进来的是「组装」还是「规则」？规则一律
//! 下沉到拥有它的领域模块）：
//!
//! | 内容 | 归属 |
//! |------|------|
//! | 进程前置 / Builder 组装 / 启动顺序 | [`boot`]（本目录，纯组装） |
//! | 会话 → 工作区恢复规则 | `session::boot` |
//! | 自定义 agent 装载 + 历史配置迁移 | `agent::boot` |
//! | 默认 Tag Group 存在性 | `library::boot` |
//! | 关闭标签页 vs 关闭窗口的判别 | `platform::close_tab` |
//! | 删除会话：跨两个生产者的终止编排 | [`session_lifecycle`]（本目录，编排） |
//!
//! 因此本目录只允许出现「按什么顺序调用谁」与「失败策略」两类代码。
//! 「怎么结束一条会话」仍各自留在生产者里（终端路由 / chat 管理器），
//! 本目录只负责**先问谁、再问谁**。

mod boot;
mod close;
pub mod commands;
pub mod session_lifecycle;

pub use boot::run;
