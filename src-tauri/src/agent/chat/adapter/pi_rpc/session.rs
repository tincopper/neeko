//! Pi rpc 会话：握手、事件泵、请求分派。
//!
//! # 三层职责
//!
//! ```text
//! process.rs   进程 I/O + 响应配对（不认识 StreamEvent）
//! translate.rs 单条事件 → StreamEvent（纯函数，无状态）
//! session.rs   状态（ConfigOptionsState）+ 握手 + 请求分派（本文件）
//! ```
//!
//! 状态放这里的理由：`configOptions` 是**会话状态**而不是一次性载荷（见
//! `session_config.rs` 的 `ConfigOptionsState` 文档）。进程层不该知道它，
//! 翻译层是纯函数不能持有它 —— 只有会话层同时需要「读它来判断要不要发命令」
//! 与「写它来保持与 pi 的真实状态一致」。

use std::collections::VecDeque;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use tokio::sync::mpsc;

use async_trait::async_trait;
use serde_json::{json, Value};

use super::config::{
    levels_from_response, models_from_response, project_config_options, CurrentSelection,
    MODEL_CONFIG_ID, THINKING_LEVEL_CONFIG_ID,
};
use super::process::PiRpcProcess;
use super::translate::{self, ApprovalKind};
use crate::agent::chat::adapter::session_config::{
    current_model_from_config, ConfigOptionsState, SessionConfigValue,
};
use crate::agent::chat::adapter::{AgentContext, AgentSession};
use crate::agent::chat::capabilities::ChatCapabilities;
use crate::agent::chat::events::{
    Capabilities, ContextManifest, SessionRequest, StreamEvent, TurnEndReason, Usage,
};
use crate::common::agent::types::ModelInfo;
use crate::common::error::AppError;

/// `get_session_stats` 的专用超时。
///
/// 刻意短于 `process::AUX_TIMEOUT`（5s）：stats 拉取是**best-effort 遥测**，
/// 且落在事件空闲窗口（见 [`PiSession::next`]）—— 用户在空档期发出下一条
/// 消息时，新话轮的流式事件要排队等这次 RPC 落幕，旧版 pi 对未知命令不回应
/// 的场景下 5s 会把新回合首字拖到不可接受；2s 上限把损害框在该窗口内。
const STATS_TIMEOUT: Duration = Duration::from_secs(2);

/// 一条 pi 会话。
pub struct PiSession {
    /// 进程连接。`Arc` 共享给请求 pump —— `request_channel()` 签名是 `&self`，
    /// 拿不到 `&mut self`，所以处理请求的代码必须在独立 task 里跑。
    proc: Arc<PiRpcProcess>,
    /// 事件流（从 `proc` **取走**，由本会话独占）。
    ///
    /// 不放在 `proc` 里对共享消费者持有：事件是单消费者资源，独占后就无需
    /// 任何锁、也不会与 pump task 抢。`None` = 流已关闭。
    events: Option<mpsc::Receiver<Value>>,
    session_id: String,
    /// pi 自己的会话 id（`get_state.sessionId`）。
    ///
    /// 用于 `resume_id()` —— `conversation/adapters/pi.rs` 的 `resume_command`
    /// 已经能把它拼成 `pi --session <id>`，缺的只是 chat 侧把它暴露出来。
    native_session_id: Option<String>,
    /// 待回答的审批：`extension_ui_request.id` → 它的回答形状。
    ///
    /// 存在的理由：`Approve { call_id, allow }` 只有一个布尔，而要回写的字段名
    /// 取决于是 `confirm`（`confirmed`）还是 `select`（`value`）。这个形状只在
    /// 请求本身里，`allow` 带不过来 —— 必须在发出审批时记下。
    pending_approvals: Arc<StdMutex<std::collections::HashMap<String, ApprovalKind>>>,
    /// 会话配置状态（与请求 pump 共享）。
    ///
    /// `next()` 需要从中读**当前模型**（`get_session_stats` 的响应里没有模型名，
    /// `Meta.model` 只能取这份共享状态 —— pump 切完模型会 `replace` 它，所以
    /// 这里读到的一直是新鲜值）。
    configs: Arc<ConfigOptionsState>,
    /// **本轮是否已报过错误**（跨事件事实，`absorb` 维护，`agent_settled` 消费）。
    ///
    /// 为什么不能放在 `translate`：它是纯函数，只看得到一条 pi 事件；而失败与
    /// 终止是**两条**事件（`turn_end{stopReason:error}` → `Error`，随后
    /// `agent_settled` → `TurnEnd`）。
    ///
    /// 不记这个事实的后果：失败轮先报「会话异常终止」，紧接着 settle 又报
    /// 「任务完成」—— `notify.rs` 明确要求二者互斥（`TurnEnd{error}` 留给
    /// Error / SessionDone 事件，避免双发）。
    turn_failed: bool,
    /// **待拉的会话统计**（`agent_settled` 置位，空闲窗口消费）。
    ///
    /// 为什么不就地拉取：`agent_settled` 的翻译分支里 TurnEnd 刚入队，就地
    /// `await` 会让它的交付串行等一次遥测 RPC —— 必要数据（回合终点，延迟
    /// 敏感）被可选数据（usage，可慢）阻塞。置位后由下一次 `next()` 在
    /// `pending` 排空、即将阻塞读进程时拉取，延迟落在回合间空档，对用户不可见。
    stats_pull_pending: bool,
    /// 已就绪、待 `next()` 取走的事件队列。
    ///
    /// **两个生产者**：
    /// 1. 握手期：`SessionStart` + `ContextInit`（`start_with` 里 push）；
    /// 2. 运行期：`translate` 的输出（可能是 0..n 条）、以及 `refresh_configs`
    ///    产生的 `ConfigOptionUpdate`。
    ///
    /// 用队列而不是单槽：`next()` 一次只能返回一个，而上面任一路径都可能
    /// 一次产出多条。多生产者 + 单消费者的形状决定了必须有缓冲。
    ///
    /// 注意：当前 `translate` 对每条 pi 事件的映射都是 ≤1 条 `StreamEvent`
    /// （`text_delta` / `thinking_delta` / `agent_settled` 各 1，其余 0）。
    /// 所以「一次产出多条」今天只在 `start` 与 `refresh_configs` 里发生。
    /// 一旦二期补上「同一条 pi 事件既产出 `TurnEnd` 又产出 `ConfigOptionUpdate`」，
    /// 队列的存在就是正确性的必要条件（ACP 那边已是这个形状）。
    pending: VecDeque<StreamEvent>,
    /// pump 产出的额外事件（`ConfigOptionUpdate` / 请求失败）。
    ///
    /// 单独一条通道而不是直接写 `pending`：`pending` 归 `&mut self` 所有，
    /// pump 拿不到；而这两类事件必须能被 `next()` 交付给前端。
    ///
    /// `Option` 包一层是为了表达「pump 已退出」：`recv()` 返回 `None` 之后
    /// **必须把这个分支从 `select!` 里摘掉**，否则下一轮它立刻又就绪，形成
    /// 忙自旋（CPU 满转且永远轮不到进程事件流）。
    request_events: Option<mpsc::Receiver<StreamEvent>>,
    /// 页面 → 会话的请求通道。
    ///
    /// **没有它多轮对话就不成立**：`spawn_session_pipeline` 只在
    /// `request_channel()` 返回 `Some` 时把会话注册进 `AgentChatManager`，
    /// 而 `agent_stream` 的续聊分支靠 `manager.owns()` 判断。返回 `None`
    /// 会让每次发消息都 `create()` 一个新会话 —— 新会话握手后从不发 prompt，
    /// 前端就永远停在 thinking。
    request_tx: mpsc::Sender<SessionRequest>,
}

