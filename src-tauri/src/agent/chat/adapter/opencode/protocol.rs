//! 协议层：`ServeProtocol` + 端点/载荷构造（纯函数）。
//!
//! 这张表是双栈的**唯一**分派点。调用点不得自行判断版本 —— 所有差异都通过
//! `ServeProtocol` 的方法查出来。

/// 一次 `opencode serve` 进程所讲的应用层协议。
///
/// 判定依据是**能力**（`GET /api/info` 是否返回 JSON），不是版本号字符串：
/// 1.19 与 2.0 的 `--version` 输出格式都不同（`1.19.0` vs `opencode v2.0.32`），
/// 且 1.18–1.20 的小版本还没穷举。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ServeProtocol {
    /// ≤ 1.19：`/session`、`/event?directory=`、`prompt_async`。
    V1,
    /// ≥ 2.0：`/api/*` + Basic 认证。
    V2,
}

impl ServeProtocol {
    /// 端点前缀。**这是全部端点差异的唯一来源** —— 其余方法都基于它拼路径。
    #[must_use]
    pub(super) const fn prefix(self) -> &'static str {
        match self {
            Self::V1 => "",
            Self::V2 => "/api",
        }
    }

    /// 建会话路径（不含 base_url）。
    #[must_use]
    pub(super) fn session_create_path(self) -> String {
        format!("{}/session", self.prefix())
    }

    /// 建会话 URL。V1 带 `?directory=`；V2 的目录在 body（`location.directory`）。
    ///
    /// 实测 2.0：`?directory=` 被**忽略**，会话落到 serve 进程 cwd。
    #[must_use]
    pub(super) fn session_create_url(self, base_url: &str, project_id: &str) -> String {
        match self {
            Self::V1 => format!(
                "{base_url}{}?directory={}",
                self.session_create_path(),
                urlencoding::encode(project_id)
            ),
            Self::V2 => format!("{base_url}{}", self.session_create_path()),
        }
    }

    /// 读单个会话（resume 存在性探测 + 建会话后的回读校验）。
    #[must_use]
    pub(super) fn session_get_path(self, session_id: &str) -> String {
        format!("{}/session/{session_id}", self.prefix())
    }

    /// 发一轮 prompt。V1 是 `prompt_async`，V2 是 `prompt`。
    #[must_use]
    pub(super) fn prompt_path(self, session_id: &str) -> String {
        let verb = match self {
            Self::V1 => "prompt_async",
            Self::V2 => "prompt",
        };
        format!("{}/session/{session_id}/{verb}", self.prefix())
    }

    /// 模型列表端点 —— **两版都是 `/api/model`，不受 [`Self::prefix`] 影响**。
    ///
    /// # 这是唯一一个前缀不随协议变的端点
    ///
    /// 实测（真 `opencode serve`，两版各一次）：
    ///
    /// | 路径 | 1.19.0 | 2.0.32 |
    /// | --- | --- | --- |
    /// | `/model` | `200 text/html`（SPA 回落） | `200 text/html`（SPA 回落） |
    /// | `/api/model` | `200 application/json`（**206 条**） | `200 application/json`（**167 条**） |
    ///
    /// 1.19 把模型目录放在 `/api/model`（它的 `/api` 并非"v2 专属"），
    /// 2.0 也保留了它。所以这里是**两版共用的固定路径**，按 `prefix()` 拼会给
    /// V1 得到 `/model` —— 拿到 HTML 而当空列表处理。
    ///
    /// 响应字段名仍分两版（1.19 `data[].id`，2.0 `data[].modelID`），
    /// 由 `adapter::models_from_api_response` 同时接受。
    #[must_use]
    pub(super) const fn models_path(self) -> &'static str {
        // 有意不使用 `self`：两个协议共用同一路径（见上方说明）。
        // 保留 `self` 接收者是为了让调用点统一写成 `protocol.models_path()` ——
        // 那面「所有端点都查协议」的一致性比省一个参数更重要。
        let _ = self;
        "/api/model"
    }

    /// 命令列表端点 —— **两版共用 `/api/command`**，同 [`Self::models_path`]
    /// 的形状（前缀不随协议变）。
    ///
    /// # 取证与推断的边界（说清楚，不要读成已实测）
    ///
    /// **已实测（2.1.3）**：`/api/command` → `200 application/json`
    ///（`{location, data:[{name, description, …}]}`）；无前缀的 `/command`
    /// → `200 text/html`（SPA 回落，不是端点）。
    ///
    /// **未实测（1.19）**：本机只有 2.1.3，1.x 上该端点没有一手取证。
    /// 但 1.x 的 `/api/*` 是**渐进迁移的共享层**，不是 v2 专属 —— 已实测的先例：
    ///
    /// | 端点 | 1.19.0 | 2.0.32 |
    /// | --- | --- | --- |
    /// | `/api/model` | ✅ JSON | ✅ JSON |
    /// | `/api/session`（POST） | ✅ 200 | ✅ 200 |
    /// | `/api/event`（GET） | ✅ 200 | ✅ 200 |
    /// | `/api/info` | ❌ SPA 回落 | ✅ JSON（这正是协议判据） |
    ///
    /// 所以这里**按共用路径实现，并让运行时决定真相**：真没有的版本会在
    /// 请求上失败（HTML/404），由 `list_commands` 的失败路径处理，
    /// 而不是由本方法**猜**一个 `None`。
    ///
    /// 判据（可推广）：**「不确定某端点是否存在」不能用静态假设表达，
    /// 要么取证，要么把它降级成运行时探测。** 猜 `None` 与猜 `Some` 一样错，
    /// 只是一个把功能藏起来、一个把报错露出来。
    #[must_use]
    pub(super) const fn commands_path(self) -> &'static str {
        // 有意不使用 `self`：两版共用同一路径（同 `models_path` 的先例）。
        // 保留 `self` 接收者是为了让调用点统一写成 `protocol.commands_path()`。
        let _ = self;
        "/api/command"
    }

    /// 回落用的 CLI 参数。
    ///
    /// | 版本 | 命令 | 原因 |
    /// | --- | --- | --- |
    /// | 1.19 | `models --verbose` | NDJSON 带 `limit.context` |
    /// | 2.0 | `models` | **`--verbose` 在 2.0 被移除**（实测 `Unrecognized flag`, exit 1） |
    ///
    /// 在 2.0 上传 `--verbose` 的后果是命令失败 → 模型选择器空着 + 日志刷 ERROR。
    #[must_use]
    pub(super) fn cli_models_args(self) -> Vec<&'static str> {
        match self {
            Self::V1 => vec!["models", "--verbose"],
            Self::V2 => vec!["models"],
        }
    }

    /// 切换会话 agent（plan / build）。
    ///
    /// | 版本 | 通道 |
    /// | --- | --- |
    /// | V1 | `prompt_async` 的 `agent` 字段（per-prompt） |
    /// | V2 | `POST /api/session/{id}/agent` `{"agent":"plan"}` → `204` |
    ///
    /// 实测 2.0：`{"agent":"nope"}` 对不存在的 agent 也返回 **204** ——
    /// 静默接受，所以调用方必须自己保证值来自真实列表。
    #[must_use]
    pub(super) fn agent_switch_path(self, session_id: &str) -> String {
        format!("{}/session/{session_id}/agent", self.prefix())
    }

    /// 切模型端点。**仅 V2 有独立端点** —— V1 的模型是 per-prompt 参数。
    #[must_use]
    pub(super) fn model_switch_path(self, session_id: &str) -> String {
        format!("{}/session/{session_id}/model", self.prefix())
    }

    /// 提问回执端点。
    ///
    /// | 版本 | 形状 |
    /// | --- | --- |
    /// | V1 | `POST /question/{rid}/reply?directory=` |
    /// | V2 | `POST /api/session/{sid}/form/{fid}/reply` |
    #[must_use]
    pub(super) fn question_reply_path(self, session_id: &str, request_id: &str) -> String {
        match self {
            Self::V1 => format!("/question/{request_id}/reply"),
            Self::V2 => format!(
                "{}/session/{session_id}/form/{request_id}/reply",
                self.prefix()
            ),
        }
    }

    /// SSE 流端点。
    #[must_use]
    pub(super) fn event_path(self) -> String {
        format!("{}/event", self.prefix())
    }

    /// 中止当前轮。V1 `/abort`，V2 `/interrupt`（2.0 不存在 abort）。
    #[must_use]
    pub(super) fn abort_path(self, session_id: &str) -> String {
        let verb = match self {
            Self::V1 => "abort",
            Self::V2 => "interrupt",
        };
        format!("{}/session/{session_id}/{verb}", self.prefix())
    }

    /// 权限回执。
    #[must_use]
    pub(super) fn permission_reply_path(self, session_id: &str, request_id: &str) -> String {
        match self {
            // V1 是全局路由，directory 走 query（由调用方拼）。
            Self::V1 => format!("/session/{session_id}/permissions/{request_id}"),
            Self::V2 => format!(
                "{}/session/{session_id}/permission/{request_id}/reply",
                self.prefix()
            ),
        }
    }
}

