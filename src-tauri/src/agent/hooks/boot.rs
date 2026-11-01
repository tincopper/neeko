//! `agent::hooks` 域的唯一启动入口（与 `session` / `agent` / `library` / `lsp` 四域对称）。
//!
//! 组合根只负责顺序与失败策略（`src-tauri/AGENTS.md`「主链路」），所以源 B 的两件启动事务
//! 收在本文件：① 发布 loopback ingest 坐标（endpoint 文件）；② 收敛「设置意图 → hook 文件事实」。
//! 两者都是旁路能力：失败只降级外部 CLI 的通知，绝不阻断 Neeko 启动 —— 因此本函数不返回
//! Result，错误就地记日志。
//!
//! # HTTP 服务端接线（design §4.2 的顺序不可变）
//!
//! `bind :0` → 读实得端口 → `remove_legacy_endpoint` → `publish` → `prune_stale_endpoints`
//! → `serve`（引擎接管 accept 循环）。坐标先于 serve 发布是旧实现的既有顺序，迁移期保持不变。

use std::path::PathBuf;
use std::sync::Arc;

use tauri::AppHandle;

use crate::common::runtime::AppRuntime;
use crate::server::{AuthGate, HeaderToken, ServerConfig, ServerHandle};

use super::ingest::dispatch;
use super::ingest::endpoint as lifecycle;
use super::ingest::endpoint::EndpointPublication;
use super::ingest::handlers;
use super::ingest::validation::TOKEN_HEADER;
use super::install::config::settings;
use super::install::selection;

/// 并发在途上限（旧 `MAX_INFLIGHT_CONNECTIONS`：单机 loopback 的 OS 资源底线）。
const MAX_INFLIGHT_CONNECTIONS: usize = 16;
/// 单请求 body 上限（旧 `MAX_BODY_BYTES`：通知载荷是标量集合，64KB 远够；红线 4 精神）。
const MAX_BODY_BYTES: usize = 64 * 1024;
/// 逐请求超时（旧实现是 2s 读/写超时；请求级语义等价，留足归属+投影余量）。
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// 启动 CLI hook 摄入并补齐安装态。
///
/// 入参由组合根给到"具体事实"（应用句柄、`~/.neeko` 根、用户的 cliHooks 主开关、
/// `config.json` 快照（供逐 CLI 覆盖）、Scheme C 执行器），boot 本身不依赖 `AppStateWrapper`
/// （但 `ingest::deliver` 的外圈投递点需要它来 emit）。
///
/// `sinks` 是**消费者表**：组合根把「通知」与「live-sessions」两个消费者的入口并列传进来，
/// 本域只负责按序投递 —— 新增消费者不改本文件（见 `ingest::dispatch` 模块头）。
///
/// 返回 HTTP 句柄供组合根存入 `AppStateWrapper`（关闭协议据此优雅停机）；启动失败返回 `None`
/// —— 失败只记 warn，不阻断启动（旁路能力）。
#[must_use]
pub fn boot(
    app: AppHandle,
    neeko_dir: PathBuf,
    want_cli_hooks: bool,
    config: &serde_json::Value,
    runtime: Arc<AppRuntime>,
    sinks: Vec<dispatch::HookSink>,
) -> Option<ServerHandle> {
    let handle = match start_ingest(&app, &neeko_dir, &runtime, sinks) {
        Ok(handle) => Some(handle),
        Err(err) => {
            log::warn!("[boot] start agent-hooks ingest failed: {err}");
            None
        }
    };
    reconcile(want_cli_hooks, config);
    handle
}

/// 发布坐标并启动引擎（顺序见模块头；任一步失败即整体失败，由调用方降级）。
fn start_ingest(
    app: &AppHandle,
    neeko_dir: &std::path::Path,
    runtime: &Arc<AppRuntime>,
    sinks: Vec<dispatch::HookSink>,
) -> std::io::Result<ServerHandle> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();

    // 一次性迁移（v5 多实例）：旧单文件坐标退役，避免上报端同时读到新旧两种形态。
    // 失败只警告不阻断（通知是旁路；上报端的目录扫描本就忽略旧文件）。
    if let Err(err) = lifecycle::remove_legacy_endpoint(neeko_dir) {
        log::warn!("[agent-hooks] remove legacy endpoint.env failed: {err}");
    }

    // instance_id = 进程启动时随机 uuid，仅内存持有、仅用作文件名：每实例一个坐标文件，
    // 多实例共存互不覆写（R6.8 / AC18）。token 同时是本实例签发的能力（鉴权门的期望值）。
    let publication = EndpointPublication::new(
        neeko_dir,
        uuid::Uuid::new_v4().to_string(),
        port,
        uuid::Uuid::new_v4().to_string(),
    );
    publication.publish()?;

    // 回收历史死坐标（`prune_stale_endpoints` 用 connect 探测，天然跨平台）。
    // 必须在**自己 publish 之后**：`keep` 指向本实例，避免把自己的文件删掉。
    let _ = lifecycle::prune_stale_endpoints(neeko_dir, &publication.instance_id);

    let gate = Arc::new(AuthGate::new(
        publication.token.clone(),
        vec![Arc::new(HeaderToken { name: TOKEN_HEADER })],
    ));
    let groups = vec![handlers::route_group(
        app.clone(),
        Arc::clone(runtime),
        sinks,
    )];
    let handle = crate::server::serve(
        runtime,
        ServerConfig {
            listener,
            max_inflight: MAX_INFLIGHT_CONNECTIONS,
            request_timeout: REQUEST_TIMEOUT,
            max_body_bytes: MAX_BODY_BYTES,
        },
        gate,
        groups,
    )?;

    log::info!(
        "[agent-hooks] ingest listening on 127.0.0.1:{port} (instance {}, endpoint: {})",
        publication.instance_id,
        publication.path.display()
    );
    Ok(handle)
}

/// 开机收敛：意图与文件不一致时单向对齐。
///
/// 与设置页保存走**同一个收敛入口**（[`selection::apply_selection`]）—— 此前这里先算
/// `reconcile_action` 再二选一执行，缺了「装该装的 + 卸不该装的」中的卸那一半，
/// 使「关掉某个 CLI 后重启又装回来」。统一入口后两个调用方语义必然一致。
///
/// install / uninstall 都幂等且只触碰带自家标记的文件，因此直接执行，不需要二次确认。
fn reconcile(want_cli_hooks: bool, config: &serde_json::Value) {
    let overrides = settings::hook_source_overrides(config);
    let outcomes = selection::apply_selection(want_cli_hooks, |source| {
        settings::hook_enabled_for(source, want_cli_hooks, &overrides)
    });
    // 只记**有实际动作**的行：`Unchanged` / `Removed`（无痕迹）是常态，全量打日志会淹没
    // 真正的变更（开机日志的价值在于「这次启动改了什么」）。
    let changed: Vec<String> = outcomes
        .iter()
        .filter(|o| {
            matches!(
                o.status,
                crate::agent::hooks::install::outcome::HookApplyStatus::Applied
                    | crate::agent::hooks::install::outcome::HookApplyStatus::Removed
                    | crate::agent::hooks::install::outcome::HookApplyStatus::Failed
                    | crate::agent::hooks::install::outcome::HookApplyStatus::Skipped
            )
        })
        .map(|o| format!("{}:{:?}", o.source, o.status))
        .collect();
    if !changed.is_empty() {
        log::info!("[agent-hooks] reconcile: {}", changed.join(" "));
    }
}
