//! 团队 MCP 端点（design §4.2 / §5.5）—— MCP over HTTP，单端点 `POST /team/mcp`。
//!
//! # 这一层做什么，不做什么
//!
//! 做三件事：**身份**（header token → `sha256` 查表 → [`TeamPrincipal`]）、
//! **JSON-RPC 2.0 编解码**（单请求 / 单响应，无 SSE、无 batch）、**委派**给
//! [`dispatch::call_async`]。不做：工具语义（`dispatch`）、授权（`authorize`）、状态迁移
//! （`manager`）、启动 listener 与选端口（组合根，见 [`crate::app::boot`]）。
//!
//! # 为什么鉴权在 handler 里而不只靠门
//!
//! 门（`server::AuthGate::with_tokens`）只回答「这个 token 是不是本端点签发的」——
//! 它是**端点级**的存在性检查。而工具调用需要知道**谁**在调（`team_id` / `member_id` /
//! `role`），所以 handler 里再做一次 `sha256 → 查表` 拿主体。两次判定不是重复：
//! 门决定「能不能进来」，查表决定「进来的是谁」。
//!
//! **这里没有恒定时间比较，将来也不许加**：`principals` 以 `hash_token(明文)` 为 key，
//! 攻击者无法控制 key 侧，查表本身就足够（见 `identity::resolve_principal` 的长注释）。
//! `server/gate.rs` 的「进程内比较落点 = 1」不变量因此仍成立。
//!
//! # 错误一律走 JSON-RPC，不用 HTTP 状态码
//!
//! 未授权 / 未知方法 / 参数非法 / 业务拒绝全部返回 **HTTP 200 + error 对象**：MCP 客户端
//! 按 `error.code` 分支处理，而 4xx/5xx 会被各家 CLI 当成「服务器打错了」而停止重试。
//! 业务错误（[`AppError`]）统一映成 [`SERVER_ERROR`]，`message` 直接用 [`AppError`] 的可读
//! 文案 —— 那条文案是写给**队长模型**看的提示，它靠它自我纠正（例：未知工具的错误里
//! 逐条列出已知工具名）。

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Router;
use serde_json::{json, Value};

use crate::agent::team::identity::resolve_principal;
use crate::agent::team::manager::TeamManager;
use crate::agent::team::mcp::dispatch;
use crate::agent::team::mcp::protocol::{ENDPOINT_PATH, TOKEN_HEADER};
use crate::agent::team::mcp::schema::{self, ToolSpec};
use crate::agent::team::types::TeamPrincipal;
use crate::common::error::AppError;
use crate::server::{BearerToken, CredentialExt, HeaderToken, SharedTokenSet};

/// 本端点声明的 MCP 协议版本。
///
/// 只声明，不实现版本协商：本端点只支持工具面，`initialize` 的其它字段（`clientInfo` /
/// sampling / roots）一律忽略 —— 声明不支持的能力比声明了不实现安全（红线 14 同族）。
pub const PROTOCOL_VERSION: &str = "2024-11-05";

/// JSON-RPC：body 不是合法 JSON（或不是对象）。
pub const PARSE_ERROR: i64 = -32700;
/// JSON-RPC：envelope 不成形（不是对象 / 没有 `method`）。
pub const INVALID_REQUEST: i64 = -32600;
/// JSON-RPC：方法不存在。
pub const METHOD_NOT_FOUND: i64 = -32601;
/// JSON-RPC：参数非法（`tools/call` 的 `name` / `arguments` 形状不对）。
pub const INVALID_PARAMS: i64 = -32602;
/// 业务错误：`dispatch::call_async` 返回的 [`AppError`] 全部映到这里。
///
/// 刻意不用 `-32603`（Internal error）：本端点的 `-32000` 绝大多数是**调用方可纠正**的
/// 拒绝（未授权工具 / 任务不存在 / 任务不属于你），把它们标成「内部错误」会诱导模型重试。
pub const SERVER_ERROR: i64 = -32000;
/// 未认证：header 缺失 / token 不对 / token 属于其它团队端点。
pub const UNAUTHORIZED: i64 = -32001;

/// 团队 MCP 端点状态。principal 表与 manager 都由调用方注入（组合根在 [`crate::app::boot`]）。
///
/// 执行者端口（`MemberExecutor`）与启动计划在 [`crate::agent::team::execution`] —— 与回复
/// 副作用映射放在一起，而不是在传输层。本文件只负责「把结论交出去」那一行调用。
///
/// 两个字段都是 `Arc`：`TeamManager` 是团队域的权威状态（与面板 / commands 共享同一实例），
/// principal 表由 `team_spawn` / `team_close` 增删（团队关闭即失效，design §3.1）。
/// 表以 `hash_token(明文)` 为 key —— 明文永远不进进程状态（只下发一次给成员）。
///
/// # 为什么 `Clone`
///
/// 字段都是 `Arc` / `SharedTokenSet`（内部 `Arc`）或它们的小表，克隆只复制句柄，不复制状态。
/// 凭证刷新与身份表重建要读库，必须能把自己搬进阻塞池（红线 3）—— 那需要一个 `'static` 的句柄。
#[derive(Clone)]
pub struct TeamServerState {
    /// 团队域唯一管理器（工具调用的委派目标）。
    pub manager: Arc<TeamManager>,
    /// `sha256(token)` → 主体。
    pub principals: Arc<RwLock<HashMap<String, TeamPrincipal>>>,
    /// 业务异步执行器：**唯一**把同步写库挪出 tokio worker 的地方（红线 3，
    /// 见 `dispatch::call_async` 的文档）。注入而非自取，测试可用自建 runtime。
    pub runtime: Arc<crate::common::runtime::AppRuntime>,
    /// 门装载的**活** token 集合（团队形态的 `ExpectedTokens::Shared`）。
    ///
    /// handler 刷新身份表时要同步它 —— 两处必须来自同一次 `principals_from`
    /// （门放行谁 / 认出谁，不能有两份表）。
    pub tokens: SharedTokenSet,
    /// 凭证形状清单（与门**同源**：`team_credentials()`）。
    ///
    /// handler 用它把门放行的请求解析成主体。与门各写一份时，新增形状会出现
    /// 「门按新形状放行、handler 查不到主体」的静默组合（见 `team_credentials` 的文档）。
    pub credentials: Vec<Arc<dyn CredentialExt>>,
    /// 成员执行者（**必填**：组合根总是注入它，见
    /// [`crate::agent::team::execution::apply_effect`] 关于「不留会撒谎的 None 分支」的说明）。
    pub executor: Arc<dyn crate::agent::team::execution::MemberExecutor>,
    /// 成员会话的**读接口**（`team_status` 的花名册用它回答「有没有活会话」）。
    ///
    /// 与 `executor` 同一条理由必须必填：缺席会让工具面对「成员在不在跑」撒谎
    /// （恒 `live=false`），而那是模型据此决定要不要派活的输入。
    pub sessions: Arc<dyn crate::agent::team::view::MemberSessionLookup>,
}