impl PiSession {
    /// 握手 + 事件队列初始化 + 请求 pump 启动。
    ///
    /// 与 spawn 拆开（spawn 在 `PiRpcAdapter::spawn_process`）是为了让测试注入假连接
    /// —— 否则测试只能复制一遍握手逻辑，实现被改坏时测试仍绿（本项目已踩过这个坑）。
    pub async fn start_with(
        proc: PiRpcProcess,
        ctx: &AgentContext,
        caps: ChatCapabilities,
    ) -> Result<Self, AppError> {
        // 握手失败时附上 pi 自己的 stderr 尾部（如 `No session found matching '<id>'`）
        // —— 否则用户只会看到一句「超时」或「响应通道关闭」，而真实原因就在 stderr 里。
        let Handshake {
            models,
            levels,
            current,
            native_session_id,
        } = match handshake(&proc).await {
            Ok(hs) => hs,
            Err(e) => return Err(proc.annotate(e).await),
        };

        let configs = Arc::new(ConfigOptionsState::new(project_config_options(
            &models,
            &levels,
            Some(&current),
        )));
        let pending_approvals = Arc::new(StdMutex::new(std::collections::HashMap::new()));
        // 事件流先取走：握手已用完 response 通道，后续全由会话消费。
        let events = proc.take_events().ok_or_else(|| {
            AppError::Agent("pi-rpc: event stream already taken by another consumer".into())
        })?;
        let proc = Arc::new(proc);

        // ── 首轮 prompt ────────────────────────────────────────────────
        //
        // `agent_stream` 首次调用把用户的 prompt 放在 `ctx.prompt` 里，期望
        // `create()` 内部消费 —— ACP（`acp.rs:631`）与 DeepSeek
        //（`deepseek.rs:109`）都在这一步发首轮。
        //
        // 不在这里发，首条消息就此丢失：`agent_stream` 只在**续聊**分支
        //（`session_id` 非空）走 `manager.send()`；新建会话时它不做第二次派发。
        // 表现是「发了消息、界面停在 thinking、pi 侧从未收到 prompt」。
        if !ctx.prompt.is_empty() {
            proc.send(json!({"type": "prompt", "message": ctx.prompt}))
                .await?;
        }

        let mut pending = VecDeque::new();
        // 生命周期事件由适配器立即发（与 agent 自身输出无关），与 ACP 同契约。
        pending.push_back(StreamEvent::SessionStart {
            session_id: ctx.session_id.clone(),
            agent: ctx.agent_id.clone(),
            model: current.model_id.clone(),
            config_options: configs.snapshot(),
            // 由能力快照派生（`PiRpcAdapter::chat_capabilities`）：
            // `select`/`confirm` → 审批；`get_state.sessionId` → resume。
            // 传入的快照来自适配器，握手阶段拿不到 `&self`，故名由调用方透传。
            capabilities: Capabilities::from_chat_capabilities(caps, false, false),
        });
        pending.push_back(StreamEvent::ContextInit {
            session_id: ctx.session_id.clone(),
            manifest: ContextManifest {
                project_id: ctx.project_id.clone(),
                project_name: ctx.project_name.clone(),
                env: ctx.env.clone(),
                skills: ctx.skills.clone(),
                files: ctx.files.clone(),
                mode: ctx.mode.clone(),
            },
        });

        // ── 请求 pump ──────────────────────────────────────────────────
        //
        // 与 `DeepSeekHarnessAdapter` 同构：同一份会话状态用 `Arc` 共享给
        // 独立 task，于是 manager 路由进来的请求（`Turn` / `Approve` /
        // `SetConfigOption`）与 `send()` 走同一套处理，不会各自看到半张状态。
        let (request_tx, mut request_rx) = mpsc::channel::<SessionRequest>(64);
        let (out_tx, request_events) = mpsc::channel::<StreamEvent>(64);
        {
            let proc = Arc::clone(&proc);
            let configs = Arc::clone(&configs);
            let approvals = Arc::clone(&pending_approvals);
            let sid = ctx.session_id.clone();
            tokio::spawn(async move {
                while let Some(req) = request_rx.recv().await {
                    let result = handle_request(&proc, &configs, &approvals, &sid, req).await;
                    let events = match result {
                        Ok(events) => events,
                        Err(e) => {
                            log::warn!("[pi-rpc] request failed: {e}");
                            vec![StreamEvent::Error {
                                session_id: sid.clone(),
                                kind: crate::agent::chat::events::ErrorKind::Agent,
                                code: "E_REQUEST".into(),
                                message: e.to_string(),
                            }]
                        }
                    };
                    for ev in events {
                        if out_tx.send(ev).await.is_err() {
                            return;
                        }
                    }
                }
            });
        }

        Ok(Self {
            proc,
            events: Some(events),
            session_id: ctx.session_id.clone(),
            native_session_id,
            pending_approvals,
            configs,
            turn_failed: false,
            stats_pull_pending: false,
            pending,
            request_events: Some(request_events),
            request_tx,
        })
    }
}

/// 握手结果：三份会话级查询的产物（模型 / 档位 / 当前选择 + pi 自己的会话 id）。
///
/// 抽成结构体只为了让 [`handshake`] 能把它们一次交付出去 —— 不引入任何行为。
struct Handshake {
    models: Vec<ModelInfo>,
    levels: Vec<String>,
    current: CurrentSelection,
    /// `get_state.sessionId` —— pi 自己回报的权威会话 id。
    native_session_id: Option<String>,
}

/// 三段握手查询（**纯 I/O 序列**，不持有状态）。
///
/// 抽成自由函数是为了让 [`PiSession::start_with`] 的 `map_err(annotate)` 只写一次，
/// 且测试可以拿假连接直测失败路径（`from_split_with_stderr`）。
async fn handshake(proc: &PiRpcProcess) -> Result<Handshake, AppError> {
    let data = proc
        .request(json!({"type": "get_available_models"}), None)
        .await?;
    let models = models_from_response(&data);

    let data = proc
        .request(json!({"type": "get_available_thinking_levels"}), None)
        .await?;
    let levels = levels_from_response(&data);

    let data = proc.request(json!({"type": "get_state"}), None).await?;
    Ok(Handshake {
        models,
        levels,
        current: CurrentSelection::from_state(&data),
        native_session_id: data
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// 处理一条页面 → 会话的请求，返回要交给前端的额外事件。
///
/// 抽成自由函数（而非 `&mut self` 方法）：pump 在独立 task 里跑，
/// 只拿得到 `Arc` 共享的状态。
async fn handle_request(
    proc: &Arc<PiRpcProcess>,
    configs: &Arc<ConfigOptionsState>,
    approvals: &Arc<StdMutex<std::collections::HashMap<String, ApprovalKind>>>,
    session_id: &str,
    req: SessionRequest,
) -> Result<Vec<StreamEvent>, AppError> {
    match req {
        // 不等响应：完成由 `agent_settled` 事件决定（见 translate.rs）。
        SessionRequest::Turn { prompt, model_id } => {
            // **先切模型，再发 prompt** —— 与 ACP 同契约（`acp.rs:341`）。
            //
            // `prompt` 没有 model 参数，所以「本轮换模型」只能是两步。
            // 忽略 `model_id` 会让用户选的模型静默失效：pi 用默认模型跑完这一轮，
            // 会话内 `configOptions` 回报的当前值是**真实**那个 —— 于是前端看到
            // 列表与选择都「变了」，看起来像数据不一致。
            let mut events = Vec::new();
            if let Some(model_id) = model_id {
                match set_model(proc, configs, session_id, &model_id).await {
                    Ok(evs) => events = evs,
                    // 切模型失败**不阻断本轮**：历史遗留的 `provider/model` 复合串
                    // 与 `set_model` 认的裸 id 不同源；真没法用的时候退回当前模型
                    // 继续跑，比让用户「发消息直接报错」更有用。但**必须告知**：
                    // 否则用户看到的是「选了模型却没用」，而 UI 上什么都没有。
                    Err(e) => {
                        log::warn!(
                            "[pi-rpc] cannot switch to model '{model_id}', keeping current: {e}"
                        );
                        events.push(StreamEvent::Error {
                            session_id: session_id.to_string(),
                            kind: crate::agent::chat::events::ErrorKind::Agent,
                            code: "E_MODEL_NOT_APPLIED".into(),
                            message: format!(
                                "模型 '{model_id}' 未生效，本轮沿用会话当前模型（{e}）"
                            ),
                        });
                    }
                }
            }
            proc.send(json!({"type": "prompt", "message": prompt}))
                .await?;
            Ok(events)
        }
        SessionRequest::Cancel => {
            proc.send(json!({"type": "abort"})).await?;
            Ok(Vec::new())
        }
        SessionRequest::SetConfigOption { config_id, value } => {
            apply_config_option(proc, configs, session_id, &config_id, &value).await
        }
        SessionRequest::Approve { call_id, allow } => {
            answer_ui_request(proc, approvals, &call_id, allow).await?;
            Ok(Vec::new())
        }
        // 其余请求在 Pi rpc 里没有对应动作。静默忽略而非报错 —— 调用方是通用
        // UI，它不知道各传输的能力差异，报错会变成「点了没用还弹错」。
        _ => Ok(Vec::new()),
    }
}

/// 把 `SetConfigOption` 翻成 pi 的具体命令。
async fn apply_config_option(
    proc: &Arc<PiRpcProcess>,
    configs: &Arc<ConfigOptionsState>,
    session_id: &str,
    config_id: &str,
    value: &SessionConfigValue,
) -> Result<Vec<StreamEvent>, AppError> {
    match config_id {
        MODEL_CONFIG_ID => {
            let Some(model_id) = value.as_text() else {
                return Err(AppError::InvalidInput(
                    "pi-rpc: model option expects a string".into(),
                ));
            };
            set_model(proc, configs, session_id, model_id).await
        }
        THINKING_LEVEL_CONFIG_ID => {
            let Some(level) = value.as_text() else {
                return Err(AppError::InvalidInput(
                    "pi-rpc: thinking level expects a string".into(),
                ));
            };
            proc.send(json!({"type": "set_thinking_level", "level": level}))
                .await?;
            refresh_configs(proc, configs, session_id).await
        }
        other => {
            // 未知配置项静默忽略：调用方（通用 UI）并不知道各传输的能力差异。
            log::debug!("[pi-rpc] unknown config option: {other}");
            Ok(Vec::new())
        }
    }
}

/// 切模型：先用当前状态判定「是否已经是要切的值」，再回查 provider。
async fn set_model(
    proc: &Arc<PiRpcProcess>,
    configs: &Arc<ConfigOptionsState>,
    session_id: &str,
    model_id: &str,
) -> Result<Vec<StreamEvent>, AppError> {
    // 已是当前值 → 不发。与 ACP 的 `ModelSwitch::AlreadySet` 同一判据，
    // 避免每次进会话都多一次无意义的往返。
    if current_model_from_config(&configs.snapshot()).as_deref() == Some(model_id) {
        return Ok(Vec::new());
    }

    // pi 的 `set_model` 要求 provider 与 modelId 分开传，而 provider 是模型
    // 条目的字段（不是从 id 里拆出来的 —— 实测 id 可能带 `/`，如 `auto/x`）。
    // `provider_of` 同时把会话外的复合串翻译成裸 id。
    let (provider, bare_id) = provider_of(proc, model_id).await?;
    proc.send(json!({"type": "set_model", "provider": provider, "modelId": bare_id}))
        .await?;
    refresh_configs(proc, configs, session_id).await
}

/// 从可用模型列表回查 provider。
///
/// # 两套 id 命名空间
///
/// | 来源 | 形态 | 例子 |
/// | --- | --- | --- |
/// | 会话内 `configOptions` / rpc 列表 | 裸 id | `deepseek-flash` |
/// | 历史遗留（旧版 tab 持久化、旧会话记录） | `provider/model` | `ark-coding-plan/ark-code-latest` |
///
/// 第一行是当下的**唯一活来源**。第二行不再是活列表 —— `pi --list-models`
/// 的表格解析器已删除（它的复合串 id 写不回去），但用户机器上可能还存着旧版
/// 持久化的 `modelId`，所以这条翻译路径必须留着。
///
/// 这里统一把复合串翻译成裸 id —— 翻译放在**唯一的回查入口**，而不是让每个
/// 调用方自己拆（拆法不一致就是静默失效）。
///
/// 注意不能用 `split('/')` 取第一段当 provider：实测存在 `auto/x` 这种
/// **带 `/` 的裸 id**（provider 是 `magpie`）。所以只能按「整串命中 → 拆尾段命中」
/// 的顺序在真实列表里试，不能从字符串形状推断。
async fn provider_of(
    proc: &Arc<PiRpcProcess>,
    model_id: &str,
) -> Result<(String, String), AppError> {
    let data = proc
        .request(json!({"type": "get_available_models"}), None)
        .await?;
    let models = data
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::InvalidInput("pi-rpc: get_available_models returned no list".into())
        })?;

    let find = |candidate: &str| {
        models
            .iter()
            .find(|m| m.get("id").and_then(Value::as_str) == Some(candidate))
    };

    // ① 整串命中（会话内裸 id，包括 `auto/x` 这种自带 `/` 的）
    // ② 拆尾段命中（`provider/model` 复合串）；只在①失败时试，避免把 `auto/x`
    //    误拆成 provider=`auto` / model=`x`。
    let bare = [
        Some(model_id),
        model_id.rsplit_once('/').map(|(_, tail)| tail),
    ]
    .into_iter()
    .flatten()
    .find_map(|candidate| find(candidate).map(|m| (candidate, m)));

    let Some((bare_id, entry)) = bare else {
        return Err(AppError::InvalidInput(format!(
            "pi-rpc: model '{model_id}' is not in the agent's model list"
        )));
    };
    let provider = entry
        .get("provider")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::InvalidInput(format!("pi-rpc: model '{bare_id}' has no provider field"))
        })?;
    Ok((provider.to_string(), bare_id.to_string()))
}

