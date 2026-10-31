use std::sync::Arc;

use tokio::sync::mpsc;

use crate::agent::chat::adapter::session_config::SessionConfigValue;
use crate::agent::chat::adapter::{AgentContext, AgentSession};
use crate::agent::chat::capabilities::ChatCapabilities;
use crate::agent::chat::events::{
    Capabilities, ContextManifest, DoneReason, SessionRequest, StreamEvent,
};
use crate::common::error::AppError;

use super::config_options::{self, ConfigKind, ConfigState};
use super::connection::ServeConnection;
use super::eventurl::question_reply_url;
use super::protocol::{
    model_slug_split, model_switch_body_with_variant, permission_reply_body, prompt_body_for,
    prompt_body_with_options, question_reply_body, ServeProtocol,
};
use super::pump::{run_event_pump, PumpTarget};
use super::session::ServeSession;

/// POST 一个 serve 回执并**校验响应**（approve / question reply / prompt 共用）。
///
/// 为什么不能只判 `Err`（实测 opencode 1.19.0）：
/// - reqwest 默认对 4xx/5xx 返回 `Ok` → `404 QuestionNotFoundError` 会被当成投递成功；
/// - serve 对**未匹配路由**回落 SPA `index.html`（`200 + text/html`）→ 连状态码都是绿的。
///
/// 两者叠加的故障形态：用户点了「回答」，Neeko 记一条成功日志都没有，agent 永久挂起。
pub(super) async fn post_serve(
    client: &reqwest::Client,
    url: &str,
    body: Option<&serde_json::Value>,
    what: &str,
) {
    let request = match body {
        Some(body) => client.post(url).json(body),
        None => client.post(url),
    };
    match request.send().await {
        Ok(resp) => {
            let status = resp.status();
            let html_fallback = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .is_some_and(|v| v.contains("text/html"));
            if !status.is_success() || html_fallback {
                log::warn!(
                    "[ServeAdapter] {what} 未生效: HTTP {status} html_fallback={html_fallback} {url}"
                );
            }
        }
        Err(e) => log::warn!("[ServeAdapter] {what} 请求失败: {e} {url}"),
    }
}

/// serve 请求作用域：实例地址 + 协议版本 + 项目目录。
///
/// 三者共同决定一条会话的路由（serve 按 `directory` 分片，实测缺 directory 的 question
/// 回执返回 404；协议版本决定端点前缀），故合成一个参数：既表达「这是同一个概念」，
/// 也让 `run_request_loop` 待在 clippy `too_many_arguments`（≤7）内。
#[derive(Clone, Copy)]
pub(super) struct ServeScope<'a> {
    base_url: &'a str,
    protocol: ServeProtocol,
    directory: &'a str,
    /// V2 待答表单的 `form_id → field key`（见 `ServeConnection::pending_forms`）。
    /// V1 路径不读它。
    pending_forms: &'a std::sync::Mutex<std::collections::HashMap<String, String>>,
}