impl TeamServerState {
    /// 从库重建「谁能进 / 谁是誰」：身份表 + 门的期望集合。
    ///
    /// 顺序固定：**先**重建身份表并写入，**再**替换门的集合。反过来会留一个窗口 ——
    /// 门已放行新 hash，而 handler 查表查不到（表现为 200 + 空主体）。
    ///
    /// 调用点只有一个：凭证面（[`CredentialLedger::admit`]）。一次实现，一处调用 ——
    /// 否则「什么时候同步」会散成 N 个点，漏一处就是「新成员永远 401」。
    pub fn refresh_credentials(&self) -> Result<(), AppError> {
        let principals = crate::agent::team::mcp::principals::principals_from(&self.manager)?;
        let hashes = crate::agent::team::mcp::principals::token_hashes(&principals);
        // 先表后门（见方法文档）。
        let mut table = self
            .principals
            .write()
            .map_err(|err| AppError::Unknown(format!("team principals lock poisoned: {err}")))?;
        *table = principals;
        drop(table);
        self.tokens.replace(hashes);
        Ok(())
    }
}

/// 端点实现凭证面：签发 + **同一动作内**认门；以及单独的「只刷新」。
///
/// 顺序（签发 → 刷新）不可拆：拆开就留一个「库里已有新凭证、门还不认识它」的窗口，
/// 而成员进程恰好会在这个窗口里发第一次工具调用（401）。
///
/// `refresh` 是同一个写入点的**另一个入口**：关闭成员会把它行里的 `token_hash` 清空，
/// 但那只是库里的改动 —— 门必须重新组装才会**忘掉**旧 hash。所以 `admit` 与「归档后
/// 失效」共用 [`TeamServerState::refresh_credentials`] 这一份实现（再写一份 = 两个会漂移的
/// 「谁能进」）。
#[async_trait::async_trait]
impl crate::agent::team::execution::CredentialLedger for TeamServerState {
    async fn admit(&self, member_id: &str) -> Result<String, AppError> {
        let manager = Arc::clone(&self.manager);
        let member = member_id.to_owned();
        let token = self
            .runtime
            .spawn_blocking(move || {
                manager.issue_token(&member, crate::agent::team::manager::now_millis())
            })
            .await
            .map_err(|err| AppError::Unknown(format!("issuing a member token failed: {err}")))??;

        // 认门：读库 → 重建身份表 → 替换门的期望集合，整段在阻塞池里（红线 3）。
        self.refresh().await?;
        Ok(token)
    }

    async fn refresh(&self) -> Result<(), AppError> {
        // 读库 + 重建表 = 阻塞 I/O（红线 3）。
        let state = self.clone();
        self.runtime
            .spawn_blocking(move || state.refresh_credentials())
            .await
            .map_err(|err| {
                AppError::Unknown(format!("refreshing team credentials failed: {err}"))
            })??;
        Ok(())
    }
}

/// 组装路由（带 state）。
///
/// 返回 `Router<()>` 供 [`crate::server::RouteGroup`] 持有；**本函数不 bind、不 serve** ——
/// 监听器与端口由组合根决定（它才知道该落哪个 loopback 端口，红线 8 同族）。
pub fn router(state: TeamServerState) -> Router {
    Router::new()
        .route(ENDPOINT_PATH, post(rpc))
        .with_state(state)
}

/// 构造团队 MCP 的路由组（供**组合根**在独立 listener 上 mount）。
///
/// # 为什么是 `FailClosed`
///
/// 本端点面对的是**交互式客户端**（队长/成员的 MCP 客户端）：它们必须看到真实错误。
/// `FailOpen` 会把 panic / 超时 / body 超限归一化成 204 —— 对 hooks（谁在乎）是保护，
/// 对团队是静默失效：模型会以为工具调用成功了。
///
/// # 作用域由组合根决定
///
/// 本函数不 bind、不读端口、不决定「服务哪些团队」（那是 D+E 里 listener 作用域的事），
/// 也不碰 `AppHandle` —— 监听器与成员 token 表都由组合根注入。
#[must_use]
pub fn route_group(state: TeamServerState) -> crate::server::RouteGroup {
    crate::server::RouteGroup {
        name: "team-mcp",
        policy: crate::server::FailurePolicy::FailClosed,
        router: router(state),
    }
}

/// `POST /team/mcp` —— JSON-RPC 2.0 单请求/单响应。
///
/// 顺序是契约：**先身份、后解析**。解析未认证请求的 body 是把 CPU 与错误信息
/// 借给任何本机进程；反过来先认证只会让畸形 body 在鉴权失败时得到 `unauthorized`，
/// 而带合法 token 的畸形 body 仍然得到 `parse error`（客户端能区分两者的前提是它自己有 token）。
async fn rpc(State(state): State<TeamServerState>, headers: HeaderMap, body: Bytes) -> Response {
    let Some(principal) = authenticate(&state, &headers) else {
        log::warn!("[team-mcp] rejected a request without a valid team token");
        return reply(RpcResponse::error(
            Value::Null,
            UNAUTHORIZED,
            "unauthorized",
        ));
    };

    let Ok(body) = serde_json::from_slice::<Value>(&body) else {
        return reply(RpcResponse::error(
            Value::Null,
            PARSE_ERROR,
            "parse error: body is not JSON",
        ));
    };
    let Value::Object(request) = body else {
        return reply(RpcResponse::error(
            Value::Null,
            INVALID_REQUEST,
            "invalid request: body must be a JSON-RPC object",
        ));
    };

    // `id` 原样回显（可以是 string / number / null）；缺失即 `null`（通知形态）。
    let id = request.get("id").cloned().unwrap_or(Value::Null);

    let Some(method) = request.get("method").and_then(Value::as_str) else {
        return reply(RpcResponse::error(
            id,
            INVALID_REQUEST,
            "invalid request: missing string `method`",
        ));
    };

    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
    let outcome = match method {
        "initialize" => Ok(initialize()),
        "tools/list" => Ok(tools_list()),
        "tools/call" => tools_call(&state, &principal, &params).await,
        other => Err(RpcError::new(
            METHOD_NOT_FOUND,
            format!(
                "unknown method `{other}`; this endpoint supports initialize, tools/list, tools/call"
            ),
        )),
    };

    let response = match outcome {
        Ok(result) => RpcResponse::result(id, result),
        Err(error) => RpcResponse {
            jsonrpc: JSONRPC_VERSION,
            id,
            result: None,
            error: Some(error),
        },
    };
    reply(response)
}

