//! 进程内 HTTP 服务端（C/S 架构的 L1 网关引擎）。
//!
//! # 分层（依赖方向由 `check_server_no_business_dep` 静态钉住）
//!
//! - [`gate`] —— 统一鉴权门：进程内唯一的 token 能力裁决点（恒定时间比较）。
//! - [`group`] —— 路由组契约：`RouteGroup`（值对象）+ `FailurePolicy`（编译期策略）。
//! - [`engine`] —— 引擎：bind / 分层 / 挂载路由组 / 优雅停机；**零业务分支**。
//!
//! **本模块禁止 import 任何业务域**（agent / git / terminal / notification …）与
//! `tauri::`：引擎要能在纯 tokio 测试里被驱动，业务句柄由调用方（组合根）注入。
//!
//! # 为什么分层位置是契约
//!
//! tower 中间件只能改写**来自内层**的响应。失败策略（[`FailurePolicy`]）的消费点因此
//! 必须在组内、把 catch-panic / timeout / body-limit 包在里面 —— 否则三层自产的
//! 5xx/4xx 会绕过归一化，fail-open 组向调用方漏出故障信号（违背 hooks 组的 B1 约束）。
//! 完整洋葱序与逐条理由见任务 design §3.3。

mod engine;
mod gate;
mod group;

pub use engine::{serve, ServerConfig, ServerHandle};
pub use gate::{AuthGate, BearerToken, CredentialExt, HeaderToken, SharedTokenSet};
pub use group::{FailurePolicy, RouteGroup};
