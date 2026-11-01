//! `/hook/{source}` 的 handler 与路由组（design §3.4）。
//!
//! # 这里没有 HTTP 实现
//!
//! 解析 / body 上限 / 超时 / panic 兜底 / 并发 / 鉴权都在 [`crate::server`] 引擎里。
//! 本文件只有：状态、handler、把两者装成 [`RouteGroup`] 的工厂。
//!
//! handler 与投递分离：handler 的契约是「恒定 204」，投递（[`super::dispatch`]）有副作用、
//! 会阻塞。混在一起会让测试被迫二选一：要么起真 `AppHandle`（集成测试做不到），要么放弃
//! 断言投递。故状态持一个投递闭包：生产实现走阻塞池，测试实现是记录型 sink。

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Router;
use tauri::AppHandle;

use crate::common::runtime::AppRuntime;
use crate::server::{FailurePolicy, RouteGroup};

use super::dispatch;
use super::event::HookEvent;
use super::validation;

/// 投递闭包：`(source, event) -> ()`，可跨线程共享。
pub type Deliver = dyn Fn(&str, HookEvent) + Send + Sync;

/// 路由组状态：**只放投递闭包**。token 不进路由组（校验唯一位置是鉴权门）。
#[derive(Clone)]
pub struct HookState {
    deliver: Arc<Deliver>,
}

/// 生产入口：构造 hooks 路由组（该组自己声明 fail-open）。
///
/// `sinks` 由组合根装配（`app/boot.rs`）：本层只把它们交给引擎侧的投递闭包，
/// 不关心有哪些消费者。
#[must_use]
pub fn route_group(
    app: AppHandle,
    runtime: Arc<AppRuntime>,
    sinks: Vec<dispatch::HookSink>,
) -> RouteGroup {
    route_group_with(dispatch::via_blocking_pool(app, runtime, sinks))
}

/// **测试缝（AC2）**：注入投递闭包，引擎 / 门 / 策略 / handler / 校验与生产入口完全同源。
///
/// 集成测试是独立 crate、无 `tauri::test` feature、构造不出 `AppHandle` —— 用本入口
/// + 记录型 sink 断言「投递 / 不投递」，走真引擎真 socket。
#[must_use]
pub fn route_group_with(deliver: impl Fn(&str, HookEvent) + Send + Sync + 'static) -> RouteGroup {
    let state = HookState {
        deliver: Arc::new(deliver),
    };
    let router = Router::new()
        .route("/hook/{source}", post(ingest_hook))
        .with_state(state);
    RouteGroup {
        name: "hooks",
        policy: FailurePolicy::FailOpen,
        router,
    }
}

/// `POST /hook/{source}` —— wire 契约见 design §6。
///
/// 只做三件事：取 path 与 body（axum 已解析，含 body 上限）→ 调校验 → 恒 204。
/// **没有 403 分支**：拒绝发生在鉴权门；handler 若能返回 403，就等于允许某些组绕过门。
async fn ingest_hook(
    State(state): State<HookState>,
    Path(source): Path<String>,
    body: Bytes,
) -> Response {
    validation::validate(&source, &body, |registered, event| {
        (state.deliver)(registered, event);
    });
    StatusCode::NO_CONTENT.into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 组声明：fail-open + 稳定的组名（日志/测试用）。
    #[test]
    fn route_group_declares_fail_open_and_stable_name() {
        let group = route_group_with(|_, _| {});
        assert_eq!(group.name, "hooks");
        assert_eq!(group.policy, FailurePolicy::FailOpen);
    }
}