/// `initialize` 的结果：协议版本 + 能力 + 服务器标识。
///
/// `capabilities` 里**只有 `tools`** —— 本端点不提供 resources / prompts / logging，
/// 声明它们会让客户去调一个必然 `-32601` 的方法（红线 14 同族）。
fn initialize() -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "neeko-team", "version": env!("CARGO_PKG_VERSION") },
    })
}

/// `tools/list` 的结果：**逐条来自 `schema::TOOLS`**（红线 14：声明即实现）。
///
/// 这里不维护第二份工具清单：新增工具只需改 `schema.rs`，路由、授权、入参校验与
/// 工具列表自动同步；`schema::tests` 的护栏保证清单与 `ToolName` 变体一一对应。
fn tools_list() -> Value {
    let tools: Vec<Value> = schema::TOOLS
        .iter()
        .map(|spec| {
            json!({
                "name": spec.wire,
                "description": spec.summary,
                "inputSchema": input_schema(spec),
            })
        })
        .collect();
    json!({ "tools": tools })
}

/// `spec.input_schema` 字面量 → JSON。
///
/// 字面量写坏由 `schema::tests::every_input_schema_parses_as_a_json_object` 在 CI 拦；
/// 这里退化成一个空 object schema 而不是 panic —— handler 的零 panic 是结构要求
/// （与门同源：handler 崩了只能靠组内 catch-panic 兜）。
fn input_schema(spec: &ToolSpec) -> Value {
    serde_json::from_str(spec.input_schema).unwrap_or_else(|_| json!({ "type": "object" }))
}

/// `tools/call`：入参校验 → 委派 → 把 [`dispatch::ToolReply`] 包成 MCP 文本内容。
///
/// # 为什么是 `async`（P2.4）
///
/// `team_wait` 必须在**工具调用内**阻塞（design §4.3）：队长物理上无法边等边干活。
/// 阻塞靠 `.await`，所以 handler 必须是 `async` 并走 [`dispatch::call_async`] ——
/// 走同步入口会让 `team_wait` 直接 `Unsupported`（那样「服务端阻塞」这个核心能力
/// 在协议层就不存在了）。
async fn tools_call(
    state: &TeamServerState,
    principal: &TeamPrincipal,
    params: &Value,
) -> Result<Value, RpcError> {
    let Some(wire) = params.get("name").and_then(Value::as_str) else {
        return Err(RpcError::new(
            INVALID_PARAMS,
            "missing string `params.name` (the tool wire name, e.g. \"task_list\")".to_owned(),
        ));
    };
    let arguments = match params.get("arguments") {
        None | Some(Value::Null) => json!({}),
        Some(Value::Object(map)) => Value::Object(map.clone()),
        Some(_) => {
            return Err(RpcError::new(
                INVALID_PARAMS,
                "`params.arguments` must be a JSON object".to_owned(),
            ))
        }
    };

    // 业务错误（含授权拒绝）→ `-32000` + `AppError` 的可读文案：它是写给队长模型的
    // 纠正提示（「哪个工具、哪个入参、允许什么」），不是给日志看的状态码。
    let reply = dispatch::call_async(
        &state.runtime,
        &state.manager,
        principal,
        Arc::clone(&state.sessions),
        wire,
        &arguments,
    )
    .await
    .map_err(|err| RpcError::new(SERVER_ERROR, err.to_string()))?;

    // 决策层只落库；**执行在这里**（两相位）。三件事各有唯一的实现：
    //
    // ```text
    // dispatch::effect_for        ToolReply → Option<Effect>（线协议 → 领域副作用）
    // execution::apply_effect     Effect → EffectOutcome（领域副作用 → 动手）
    // dispatch::reply_for         EffectOutcome → ToolReply（结果 → 线协议）
    // ```
    //
    // 本层只负责把它们串起来，以及把错误翻成 JSON-RPC 码。返回的是**执行之后**的回复
    // （`team_close` 的 `teamState` / `membersClosed` 因此是事实而不是意图）。
    let reply = match dispatch::effect_for(&reply) {
        Some(effect) => {
            let outcome = crate::agent::team::execution::apply_effect(
                &state.runtime,
                state,
                state.executor.as_ref(),
                &state.manager,
                &effect,
            )
            .await
            .map_err(|err| RpcError::new(SERVER_ERROR, err.to_string()))?;
            dispatch::reply_for(&reply, outcome)
        }
        // 纯数据回复：决定层给的就是事实，没有副作用要做。
        None => reply,
    };

    // 红线 4：`ToolReply` 里没有任何字段承载 transcript（只有 id / 名字 / 状态 /
    // 租约剩余秒 / 任务行），所以把它整段序列化成文本内容不会把对话正文拖进上下文。
    let text = serde_json::to_string(&reply).map_err(|err| {
        RpcError::new(
            SERVER_ERROR,
            format!("failed to serialize the tool reply: {err}"),
        )
    })?;
    Ok(json!({ "content": [{ "type": "text", "text": text }] }))
}