/// 回答一个 `extension_ui_request`。
///
/// pi 没有「审批专用」方法 —— 审批体现为 `select`（选项列表）与 `confirm`
/// （是/否）。两者用**同一个响应信封**，但字段不同：
///
/// | 请求 method | 响应 |
/// | --- | --- |
/// | `select` | `{ id, value: "<选中项>" }`，取消用 `{ id, cancelled: true }` |
/// | `confirm` | `{ id, confirmed: bool }` |
///
/// Neeko 的 `Approve { allow: bool }` 只有一个布尔，而 `select` 可能有多个
/// 非布尔选项。取舍：**allow 走 `select` 的第一项**，拒绝一律 `cancelled`。
async fn answer_ui_request(
    proc: &Arc<PiRpcProcess>,
    approvals: &Arc<StdMutex<std::collections::HashMap<String, ApprovalKind>>>,
    request_id: &str,
    allow: bool,
) -> Result<(), AppError> {
    // 该请求是 `confirm` 还是 `select`？由我们缓存的形状决定。
    // 缓存不存在说明这条审批已被回答过、或根本不是审批 —— 静默忽略，
    // 因为重复回答会让 pi 侧收到一个无法匹配的响应。
    let kind = approvals.lock().ok().and_then(|mut m| m.remove(request_id));
    let Some(kind) = kind else {
        log::debug!("[pi-rpc] approve for unknown request {request_id}, ignoring");
        return Ok(());
    };

    // 字段名由请求形状决定（pi 没有统一的审批信封）：
    // - `confirm` → `{confirmed: bool}`，拒绝就是 `false`（pi-acp 同样如此）；
    // - `select`   → `{value: "<选中项>"}`，拒绝用 `cancelled`。
    //
    // **不能**把 confirm 的拒绝也写成 `cancelled`：pi 把 `cancelled` 读作
    // 「用户关掉了弹窗、没做选择」，与「明确拒绝」是两种状态。
    let response = match (kind, allow) {
        (ApprovalKind::Confirm, allow) => json!({
            "type": "extension_ui_response",
            "id": request_id,
            "confirmed": allow,
        }),
        (ApprovalKind::Select { first_option }, true) => json!({
            "type": "extension_ui_response",
            "id": request_id,
            "value": first_option,
        }),
        // `select` 的拒绝：没有「否」的语义槽位，只能整体取消。
        (ApprovalKind::Select { .. }, false) => json!({
            "type": "extension_ui_response",
            "id": request_id,
            "cancelled": true,
        }),
    };

    proc.send(response).await
}

/// `get_session_stats` 的 `data` → `Meta` 事件（纯函数，单独可测）。
///
/// 字段映射（pi docs `rpc-commands.md` §get_session_stats）：
///
/// | pi 字段 | `Usage` 字段 |
/// | --- | --- |
/// | `contextUsage.tokens` | `context_tokens`（当前占用估计） |
/// | `contextUsage.contextWindow` | `context_limit` |
/// | `tokens.input` / `output` | `input_tokens` / `output_tokens`（会话累计） |
/// | `tokens.cacheRead` / `cacheWrite` | `cache_read_tokens` / `cache_write_tokens` |
///
/// - `tokens` 缺失 → `None`：没有任何 token 计数的 stats 不值得发一条空 Meta。
/// - `contextUsage` 整体缺失仍产出 Meta（pi 在无模型/无窗口信息时省略它）。
/// - `contextUsage.tokens` / `percent` 为 `null` 是 compaction 后的正常降级
///   （到新 assistant 响应前 pi 给不出估计）—— `as_u64` 把 `null` 当缺失，
///   正好是要的语义。
/// - `percent` 不复用：前端自算百分比（单一真相，舍入口径不漂移）。
fn meta_from_stats(session_id: &str, model: &str, data: &Value) -> Option<StreamEvent> {
    let tokens = data.get("tokens")?;
    let usage = Usage {
        input_tokens: tokens.get("input").and_then(Value::as_u64),
        output_tokens: tokens.get("output").and_then(Value::as_u64),
        context_tokens: data.pointer("/contextUsage/tokens").and_then(Value::as_u64),
        context_limit: data
            .pointer("/contextUsage/contextWindow")
            .and_then(Value::as_u64),
        cache_read_tokens: tokens.get("cacheRead").and_then(Value::as_u64),
        cache_write_tokens: tokens.get("cacheWrite").and_then(Value::as_u64),
    };
    Some(StreamEvent::Meta {
        session_id: session_id.to_string(),
        model: (!model.is_empty()).then(|| model.to_string()),
        usage: Some(usage),
    })
}

/// 重新拉取档位并产出 `ConfigOptionUpdate`。
///
/// **档位是动态的**：实测 `get_available_thinking_levels` 返回
/// `["low","high","max"]`，且当前模型的 `thinkingLevelMap` 决定哪些可用
///（不支持档位为 `null`）。所以每次切模型后必须重拉，不能缓存一次用到底。
async fn refresh_configs(
    proc: &Arc<PiRpcProcess>,
    configs: &Arc<ConfigOptionsState>,
    session_id: &str,
) -> Result<Vec<StreamEvent>, AppError> {
    let models = {
        let data = proc
            .request(json!({"type": "get_available_models"}), None)
            .await?;
        models_from_response(&data)
    };
    let levels = {
        let data = proc
            .request(json!({"type": "get_available_thinking_levels"}), None)
            .await?;
        levels_from_response(&data)
    };
    let current = {
        let data = proc.request(json!({"type": "get_state"}), None).await?;
        CurrentSelection::from_state(&data)
    };

    let options = project_config_options(&models, &levels, Some(&current));
    configs.replace(options.clone());
    Ok(vec![StreamEvent::ConfigOptionUpdate {
        session_id: session_id.to_string(),
        config_options: options,
    }])
}

