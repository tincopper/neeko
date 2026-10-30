//! opencode 适配器的用例入口（`mod tests;` 挂到 `opencode.rs`）。
//!
//! 分三组：`fixture`（v1 库夹具 + `parse_v1` 分派断言）、`listing`（列表 / 过滤 / 缓存 / 恢复）、
//! `messages`（v1 正文块映射）。v2 的用例在 `v2/tests/`。

mod fixture;
mod listing;
mod messages;
mod real_db;