/// Attach the SSE pump + request loop to an existing serve session.
///
/// Shared by [`ServeAdapter::create`] (fresh session) and
/// [`ServeAdapter::resume`] (existing native session) — the streaming
/// infrastructure is identical; only the session-id provenance differs.
/// Sends the initial prompt when `ctx.prompt` is non-empty (per-turn model).
pub(super) async fn attach_streaming(
    conn: &'static Arc<ServeConnection>,
    ctx: &AgentContext,
    serve_sid: String,
    caps: ChatCapabilities,
    // 会话配置项状态（模式 / 思考等级的候选值与当前值）。
    // 由调用方探测初值后传入 —— 初建与 resume 的探测时机不同。
    config_state: ConfigState,
) -> Result<Box<dyn AgentSession>, AppError> {
    // ── First prompt (model selection is per-prompt; resume starts silent) ──
    let model_id = ctx.model_id.clone();
    if !ctx.prompt.is_empty() {
        let url = format!("{}{}", conn.base_url, conn.protocol.prompt_path(&serve_sid));
        let resp = conn
            .client
            .post(&url)
            .json(&prompt_body_for(
                conn.protocol,
                &ctx.prompt,
                model_id.as_deref(),
            ))
            .send()
            .await
            .map_err(|e| AppError::Io(format!("serve prompt failed: {e}")))?;
        if !resp.status().is_success() {
            log::warn!("[ServeAdapter] prompt HTTP {}", resp.status());
        }
    }

    // ── Channels + pump / request tasks ────────────────────────────────
    let (event_tx, event_rx) = mpsc::channel(64);
    let (req_tx, req_rx) = mpsc::channel(64);

    // Event pump: SessionStart + ContextInit, then translate SSE events.
    let pump_client = conn.client.clone();
    let pump_protocol = conn.protocol;
    let pump_base = conn.base_url.clone();
    let pump_serve_sid = serve_sid.clone();
    let inner_sid = ctx.session_id.clone();
    let ctx_agent_id = ctx.agent_id.clone();
    let ctx_cwd = ctx.cwd.clone();
    let ctx_workspace_key = ctx.workspace_key();
    let ctx_project_name = ctx.project_name.clone();
    let ctx_env = ctx.env.clone();
    let ctx_skills = ctx.skills.clone();
    let ctx_files = ctx.files.clone();
    let ctx_mode = ctx.mode.clone();
    let model_id = ctx.model_id.clone();
    let pump_event_tx = event_tx.clone();
    let pump_model_id = model_id.clone();
    // `SessionStart` 的载荷是**快照**（那一刻的配置项），在包 Arc 之前取。
    let config_options_for_pump = config_state.to_options();
    // 状态跨 task 共享：pump 从 `session.step.started` 学到真实 agent/variant，
    // request loop 处理用户点选 —— 两者改的是同一份状态，必须共享。
    //
    // 用 `std::sync::Mutex`（不是 tokio）：持锁范围内**没有** `await`，
    // 与 `pending_forms` 同一理由。
    let config_state = Arc::new(std::sync::Mutex::new(config_state));
    let pump_config_state = Arc::clone(&config_state);
    tokio::spawn(async move {
        let _ = pump_event_tx
            .send(StreamEvent::SessionStart {
                session_id: inner_sid.clone(),
                agent: ctx_agent_id,
                model: pump_model_id,
                config_options: config_options_for_pump,
                capabilities: Capabilities::from_chat_capabilities(caps, false, false),
            })
            .await;
        let _ = pump_event_tx
            .send(StreamEvent::ContextInit {
                session_id: inner_sid.clone(),
                manifest: ContextManifest {
                    cwd: ctx_cwd.clone(),
                    project_name: ctx_project_name,
                    env: ctx_env,
                    skills: ctx_skills,
                    files: ctx_files,
                    mode: ctx_mode,
                    workspace_key: ctx_workspace_key,
                },
            })
            .await;
        run_event_pump(
            &pump_client,
            PumpTarget {
                protocol: pump_protocol,
                base_url: &pump_base,
                serve_sid: &pump_serve_sid,
                session_id: &inner_sid,
                directory: &ctx_cwd,
            },
            &conn.pending_forms,
            &pump_config_state,
            &pump_event_tx,
        )
        .await;
    });

    // Request channel: page → agent (approve / turn / input / cancel).
    let req_client = conn.client.clone();
    let req_base = conn.base_url.clone();
    let req_protocol = conn.protocol;
    let req_serve_sid = serve_sid.clone();
    let req_inner_sid = ctx.session_id.clone();
    let req_event_tx = event_tx.clone();
    let req_config_state = Arc::clone(&config_state);
    // question 回执按目录分片路由（`directory` 是必填 query 参数，实测缺失即 404）。
    let req_directory = ctx.cwd.clone();
    tokio::spawn(async move {
        // scope 在任务内构造：owned 的 base_url / directory 随闭包移入 'static 未来，
        // 借用才合法（与 run_event_pump 的调用点同形）。
        let scope = ServeScope {
            base_url: &req_base,
            protocol: req_protocol,
            directory: &req_directory,
            pending_forms: &conn.pending_forms,
        };
        run_request_loop(
            &req_client,
            scope,
            SessionIds {
                serve_sid: &req_serve_sid,
                session_id: &req_inner_sid,
            },
            &req_event_tx,
            model_id.clone(),
            LoopState {
                pending: PendingTurnOptions::default(),
                config: Arc::clone(&req_config_state),
            },
            req_rx,
        )
        .await;
    });

    Ok(Box::new(ServeSession {
        event_rx,
        request_tx: req_tx,
        resume: Some(serve_sid),
    }))
}