#[async_trait]
impl AgentSession for PiSession {
    async fn next(&mut self) -> Option<Result<StreamEvent, AppError>> {
        loop {
            // 先清空缓冲：`translate` 与 pump 都可能一次产出多个事件。
            if let Some(ev) = self.pending.pop_front() {
                return Some(Ok(ev));
            }

            // stats 拉取落在**事件空闲窗口**：`pending` 排空、即将阻塞等新事件
            // 时才发 `get_session_stats`。TurnEnd（必要数据）因此不等遥测；
            // 拉取期间的延迟发生在回合间空档，用户不可见。会话流已关闭时跳过
            //（写向死进程只会白等一次超时）。失败只 debug 日志：遥测缺失不等于
            // 回合失败，**不发 Error 事件**（旧版 pi 没有 `get_session_stats`
            // 时表现为「无计量器」，无害）。
            if self.stats_pull_pending && self.events.is_some() {
                self.stats_pull_pending = false;
                let model = current_model_from_config(&self.configs.snapshot()).unwrap_or_default();
                match self
                    .proc
                    .request(json!({"type": "get_session_stats"}), Some(STATS_TIMEOUT))
                    .await
                {
                    Ok(data) => {
                        if let Some(meta) = meta_from_stats(&self.session_id, &model, &data) {
                            self.pending.push_back(meta);
                        }
                    }
                    Err(e) => {
                        log::debug!("[pi-rpc] session stats unavailable, skipping meta: {e}");
                    }
                }
                continue;
            }

            // 两路来源：进程事件流 + pump 产出（ConfigOptionUpdate / 请求错误）。
            // 只等进程那一侧会让 pump 的事件永远交付不出去。
            //
            // pump 退出（`recv()` 返回 `None`）后把 `request_events` 置 `None`
            // 并**摘掉该分支** —— 否则已关闭的 receiver 每轮都 ready，
            // `select!` 会一再选中它形成忙自旋（CPU 空转，且进程事件永远排不上）。
            // 之后由进程事件流单独决定会话终止。
            let from_request = async {
                match self.request_events.as_mut() {
                    Some(rx) => rx.recv().await,
                    // 分支已摘除：永不就绪（`select!` 的惯用写法）。
                    None => std::future::pending().await,
                }
            };
            // 事件流已关闭（进程退出后的下一轮）→ 会话结束。
            let events = self.events.as_mut()?;
            tokio::select! {
                from_request = from_request => {
                    match from_request {
                        Some(ev) => return Some(Ok(ev)),
                        // pump 已退出：摘掉分支，下一轮只等进程事件流。
                        None => self.request_events = None,
                    }
                }
                raw = events.recv() => {
                    let Some(raw) = raw else {
                        // 进程侧事件流结束 = 会话到此结束。
                        self.events = None;
                        return None;
                    };
                    let translated = translate::translate(&self.session_id, &raw);
                    // 审批事件与它的回写形状来自**同一次**翻译 —— 分成两条路径
                    // 各自解析 `extension_ui_request` 会让两者静默漂移。
                    if let Some((id, kind)) = translated.approval {
                        if let Ok(mut m) = self.pending_approvals.lock() {
                            m.insert(id, kind);
                        }
                    }
                    let settled = translated.settled;
                    self.absorb(translated.events);
                    // `agent_settled` = 回合稳定终点 → 标记待拉会话统计（上下文
                    // 用量的唯一真实数据源）。**不就地拉取**：TurnEnd 刚入队，
                    // 就地 await 会把它的交付串行等在一次遥测 RPC 上 —— 拉取
                    // 由下一轮循环顶部的空闲窗口分支消费（见 next 开头）。
                    if settled {
                        self.stats_pull_pending = true;
                    }
                }
            }
        }
    }

    async fn send(&mut self, req: SessionRequest) -> Result<(), AppError> {
        // 与 manager 路由走**同一条路径**：入队后由 pump 统一处理。
        // 直接写 `proc` 会让 `send()` 与 pump 各自持有一半状态
        //（例如 pump 改了 `configs`，`send()` 却还在用旧快照判断）。
        self.request_tx
            .send(req)
            .await
            .map_err(|_| AppError::Agent("pi-rpc: request pump is gone".into()))
    }

    fn request_channel(&self) -> Option<mpsc::Sender<SessionRequest>> {
        // **必须返回 Some**：`spawn_session_pipeline` 只在它非 `None` 时把会话
        // 注册进 `AgentChatManager`。返回 `None` 会让 `agent_stream` 的续聊
        // 分支永久失配（`owns()` 恒 false），于是每次发消息都新建会话 ——
        // 新会话握手后从不发 prompt，前端永远停在 thinking。
        Some(self.request_tx.clone())
    }

    async fn cancel(&mut self) {
        let _ = self.proc.send(json!({"type": "abort"})).await;
        self.proc.dispose();
    }

    /// pi 的 native session id（来自握手时的 `get_state`）。
    ///
    /// 两个消费方：
    /// 1. `conversation/adapters/pi.rs::resume_command` —— 拼成 `pi --session <id>`
    ///    （终端侧原生恢复）；
    /// 2. `PiRpcAdapter::resume` —— 用它校验这次 spawn **确实绑定到了请求的那个会话**
    ///    （`ensure_bound_to`）。绑定错会话比失败更糟：用户以为在续写原会话，实际在
    ///    污染另一条会话的上下文。
    ///
    /// 返回 `None` 会让「历史会话 → 继续聊」这条入口消失。
    fn resume_id(&self) -> Option<String> {
        self.native_session_id.clone()
    }
}

impl PiSession {
    /// 把一次翻译产出入队，并在**事件边界**维护「本轮已失败」这条跨事件事实。
    ///
    /// # 为什么需要它
    ///
    /// 一条话轮的失败由 `translate` 产出 `Error`，而终止由**另一条**事件
    /// （`agent_settled`）产出 `TurnEnd`。两侧都只看得见自己那条事件：
    ///
    /// - `translate` 是纯函数，无状态（这是它可被密集单测的前提，不能破）；
    /// - `agent_settled` 的载荷只有 `aborted`，不包含「本轮是否报过错」。
    ///
    /// 于是 `TurnEnd{Completed}` 会紧随 `Error` 到达，`notify.rs` 的两条互斥
    /// 声明被同时触发（「会话异常终止」+「任务完成」）。
    ///
    /// 修法：把**判定输入**（这一轮失败过没有）记在这里，让它与 `TurnEnd` 在
    /// 同一个事件边界上汇合。
    ///
    /// # 为什么在入队时改写，而不是在 `next()` 出队时
    ///
    /// 入队就是事件产生的那个时刻，此时「本轮」是唯一确定的。
    /// 出队时再判会让 `TurnEnd` 与它前面那条 `Error` 的对应关系取决于队列
    /// 消费速度 —— 那是另一个时序 bug。
    fn absorb(&mut self, events: Vec<StreamEvent>) {
        for ev in events {
            match ev {
                // 失败标记：任何带 Agent/Protocol/Transport 性质的错误都说明本轮没成功。
                StreamEvent::Error { .. } => {
                    self.turn_failed = true;
                    self.pending.push_back(ev);
                }
                // 失败轮的 settle 是 `Completed`（pi 不认为「上游报错」算 abort）——
                // 但对我们它**不是**完成：用户没拿到结果。改成 `Error`，让
                // `notify.rs` 走 Failed 而不是 Completed，且与前面那条 `Error`
                // 同类同 session（节流窗口内合并）。
                StreamEvent::TurnEnd {
                    session_id,
                    turn_id,
                    reason,
                } => {
                    self.pending.push_back(StreamEvent::TurnEnd {
                        session_id,
                        turn_id,
                        reason: if self.turn_failed {
                            TurnEndReason::Error
                        } else {
                            reason
                        },
                    });
                    // 终止事件本身就是账本的终点（下一轮从干净状态开始）。
                    self.turn_failed = false;
                }
                // 不要在这里加 `TurnStart` 分支：pi 传输**从不产出**
                // `StreamEvent::TurnStart` —— `translate` 没有那个臂，`turn_start`
                // 落进 `unmapped` 分支。写一条不可达的清零路径 = 自己造「声明了
                // 却没人实现」，反而让人误以为有两条保障。
                other => self.pending.push_back(other),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::chat::adapter::session_config::{
        find_by_category, CATEGORY_MODEL, CATEGORY_THOUGHT_LEVEL,
    };
    // 进程层的位置：`process` 是 `pi_rpc` 的私有子模块，`tests` 是它的后代所以可见。
    use super::super::process::KillProbe;
    use serde_json::json;
    use std::time::Duration;

    /// 假 pi：从 `stdin` 读命令，按 `type` 回对应响应。
    ///
    /// 这样 `start_with` 的**真实握手路径**（三次 request/response 配对）
    /// 会被完整执行 —— 而不是在测试里复制一遍它的逻辑。
    /// 测试复制实现的话，实现被改坏时测试仍绿（本项目已踩过这个坑）。
    fn fake_pi() -> (PiRpcProcess, tokio::task::JoinHandle<()>) {
        fake_pi_with_events(vec![])
    }

    /// 假 pi，握手后额外推送一组事件（无 id，即 pi 的「事件」通道）。
    fn fake_pi_with_events(events: Vec<Value>) -> (PiRpcProcess, tokio::task::JoinHandle<()>) {
        let (proc, handle, _cmds) = fake_pi_recording(events);
        (proc, handle)
    }

    /// 假 pi 对 `get_session_stats` 的回法：`Full` 回满额数据，`Failure` 模拟
    /// 旧版 pi 无此命令（`success: false`），`Silent` 模拟更恶劣的旧版——
    /// 对未知命令**连错误信封都不回**（请求只能等超时）。
    #[derive(Clone, Copy)]
    enum StatsReply {
        Full,
        Failure,
        Silent,
    }

    /// 同上，额外回传「pi 收到的命令」，供回写断言（如 `extension_ui_response`）。
    fn fake_pi_recording(
        events: Vec<Value>,
    ) -> (
        PiRpcProcess,
        tokio::task::JoinHandle<()>,
        tokio::sync::mpsc::UnboundedReceiver<Value>,
    ) {
        fake_pi_replying(events, StatsReply::Full)
    }

    fn fake_pi_replying(
        events: Vec<Value>,
        stats: StatsReply,
    ) -> (
        PiRpcProcess,
        tokio::task::JoinHandle<()>,
        tokio::sync::mpsc::UnboundedReceiver<Value>,
    ) {
        // 两条单向管道：session → pi（命令）与 pi → session（响应）。
        let (session_in, pi_in) = tokio::io::duplex(64 * 1024);
        let (pi_out, session_out) = tokio::io::duplex(64 * 1024);

        let (cmd_tx, cmd_rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
            let mut write_half = pi_out;
            let mut lines = BufReader::new(pi_in).lines();
            let mut handshakes = 0usize;
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(cmd) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                let _ = cmd_tx.send(cmd.clone());
                let id = cmd.get("id").cloned().unwrap_or(Value::Null);
                let kind = cmd.get("type").and_then(Value::as_str).unwrap_or("");
                let data = match kind {
                    "get_available_models" => json!({"models": [
                        {"id": "auto/deepseek-v4.1-flash", "name": "DV4", "provider": "magpie"},
                        {"id": "deepseek-flash", "name": "DF", "provider": "deepseek"}
                    ]}),
                    "get_available_thinking_levels" => json!({"levels": ["low", "high", "max"]}),
                    "get_state" => json!({
                        "model": {"id": "auto/deepseek-v4.1-flash"},
                        "thinkingLevel": "high",
                        "sessionId": "01a15cec-9454-7596-9016-6069189d7d4e"
                    }),
                    // pi docs rpc-commands.md §get_session_stats 的实测形状。
                    "get_session_stats" => json!({
                        "tokens": {"input": 1234, "output": 567,
                                   "cacheRead": 197_400, "cacheWrite": 1_200,
                                   "total": 199_201},
                        "contextUsage": {"tokens": 205_000, "contextWindow": 1_000_000,
                                          "percent": 20.5}
                    }),
                    _ => json!({}),
                };
                // Silent 模拟对未知命令完全不回应的旧版 pi（拉取只能等超时）。
                if kind == "get_session_stats" && matches!(stats, StatsReply::Silent) {
                    continue;
                }
                // Failure 模拟旧版 pi：命令不存在（错误在响应信封，不在 data）。
                let resp = if kind == "get_session_stats" && matches!(stats, StatsReply::Failure) {
                    json!({"type": "response", "id": id, "command": kind,
                               "success": false, "error": "unknown command"})
                } else {
                    json!({"type": "response", "id": id, "command": kind,
                               "success": true, "data": data})
                };
                if write_half
                    .write_all(format!("{resp}\n").as_bytes())
                    .await
                    .is_err()
                {
                    break;
                }
                let _ = write_half.flush().await;

                // 握手（models / thinking_levels / state）完成后，把预置的
                // pi **事件**推进同一通道 —— 与真实协议一致（事件无 id）。
                handshakes += 1;
                if handshakes == 3 {
                    for ev in &events {
                        let _ = write_half.write_all(format!("{ev}\n").as_bytes()).await;
                    }
                    let _ = write_half.flush().await;
                }
            }
        });

        let proc = PiRpcProcess::from_split(session_out, session_in);
        (proc, handle, cmd_rx)
    }

    /// 假 pi：握手第一枪就失败（模拟 `pi --session <不存在>` → 立即 exit 1）。
    ///
    /// 真实形态：stdout **一条响应都没有**，原因只写在 stderr。
    ///
    /// 返回的 `release` 只是为了让测试**确定**：测试先等 stderr 落进有界尾部，
    /// 再放行错误响应 —— 否则「stderr 读线程 vs stdout 错误响应」两条异步路径
    /// 存在竞态，断言会时绿时红。
    fn fake_pi_failing_handshake(
        stderr_text: &str,
    ) -> (PiRpcProcess, tokio::sync::oneshot::Sender<()>) {
        // 一次性探针：不为「是否被回收」断言的用例不需要它，但夹具要保持单一路径。
        fake_pi_failing_handshake_probed(stderr_text, &KillProbe::new())
    }

    /// 同上，但注入 kill 探针 —— 用来断言「握手失败后 spawn 的进程被回收」。
    fn fake_pi_failing_handshake_probed(
        stderr_text: &str,
        probe: &KillProbe,
    ) -> (PiRpcProcess, tokio::sync::oneshot::Sender<()>) {
        let (session_in, pi_in) = tokio::io::duplex(64 * 1024);
        let (pi_out, session_out) = tokio::io::duplex(64 * 1024);
        let (mut err_out, err_in) = tokio::io::duplex(4 * 1024);
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        let stderr_text = stderr_text.to_string();

        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
            let _ = err_out
                .write_all(format!("{stderr_text}\n").as_bytes())
                .await;
            let _ = release_rx.await;

            let mut write_half = pi_out;
            let mut lines = BufReader::new(pi_in).lines();
            if let Ok(Some(line)) = lines.next_line().await {
                if let Ok(cmd) = serde_json::from_str::<Value>(&line) {
                    let id = cmd.get("id").cloned().unwrap_or(Value::Null);
                    let resp = json!({"type": "response", "id": id,
                                        "success": false, "error": "unknown command"});
                    let _ = write_half.write_all(format!("{resp}\n").as_bytes()).await;
                    let _ = write_half.flush().await;
                }
            }
        });

