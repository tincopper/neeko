//! **入站**：接收外部 Agent CLI 的上报（源 B）。
//!
//! # 事件是核心资产，消费者是插件
//!
//! 一个上报事件从 CLI 的 hook 插件发出 → shim → HTTP → 本域，然后**被多个消费者使用**：
//!
//! ```text
//! 外部 CLI ──POST /hook/{source}──▶ crate::server（引擎：解析/限流/超时/panic/鉴权门）
//!                                      │
//!                                      ▼
//!        handlers.rs   取 path+body → 调接收链路 → 恒 204（零副作用）
//!                                      ▼
//!        validation.rs 白名单 → JSON → 会话身份 → sink（三个闸门，一个出口）
//!                                      ▼
//!        event.rs      HookEvent：是谁 / 发生了什么 / 在哪   ← 公共数据资产
//!                                      │
//!                                      ▼
//!        dispatch.rs   spawn_blocking 里按序把事件交给一组 HookSink
//!                                      │
//!              ┌───────────────────────┴───────────────────────┐
//!              ▼                                               ▼
//!        notify.rs → 通知中心                    live_sessions/wiring/hooks.rs
//!        （dispatch::notification_sink）          → 会话标题 + has_user_input
//!                                                （live_sessions::…::sink）
//!
//!        attribution.rs  归属降级链（纯函数，供任意消费者复用）
//!        endpoint.rs     坐标文件：客户端靠它找到我们（与请求链路正交）
//! ```
//!
//! **新增消费者时**：读 [`event::HookEvent`]，在自己的域里写投影 + 暴露一个 [`dispatch::HookSink`]，
//! 再由组合根（`app/boot.rs`）加进 `sinks` 列表。不要改采集侧（`validation.rs` / `handlers.rs`），
//! 也不要把新逻辑塞进 [`dispatch`]（它只做扇出，不认识任何具体域）。
//!
//! # HTTP 传输在哪
//!
//! 报文解析 / body 上限 / 超时 / panic 兜底 / 并发 / 鉴权都在 [`crate::server`]
//! （进程级基础设施，多个客户端形态共用）。本目录只声明 RouteGroup 与语义规则。
//!
//! # 不变式：fail-open
//!
//! 这一侧的任何失败都**不得影响用户终端里的 agent**：
//! - 监听只绑 loopback + 随机端口（bind 在 `boot`，引擎在 `crate::server`），
//!   失败只记 warning、不阻断启动；
//! - 并发上限与超时由引擎强制，超限**拒绝**而非排队；
//! - 上报解析失败/未知 source 只记日志并回 204（[`validation`]），**永不**返回非 2xx
//!   让 CLI 侧把我们的故障当成它的故障。
//!
//! 与 [`super::install`] 的 fail-safe 是**两条互斥的失败策略**：那边失败必须拒绝写盘
//!（用户配置神圣），这边失败必须静默放手（不能拖累 agent）。故它们是两个目录。

pub mod attribution;
pub mod dispatch;
pub mod endpoint;
pub mod event;
pub mod handlers;
pub mod notify;
pub mod validation;

// 与 `hooks/mod.rs` 同一规则：**不 re-export 没人消费的符号**。
// 域外一律写全路径 `ingest::<mod>::<sym>`；一个没人 import 的门面只是把内部实现
// 暴露成公共 API（封装为零），却让「域边界」不可读。