/// Page → agent request loop: approve / turn / input / cancel.
async fn run_request_loop(
    client: &reqwest::Client,
    scope: ServeScope<'_>,
    ids: SessionIds<'_>,
    event_tx: &mpsc::Sender<StreamEvent>,
    model_id: Option<String>,
    // 跨请求状态（per-prompt 选项 + 配置项快照）。
    // 由调用方构造 —— `config` 初值是 `create` / `resume` 探测来的完整选项列表，
    // 写成功后用它构造全量的 `ConfigOptionUpdate`（协议要求整体替换）。
    mut state: LoopState,
    mut req_rx: mpsc::Receiver<SessionRequest>,
) {
    let ServeScope {
        base_url,
        protocol,
        directory,
        pending_forms,
    } = scope;
    let SessionIds {
        serve_sid,
        session_id,
    } = ids;

    // V1 没有「立即改模式/档位」的通道 —— 两者都是 per-prompt 字段。
    // 所以点选时先记在这里，下一次 Turn 带上。
    //
    // V2 有真通道（`POST .../agent` / `POST .../model`），点选即写，
    // 这个状态只为 V1 与「V2 写失败时仍能在下一轮生效」而存在。
    while let Some(req) = req_rx.recv().await {
        match req {
            // 模型走 per-turn（每次 prompt 带 model），但**模式与思考等级**
            // 有各自的会话级通道，必须真的写下去：
            //
            // | configId | V1 | V2 |
            // | --- | --- | --- |
            // | `mode` | per-prompt `agent` 字段（记到本地，下一次 Turn 带上） | `POST .../agent` |
            // | `thought_level` | per-prompt `variant`（同上） | `POST .../model` 带 `variant` |
            //
            // 「显示了但点了没反应」比「不显示」更糟 —— 这两项既然列出来了，
            // 就必须有写通道。
            SessionRequest::SetConfigOption { config_id, value } => {
                handle_config_option(client, scope, ids, &config_id, &value, &mut state, event_tx)
                    .await;
            }
            SessionRequest::Approve { call_id, allow } => {
                let url = format!(
                    "{base_url}{}",
                    protocol.permission_reply_path(serve_sid, &call_id)
                );
                let body = permission_reply_body(protocol, allow);
                post_serve(
                    client,
                    &url,
                    Some(&body),
                    &format!("permission reply {call_id}"),
                )
                .await;
            }
            SessionRequest::Turn {
                prompt,
                model_id: turn_model_id,
            } => {
                // 本轮的模型优先；否则沿用会话初始模型（或 serve 默认）。
                let effective_model = turn_model_id.as_deref().or(model_id.as_deref());

                // ── 切模型前先刷新档位候选 ────────────────────────────────
                //
                // **顺序要紧**：`variants` 是模型属性（实测 133 个模型里 114 个有，
                // 且集合不同）。不先刷新就下发，会把旧模型的档位写给新模型 ——
                // 用户看到「切了模型，档位还是那几个」，选了静默失效。
                //
                // 这也是 `ConfigState::refresh_variants` 的消费点：它负责
                // 「当前值不在新候选里就回落第一个」。
                if let Some(m) = effective_model {
                    // 短路：模型没变就不发 HTTP（`/api/model` 有 133 条，
                    // 而 `Turn` 是热路径，绝大多数轮次模型没变）。
                    let needs = state
                        .config
                        .lock()
                        .map(|cfg| cfg.needs_variants_for(m))
                        .unwrap_or(false);
                    let fetched = if needs {
                        config_options::fetch_variants(client, protocol.models_path(), base_url, m)
                            .await
                    } else {
                        None
                    };
                    if let Some(variants) = fetched {
                        let changed = state
                            .config
                            .lock()
                            .map(|mut cfg| cfg.refresh_variants(variants, m))
                            .unwrap_or(false);
                        if changed {
                            // 候选值变了 → 回推，否则下拉仍列旧档位
                            let options = state
                                .config
                                .lock()
                                .map(|cfg| cfg.to_options())
                                .unwrap_or_default();
                            let _ = event_tx
                                .send(StreamEvent::ConfigOptionUpdate {
                                    session_id: session_id.into(),
                                    config_options: options,
                                })
                                .await;
                        }
                    }
                }

                // V2 的 prompt **不带** model（实测被静默忽略），切模型必须走
                // 独立端点。这是「显示了但不起作用」类故障的典型：
                // 传了 model 不报错，但模型没换。
                if protocol == ServeProtocol::V2 {
                    if let Some(m) = effective_model {
                        let (provider, bare) = model_slug_split(m);
                        if !provider.is_empty() {
                            let url =
                                format!("{base_url}{}", protocol.model_switch_path(serve_sid));
                            // 档位是 `Model.Ref.variant`，必须与模型一起下发 ——
                            // 单独调 `/model` 会把 variant 清空。
                            //
                            // 用刷新后的状态里的 variant（不是 pending 的）：
                            // 新模型不支持旧档位时，`refresh_variants` 已回落。
                            let variant =
                                state.config.lock().ok().and_then(|cfg| cfg.variant.clone());
                            let body = model_switch_body_with_variant(
                                &provider,
                                &bare,
                                variant.as_deref(),
                            );
                            post_serve(
                                client,
                                &url,
                                Some(&body),
                                &format!("switch model {provider}/{bare}"),
                            )
                            .await;
                        }
                    }
                }

                let url = format!("{base_url}{}", protocol.prompt_path(serve_sid));
                // V1 的 agent / variant 只能随 prompt 下发（见 `PendingTurnOptions`）。
                let body = prompt_body_with_options(
                    protocol,
                    &prompt,
                    effective_model,
                    state.pending.agent.as_deref(),
                    state.pending.variant.as_deref(),
                );
                post_serve(client, &url, Some(&body), "prompt").await;
            }
            SessionRequest::Input { turn_id, prompt } => {
                // 提问回执（`que_…` id，见 translate_question_asked）走 question 专用端点。
                // 权限门（allow/deny）与提问（答案文本）是两套协议、两个路由，不可混用。
                if turn_id.starts_with("que_") || turn_id.starts_with("frm_") {
                    let url =
                        question_reply_url_for(protocol, base_url, directory, serve_sid, &turn_id);
                    // V2 的回执要按 `fields[].key` 映射；Neeko 的 UserInput 只带
                    // 一个问题文本，所以字段 key 用 `q0`（与 2.0 的默认命名一致），
                    // 取不到时回退到空 key —— 服务端会以 unknown field 拒绝，
                    // 但那比静默丢弃容易查。
                    let field_key = pending_form_field_key(pending_forms, &turn_id);
                    let body = question_reply_body(protocol, &field_key, &prompt);
                    post_serve(
                        client,
                        &url,
                        Some(&body),
                        &format!("question reply {turn_id}"),
                    )
                    .await;
                } else {
                    let url = format!("{base_url}{}", protocol.prompt_path(serve_sid));
                    let body = prompt_body_for(protocol, &prompt, model_id.as_deref());
                    post_serve(client, &url, Some(&body), "prompt (input)").await;
                }
            }
            SessionRequest::Cancel => {
                // abort 无请求体；同样必须校验响应 —— 静默失败时前端已显示「已停止」
                // 但 serve 侧模型仍在跑并继续计费。
                let url = format!("{base_url}{}", protocol.abort_path(serve_sid));
                post_serve(client, &url, None, "abort").await;
                let _ = event_tx
                    .send(StreamEvent::SessionDone {
                        session_id: session_id.into(),
                        reason: DoneReason::Cancelled,
                    })
                    .await;
                // **不得 break**：一次取消不是会话结束。这里 break 会让循环永久
                // 退出，此后 SetConfigOption（模式 / 思考等级）、Approve、
                // 以及下一轮 Turn 全部无处投递 —— 表现是「控件在，点了没反应」，
                // 而且没有任何错误日志（request_tx 的另一端已 drop）。
                //
                // 2026-10-23 真实故障。对照 Pi 的 Cancel：只发 abort 并继续。
                // 会话真正结束由 `agent_chat_close` / manager 回收负责，不靠这里。
            }
            SessionRequest::ContextSet { .. } | SessionRequest::Pause | SessionRequest::Resume => {
                // serve has no mid-session context rebind / pause; ignored (page keeps state).
            }
        }
    }
}