        let proc = PiRpcProcess::from_split_with_hooks(
            session_out,
            session_in,
            Some(err_in),
            probe.kill_fn(),
        );
        (proc, release_tx)
    }

    /// 测试用的能力快照（与 `PiRpcAdapter::chat_capabilities` 一致）。
    fn test_caps() -> ChatCapabilities {
        ChatCapabilities {
            config: crate::agent::chat::capabilities::ConfigCapability::SessionConfig,
            approvals: true,
            commands: true,
            resume: true,
        }
    }

    fn ctx() -> AgentContext {
        AgentContext {
            agent_id: "pi".into(),
            session_id: "s1".into(),
            project_id: cwd(),
            project_name: "proj".into(),
            env: "local".into(),
            skills: vec![],
            files: vec![],
            mode: "auto".into(),
            prompt: String::new(),
            model_id: None,
        }
    }

    /// 平台无关的工作目录（红线 13）。
    ///
    /// 这里不只是风格问题：`project_id` 会作为 `PiRpcProcess::spawn` 的
    /// `current_dir` 交给执行层。硬编码 `/tmp/...` 在 Windows 上根本不存在，
    /// 本地绿而 Windows CI 红。与 `serve.rs` 的夹具同口径。
    fn cwd() -> String {
        std::env::temp_dir().display().to_string()
    }

    /// **失败可归因（AC3）**：握手失败必须带上 pi 自己的 stderr 尾部。
    ///
    /// 实测 `pi --mode rpc --session <不存在>` → exit 1 + stderr
    /// `No session found matching '<id>'`，stdout 零响应。旧行为把这个原因丢在
    /// `_stderr` 里，用户只看到 `timed out after 5s` —— 慢且原因错误。
    ///
    /// **所有权契约（缺陷回归）**：握手失败必须**回收**被 spawn 的进程。
    ///
    /// 缺陷背景（2026-10-30）：`start_with` 按值拿到 `proc` 后 `?` 早退，`proc` 被 drop，
    /// 而当时 `PiRpcProcess` 没有 `Drop` 实现 ⇒ 每次恢复失败漏一个活着的 pi 进程
    /// （应用退出才由收敛表兜底）。修复是进程层 `impl Drop`，本用例从会话层钉住它。
    ///
    /// 变异验证：删掉 `impl Drop for PiRpcProcess` → 本用例红（计数 0）。
    #[tokio::test]
    async fn failed_handshake_reclaims_the_spawned_process() {
        let probe = KillProbe::new();
        let (proc, release) = fake_pi_failing_handshake_probed("boom", &probe);
        release.send(()).unwrap();

        assert!(
            PiSession::start_with(proc, &ctx(), test_caps())
                .await
                .is_err(),
            "夹具故意让握手失败"
        );
        assert_eq!(probe.count(), 1, "握手失败必须终止被 spawn 的进程");
    }

    /// 变异验证：`start_with` 里去掉 `.map_err(|e| proc.annotate(e))` → 本用例红。
    #[tokio::test]
    async fn handshake_failure_carries_the_pi_stderr_tail() {
        let (proc, release) = fake_pi_failing_handshake("No session found matching 'abc'");
        for _ in 0..200 {
            if proc.stderr_tail().contains("No session found") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(
            proc.stderr_tail().contains("No session found"),
            "夹具必须先写入 stderr"
        );
        release.send(()).unwrap();

        let err = match PiSession::start_with(proc, &ctx(), test_caps()).await {
            Ok(_) => panic!("握手已失败，不得返回会话"),
            Err(e) => e,
        };
        let msg = err.to_string();
        assert!(msg.contains("No session found matching 'abc'"), "{msg}");
        assert!(!msg.contains("timed out"), "不得退化成超时: {msg}");
    }

    /// **首轮 prompt 护栏（真机缺陷）**：`create()` 必须把 `ctx.prompt` 发出去。
    ///
    /// `agent_stream` 首次调用把用户消息放在 `ctx.prompt`，期望 `create()`
    /// 内部消费（ACP `acp.rs:631` / DeepSeek `deepseek.rs:109` 都如此）。
    /// 不发的话首条消息静默丢失 —— 前端停在 thinking，pi 侧从未收到 prompt。
    ///
    /// 变异验证：删掉 `if !ctx.prompt.is_empty() { proc.send(...) }` → 本用例红。
    #[tokio::test]
    async fn create_sends_the_first_prompt_from_the_context() {
        let (proc, _fake, mut cmds) = fake_pi_recording(vec![]);
        let mut c = ctx();
        c.prompt = "first message".into();
        let _session = PiSession::start_with(proc, &c, test_caps())
            .await
            .expect("start");

        let mut seen = None;
        while let Ok(Some(cmd)) = tokio::time::timeout(Duration::from_secs(1), cmds.recv()).await {
            if cmd.get("type").and_then(Value::as_str) == Some("prompt") {
                seen = Some(cmd);
                break;
            }
        }
        let seen = seen.expect("create() must deliver the first prompt");
        assert_eq!(seen["message"], "first message");
    }

    /// 空 prompt 不发命令 —— 续聊/resume 走静默启动，凭空发一个空 prompt
    /// 会让 pi 产生一轮空回复。
    #[tokio::test]
    async fn create_sends_nothing_when_the_context_has_no_prompt() {
        let (proc, _fake, mut cmds) = fake_pi_recording(vec![]);
        let _session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");

        while let Ok(Some(cmd)) =
            tokio::time::timeout(Duration::from_millis(300), cmds.recv()).await
        {
            assert_ne!(
                cmd.get("type").and_then(Value::as_str),
                Some("prompt"),
                "an empty context prompt must not produce a prompt command"
            );
        }
    }

    /// **接线护栏（变异验证过）**：`start()` 必须把投影出的配置项放进
    /// `SessionStart.config_options`。
    ///
    /// 变异：把 `config_options: configs.snapshot()` 改回 `Vec::new()`
    ///（即上一轮的缺陷）→ 本用例红。
    #[tokio::test]
    async fn start_publishes_config_options_in_session_start() {
        let (proc, _fake) = fake_pi();
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");

        let first = session.next().await.expect("event").expect("ok");
        let StreamEvent::SessionStart {
            config_options,
            model,
            ..
        } = first
        else {
            panic!("first event must be SessionStart, got {first:?}");
        };

        let model_opt = find_by_category(&config_options, CATEGORY_MODEL)
            .expect("SessionStart must carry the model option");
        assert_eq!(model_opt.current(), Some("auto/deepseek-v4.1-flash"));
        assert_eq!(model_opt.select_options().len(), 2);

        let level_opt = find_by_category(&config_options, CATEGORY_THOUGHT_LEVEL)
            .expect("SessionStart must carry the thought_level option (AC3)");
        assert_eq!(level_opt.current(), Some("high"));
        assert_eq!(level_opt.select_options().len(), 3);

        assert_eq!(model.as_deref(), Some("auto/deepseek-v4.1-flash"));

        // 第二个是 ContextInit
        assert!(matches!(
            session.next().await.expect("event").expect("ok"),
            StreamEvent::ContextInit { .. }
        ));
    }

    /// `next()` 按序交付队列里的全部事件。
    ///
    /// 变异验证的**诚实边界**：把 `extend(translate(...))` 改成
    /// `extend(translate(...).take(1))` **不会**让本用例变红 —— 因为当前
    /// `translate` 每条 pi 事件最多产出 1 条事件，`take(1)` 是语义 no-op。
    /// 本用例实际守住的是「多生产者 → 单消费者」的交付顺序（`start` 造的
    /// 两条 + 运行期的三条），这个顺序错了前端会在会话建立前收到增量。
    #[tokio::test]
    async fn next_drains_every_translated_event() {
        // 握手完成后，假 pi 往**事件通道**（无 id）推三条 pi 事件。
        // 走的是真实的 translate 路径 —— 不是往 pending 里塞现成 StreamEvent，
        // 所以「一条 pi 事件产出多个事件」的情形也被覆盖。
        let (proc, _fake) = fake_pi_with_events(vec![
            json!({"type": "message_update",
                   "assistantMessageEvent": {"type": "text_delta", "delta": "a"}}),
            json!({"type": "message_update",
                   "assistantMessageEvent": {"type": "text_delta", "delta": "b"}}),
            json!({"type": "agent_settled"}),
        ]);
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await; // SessionStart
        let _ = session.next().await; // ContextInit

        let mut seen = Vec::new();
        for _ in 0..3 {
            match session.next().await.expect("event").expect("ok") {
                StreamEvent::TextDelta { delta, .. } => seen.push(delta),
                StreamEvent::TurnEnd { .. } => seen.push("end".to_string()),
                other => panic!("unexpected {other:?}"),
            }
        }
        assert_eq!(seen, ["a", "b", "end"]);
    }

    /// **失败轮不得被 settle 追认为「完成」。**
    ///
    /// 失败与终止是**两条**事件：`turn_end{stopReason:error}` 产出 `Error`，
    /// 随后 `agent_settled{aborted:false}` 产出 `TurnEnd`。pi 不认为「上游报错」
    /// 算 abort，所以 settle 报的是 `Completed` —— 而 `notify.rs` 明确要求
    /// `TurnEnd{error}` 与 Error 事件互斥（否则用户同时收到「会话异常终止」与
    /// 「任务完成」两条通知，后者完全是谎报）。
    ///
    /// 跨事件事实（本轮失败过没有）属于会话层，不能放进纯函数的 `translate`。
    ///
    /// 变异验证：把 `absorb` 里的 `turn_failed` 判据去掉（无条件透传 reason）
    /// → 本用例变红。
    #[tokio::test]
    async fn failed_turn_is_not_reported_as_completed() {
        let (proc, _fake) = fake_pi_with_events(vec![
            json!({"type": "turn_end",
                   "message": {"role": "assistant", "content": [],
                               "provider": "opencode", "model": "big-pickle",
                               "stopReason": "error"}}),
            json!({"type": "agent_settled", "aborted": false}),
        ]);
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await; // SessionStart
        let _ = session.next().await; // ContextInit

        // 第一条是失败本身
        match session.next().await.expect("error").expect("ok") {
            StreamEvent::Error { code, .. } => assert_eq!(code, "E_TURN_FAILED"),
            other => panic!("expected the failure first, got {other:?}"),
        }
        // 第二条是终止 —— 必须是 Error，不能是 Completed
        match session.next().await.expect("turn_end").expect("ok") {
            StreamEvent::TurnEnd { reason, .. } => assert_eq!(
                reason,
                TurnEndReason::Error,
                "失败轮被 settle 报成 Completed → 用户会收到「任务完成」通知"
            ),
            other => panic!("expected TurnEnd, got {other:?}"),
        }
    }

    /// 上一轮的失败不得泄漏到下一轮（账本在 `TurnEnd` 清零）。
    ///
    /// 注意：pi 传输**不产出 `TurnStart`**（`translate` 没有那个臂），所以账本
    /// 的清零点只有 `TurnEnd` 一处 —— 本用例就守住那一条。
    #[tokio::test]
    async fn failure_state_does_not_leak_into_the_next_turn() {
        let (proc, _fake) = fake_pi_with_events(vec![
            // 第一轮：失败
            json!({"type": "turn_end",
                   "message": {"role": "assistant", "content": [],
                               "provider": "p", "model": "m",
                               "stopReason": "error"}}),
            json!({"type": "agent_settled", "aborted": false}),
            // 第二轮：正常完成
            json!({"type": "agent_settled", "aborted": false}),
        ]);
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await; // SessionStart
        let _ = session.next().await; // ContextInit

        let mut reasons = Vec::new();
        // **有界读取**（与 `next_drains_every_translated_event` 同形）：
        // `while let Some(_) = session.next().await` 依赖事件流关闭，而假 pi
        // 不会关流 —— 那种写法会让用例永久阻塞。
        // settle 后现在还会交付 `Meta`（get_session_stats 遥测，与本用例无关），
        // 跳过即可；guard 上限防死循环。
        let mut guard = 0;
        while reasons.len() < 2 && guard < 8 {
            guard += 1;
            match session.next().await.expect("event").expect("ok") {
                StreamEvent::Meta { .. } | StreamEvent::Error { .. } => {}
                StreamEvent::TurnEnd { reason, .. } => reasons.push(reason),
                other => panic!("unexpected {other:?}"),
            }
        }
        assert_eq!(
            reasons,
            [TurnEndReason::Error, TurnEndReason::Completed],
            "第二轮的 settle 必须恢复为 Completed（否则正常完成的轮永远报错）"
        );
    }

    /// **接入护栏（AC7）**：`confirm` 审批 → 允许 → 回 `{confirmed: true}`。
    ///
    /// 变异：把 `answer_ui_request` 里的 `confirmed` 改成别的字段名 →
    /// pi 侧永远等不到回答，工具卡住不返回。
    #[tokio::test]
    async fn approve_confirm_sends_confirmed_true() {
        let (proc, _fake, mut cmds) = fake_pi_recording(vec![
            json!({"type": "extension_ui_request", "id": "req-1", "method": "confirm",
                   "title": "Run?", "message": "rm -rf /tmp/x"}),
        ]);
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await; // SessionStart
        let _ = session.next().await; // ContextInit

        // 下一个事件应当是审批请求
        let approval = session.next().await.expect("event").expect("ok");
        assert!(
            matches!(&approval, StreamEvent::RequestApproval { call_id, tool, .. }
                     if call_id == "req-1" && tool == "pi.confirm"),
            "expected approval, got {approval:?}"
        );

        session
            .send(SessionRequest::Approve {
                call_id: "req-1".into(),
                allow: true,
            })
            .await
            .expect("approve");

        // 找到回写的 extension_ui_response
        let mut response = None;
        while let Ok(Some(cmd)) = tokio::time::timeout(Duration::from_secs(1), cmds.recv()).await {
            if cmd.get("type").and_then(Value::as_str) == Some("extension_ui_response") {
                response = Some(cmd);
                break;
            }
        }
        let response = response.expect("must write extension_ui_response");
        assert_eq!(response["id"], "req-1");
        assert_eq!(response["confirmed"], true);
    }

    /// 拒绝 `confirm` → `confirmed: false`。
    ///
    /// 不是 `cancelled`：pi 把 `cancelled` 读作「用户关掉弹窗、没做选择」，
    /// 与「明确拒绝」是两种状态（pi-acp 的实现同样回 `confirmed: false`）。
    #[tokio::test]
    async fn deny_confirm_sends_confirmed_false() {
        let (proc, _fake, mut cmds) = fake_pi_recording(vec![
            json!({"type": "extension_ui_request", "id": "req-2", "method": "confirm",
                   "message": "ok?"}),
        ]);
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await;
        let _ = session.next().await;
        let _ = session.next().await;

        session
            .send(SessionRequest::Approve {
                call_id: "req-2".into(),
                allow: false,
            })
            .await
            .expect("deny");

        let mut response = None;
        while let Ok(Some(cmd)) = tokio::time::timeout(Duration::from_secs(1), cmds.recv()).await {
            if cmd.get("type").and_then(Value::as_str) == Some("extension_ui_response") {
                response = Some(cmd);
                break;
            }
        }
        let response = response.expect("must write extension_ui_response");
        assert_eq!(response["confirmed"], false);
        assert!(response.get("cancelled").is_none());
    }

    /// `select` 允许 → 回第一项；不是 `confirmed`。
    #[tokio::test]
    async fn approve_select_sends_first_option_value() {
        let (proc, _fake, mut cmds) = fake_pi_recording(vec![
            json!({"type": "extension_ui_request", "id": "req-3", "method": "select",
                   "title": "Pick", "options": ["Allow once", "Deny"]}),
        ]);
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await;
        let _ = session.next().await;
        let _ = session.next().await;

        session
            .send(SessionRequest::Approve {
                call_id: "req-3".into(),
                allow: true,
            })
            .await
            .expect("allow select");

        let mut response = None;
        while let Ok(Some(cmd)) = tokio::time::timeout(Duration::from_secs(1), cmds.recv()).await {
            if cmd.get("type").and_then(Value::as_str) == Some("extension_ui_response") {
                response = Some(cmd);
                break;
            }
        }
        let response = response.expect("must write extension_ui_response");
        assert_eq!(response["value"], "Allow once");
        assert!(response.get("confirmed").is_none());
    }

    /// 拒绝 `select` → `cancelled`（选项列表里没有「否」的语义槽位）。
    #[tokio::test]
    async fn deny_select_sends_cancelled() {
        let (proc, _fake, mut cmds) = fake_pi_recording(vec![
            json!({"type": "extension_ui_request", "id": "req-4", "method": "select",
                   "options": ["Allow once", "Always"]}),
        ]);
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await;
        let _ = session.next().await;
        let _ = session.next().await;

        session
            .send(SessionRequest::Approve {
                call_id: "req-4".into(),
                allow: false,
            })
            .await
            .expect("deny select");

        let mut response = None;
        while let Ok(Some(cmd)) = tokio::time::timeout(Duration::from_secs(1), cmds.recv()).await {
            if cmd.get("type").and_then(Value::as_str) == Some("extension_ui_response") {
                response = Some(cmd);
                break;
            }
        }
        let response = response.expect("must write extension_ui_response");
        assert_eq!(response["cancelled"], true);
        assert!(response.get("value").is_none());
    }

    /// 未知 id 的回答被静默忽略 —— 重复回答会让 pi 收到无法匹配的响应。
    #[tokio::test]
    async fn approve_unknown_request_is_ignored() {
        let (proc, _fake, mut cmds) = fake_pi_recording(vec![]);
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");

        session
            .send(SessionRequest::Approve {
                call_id: "never-issued".into(),
                allow: true,
            })
            .await
            .expect("must not error");

        // 不应写出任何 extension_ui_response
        while let Ok(Some(cmd)) =
            tokio::time::timeout(Duration::from_millis(200), cmds.recv()).await
        {
            assert_ne!(
                cmd.get("type").and_then(Value::as_str),
                Some("extension_ui_response"),
                "unknown approval must not be answered"
            );
        }
    }

    /// **Turn 带 model_id 时必须先切模型再发 prompt**（与 ACP 同契约）。
    ///
    /// 变异验证：把 `handle_request` 的 Turn 分支改回忽略 `model_id` → 本用例红。
    /// 忽略的后果是「用户选了模型、实际用默认模型跑」——会话内 `configOptions`
    /// 随后回报真实模型，看起来像列表数据不一致。
    #[tokio::test]
    async fn turn_with_model_switches_before_prompt() {
        let (proc, _fake, mut cmds) = fake_pi_recording(vec![]);
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await;
        let _ = session.next().await;

        session
            .send(SessionRequest::Turn {
                prompt: "hi".into(),
                model_id: Some("deepseek-flash".into()),
            })
            .await
            .expect("turn");

        // 收集 pump 发出的命令，断言 set_model 早于 prompt
        let mut order = Vec::new();
        while let Ok(Some(cmd)) =
            tokio::time::timeout(Duration::from_millis(400), cmds.recv()).await
        {
            if let Some(t @ ("set_model" | "prompt")) = cmd.get("type").and_then(Value::as_str) {
                order.push(t.to_string());
            }
            if order.len() == 2 {
                break;
            }
        }
        assert_eq!(
            order,
            ["set_model", "prompt"],
            "model must be switched before the prompt is sent"
        );
    }

    /// `model_id` 是认不出来的复合串（`provider/model`）时切不动 —— 必须
    /// **降级为不切**并继续本轮，而不是让用户发消息直接失败。
    #[tokio::test]
    async fn unknown_model_id_does_not_block_the_turn() {
        let (proc, _fake, mut cmds) = fake_pi_recording(vec![]);
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await;
        let _ = session.next().await;

        session
            .send(SessionRequest::Turn {
                prompt: "hi".into(),
                // 历史遗留的复合串形态，set_model 认不出来
                model_id: Some("ark-coding-plan/ark-code-latest".into()),
            })
            .await
            .expect("turn must not fail on an unusable model id");

        // prompt 仍要发出去
        let mut saw_prompt = false;
        while let Ok(Some(cmd)) =
            tokio::time::timeout(Duration::from_millis(400), cmds.recv()).await
        {
            if cmd.get("type").and_then(Value::as_str) == Some("prompt") {
                saw_prompt = true;
                break;
            }
        }
        assert!(saw_prompt, "the turn must still run with the current model");
    }

    /// **降级必须可见**：模型没切成功时，用户必须收到一条 `E_MODEL_NOT_APPLIED`。
    ///
    /// 变异验证：把 `handle_request` 的 `Err` 分支改回只 `log::warn!` → 本用例红。
    /// 只打日志的话，用户看到的是「选了模型却没生效，UI 上什么都没有」。
    #[tokio::test]
    async fn model_switch_failure_surfaces_an_error_event() {
        let (proc, _fake, _cmds) = fake_pi_recording(vec![]);
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await;
        let _ = session.next().await;

        session
            .send(SessionRequest::Turn {
                prompt: "hi".into(),
                model_id: Some("does-not-exist".into()),
            })
            .await
            .expect("turn");

        let mut seen = None;
        for _ in 0..8 {
            let Some(Ok(ev)) = tokio::time::timeout(Duration::from_millis(500), session.next())
                .await
                .ok()
                .flatten()
            else {
                break;
            };
            if let StreamEvent::Error { code, .. } = &ev {
                seen = Some(code.clone());
                break;
            }
        }
        assert_eq!(
            seen.as_deref(),
            Some("E_MODEL_NOT_APPLIED"),
            "a silent model-switch failure is exactly the bug we are fixing"
        );
    }

    /// **历史遗留的复合串要能被翻译**：`provider/model` → 裸 id + provider。
    ///
    /// 旧版 Pi 走 `--list-models` 表格（`provider/model`），那个解析器已删除；
    /// 但用户机器上可能还存着旧版 tab 持久化的 `modelId`。不翻译的话，这些会话
    /// 选中的模型永远切不动。
    ///
    /// 变异验证：把 `provider_of` 的「拆尾段」回退 → 本用例红。
    #[tokio::test]
    async fn composite_model_id_is_translated_to_bare_id_and_provider() {
        let (proc, _fake, mut cmds) = fake_pi_recording(vec![]);
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await;
        let _ = session.next().await;

        // 假 pi 的列表里有 `deepseek-flash`（provider=`deepseek`）。
        session
            .send(SessionRequest::Turn {
                prompt: "hi".into(),
                model_id: Some("deepseek/deepseek-flash".into()),
            })
            .await
            .expect("turn");

        let mut set_model = None;
        while let Ok(Some(cmd)) =
            tokio::time::timeout(Duration::from_millis(400), cmds.recv()).await
        {
            if cmd.get("type").and_then(Value::as_str) == Some("set_model") {
                set_model = Some(cmd);
                break;
            }
        }
        let cmd = set_model.expect("composite id must still produce a set_model command");
        assert_eq!(
            cmd["provider"], "deepseek",
            "provider must come from the list"
        );
        assert_eq!(
            cmd["modelId"], "deepseek-flash",
            "modelId must be the bare id, not the composite string"
        );
    }

    /// `resume_id()` 必须给出 pi 的 native session id。
    ///
    /// 这条不是锦上添花：`conversation/adapters/pi.rs::resume_command` 已能把它
    /// 拼成 `pi --session <id>`，返回 `None` 会让「历史会话 → 继续聊」整条入口消失，
    /// 且没有任何报错。
    #[tokio::test]
    async fn resume_id_comes_from_the_handshake() {
        let (proc, _fake) = fake_pi();
        let session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        assert_eq!(
            session.resume_id().as_deref(),
            Some("01a15cec-9454-7596-9016-6069189d7d4e")
        );
    }

    /// `resume` 能力位必须与 `resume_id()` 一致 —— 声明 false 会让前端隐藏入口，
    /// 而实现其实可用。
    #[tokio::test]
    async fn capabilities_declare_resume_because_it_works() {
        let (proc, _fake) = fake_pi();
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        match session.next().await.expect("event").expect("ok") {
            StreamEvent::SessionStart { capabilities, .. } => {
                assert!(
                    capabilities.resume,
                    "resume_id() is implemented, declare it"
                );
                assert!(capabilities.approvals, "approvals are mapped, declare it");
            }
            other => panic!("first event must be SessionStart, got {other:?}"),
        }
    }

    /// **根因护栏**：`request_channel()` 必须返回 `Some`。
    ///
    /// 真机「Pi 一直 thinking」的根因就在这里：`spawn_session_pipeline` 只在
    /// 它非 `None` 时把会话注册进 `AgentChatManager`，而 `agent_stream` 的续聊
    /// 分支靠 `manager.owns()` 判断。返回 `None`（默认实现）会让每轮发消息都
    /// `create()` 一个新会话 —— 新会话握手后从不发 prompt，前端永远收不到
    /// 任何增量，只能停在 thinking。**且没有任何报错**。
    ///
    /// 变异验证：删掉 `request_channel` 的实现（回落默认 `None`）→ 本用例红。
    #[tokio::test]
    async fn exposes_a_request_channel_so_turns_can_be_routed() {
        let (proc, _fake) = fake_pi();
        let session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        assert!(
            session.request_channel().is_some(),
            "without a request channel the session is never registered and every \
             message starts a brand-new session"
        );
    }

    /// `send()` 必须经 pump 生效：把 `Turn` 交给会话后，假 pi 应收到 `prompt`。
    ///
    /// 变异验证：把 `send()` 改成无条件 `Ok(())`（不转发）→ 本用例红。
    #[tokio::test]
    async fn send_delivers_the_prompt_to_pi() {
        let (proc, _fake, mut cmds) = fake_pi_recording(vec![]);
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await;
        let _ = session.next().await;

        session
            .send(SessionRequest::Turn {
                prompt: "hello pi".into(),
                model_id: None,
            })
            .await
            .expect("send turn");

        let mut seen = None;
        while let Ok(Some(cmd)) = tokio::time::timeout(Duration::from_secs(1), cmds.recv()).await {
            if cmd.get("type").and_then(Value::as_str) == Some("prompt") {
                seen = Some(cmd);
                break;
            }
        }
        let seen = seen.expect("pi must receive a prompt command");
        assert_eq!(seen["message"], "hello pi");
    }

    /// 切模型：已是当前值时不发命令；否则发 `set_model` 并重新拉档位。
    #[tokio::test]
    async fn set_config_option_is_a_no_op_when_already_current() {
        let (proc, _fake) = fake_pi();
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await; // SessionStart
        let _ = session.next().await; // ContextInit

        // 切到当前值 → 不发命令、不产生 ConfigOptionUpdate
        session
            .send(SessionRequest::SetConfigOption {
                config_id: MODEL_CONFIG_ID.into(),
                value: SessionConfigValue::Text("auto/deepseek-v4.1-flash".into()),
            })
            .await
            .expect("no-op switch");

        assert!(
            session.pending.is_empty(),
            "切到当前值不应产生任何事件（多余的往返会让 UI 闪一下）"
        );
    }

    // ── get_session_stats → Meta（上下文用量遥测） ──────────────────

    /// 满额载荷：全部字段映射到 `Usage`。
    #[test]
    fn meta_from_stats_maps_the_full_payload() {
        let data = json!({
            "tokens": {"input": 1234, "output": 567,
                       "cacheRead": 197_400, "cacheWrite": 1_200},
            "contextUsage": {"tokens": 205_000, "contextWindow": 1_000_000,
                              "percent": 20.5}
        });
        let Some(StreamEvent::Meta {
            session_id,
            model,
            usage,
        }) = meta_from_stats("s1", "auto/dv4", &data)
        else {
            panic!("full payload must produce a Meta event");
        };
        assert_eq!(session_id, "s1");
        assert_eq!(model.as_deref(), Some("auto/dv4"));
        let usage = usage.expect("usage");
        assert_eq!(usage.input_tokens, Some(1234));
        assert_eq!(usage.output_tokens, Some(567));
        assert_eq!(usage.context_tokens, Some(205_000));
        assert_eq!(usage.context_limit, Some(1_000_000));
        assert_eq!(usage.cache_read_tokens, Some(197_400));
        assert_eq!(usage.cache_write_tokens, Some(1_200));
    }

    /// `contextUsage` 整体缺失（无模型/无窗口信息时 pi 省略它）仍产出 Meta ——
    /// 只有累计 token 也有价值（命中率、已用回退）。
    #[test]
    fn meta_from_stats_without_context_usage_still_reports_tokens() {
        let data = json!({
            "tokens": {"input": 10, "output": 20, "cacheRead": 5, "cacheWrite": 1}
        });
        let Some(StreamEvent::Meta { usage, .. }) = meta_from_stats("s1", "m", &data) else {
            panic!("cumulative tokens alone must still produce a Meta event");
        };
        let usage = usage.expect("usage");
        assert_eq!(usage.input_tokens, Some(10));
        assert_eq!(usage.output_tokens, Some(20));
        assert_eq!(usage.context_tokens, None);
        assert_eq!(usage.context_limit, None);
    }

    /// `tokens` 缺失返回 `None` —— 一条没有任何 token 数据的 stats 不值得发空 Meta。
    #[test]
    fn meta_from_stats_without_tokens_returns_none() {
        let data = json!({"contextUsage": {"tokens": 1, "contextWindow": 2}});
        assert!(meta_from_stats("s1", "m", &data).is_none());
        // 空对象同理。
        assert!(meta_from_stats("s1", "m", &json!({})).is_none());
    }

    /// compaction 后 `contextUsage.tokens/percent` 为 null 是**正常降级**
    ///（到新 assistant 响应前 pi 给不出估计）—— 按字段缺失处理，不丢弃整条。
    #[test]
    fn meta_from_stats_treats_null_context_fields_as_missing() {
        let data = json!({
            "tokens": {"input": 1, "output": 2},
            "contextUsage": {"tokens": null, "contextWindow": 1_000_000, "percent": null}
        });
        let Some(StreamEvent::Meta { usage, .. }) = meta_from_stats("s1", "m", &data) else {
            panic!("must not drop the whole Meta on compaction-null context tokens");
        };
        let usage = usage.expect("usage");
        assert_eq!(usage.context_tokens, None);
        assert_eq!(usage.context_limit, Some(1_000_000));
    }

    /// `model` 为空串时 `Meta.model` 为 `None`（未知模型的诚实降级）。
    #[test]
    fn meta_from_stats_with_empty_model_reports_none() {
        let data = json!({"tokens": {"input": 1}});
        let Some(StreamEvent::Meta { model, .. }) = meta_from_stats("s1", "", &data) else {
            panic!("must produce Meta");
        };
        assert!(model.is_none());
    }

    /// **接入护栏**：`agent_settled` 后 `next()` 必须拉取 `get_session_stats`
    /// 并把产物作为 `Meta` 交付 —— 这是前端计量器的唯一真实数据源。
    ///
    /// model 取会话当前模型（握手 `get_state` 缓存的那份）。
    #[tokio::test]
    async fn settled_turn_pulls_session_stats_into_a_meta_event() {
        let (proc, _fake) = fake_pi_with_events(vec![json!({
            "type": "agent_settled", "aborted": false
        })]);
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await; // SessionStart
        let _ = session.next().await; // ContextInit

        match session.next().await.expect("event").expect("ok") {
            StreamEvent::TurnEnd { reason, .. } => assert_eq!(reason, TurnEndReason::Completed),
            other => panic!("expected TurnEnd after settle, got {other:?}"),
        }
        match session.next().await.expect("meta").expect("ok") {
            StreamEvent::Meta { model, usage, .. } => {
                assert_eq!(
                    model.as_deref(),
                    Some("auto/deepseek-v4.1-flash"),
                    "model must come from the session's current selection"
                );
                let usage = usage.expect("usage");
                assert_eq!(usage.context_tokens, Some(205_000));
                assert_eq!(usage.context_limit, Some(1_000_000));
                assert_eq!(usage.cache_read_tokens, Some(197_400));
            }
            other => panic!("expected Meta after the settled turn, got {other:?}"),
        }
    }

    /// **统计拉不到不打断对话流**：旧版 pi 无 `get_session_stats` → 只跳过本次
    /// Meta，**不发 Error 事件**（遥测缺失不等于回合失败）。
    #[tokio::test]
    async fn stats_failure_does_not_surface_an_error_event() {
        let (proc, _fake, _cmds) = fake_pi_replying(
            vec![json!({"type": "agent_settled", "aborted": false})],
            StatsReply::Failure,
        );
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await; // SessionStart
        let _ = session.next().await; // ContextInit

        match session.next().await.expect("event").expect("ok") {
            StreamEvent::TurnEnd { .. } => {}
            other => panic!("expected TurnEnd, got {other:?}"),
        }
        // 有界读取：没有 Meta、也没有 Error —— 下一轮 next() 只能等到超时。
        let next = tokio::time::timeout(Duration::from_millis(300), session.next()).await;
        assert!(
            next.is_err(),
            "stats failure must not emit Meta or Error; got {next:?}"
        );
    }

    /// **解耦护栏**：`agent_settled` 后 TurnEnd 必须立即交付，不等 stats RPC ——
    /// 拉取被推迟到事件空闲窗口（`pending` 排空后的循环顶部），回合终点的
    /// 交付延迟与遥测延迟解耦。假 pi 对 `get_session_stats` 连错误信封都不回
    ///（比 `Failure` 更恶劣，旧请求只能等超时），TurnEnd 仍须在远小于
    /// `STATS_TIMEOUT` 的窗口内到达。
    #[tokio::test]
    async fn turn_end_is_delivered_without_waiting_for_stats() {
        let (proc, _fake, _cmds) = fake_pi_replying(
            vec![json!({"type": "agent_settled", "aborted": false})],
            StatsReply::Silent,
        );
        let mut session = PiSession::start_with(proc, &ctx(), test_caps())
            .await
            .expect("start");
        let _ = session.next().await; // SessionStart
        let _ = session.next().await; // ContextInit

        let ev = tokio::time::timeout(Duration::from_millis(300), session.next())
            .await
            .expect("TurnEnd must not wait for the stats rpc")
            .expect("ok");
        assert!(
            matches!(ev, Ok(StreamEvent::TurnEnd { .. })),
            "expected TurnEnd right after settle, got {ev:?}"
        );
    }
}
