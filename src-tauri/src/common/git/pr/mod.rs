//! Pull-request provider abstraction and dispatch functions.
//!
//! 按职责拆分（AGENTS.md 规则 #9：`mod.rs` 只留 `mod` 声明与 `pub use`）：
//! - `provider` —— [`PrProvider`] trait
//! - `store` —— 进程级 provider 缓存
//! - `dispatch` —— 工厂 + 全部对外调度函数
//! - `github` / `gitlab` / `gitee` —— 平台实现

pub mod gitee;
pub mod github;
pub mod gitlab;

mod dispatch;
mod provider;
mod store;

pub use dispatch::*;
pub use provider::PrProvider;
pub use store::{invalidate_provider_cache, resolve_provider, set_cached_provider};