/// 提问回执 URL，按协议分叉。
///
/// | 版本 | 形状 | directory |
/// | --- | --- | --- |
/// | V1 | `/question/{rid}/reply?directory=` | **必填**（serve 按目录分片路由，缺失即 404） |
/// | V2 | `/api/session/{sid}/form/{fid}/reply` | 不需要（会话已绑定目录） |
fn question_reply_url_for(
    protocol: ServeProtocol,
    base_url: &str,
    directory: &str,
    serve_sid: &str,
    request_id: &str,
) -> String {
    match protocol {
        ServeProtocol::V1 => question_reply_url(base_url, directory, request_id),
        ServeProtocol::V2 => format!(
            "{base_url}{}",
            protocol.question_reply_path(serve_sid, request_id)
        ),
    }
}

/// 取 V2 提问回执的字段 key（由 pump 在 `form.created` 时登记）。
///
/// 取不到时回退 `"q0"` —— 2.0 的默认字段命名就是 `q0`。宁可让服务端以
/// `unknown field` 拒绝（有日志、可查），也不要静默不发（用户点了提交却毫无反应）。
fn pending_form_field_key(
    conn_forms: &std::sync::Mutex<std::collections::HashMap<String, String>>,
    form_id: &str,
) -> String {
    conn_forms
        .lock()
        .ok()
        .and_then(|m| m.get(form_id).cloned())
        .unwrap_or_else(|| "q0".to_string())
}

