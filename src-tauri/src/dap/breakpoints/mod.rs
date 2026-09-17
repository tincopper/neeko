//! 断点领域：状态仓储（`store`）+ 有效断点过滤（`effective`）+ 全链路编排（`service`）。

mod effective;
pub(crate) mod service;
mod store;

/// 对外只暴露过滤函数与仓储类型：`service` 是编排层（由 `manager` / `launch` 调用），
/// `specs_for_file` 是仓储内部构造细节。
pub use effective::effective_breakpoints;
pub use store::BreakpointStore;