/// 团队 MCP 的**凭证形状清单**（唯一实现）：门与 [`authenticate`] 共用。
///
/// - 门的消费者是 `agent::team::boot::team_gate`（决定「谁能进来」）；
/// - handler 的消费者是 `authenticate`（决定「进来的是谁」）。
///
/// 两侧各写一份时会出现一个静默组合：门按新形状放行，handler 查不到主体 ⇒ HTTP 200 +
/// JSON-RPC `unauthorized`。rmcp 看到的仍然是认证失败、工具面整体不存在，而访问日志上
/// 那次请求是成功的 —— 比 403 更难查。
#[must_use]
pub(crate) fn team_credentials() -> Vec<Arc<dyn CredentialExt>> {
    vec![
        // JSON 配置形态的成员（claude-code / codebuddy / qoder / pi）：header 名与端点读的
        // 那个常量同源。
        Arc::new(HeaderToken { name: TOKEN_HEADER }),
        // codex 的 `bearer_token_env_var`：`Authorization: Bearer <token>`。
        Arc::new(BearerToken),
    ]
}

/// header token → 主体（`sha256` 后查表，**不做任何恒定时间比较**）。
///
/// 形状清单与门**同源**（[`team_credentials`]）：门放行的候选值必须能在这里解析出主体。
fn authenticate(state: &TeamServerState, headers: &HeaderMap) -> Option<TeamPrincipal> {
    // 锁中毒视同未认证：拒绝比把 `PoisonError` 传给 handler 安全（团队关闭时会重建本表）。
    let principals = state.principals.read().ok()?;
    state.credentials.iter().find_map(|credential| {
        let candidate = credential.extract(headers)?;
        // token 是 32 位十六进制（ASCII）；非 UTF-8 不可能命中，与旧的 `to_str()` 同口径。
        let token = std::str::from_utf8(candidate.as_ref()).ok()?;
        resolve_principal(&principals, token).cloned()
    })
}

/// JSON-RPC 版本字面量（响应里的固定字段）。
const JSONRPC_VERSION: &str = "2.0";

/// JSON-RPC 2.0 响应 envelope。
#[derive(serde::Serialize)]
struct RpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

impl RpcResponse {
    const fn result(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION,
            id,
            result: Some(result),
            error: None,
        }
    }

    fn error(id: Value, code: i64, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION,
            id,
            result: None,
            error: Some(RpcError::new(code, message.into())),
        }
    }
}

/// JSON-RPC 2.0 错误对象。
#[derive(serde::Serialize)]
struct RpcError {
    code: i64,
    message: String,
}

impl RpcError {
    const fn new(code: i64, message: String) -> Self {
        Self { code, message }
    }
}

/// 序列化响应并恒以 200 返回（错误语义在 body 里，见模块文档）。
fn reply(response: RpcResponse) -> Response {
    axum::Json(response).into_response()
}