/// V1 的 per-prompt 选项：模式与思考等级都只能随下一轮 prompt 下发。
///
/// V1 没有「立即改模式」的端点（2.0 才有 `POST .../agent`），也没有独立切档位
/// 的端点（档位是 `Model.Ref.variant`，V1 的模型本身也是 per-prompt）。
/// 所以点选后必须记住，等下一轮带上 —— 否则用户点了没反应。
#[derive(Debug, Default)]
struct PendingTurnOptions {
    agent: Option<String>,
    variant: Option<String>,
}

/// 一个会话的两个身份：serve 侧 id 与 Neeko 侧 id。
///
/// 合成一个参数而不是两个：它们在这个文件里**总是一起出现**（写通道要前者拼
/// URL、要后者填 `StreamEvent`），分开传既有「传错顺序」的风险，也让
/// `handle_config_option` 超出 clippy 的 7 参数上限。
#[derive(Clone, Copy)]
pub(super) struct SessionIds<'a> {
    serve_sid: &'a str,
    session_id: &'a str,
}

/// 请求循环里需要**跨请求**保留的会话状态。
///
/// 合成一个结构而不是散成多个参数：`run_request_loop` 已有 7 个参数（clippy 上限），
/// 而这些状态共同回答「这个会话现在是什么状态」，本来就该在一起。
pub(super) struct LoopState {
    /// V1 的 per-prompt 选项（下一轮 Turn 带上）。
    pending: PendingTurnOptions,
    /// 配置项状态（agent / variant / 档位候选）。
    ///
    /// **唯一真相**，且与 pump task 共享：写通道改它、
    /// `session.step.started` 校正它、回推时由它重建全量载荷
    /// （`ConfigState::to_options`）。不再单独存一份 `Vec<SessionConfigOption>`
    /// —— 两份必然漂移。
    config: Arc<std::sync::Mutex<ConfigState>>,
}

