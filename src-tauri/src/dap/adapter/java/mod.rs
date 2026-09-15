//! Java 语言调试后端聚合点（§9.5 方案 C）。
//!
//! - `java.rs`：协议层 `JavaAdapter`（spawn / launch args，无状态）。
//! - `debuggee.rs`：Java attach-first 的测试 JVM 生命周期。
//! - `capability.rs`：能力探测端口 `JavaDebugCapabilityProvider`（dap 定义抽象，lsp 实现）。
//! - `source_path.rs`：断点源路径翻译端口 `JavaSourcePathProvider`（dap 定义抽象，lsp 实现）。
//!
//! 子模块统一 `pub`：`dap/mod.rs` 以模块别名重导出（`java_capability` / `java_debuggee` /
//! `java_source_path`）保持既有对外路径不变。`mod.rs` 仅声明与 re-export（AGENTS.md 红线 9）。

pub mod backend;
pub mod capability;
pub mod debuggee;
pub mod protocol;
pub mod source_path;

pub use backend::JavaBackend;
pub use protocol::JavaAdapter;
