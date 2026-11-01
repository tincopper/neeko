//! **投递链**：事件 → 归属 → 各消费者（源 B 的扇出点）。
//!
//! # 为什么单独成文件
//!
//! 这是 ingest 里**唯一有副作用**的一段：锁 `project_manager`、读会话可见性、投喂
//! `NotificationCenter`。它与 handler 的契约正交：
//!
//! | | 契约 | 失败时 |
//! |---|---|---|
//! | handler（[`super::handlers`]） | 恒定 204 | 永远不会失败 |
//! | 投递（本文件） | 尽力投递一次 | 只记日志，绝不反压（B1/F10） |
//!
//! # 消费者是**装配期的事实**，不是本文件的硬编码
//!
//! 本文件只负责「在阻塞池里按序把事件交给一组 [`HookSink`]」。谁是消费者由组合根
//! （`app/boot.rs`）装配：目前是通知域（[`notification_sink`]）与 live-sessions 注册表
//! （`live_sessions::wiring::hooks::sink`）。于是
//!
//! - 新增消费者 = 在该消费者自己的域里写投影 + 组合根加一行，**不改本文件**；
//! - 依赖方向是「组合根 → 各域」，避免 `agent` 与 `live_sessions` 互相知道对方。
//!
//! # 必须跑在阻塞池里（红线 3 / PRD H4）
//!
//! 通知投影同步持两把 std `Mutex`（`project_manager` / `notification.policy`）。旧实现每连接
//! 一个专用 OS 线程，阻塞无害；现在 handler 跑在 **Tauri 共享 tokio runtime 的 worker**
//! 上 —— 同步持锁会占住 worker，多 Agent 并发（16 在途 hook + 用户同时刷项目列表）可打满
//! worker，令前端 Tauri Command（IPC）与 LSP/终端异步任务一起停摆。
//!
//! 故生产入口 [`via_blocking_pool`] 用 `AppRuntime::spawn_blocking` fire-and-forget 隔离：
//! 204 不再含锁等待（B1 的 800ms 预算压力归零），且 fail-open 语义不变。

use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::common::runtime::AppRuntime;
use crate::AppStateWrapper;

use super::attribution::{attribute, ProjectRef};
use super::event::HookEvent;
use super::notify::project;

/// 一个 hook 事件的**消费者**：`(app, 上报来源, 已解析事件)`。
///
/// 消费者由组合根装配（见模块头），本文件只按序调用 —— 它不需要认识任何具体域。
pub type HookSink = Arc<dyn Fn(&AppHandle, &str, &HookEvent) + Send + Sync>;

/// 生产投递闭包：把每个 sink 推到阻塞池（fire-and-forget）。
///
/// 返回的闭包可直接喂给 [`super::handlers::route_group_with`]。`sinks` 的顺序即投递顺序
/// （通知在前：既有行为不变；live-sessions 在后：它只写内存注册表）。
pub fn via_blocking_pool(
    app: AppHandle,
    runtime: Arc<AppRuntime>,
    sinks: Vec<HookSink>,
) -> impl Fn(&str, HookEvent) + Send + Sync + 'static {
    let sinks: Arc<[HookSink]> = sinks.into();
    move |source, event| {
        // `&str` 不能跨线程移动：先拥有化。`HookEvent` 已是 `Send` 值类型。
        let source = source.to_owned();
        let app = app.clone();
        let sinks = Arc::clone(&sinks);
        runtime.spawn_blocking(move || {
            for sink in sinks.iter() {
                sink(&app, &source, &event);
            }
        });
    }
}

/// 通知消费者（源 B 的既有实现）：闭包形态，供组合根与其他消费者并列装配。
#[must_use]
pub fn notification_sink() -> HookSink {
    Arc::new(deliver_notification)
}

/// 归属 + 投影 + 门面投喂（通知消费者，唯一触碰业务状态处）。
///
/// 由 [`notification_sink`] 在**阻塞池**里调用，因此这里的同步锁是安全的。
fn deliver_notification(app: &AppHandle, source: &str, event: &HookEvent) {
    let state = app.state::<AppStateWrapper>();
    let projects: Vec<ProjectRef> = match state.project_manager.lock() {
        Ok(manager) => manager
            .list_projects()
            .into_iter()
            .map(|p| ProjectRef {
                project_id: p.id.clone(),
                project_name: p.name.clone(),
                roots: vec![p.path.clone()],
            })
            .collect(),
        Err(poisoned) => {
            log::warn!("[agent-hooks] project manager lock poisoned: {poisoned}");
            return;
        }
    };
    let attribution = attribute(
        &event.agent_session_id,
        event.cwd.as_deref(),
        &event.hints,
        &projects,
    );
    let Some(signal) = project(source, event, &attribution) else {
        return; // 未知语义事件：fail-open（通知域不认识的键，其他消费者可能认识）
    };
    // 外部终端会话对本应用恒不可见；env 精确命中自有会话时复用源 A 可见性判定。
    let instance_visible = state.agent_chat_manager.visible_session().as_deref()
        == Some(signal.source.instance_id.as_str());
    state.notification.observe(app, signal, instance_visible);
}