#[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::fixtures::{fixture_member, fixture_team};
    use crate::agent::team::identity::hash_token;
    use crate::agent::team::mcp::schema::TOOLS;
    use crate::agent::team::store::TeamStore;
    use crate::agent::team::types::{
        AdmissionTier, MemberRole, Team, TeamMember, TeamPrincipal, WorkerChannel,
    };
    use crate::agent::team::TeamManager;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use serde_json::{json, Value};
    use std::sync::{Arc, RwLock};
    use tower::ServiceExt;

    const TEAM: &str = "tm_1";
    const OTHER: &str = "tm_2";
    const LEAD: &str = "lead@tm_1";
    const W1: &str = "w1@tm_1";
    const OUTSIDER: &str = "x9@tm_2";

    const LEAD_TOKEN: &str = "lead-token-0001";
    const W1_TOKEN: &str = "w1-token-0002";
    const OUTSIDER_TOKEN: &str = "x9-token-0003";

    fn team(id: &str) -> Team {
        Team {
            name: format!("team {id}"),
            ..fixture_team(id)
        }
    }

    fn member(id: &str, name: &str, role: MemberRole, team_id: &str, token: &str) -> TeamMember {
        TeamMember {
            name: name.into(),
            role,
            // 落库只存 hash（design §3.1）—— 夹具照同一口径，明文只出现在请求里。
            token_hash: hash_token(token),
            ..fixture_member(id, team_id)
        }
    }

    fn principal(member_id: &str, role: MemberRole, team_id: &str) -> TeamPrincipal {
        TeamPrincipal {
            team_id: team_id.into(),
            member_id: member_id.into(),
            role,
            channel: WorkerChannel::Mcp,
            tier: AdmissionTier::A,
        }
    }

    /// 两张团队 + 三名成员（`x9@tm_2` 是**他队** token，用于跨队拒绝）。
    ///
    /// `principals` 的 key 是 `hash_token(明文)` —— 与 `identity::resolve_principal`
    /// 的查表口径同源，键构造在夹具里显式写出来，不允许实现侧换一套口径。
    fn state() -> TeamServerState {
        state_with(Arc::new(crate::agent::team::fixtures::NoopExecutor))
    }

    /// 同上，但换一个执行者（只有需要断言「交给谁」的用例用它）。
    fn state_with(
        executor: Arc<dyn crate::agent::team::execution::MemberExecutor>,
    ) -> TeamServerState {
        let manager = TeamManager::new(TeamStore::open_in_memory().expect("in-memory store"));
        manager.create_team(team(TEAM)).expect("team");
        manager.create_team(team(OTHER)).expect("other team");
        for (id, name, role, team_id, token) in [
            (LEAD, "lead", MemberRole::Lead, TEAM, LEAD_TOKEN),
            (W1, "w1", MemberRole::Worker, TEAM, W1_TOKEN),
            (OUTSIDER, "x9", MemberRole::Lead, OTHER, OUTSIDER_TOKEN),
        ] {
            manager
                .add_member(member(id, name, role, team_id, token))
                .expect("member");
        }
        let principals = [
            (LEAD_TOKEN, principal(LEAD, MemberRole::Lead, TEAM)),
            (W1_TOKEN, principal(W1, MemberRole::Worker, TEAM)),
            (OUTSIDER_TOKEN, principal(OUTSIDER, MemberRole::Lead, OTHER)),
        ]
        .into_iter()
        .map(|(token, principal)| (hash_token(token), principal))
        .collect();
        TeamServerState {
            manager: Arc::new(manager),
            principals: Arc::new(RwLock::new(principals)),
            // 测试自己建 runtime 再 block_on，`Handle::current()` 在这里是有效的
            // （`state()` 只在 `block_on` 的 async 块内被调用）。
            runtime: Arc::new(crate::common::runtime::AppRuntime::from_handle(
                tokio::runtime::Handle::current(),
            )),
            // 测试直接构造状态、不经门：集合内容不影响 handler 的分支，空集合即可。
            tokens: SharedTokenSet::new(Vec::new()),
            credentials: team_credentials(),
            executor,
            // handler 用例不关心活性：`NoSessions` 恒答「没有活会话」。
            sessions: Arc::new(crate::agent::team::fixtures::AllLiveSessions),
        }
    }

    /// 发一个原始 body 的请求，返回 `(HTTP 状态, JSON-RPC 响应)`。
    ///
    /// 走 `oneshot` 直接驱动 `router()`：真路由、真提取器、真 handler，**不起 listener**。
    async fn post_raw(
        state: &TeamServerState,
        token: Option<&str>,
        raw: &str,
    ) -> (StatusCode, Value) {
        let headers: Vec<(&str, String)> = token
            .map(|token| vec![(TOKEN_HEADER, token.to_owned())])
            .unwrap_or_default();
        post_raw_with_headers(state, &headers, raw).await
    }

    /// 同上，但请求头由调用方给：鉴权形状不止 `TOKEN_HEADER` 一种（见 `team_credentials`）。
    async fn post_raw_with_headers(
        state: &TeamServerState,
        headers: &[(&str, String)],
        raw: &str,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder()
            .method("POST")
            .uri("/team/mcp")
            .header("content-type", "application/json");
        for (name, value) in headers {
            builder = builder.header(*name, value);
        }
        let request = builder
            .body(Body::from(raw.to_owned()))
            .expect("valid request");
        let response = router(state.clone())
            .oneshot(request)
            .await
            .expect("router 是 infallible 服务");
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .expect("body");
        let value = serde_json::from_slice(&bytes).expect("JSON-RPC 响应必须是 JSON");
        (status, value)
    }

    async fn post(
        state: &TeamServerState,
        token: Option<&str>,
        body: Value,
    ) -> (StatusCode, Value) {
        post_raw(state, token, &body.to_string()).await
    }
    /// 执行层端口：`team_spawn` 成功后 handler **必须**把成员交给执行者。
    ///
    /// 只钉这一条：`MemberCreated` 止步于落库 = 成员永远不会起进程，而队长拿到的回复
    /// 长得跟成功一样。凭证刷新（门是否认得新成员）由 `principals` 的端到端用例覆盖。
    #[tokio::test]
    async fn a_created_member_is_handed_to_the_executor() {
        use crate::agent::team::execution::MemberExecutor;
        use std::sync::atomic::{AtomicUsize, Ordering};

        /// 只记「被要求起进程」这一个事实：凭证签发与刷新由 `execution` 的单测钉住。
        struct Recording(AtomicUsize);
        #[async_trait::async_trait]
        impl MemberExecutor for Recording {
            async fn spawn(
                &self,
                member_id: &str,
                token: &str,
                resume_argv: Option<Vec<String>>,
            ) -> Result<String, AppError> {
                assert_eq!(member_id, "w9@tm_1", "执行者拿到的必须是刚落库的成员 id");
                assert!(!token.is_empty(), "执行者必须拿到刚签发的明文凭证");
                assert!(
                    resume_argv.is_none(),
                    "`team_spawn` 永远新开对话（续接只走 `team_resume`）：{resume_argv:?}"
                );
                self.0.fetch_add(1, Ordering::SeqCst);
                Ok("term-w9".to_owned())
            }

            async fn deliver(&self, _member_id: &str, _message: &str) -> Result<(), AppError> {
                panic!("team_spawn 不该触发投递")
            }

            async fn close(&self, _member_id: &str) -> Result<(), AppError> {
                panic!("team_spawn 不该触发关闭")
            }
        }

        let recording = Arc::new(Recording(AtomicUsize::new(0)));
        let state = state_with(recording.clone());

        // 人数护栏：spawn 之前板上必须已有指派给 `w9@tm_1` 的未终结任务
        // （先写计划再起人）。这也顺带验证了 handler 与 dispatch 的同一条链路。
        let (_, planned) = post(
            &state,
            Some(LEAD_TOKEN),
            request(
                "tools/call",
                json!({
                    "name": "task_create",
                    "arguments": {"title": "t", "body": "b", "assignee": "w9@tm_1"}
                }),
            ),
        )
        .await;
        assert_eq!(planned["error"], Value::Null, "{planned}");

        let (_, response) = post(
            &state,
            Some(LEAD_TOKEN),
            request(
                "tools/call",
                json!({
                    "name": "team_spawn",
                    "arguments": {
                        "agent_id": "claude-code",
                        "name": "w9",
                        "workspace": {"kind": "shared"}
                    }
                }),
            ),
        )
        .await;

        assert_eq!(response["error"], Value::Null, "{response}");
        assert_eq!(
            recording.0.load(Ordering::SeqCst),
            1,
            "MemberCreated 必须被交给执行者"
        );
        // 端到端的不变量：签发之后门必须已经认得那个新凭证。
        // （`admit` 的“签发 + 认门同一动作”在真状态上成立，而不只是在一个假体上。）
        assert!(
            !state.tokens.snapshot().is_empty(),
            "admit 必须把新凭证装进门"
        );
    }

    /// `team_send` 的 `NeedsDelivery` 必须真的走到执行层（而不是止步于「已校验」）。
    ///
    /// 反例（本用例挡的正是它）：回复返回成功，但一个字节也没投递 —— 队长会以为成员收到了。
    #[tokio::test]
    async fn a_sent_message_is_handed_to_the_executor() {
        use crate::agent::team::execution::MemberExecutor;

        struct Recorder(std::sync::Mutex<Vec<String>>);
        #[async_trait::async_trait]
        impl MemberExecutor for Recorder {
            async fn spawn(
                &self,
                _member_id: &str,
                _token: &str,
                _resume_argv: Option<Vec<String>>,
            ) -> Result<String, AppError> {
                panic!("team_send 不该触发起进程")
            }

            async fn deliver(&self, member_id: &str, message: &str) -> Result<(), AppError> {
                self.0
                    .lock()
                    .expect("calls")
                    .push(format!("{member_id}:{message}"));
                Ok(())
            }

            async fn close(&self, _member_id: &str) -> Result<(), AppError> {
                panic!("team_send 不该触发关闭")
            }
        }

        let recorder = Arc::new(Recorder(std::sync::Mutex::new(Vec::new())));
        let state = state_with(recorder.clone());

        let (_, response) = post(
            &state,
            Some(LEAD_TOKEN),
            request(
                "tools/call",
                json!({
                    "name": "team_send",
                    "arguments": {"to": "w1@tm_1", "message": "run the tests"}
                }),
            ),
        )
        .await;

        assert_eq!(response["error"], Value::Null, "{response}");
        assert_eq!(
            *recorder.0.lock().expect("calls"),
            vec![format!("{W1}:[team] {LEAD}: run the tests")],
            "NeedsDelivery 必须被交给执行者，且投递文本带**发送者**（不是收件人）"
        );
    }

    fn request(method: &str, params: Value) -> Value {
        json!({"jsonrpc": "2.0", "id": 7, "method": method, "params": params})
    }

    fn error_code(response: &Value) -> i64 {
        response["error"]["code"]
            .as_i64()
            .unwrap_or_else(|| panic!("响应里没有 error.code：{response}"))
    }

    fn error_message(response: &Value) -> String {
        response["error"]["message"]
            .as_str()
            .unwrap_or_else(|| panic!("响应里没有 error.message：{response}"))
            .to_owned()
    }

    // ───────────────────────────────────────────────────────────────
    // 鉴权（design §3.1b：handler 内 hash 查表，HTTP 仍 200）
    // ───────────────────────────────────────────────────────────────

    /// 无 token / 错 token / 他队 token → `-32001`，且 **HTTP 仍是 200**。
    ///
    /// 保护的不变量：JSON-RPC 的错误语义走 body（客户端按 error 分支处理），
    /// 不用 HTTP 状态码表达 —— 成员看到 403 会以为端口打错了，看到 `unauthorized`
    /// 才知道是凭据问题。
    ///
    /// 注：**他队 token 不属于本测试** —— 它在本 listener 上是合法凭据。
    /// 一个 listener 服务哪些团队是**组合根**的决定（D+E：团队流量走独立 listener），
    /// 服务端无从知道自己的作用域，所以不能硬编码「拒绝外队」。
    /// 跨队隔离由 `TeamPrincipal.team_id` 在 `dispatch` 层完成，见
    /// `outsider_token_is_scoped_by_its_principal_team`。
    #[test]
    fn unauthorized_requests_are_json_rpc_errors_over_http_200() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let state = state();
            let body = request("tools/list", json!({}));
            for token in [None, Some("not-a-token"), Some("")] {
                let (status, response) = post(&state, token, body.clone()).await;
                assert_eq!(status, StatusCode::OK, "{token:?} 的 HTTP 状态必须是 200");
                assert_eq!(error_code(&response), -32001, "{token:?}");
                assert_eq!(error_message(&response), "unauthorized");
            }
            // 正例对照：本队 token 必须通过（否则上面的拒绝可能是「全拒」）。
            let (_, response) = post(&state, Some(LEAD_TOKEN), body).await;
            assert!(response["error"].is_null(), "{response}");
        });
    }

    /// codex 的 `bearer_token_env_var` 形态：门与 handler **都**要认。
    ///
    /// 只修门不修 handler 的症状是静默的：403 变成 200 + JSON-RPC `unauthorized`，
    /// rmcp 仍然把 server 丢掉 —— 工具面还是不存在，而访问日志上那次请求是成功的。
    /// 这里直接驱动 handler（门由 `boot::tests` 的护栏覆盖），两层合起来才是「能进门、
    /// 进得来的是谁」。
    #[test]
    fn a_bearer_only_request_resolves_the_same_principal() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let state = state();
            let body = request("tools/list", json!({}));
            let (status, response) = post_raw_with_headers(
                &state,
                &[("authorization", format!("Bearer {LEAD_TOKEN}"))],
                &body.to_string(),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            assert!(
                response["error"].is_null(),
                "Bearer 请求必须解析出主体：{response}"
            );
            assert!(
                response["result"]["tools"].is_array(),
                "Bearer 主体必须拿到工具面：{response}"
            );

            // 反例：同一个形状带错 token 仍然是 `unauthorized`（不是「有 Authorization 就过」）。
            let (_, response) = post_raw_with_headers(
                &state,
                &[("authorization", "Bearer not-a-token".to_owned())],
                &body.to_string(),
            )
            .await;
            assert_eq!(error_code(&response), -32001, "{response}");
            assert_eq!(error_message(&response), "unauthorized");
        });
    }

    /// 他队 token 在传输层是**合法**的（它是另一个团队的队长），但只能看到自己的队。
    ///
    /// 保护的不变量：跨队隔离靠 `TeamPrincipal.team_id`，**不靠端口隔离** ——
    /// 一旦有人把隔离“优化”成「只验 token 存在」，外队就能读到别人的板。
    #[test]
    fn outsider_token_is_scoped_by_its_principal_team() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let state = state();
            let body = request(
                "tools/call",
                json!({"name": "team_status", "arguments": {}}),
            );

            for (token, expected_team) in [(LEAD_TOKEN, TEAM), (OUTSIDER_TOKEN, OTHER)] {
                let (status, response) = post(&state, Some(token), body.clone()).await;
                assert_eq!(status, StatusCode::OK);
                assert!(
                    response["error"].is_null(),
                    "{token} 应当被接受（它是合法凭据）：{response}"
                );
                let text = response["result"]["content"][0]["text"]
                    .as_str()
                    .expect("text");
                let view: Value = serde_json::from_str(text).expect("JSON");
                assert_eq!(
                    view["status"]["teamId"], expected_team,
                    "主体所在的队决定看得到的队"
                );
            }
        });
    }

    // ───────────────────────────────────────────────────────────────
    // 协议：initialize / tools/list / tools/call
    // ───────────────────────────────────────────────────────────────

    #[test]
    fn initialize_advertises_protocol_and_tools_capability() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let (_, response) =
                post(&state(), Some(LEAD_TOKEN), request("initialize", json!({}))).await;
            let result = &response["result"];
            assert_eq!(result["protocolVersion"], PROTOCOL_VERSION);
            assert!(
                result["capabilities"]["tools"].is_object(),
                "initialize 必须声明 tools 能力：{result}"
            );
            assert_eq!(result["serverInfo"]["name"], "neeko-team");
            assert!(result["serverInfo"]["version"].is_string());
        });
    }

    /// `tools/list` 与 `schema::TOOLS` **完全一致**（红线 14：声明即实现）。
    ///
    /// 断言直接引用常量（不硬编码数字），并且逐条比对 wire 名 —— 数量相等但
    /// 名字漂移同样是缺陷（模型按 wire 名调用，名字错了工具就永远调不到）。
    #[test]
    fn tools_list_mirrors_the_schema_catalogue() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let (_, response) =
                post(&state(), Some(LEAD_TOKEN), request("tools/list", json!({}))).await;
            let tools = response["result"]["tools"]
                .as_array()
                .expect("tools/list 必须返回 tools 数组");
            assert_eq!(tools.len(), TOOLS.len());
            for (listed, spec) in tools.iter().zip(TOOLS.iter()) {
                assert_eq!(listed["name"], spec.wire);
                assert_eq!(listed["description"], spec.summary);
                let schema: Value =
                    serde_json::from_str(spec.input_schema).expect("schema 是合法 JSON");
                assert_eq!(listed["inputSchema"], schema);
            }
        });
    }

    /// happy path：`task_list` → `content[0].text` 可反序列化。
    #[test]
    fn task_list_call_returns_serializable_text_content() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let (status, response) = post(
                &state(),
                Some(W1_TOKEN),
                request("tools/call", json!({"name": "task_list", "arguments": {}})),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            let content = response["result"]["content"]
                .as_array()
                .expect("tools/call 必须返回 content 数组");
            assert_eq!(content.len(), 1);
            assert_eq!(content[0]["type"], "text");
            let text = content[0]["text"].as_str().expect("text 必须是字符串");
            let parsed: Value = serde_json::from_str(text).expect("text 必须是 JSON");
            // `ToolReply` 是外部标记枚举（`#[serde(rename_all = "snake_case")]`），
            // 所以载荷自带变体名 —— 模型不用猜「这段数组是什么」。
            assert!(
                parsed["tasks"].is_array(),
                "task_list 的结果在 `tasks` 键下：{parsed}"
            );
        });
    }

    /// 未知工具 → `-32000`，且 message 里列出**已知工具名**（模型据此自我纠正）。
    ///
    /// `team_spawn` 已随 P2.5a 进清单，所以这里用一个真的不存在的 wire
    /// （`team_hire`）—— 下面对 `TOOLS` 的遍历会把它挡成一个「漏了团队工具」的错。
    #[test]
    fn unknown_tool_maps_to_server_error_with_known_names() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let (_, response) = post(
                &state(),
                Some(LEAD_TOKEN),
                request("tools/call", json!({"name": "team_hire", "arguments": {}})),
            )
            .await;
            assert_eq!(error_code(&response), -32000);
            let message = error_message(&response);
            for spec in TOOLS {
                assert!(
                    message.contains(spec.wire),
                    "错误信息漏了 {}：{message}",
                    spec.wire
                );
            }
        });
    }

    /// worker 调 `task_create` → `-32000`（授权矩阵在 dispatch 已逐格测过）。
    ///
    /// 本用例只证明一件事：**拒绝被映射成 JSON-RPC error 而不是 panic / 500**。
    /// 面板与成员都靠这条映射区分「你没权限」和「服务器崩了」。
    #[test]
    fn worker_task_create_maps_to_server_error() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let state = state();
            let (status, response) = post(
                &state,
                Some(W1_TOKEN),
                request(
                    "tools/call",
                    json!({"name": "task_create", "arguments": {"title": "t", "body": "b"}}),
                ),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(error_code(&response), -32000);
            assert!(
                error_message(&response).contains("task_create"),
                "{}",
                error_message(&response)
            );
            // 正例对照：同一入参换队长必须成功（否则上面的拒绝可能是「全拒」）。
            let (_, response) = post(
                &state,
                Some(LEAD_TOKEN),
                request(
                    "tools/call",
                    json!({"name": "task_create", "arguments": {"title": "t", "body": "b", "assignee": "w9@tm_1"}}),
                ),
            )
            .await;
            assert!(response["error"].is_null(), "{response}");
        });
    }

    // ───────────────────────────────────────────────────────────────
    // P2.4：`team_wait` 在工具调用内阻塞
    // ───────────────────────────────────────────────────────────────

    /// `tools/call` 调 `team_wait`（已满足场景）→ `content[0].text` 可解析且带 `satisfied`。
    ///
    /// 保护的不变量：`tools_call` 走的是**异步**入口 —— 若它仍走同步 `dispatch::call`，
    /// 这条用例会拿到 `-32000 Unsupported`（阻塞能力在协议层就消失了）。
    #[test]
    fn team_wait_call_returns_a_satisfied_text_content() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let state = state();
            // 把 w1 推到 `Idle`（「说完了」），`until=idle` 因此立刻满足。
            state
                .manager
                .observe_signal(
                    W1,
                    crate::agent::team::types::MemberSignal::TurnCompleted,
                    1_000,
                )
                .expect("signal");

            let (status, response) = post(
                &state,
                Some(LEAD_TOKEN),
                request(
                    "tools/call",
                    json!({
                        "name": "team_wait",
                        "arguments": {
                            "on": {"members": [W1]},
                            "until": "idle",
                            "timeout_s": 5
                        }
                    }),
                ),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            assert!(response["error"].is_null(), "{response}");

            let text = response["result"]["content"][0]["text"]
                .as_str()
                .expect("text");
            let parsed: Value = serde_json::from_str(text).expect("text 必须是 JSON");
            // `ToolReply::Wait` 是外部标记枚举 → `{"wait": {"satisfied": {"snapshot": …}}}`。
            let snapshot = &parsed["wait"]["satisfied"]["snapshot"];
            assert!(snapshot.is_object(), "{parsed}");
            assert_eq!(snapshot["teamId"], TEAM);
            assert_eq!(snapshot["members"][0]["memberId"], W1);
        });
    }

    /// worker 调 `team_wait` **不被授权拒绝**（dispatch 层已逐格测过授权）。
    ///
    /// 本用例只证明一件事：那张「要等谁」的判定被**映射成正常结果**而不是 JSON-RPC error
    /// —— 两角色均放行的矩阵格在协议层同样成立。
    #[test]
    fn worker_team_wait_maps_to_a_result_not_a_rejection() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let state = state();
            state
                .manager
                .observe_signal(
                    LEAD,
                    crate::agent::team::types::MemberSignal::TurnCompleted,
                    1_000,
                )
                .expect("signal");

            let (status, response) = post(
                &state,
                Some(W1_TOKEN),
                request(
                    "tools/call",
                    json!({
                        "name": "team_wait",
                        "arguments": {
                            "on": {"members": [LEAD]},
                            "until": "idle",
                            "timeout_s": 5
                        }
                    }),
                ),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            assert!(
                response["error"].is_null(),
                "worker 不该被授权拒绝：{response}"
            );
            assert!(
                response["result"]["content"][0]["text"]
                    .as_str()
                    .is_some_and(|text| text.contains("satisfied")),
                "{response}"
            );
        });
    }

    // ───────────────────────────────────────────────────────────────
    // 协议级错误
    // ───────────────────────────────────────────────────────────────

    /// 畸形 JSON body → `-32700`；不是对象的 JSON 数组 → `-32600`。均不 panic
    /// （handler 的零 panic 是结构要求：崩了就只剩组内 catch-panic 兜底）。
    #[test]
    fn malformed_body_is_rejected_without_panicking() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            for raw in ["{", "", "not json"] {
                let (status, response) = post_raw(&state(), Some(LEAD_TOKEN), raw).await;
                assert_eq!(status, StatusCode::OK, "{raw:?}");
                assert_eq!(error_code(&response), -32700, "{raw:?} -> {response}");
            }
            // 合法 JSON 但不是对象：envelope 不成形，`-32600`（不是 parse error）。
            let (_, response) = post_raw(&state(), Some(LEAD_TOKEN), "[1,2,3]").await;
            assert_eq!(error_code(&response), -32600, "{response}");
            // 没有 `method` 的对象同理。
            let (_, response) = post_raw(&state(), Some(LEAD_TOKEN), "{\"id\":1}").await;
            assert_eq!(error_code(&response), -32600, "{response}");
            assert_eq!(response["id"], 1, "错误响应必须回显 id");
        });
    }

    /// 未知方法 → `-32601`（不是 `-32000`：客户端要能区分「方法不存在」与「服务器失败」）。
    #[test]
    fn unknown_method_is_method_not_found() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let (_, response) = post(
                &state(),
                Some(LEAD_TOKEN),
                request("resources/list", json!({})),
            )
            .await;
            assert_eq!(error_code(&response), -32601);
            assert!(error_message(&response).contains("resources/list"));
        });
    }

    /// `tools/call` 参数非法（缺 name / arguments 非 object）→ `-32602`。
    #[test]
    fn invalid_tool_call_params_are_invalid_params() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let state = state();
            for params in [
                json!({}),
                json!({"name": 42}),
                json!({"name": "task_list", "arguments": "nope"}),
            ] {
                let (_, response) = post(
                    &state,
                    Some(LEAD_TOKEN),
                    request("tools/call", params.clone()),
                )
                .await;
                assert_eq!(error_code(&response), -32602, "{params} -> {response}");
            }
        });
    }

    /// 路由组契约：`FailClosed` + 稳定组名。
    ///
    /// 保护的不变量：团队端点的失败策略**不得**被改成 `FailOpen` ——
    /// 那会把 panic/超时伪装成 204，模型会以为工具成功了（与 hooks 的取舍相反）。
    /// 需要 `Handle::current()`（`state()` 会注入测试 runtime），故走 `#[tokio::test]`。
    #[tokio::test]
    async fn route_group_is_fail_closed_and_named() {
        let group = route_group(state());
        assert_eq!(group.name, "team-mcp");
        assert_eq!(group.policy, crate::server::FailurePolicy::FailClosed);
    }

    // ───────────────────────────────────────────────────────────────
    // 载荷边界（红线 4）
    // ───────────────────────────────────────────────────────────────

    /// `team_status` 的载荷**不含 transcript**：只有 id / 名字 / 角色 / 状态 / 租约。
    ///
    /// 保护的不变量：MCP 响应是恒定小载荷。一旦某个字段开始承载对话正文，
    /// 队长每轮工具调用都会把整段 transcript 拖进上下文（红线 4 的团队版）。
    #[test]
    fn status_payload_carries_no_transcript() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let (_, response) = post(
                &state(),
                Some(LEAD_TOKEN),
                request(
                    "tools/call",
                    json!({"name": "team_status", "arguments": {}}),
                ),
            )
            .await;
            let text = response["result"]["content"][0]["text"]
                .as_str()
                .expect("text");
            let view: Value = serde_json::from_str(text).expect("JSON");
            // 外部标记枚举：整段是 `{"status": {...}}`，键集校验要下钻一层。
            let view = &view["status"];
            let keys: Vec<&str> = view
                .as_object()
                .expect("status 是 object")
                .keys()
                .map(String::as_str)
                .collect();
            assert_eq!(
                keys,
                vec![
                    "teamId",
                    "teamState",
                    // 成员数（**不含队长**）：与团队清单的 `memberCount` 同一个数
                    // （`TeamManager::member_count`）。面板曾经只能用 `members.length`
                    // （含队长）来代替它 —— 于是同一个队有两个成员数。
                    "memberCount",
                    "members",
                    "taskTotal",
                    "taskOpen",
                    "taskDone"
                ]
            );
            for row in view["members"].as_array().expect("members 数组") {
                let keys: Vec<&str> = row
                    .as_object()
                    .expect("member 是 object")
                    .keys()
                    .map(String::as_str)
                    .collect();
                // `verification` 与 `state` 必须一起到（AC2：`idle` + `unverified` 才是
                // 「空闲 ⚠ 未声明」；只给 state 时这两种行在线上不可区分）。
                assert_eq!(
                    keys,
                    vec![
                        "memberId",
                        "name",
                        "role",
                        "state",
                        "verification",
                        "leaseRemainingSecs",
                        "agentId",
                        "session",
                        "workspace",
                        "agentSessionId",
                        "sealed",
                        "resumable",
                        "persona",
                        "channel",
                        "tier"
                    ]
                );
            }
        });
    }
}
