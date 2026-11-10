//! 纯 shell 终端历史日志：**单一所有者** `HistoryStore` + 依赖倒置接口。
//!
//! 目录按职责拆分（红线 9：本文件只做声明与 re-export）：
//! - [`sanitizer`]：把 PTY 字节流投影成可回放的纯文本（纯计算，无 IO）。
//! - [`store`]：日志格式、路径安全、生命周期与回放准备（唯一持有目录的模块）。
//! - [`writer`]：独立写线程，绝不反压 PTY 读泵。
//! - [`contract`]：会话生命周期事件的抽象，供 `live_sessions` 域依赖。
//!
//! 只服务 `agent_id` 为空的纯 shell 终端；agent TUI 输出几乎全是全屏重绘帧，不落盘。

mod contract;
mod sanitizer;
mod store;
mod writer;

#[cfg(test)]
mod tests;

pub use contract::{NoopHistory, SessionHistory, SharedHistory};
pub use sanitizer::{sanitize, Sanitizer, MAX_LOG_BYTES, MAX_LOG_LINES};
pub use store::{replay_payload, tail, HistoryPlan, HistoryStore, SharedHistoryStore};
pub use writer::Recorder;
