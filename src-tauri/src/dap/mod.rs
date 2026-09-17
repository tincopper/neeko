//! Debug Adapter Protocol support.
//!
//! Layered design (high cohesion / low coupling):
//!
//! ```text
//! commands ──→ manager（门面：只转调 + 会话级透传）
//!                 │
//!                 ├─→ launch            (启动/重跑/语言编排：plan → 建会话 → 挂断点)
//!                 ├─→ breakpoints::service (断点全链路：IPC → 内存 → 磁盘 → 适配器)
//!                 ├─→ source_translation (身份翻译 + 外部源码授权，无状态)
//!                 └─→ sessions::registry (会话所有权 / stop / list)
//!                            │
//!                      DapContext<'a> { state, sessions, breakpoints, backends }
//!                            │
//!                            ├─→ launch_config    (launch.json 读写 / 入口点发现)
//!                            ├─→ project_context  (项目根 / 执行环境 / 适配器可用性)
//!                            └─→ session ──→ events (DapEventSink 端口)
//!                                            ├─ adapter/*  (语言插件 + 编排后端)
//!                                            ├─ process / transport / client / protocol
//!                                            └─ (spawn 一律经 core::exec)
//! ```
//!
//! 依赖方向**单向**：`commands → manager → {launch, breakpoints, source_translation, sessions}
//! → DapContext → 领域服务 → session/adapter → core::exec`。用例模块之间不互相依赖
//! （`launch` 可调用 `breakpoints::service` 装载断点，反向不成立）。
//!
//! **Tauri 只出现在两处**：`commands`（IPC 翻译官）与 `events::TauriEventSink`
//! （`AppHandle` → `DapEventSink` 适配器）。其余模块在 `#[cfg(test)]` 下可脱离
//! Tauri 运行时测试（假适配器 + 事件记录器见 `testing`）。
//!
//! 不变量与踩坑清单见 `.trellis/spec/backend/dap-domain.md`。

pub mod adapter;
mod backends;
mod breakpoints;
mod build;
pub mod cleanup;
pub mod client;
pub mod commands;
pub mod config;
mod context;
pub mod discover;
pub mod events;
mod external_source;
mod launch;
mod launch_config;
mod launch_support;
pub mod manager;
pub mod process;
mod project_context;
pub mod protocol;
pub mod session;
mod sessions;
mod source_translation;
#[cfg(test)]
mod testing;
pub mod transport;
pub mod types;

pub use manager::DapManager;
