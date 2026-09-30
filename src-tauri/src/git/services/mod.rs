//! Git service layer：commit agent 集成 + 仓库单元 status 编排。

/// Commit message generation agent integration.
pub mod commit;
/// 仓库单元 status 的读取与挂载编排（命令层只校验 + 委派，红线 6）。
pub mod status;