/// 处理 `SetConfigOption`：模式与思考等级各有各的通道。
///
/// # 写成功后必须回推 `ConfigOptionUpdate`
///
/// serve 没有配置项推送机制（不像 ACP 会发 `config_option_update`），而前端
/// `useSessionConfigOptions` 只在该事件里 `replace()`。不回推的话 `currentValue`
/// 永远停在握手时的值 —— 用户选 plan、下拉仍显示 build，表现是「根本切换不了」，
/// 而后端其实已经切了（2026-10-23 真实故障）。
///
/// 载荷是**全量**：协议要求整体替换，所以保留原始选项集合、只改被写那一项的
/// `currentValue`。
async fn handle_config_option(
    client: &reqwest::Client,
    scope: ServeScope<'_>,
    ids: SessionIds<'_>,
    config_id: &str,
    value: &SessionConfigValue,
    state: &mut LoopState,
    event_tx: &mpsc::Sender<StreamEvent>,
) {
    let text = match value {
        SessionConfigValue::Text(t) => t.as_str(),
        // 这两项都是 select；boolean 形态不适用。
        SessionConfigValue::Flag(_) => return,
    };
    let ServeScope {
        base_url, protocol, ..
    } = scope;
    let SessionIds {
        serve_sid,
        session_id,
    } = ids;
    // ── 1. 解析成类型化的配置项 ────────────────────────────────────────
    //
    // `kind_of` 返回 `None` = 这个 configId 不属于本模块（例如 ACP 的
    // `model_config` 项）。直接返回，**不 panic** —— 调用方是通用 UI，
    // 它不知道各传输的能力差异。
    let Some(kind) = ConfigState::kind_of(config_id) else {
        log::debug!("[ServeAdapter] unknown config option '{config_id}' ignored");
        return;
    };

    // ── 2. 更新状态并取走快照 ──────────────────────────────────────────
    //
    // 锁在 `apply` + `to_options` 之间不释放（两者必须看同一份状态），
    // 但必须在**任何 `await` 之前 drop** —— `MutexGuard` 不是 `Send`，
    // 跨 await 持锁既过不了编译（红线：禁止跨 await 持锁），也会阻塞 pump task。
    //
    // 顺手取走当前 model：`ThoughtLevel` 的 V2 即时写需要它。
    let (options, current_model) = {
        let Ok(mut cfg) = state.config.lock() else {
            log::warn!("[ServeAdapter] config state poisoned; skipping update");
            return;
        };
        cfg.apply(kind, text);
        (cfg.to_options(), cfg.model.clone())
    };

    // ── 3. 按协议写真实通道 ────────────────────────────────────────────
    //
    // `match` 的是**枚举**，不是 `&str`：新增配置项时编译器会指出这里未处理。
    //
    // | kind | V1 | V2 |
    // | --- | --- | --- |
    // | `Mode` | 随下一轮 prompt 的 `agent` 字段 | `POST .../agent`（立即） |
    // | `ThoughtLevel` | 随下一轮 prompt 的 `model.variant` | `POST .../model` 带 variant（立即） |
    match kind {
        ConfigKind::Mode => {
            if protocol == ServeProtocol::V2 {
                let url = format!("{base_url}{}", protocol.agent_switch_path(serve_sid));
                let body = serde_json::json!({ "agent": text });
                post_serve(client, &url, Some(&body), &format!("switch agent {text}")).await;
            }
            // 两版都记下：下一轮 prompt 也带上 `agent`（2.0 只是优先用会话状态）。
            state.pending.agent = Some(text.to_string());
        }
        ConfigKind::ThoughtLevel => {
            // V2：**立即生效**。档位是 `Model.Ref.variant`，必须连模型一起
            // `POST .../model`（没有「只改档位」的端点）。
            //
            // 实测（2.0.32）：同模型只改 variant 返回 204，下一轮
            // `step.started.model.variant` 立即是新值。
            // 原实现误以为「只能等下次切模型」，于是用户点档位后不发任何请求。
            if protocol == ServeProtocol::V2 {
                match current_model.as_deref() {
                    Some(model) if !model.is_empty() => {
                        let (provider, bare) = model_slug_split(model);
                        if !provider.is_empty() {
                            let url =
                                format!("{base_url}{}", protocol.model_switch_path(serve_sid));
                            let body = model_switch_body_with_variant(&provider, &bare, Some(text));
                            post_serve(
                                client,
                                &url,
                                Some(&body),
                                &format!("switch level {text} on {provider}/{bare}"),
                            )
                            .await;
                        }
                    }
                    // 不知道当前模型 → 只能记下来等下一轮。不该发生
                    //（`probe_config_state` 总会带上 ctx.model_id），但要留痕。
                    _ => log::warn!(
                        "[ServeAdapter] thinking level '{text}' deferred: current model unknown"
                    ),
                }
            }
            // V1：没有独立端点，只能随下一轮 prompt 的 `model.variant` 下发。
            state.pending.variant = Some(text.to_string());
        }
    }

    // 回推：前端 `useSessionConfigOptions` 只认 `config_option_update`，
    // 不回推则 `currentValue` 永远停在握手时的值 —— 用户选 plan、下拉仍显示
    // build，表现是「根本切换不了」（2026-10-23 真实故障）。
    //
    // 载荷是**全量**（协议要求整体替换），由 `to_options()` 从状态重建 ——
    // 单一构造入口，避免「options 与 currentValue 来自不同快照」。
    let _ = event_tx
        .send(StreamEvent::ConfigOptionUpdate {
            session_id: session_id.into(),
            config_options: options,
        })
        .await;
}