/// 从探测响应判定协议。
///
/// 判据是 **Content-Type** 而不是状态码：1.19 对 `/api/info` 返回
/// `200 text/html`（未匹配路由回落 SPA），只看状态码会把 1.x 误判成 2.x。
///
/// 探测失败（401 / 404 / 连接错误）→ `V1`。1.x 是既有用户盘面，
/// 误判成 V2 会打断已经在工作的人；反过来 V1 上的 2.x 会在建会话时暴露。
#[must_use]
pub(super) fn detect_protocol(status: u16, content_type: &str) -> ServeProtocol {
    let is_json = content_type.contains("application/json");
    if status == 200 && is_json {
        ServeProtocol::V2
    } else {
        ServeProtocol::V1
    }
}

use crate::agent::chat::adapter::AgentContext;

pub(super) fn model_slug_split(id: &str) -> (String, String) {
    match id.split_once('/') {
        Some((provider, model)) => (provider.to_string(), model.to_string()),
        None => (String::new(), id.to_string()),
    }
}

/// Build the `{ providerID, modelID }` object accepted by opencode serve.
/// Returns `None` when there is no usable model (absent, or a bare id without
/// a provider prefix) — the server then uses its default model.
pub(super) fn model_body(model_id: Option<&str>) -> Option<serde_json::Value> {
    let id = model_id?;
    let (provider_id, model_id) = model_slug_split(id);
    if provider_id.is_empty() {
        return None;
    }
    Some(serde_json::json!({
        "providerID": provider_id,
        "modelID": model_id,
    }))
}

