//! opencode v2 读取器的用例入口（`mod tests;` 挂到 `v2.rs`）。
//!
//! 夹具与断言分成四组：`fixtures`（两套 DDL + 行模型 JSON）、`listing`（列表 / 过滤 / 预览 /
//! 标题素材）、`content`（块映射 + 计数同源）、`dispatch`（`read_db` 与 adapter 入口的布局分派）。
//! 这样每个文件都在 300 行内，且「实现」与「夹具」不再混在一起。

mod content;
mod dispatch;
mod fixtures;
mod listing;