/// Build the `POST /session` body, per protocol. Model is intentionally omitted
/// (serve rejects it on create; model selection happens per prompt).
///
/// # 两版的形状完全不同，且**字段名用错不会报错**
///
/// | 版本 | 目录 | confirm 规则字段 |
/// | --- | --- | --- |
/// | V1 | `?directory=` query | `permission: [{permission, pattern, action}]` |
/// | V2 | `location.directory`（body） | `permissions: [{action, resource, effect}]` |
///
/// 实测 2.0：收到 V1 的 `permission` 字段返回 **200 并静默丢弃** ——
/// confirm 模式于是变成 auto，用户在无人审批的情况下被直接改文件。
/// 反过来 V2 的 `permissions` 在 1.19 上会 400。
pub(super) fn session_create_body(
    protocol: ServeProtocol,
    ctx: &AgentContext,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "title": format!("Neeko {}", ctx.project_name),
    });
    match protocol {
        ServeProtocol::V1 => {
            if ctx.mode == "confirm" {
                body["permission"] = serde_json::json!([
                    { "permission": "*", "pattern": "*", "action": "ask" }
                ]);
            }
        }
        ServeProtocol::V2 => {
            // 目录必须在 body：2.0 忽略 `?directory=`。
            body["location"] = serde_json::json!({ "directory": ctx.cwd });
            if ctx.mode == "confirm" {
                body["permissions"] = serde_json::json!([
                    { "action": "*", "resource": "*", "effect": "ask" }
                ]);
            }
        }
    }
    body
}

/// Build the `POST /session` URL, per protocol.
///
/// V1 走 `?directory=` query（多目录服务的路由键）；V2 把目录放进 body，
/// URL 不带 query。委托给 [`ServeProtocol::session_create_url`] 以保证
/// 「差异只有一个来源」。
pub(super) fn session_create_url(
    protocol: ServeProtocol,
    base_url: &str,
    ctx: &AgentContext,
) -> String {
    protocol.session_create_url(base_url, &ctx.cwd)
}

/// 发 prompt 的请求体，按协议分叉。
///
/// | 版本 | 形状 | model 字段 |
/// | --- | --- | --- |
/// | V1 | `{parts:[{type:"text",text}], model?}` | **per-prompt**（生效） |
/// | V2 | `{text}` | **无** —— 实测被静默忽略，切模型必须走 `/model` 端点 |
///
/// V2 传 `model` 不是错误但会 `200` 后按默认模型跑，所以这里干脆不构造它：
/// 「发了但不起作用」比「没发」更难查。
pub(super) fn prompt_body_for(
    protocol: ServeProtocol,
    prompt: &str,
    model_id: Option<&str>,
) -> serde_json::Value {
    match protocol {
        ServeProtocol::V1 => {
            let mut body = serde_json::json!({
                "parts": [{ "type": "text", "text": prompt }]
            });
            if let Some(m) = model_body(model_id) {
                body["model"] = m;
            }
            body
        }
        ServeProtocol::V2 => serde_json::json!({ "text": prompt }),
    }
}

/// 权限回执请求体，按协议分叉。
///
/// | 版本 | 字段 | 取值 |
/// | --- | --- | --- |
/// | V1 | `response` | `once` / `reject` |
/// | V2 | `decision` | `once` / `always` / `reject` |
pub(super) fn permission_reply_body(protocol: ServeProtocol, allow: bool) -> serde_json::Value {
    match protocol {
        ServeProtocol::V1 => serde_json::json!({
            "response": if allow { "once" } else { "reject" }
        }),
        ServeProtocol::V2 => serde_json::json!({
            "decision": if allow { "once" } else { "reject" }
        }),
    }
}

/// 切模型请求体（仅 V2 使用）。
///
/// **`id` 不是 `modelID`** —— 实测 2.0：传 `modelID` 得到
/// `400 Missing key at ["model"]["id"]`。同一份 `ModelInfo` 在 V1 的
/// per-prompt 载荷里叫 `modelID`，在这里叫 `id`，两处不同名。
pub(super) fn model_switch_body(provider_id: &str, model_id: &str) -> serde_json::Value {
    serde_json::json!({
        "model": { "providerID": provider_id, "id": model_id }
    })
}

/// 同 [`model_switch_body`]，额外带上思考等级（`variant`）。
///
/// `Model.Ref` 的可选字段 `variant` 就是思考等级：
///
/// ```jsonc
/// // 实测 2.0.32：models[].variants[] = [{id:"low",settings:{reasoningEffort:"low"}}, ...]
/// POST /api/session/{id}/model {"model":{"providerID":"opencode","id":"…","variant":"high"}}
/// // → 204，随后 session.step.started.data.model.variant == "high"
/// ```
///
/// 单独一个函数而不是给 `model_switch_body` 加 `Option` 参数：调用点分两类
/// （只切模型 / 切模型+档位），两个具名函数比一个 `None` 更好读。
pub(super) fn model_switch_body_with_variant(
    provider_id: &str,
    model_id: &str,
    variant: Option<&str>,
) -> serde_json::Value {
    let mut body = model_switch_body(provider_id, model_id);
    if let Some(v) = variant {
        body["model"]["variant"] = serde_json::Value::String(v.to_string());
    }
    body
}

/// 提问回执请求体，按协议分叉。
///
/// | 版本 | 形状 |
/// | --- | --- |
/// | V1 | `{answers: [["text"]]}`（二维数组，支持一组字段的多个答案） |
/// | V2 | `{answer: {"<fieldKey>": "<value>"}}`（按字段 key 映射） |
///
/// V2 的 key 必须与 `form.created` 里 `fields[].key` 一致，否则回执被拒。
pub(super) fn question_reply_body(
    protocol: ServeProtocol,
    field_key: &str,
    answer: &str,
) -> serde_json::Value {
    match protocol {
        ServeProtocol::V1 => serde_json::json!({ "answers": [[answer]] }),
        ServeProtocol::V2 => serde_json::json!({
            "answer": { field_key: answer }
        }),
    }
}

/// 发 prompt 的请求体，额外支持 per-prompt 的模式与思考等级。
///
/// # V1 的 `agent` / `variant` 只能走这里
///
/// 1.19 没有「立即改模式」的端点，档位也没有独立通道 —— 两者都只能随 prompt 下发。
/// 所以用户点选后必须记住、下一次 Turn 带上（见 `PendingTurnOptions`）。
///
/// # V2 也接受这两个字段
///
/// 实测：2.0 的 `prompt` 带 `agent: "plan"` 返回 200 并且**生效**
/// （`session.step.started.data.agent == "plan"`）。所以两版共用同一份载荷构造，
/// 差异只在「是否还有额外的即时通道」。
///
/// 注意 `variant` 在 V2 的正确位置是 `Model.Ref.variant`（随切模型下发），
/// 不是一个顶层字段；顶层发它不仅无效，还可能被当作未知键拒绝。所以这里
/// **只对 V1** 写 `variant`。
pub(super) fn prompt_body_with_options(
    protocol: ServeProtocol,
    prompt: &str,
    model_id: Option<&str>,
    agent: Option<&str>,
    variant: Option<&str>,
) -> serde_json::Value {
    match protocol {
        ServeProtocol::V1 => {
            let mut body = serde_json::json!({
                "parts": [{ "type": "text", "text": prompt }]
            });
            if let Some(m) = model_body(model_id) {
                body["model"] = m;
            }
            if let Some(a) = agent {
                body["agent"] = serde_json::Value::String(a.to_string());
            }
            // V1 的档位是模型引用的一部分（`{providerID, modelID, variant}`）。
            if let Some(v) = variant {
                if let Some(model) = body.get_mut("model") {
                    model["variant"] = serde_json::Value::String(v.to_string());
                }
            }
            body
        }
        ServeProtocol::V2 => {
            // V2 的 prompt 只有 `text`（+ 实测可接受的 `agent`）；
            // 档位走 `POST .../model` 的 `variant`，不在这里。
            let mut body = serde_json::json!({ "text": prompt });
            if let Some(a) = agent {
                body["agent"] = serde_json::Value::String(a.to_string());
            }
            body
        }
    }
}
