use async_trait::async_trait;

use crate::agent::chat::adapter::{
    AgentAdapter, AgentCommand, AgentContext, AgentKind, AgentSession,
};
use crate::agent::chat::capabilities::{ChatCapabilities, ConfigCapability};
use crate::common::agent::types::{AgentConfig, ModelInfo};
use crate::common::error::AppError;

use super::config_options::{self, ConfigState};
use super::connection::{fetch_json, serve_connection, ServeConnection};
use super::protocol::{session_create_body, session_create_url, ServeProtocol};
use super::request::attach_streaming;

/// Serve-backed adapter for opencode (`serve` REST + SSE transport).
///
/// 一个进程级的 `opencode serve` 被所有会话共享（见 `connection.rs` 的
/// `OnceCell`）。模型切换走**每轮请求参数**，不产生 `config_option_update`。
///
/// # `cmd` / `env` 只对首次生成的 serve 进程生效
///
/// serve 是进程级单例：第一个会话触发的 spawn 决定了程序名、参数与环境变量，
/// 后续会话复用同一个 server。见 `connection::serve_connection`。
#[derive(Default)]
pub struct ServeAdapter {
    /// 完整的 serve 启动命令（`argv[0]` + `serve` 子命令等）。
    cmd: Vec<String>,
    /// 注入给 serve 进程的环境变量（内部密码在其后覆盖）。
    env: std::collections::BTreeMap<String, String>,
}

impl ServeAdapter {
    /// Create a serve-backed adapter.
    #[must_use]
    pub const fn new(cmd: Vec<String>, env: std::collections::BTreeMap<String, String>) -> Self {
        Self { cmd, env }
    }
}

/// `opencode models --verbose` 快速路径。
#[async_trait]
impl AgentAdapter for ServeAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Opencode
    }

    /// serve 的模型切换靠 **每轮 HTTP 请求参数**（`Turn { model_id }`），
    /// 不走 `set_config_option`，也不产生 `config_option_update`。
    ///
    /// 这正是 P1 的例子：旧 `supports_model_selection` 对它返回 true，
    /// 前端据此以为「可以切模型」，但点选后走 `set_config_option` 是空实现 ——
    /// 静默无操作。`PerTurn` 把机制差异表达出来。
    /// `commands` 为 `true`：`/api/command` 与 `/api/model` 同属 `/api/*`
    /// 共享层，两版都按同一路径实现（证据表见 `ServeProtocol::commands_path`）。
    ///
    /// **「端点可能不存在」由运行时回答，不由静态声明兜底**：真没有该端点的
    /// 版本会让查询失败（前端显示空态，`useAgentCommands` 已按「失败 → 空数组
    /// 降级、不打断输入」处理），而不是让 `/` 入口永久消失。
    ///
    /// 这是对早先「静态 false + 会话期派生」那版实现的修正：那版把**未取证**
    /// 当成了**不支持**，代价是 V1 用户失去整个功能。判据写在
    /// `commands_path` 的文档里。
    fn chat_capabilities(&self) -> ChatCapabilities {
        ChatCapabilities {
            config: ConfigCapability::PerTurn,
            approvals: true,
            commands: true,
            resume: true,
        }
    }

    /// 会话外模型列表，**两版都可用**。
    ///
    /// # 三条路径，按可靠性排序
    ///
    /// 1. `GET {prefix}/model` —— 两版都有、结构化、且**复用已经建好的连接与探测**。
    ///    这是主路径：不需要再 spawn 一次 `opencode`。
    /// 2. `opencode models --verbose` —— 仅 V1。NDJSON 带 `limit.context`。
    /// 3. `opencode models` —— V2 的唯一 CLI 形式（`--verbose` 在 2.0 被移除）。
    ///
    /// # 为什么 2.0 上调用 `--verbose` 是 bug 而不是低效
    ///
    /// 实测 2.0.32：`ERROR Unrecognized flag: --verbose`、exit 1。后果不是
    /// 「少一点信息」，而是**整个列表为空** + 每次刷新刷一条 ERROR 日志。
    /// 错误版本上甚至还会尝试拉起 managed service（无外部 service 时端口冲突 → exit 1）。
    async fn list_models(&self, config: &AgentConfig) -> Result<Vec<ModelInfo>, AppError> {
        // 主路径：HTTP，两版通用。
        if let Ok(conn) = serve_connection(&self.cmd, &self.env).await {
            let url = format!("{}{}", conn.base_url, conn.protocol.models_path());
            if let Some(json) = fetch_json(&conn.client, &url).await {
                let models = models_from_api_response(&json);
                if !models.is_empty() {
                    return Ok(models);
                }
                log::warn!("[ServeAdapter] /model returned no usable entries; falling back to CLI");
            }
        }

        // 回落：CLI。参数按协议选（V2 不带 --verbose）。
        //
        // 拿不到连接时按 V1 处理：这是既有用户盘面，且 1.x 的 --verbose 路径
        // 是历史上唯一可用的那条。
        let protocol = match serve_connection(&self.cmd, &self.env).await {
            Ok(conn) => conn.protocol,
            Err(_) => ServeProtocol::V1,
        };
        let binary = (!config.command.is_empty()).then(|| config.command.clone());
        let args = protocol.cli_models_args();
        crate::agent::model_discovery::discover_opencode_models_with_args(binary, &args).await
    }

    /// 查命令列表（`GET /api/command`，两版共用路径）。
    ///
    /// # 两个必须处理的现实
    ///
    /// 1. **命令发现是异步的**：实测同一 server 连续三次请求拿到
    ///    `0 → 2 → 5` 条。server 启动后才开始扫配置与项目目录，
    ///    所以「第一次拿到空数组」不等于「没有命令」。这里做有界重试。
    /// 2. **端点是否存在由运行时回答**：1.x 上该端点没有一手取证，路径按
    ///    `/api/*` 共享层实现（见 `ServeProtocol::commands_path` 的证据表）。
    ///    真没有的版本会在请求上失败 → 走失败路径，而不是靠静态假设藏功能。
    ///
    /// # 为什么带 `?directory=`
    ///
    /// 项目级命令（`<project>/.opencode/commands/**`）只在请求带上项目目录时
    /// 才被纳入。不带参时 serve 用它自己的 cwd，拿到的是用户级命令的子集。
    async fn list_commands(
        &self,
        _config: &AgentConfig,
        directory: Option<&str>,
    ) -> Result<Vec<AgentCommand>, AppError> {
        let conn = serve_connection(&self.cmd, &self.env).await?;
        fetch_commands_with_retry(conn, conn.protocol.commands_path(), directory).await
    }

    async fn create(&self, ctx: &AgentContext) -> Result<Box<dyn AgentSession>, AppError> {
        let conn = serve_connection(&self.cmd, &self.env).await?;
        let protocol = conn.protocol;

        // ── 1. Create the serve session ───────────────────────────────────
        let resp = conn
            .client
            .post(session_create_url(protocol, &conn.base_url, ctx))
            .json(&session_create_body(protocol, ctx))
            .send()
            .await
            .map_err(|e| AppError::Io(format!("serve POST /session failed: {e}")))?;
        if !resp.status().is_success() {
            return Err(AppError::Agent(format!(
                "serve POST /session: HTTP {}",
                resp.status()
            )));
        }
        let session_json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::Io(format!("serve session response parse: {e}")))?;
        // V1 的响应是裸对象 `{id}`；V2 包了一层 `{data:{id}}`。
        let serve_sid = extract_session_id(protocol, &session_json)
            .ok_or_else(|| {
                AppError::Agent(format!(
                    "serve session response missing id ({protocol:?}): {session_json}"
                ))
            })?
            .to_string();
        log::info!(
            "[ServeAdapter] session created: {} (serve id {serve_sid}, {protocol:?})",
            ctx.session_id
        );

        // V2：回读校验目录与权限规则。2.0 对错误字段名返回 200 并静默丢弃，
        // 所以「建成功」不等于「建对了」。
        if protocol == ServeProtocol::V2 {
            verify_v2_session(conn, &serve_sid, ctx).await;
        }

        // 会话级配置项：模式 + 思考等级。
        //
        // 失败不阻断建会话（用户至少能对话）—— 与 ACP 的降级语义一致：
        // 可选能力缺失不该让整条链路失效。
        let config_state = probe_config_state(conn, ctx, &serve_sid).await;

        attach_streaming(conn, ctx, serve_sid, self.chat_capabilities(), config_state).await
    }

    async fn resume(
        &self,
        ctx: &AgentContext,
        native_session_id: &str,
    ) -> Result<Box<dyn AgentSession>, AppError> {
        if native_session_id.is_empty() {
            return Err(AppError::InvalidInput(
                "resume requires a non-empty native session id".into(),
            ));
        }
        let conn = serve_connection(&self.cmd, &self.env).await?;

        // resume 前探测存在性：1.x 老会话在 2.0 下是 404（迁移单向，不可 resume）。
        // 不探测的话 `attach_streaming` 只会在 SSE 上静默等待一条永不到来的事件。
        let probe_url = format!(
            "{}{}",
            conn.base_url,
            conn.protocol.session_get_path(native_session_id)
        );
        let status = conn
            .client
            .get(&probe_url)
            .send()
            .await
            .map(|r| r.status().as_u16())
            .unwrap_or(0);
        if !session_exists_from_status(conn.protocol, status) {
            return Err(AppError::NotFound(missing_session_message(
                conn.protocol,
                native_session_id,
            )));
        }

        log::info!(
            "[ServeAdapter] resuming native session {native_session_id} as {}",
            ctx.session_id
        );
        let config_state = probe_config_state(conn, ctx, native_session_id).await;
        attach_streaming(
            conn,
            ctx,
            native_session_id.to_string(),
            self.chat_capabilities(),
            config_state,
        )
        .await
    }

    fn supports_chat_resume(&self) -> bool {
        true
    }
}

/// 从建会话响应里取 session id。
///
/// V1: `{"id": "..."}`；V2: `{"data": {"id": "..."}}`。
fn extract_session_id(protocol: ServeProtocol, json: &serde_json::Value) -> Option<&str> {
    let node = match protocol {
        ServeProtocol::V1 => json,
        ServeProtocol::V2 => json.get("data").unwrap_or(json),
    };
    node.get("id").and_then(|v| v.as_str())
}

/// V2 建会话后的回读校验。
///
/// 2.0 有两个「200 但什么都没做」的陷阱：
/// - `?directory=` 被忽略 → 会话落到 serve cwd，工具在错误目录里跑；
/// - V1 的 `permission` 字段被丢弃 → confirm 模式变成 auto。
///
/// 两者都不会报错，只能回读。校验失败**不阻断**建会话（用户至少能对话），
/// 但必须 WARN —— 否则故障表现为「模型好像不太懂这个项目」或「没人审批就改了文件」。
async fn verify_v2_session(conn: &ServeConnection, serve_sid: &str, ctx: &AgentContext) {
    let url = format!(
        "{}{}",
        conn.base_url,
        conn.protocol.session_get_path(serve_sid)
    );
    let Some(json) = fetch_json(&conn.client, &url).await else {
        log::warn!("[ServeAdapter] v2 session read-back failed for {serve_sid}");
        return;
    };
    let node = json.get("data").unwrap_or(&json);

    let dir = node
        .get("location")
        .and_then(|l| l.get("directory"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !dir.is_empty() && dir != ctx.cwd {
        log::warn!(
            "[ServeAdapter] v2 session directory mismatch: got {dir:?}, expected {:?}",
            ctx.cwd
        );
    }

    if ctx.mode == "confirm" {
        let has_perms = node
            .get("permissions")
            .and_then(|v| v.as_array())
            .is_some_and(|a| !a.is_empty());
        if !has_perms {
            log::warn!(
                "[ServeAdapter] v2 session has no permission rules; \
                 confirm mode is NOT enforced (approvals will not fire)"
            );
        }
    }
}

/// 会话存在性判据：只看状态码。
///
/// - `200` → 存在；
/// - `404` → 明确不存在（V1 老会话在 V2 下的真实处境）；
/// - 其余（401 / 500 / 连接失败用 0）→ **判为不存在**。
///
/// 最后一条是刻意的：探测本身失败时继续 attach，用户会等一条永不到来的
/// SSE 流，现象是「一直转圈」且没有任何可定位的日志。宁可报错让他重开会话。
///
/// 判据与协议无关（两版的「存在」都是 200），但**保留协议参数**是为了让调用点
/// 不必自己判断版本 —— 将来若某版改用别的成功码，改这里一处即可。
pub(super) const fn session_exists_from_status(_protocol: ServeProtocol, status: u16) -> bool {
    status == 200
}

/// 会话不存在时的错误文案。
///
/// 必须说清「不是网络问题」：1.x 老会话在 2.0 下 404 是**迁移单向**导致的，
/// 用户要做的是在新版里重开会话，而不是查网络。
pub(super) fn missing_session_message(protocol: ServeProtocol, session_id: &str) -> String {
    match protocol {
        ServeProtocol::V1 => format!(
            "native session '{session_id}' was not found on the opencode serve instance. \
             It may have been deleted, or it belongs to a different project directory."
        ),
        ServeProtocol::V2 => format!(
            "native session '{session_id}' was not found on this opencode instance. \
             Sessions created by opencode 1.x are migrated one-way into 2.0's storage and \
             cannot be resumed through the 2.x API -- start a new chat instead. \
             This is not a network error."
        ),
    }
}

/// `GET {prefix}/model` 响应 → `Vec<ModelInfo>`。
///
/// # 两版的字段名不同，但语义相同
///
/// | 版本 | 模型 id 字段 | 备注 |
/// | --- | --- | --- |
/// | 1.19 | `id` | |
/// | 2.0 | `modelID` | 另带 `package` / `capabilities` / `limit` |
///
/// 两个都接受（而不是按协议分两个函数）：字段存在性本身就是形状信息，
/// 而「按协议选字段名」会让一个协议新增字段时另一侧静默失效。
///
/// 产出 `id = "provider/model"` 复合串 —— 与前端 `model_slug_split` 的约定一致，
/// 也是 V1 的 `models --verbose` 路径一直在用的形状。
///
/// `limit.context` 等富字段**不再解析**：它们属于 ACP 的 `model_config` 配置项，
/// 不是模型条目属性（见 `.trellis/spec/backend/agent-acp-model-selection.md`）。
pub(super) fn models_from_api_response(json: &serde_json::Value) -> Vec<ModelInfo> {
    json.get("data")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let provider = item.get("providerID")?.as_str()?;
                    // 2.0 用 `modelID`，1.19 用 `id`；两个都认。
                    let model = item
                        .get("modelID")
                        .and_then(|v| v.as_str())
                        .or_else(|| item.get("id").and_then(|v| v.as_str()))?;
                    let name = item.get("name").and_then(|v| v.as_str()).unwrap_or(model);
                    Some(ModelInfo {
                        id: format!("{provider}/{model}"),
                        name: name.to_string(),
                        description: None,
                        group: Some(provider.to_string()),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 探测会话的初始配置项状态（模式 + 思考等级的候选值）。
///
/// # 只做「初值」，不做「维护」
///
/// 这里的产物是 `ConfigState` 的**起点**：agent 用默认值，档位候选按当前模型取。
/// 之后的演进有两条路，都不经过这里：
///
/// - 用户点选 → `ConfigState::apply`（`request.rs`）
/// - agent 自述 → `ConfigState::learn_from_step`（`session.step.started`）
///
/// 分开的理由：本函数需要 HTTP（拉 `/api/model`），而另外两条是纯内存更新。
/// 把「取候选值」这个 IO 留在 adapter，状态演进保持纯函数 —— 后者可测、无副作用。
async fn probe_config_state(
    conn: &ServeConnection,
    ctx: &AgentContext,
    serve_sid: &str,
) -> ConfigState {
    let mut state = ConfigState::default();

    // 档位候选值必须按**当前模型**取 —— 用固定清单会让
    // 「这个模型不支持 high」变成运行期静默失败。
    let Some(model_id) = ctx.model_id.as_deref() else {
        return state;
    };
    let Some(variants) = config_options::fetch_variants(
        &conn.client,
        conn.protocol.models_path(),
        &conn.base_url,
        model_id,
    )
    .await
    else {
        log::warn!(
            "[ServeAdapter] cannot read model variants for {serve_sid}; \
             thinking level will not be offered"
        );
        return state;
    };
    // `refresh_variants` 同时负责「当前值不在候选里就回落第一个」。
    state.refresh_variants(variants, model_id);
    state
}

/// 命令发现的重试预算：实测 server 启动后 `0 → 2 → 5` 条会持续数秒。
///
/// 取 8 次 × 250ms ≈ 2s：足够覆盖实测的最坏情况（约 2s 内稳定），
/// 又不会让用户点开 `/` 时干等。超过预算仍为空 → 返回空列表
/// （真的没有命令），**不是** `Unsupported`（协议是支持的）。
const COMMAND_DISCOVERY_ATTEMPTS: usize = 8;
const COMMAND_DISCOVERY_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);

/// 查命令，带「空结果重试」—— 命令发现是异步的（见 [`COMMAND_DISCOVERY_ATTEMPTS`]）。
///
/// 与 `list_commands` 拆开是为了可注入假连接做单测（同 `pi_rpc` 的
/// `list_commands_with`）。
async fn fetch_commands_with_retry(
    conn: &ServeConnection,
    path: &str,
    directory: Option<&str>,
) -> Result<Vec<AgentCommand>, AppError> {
    let url = commands_url(path, &conn.base_url, directory);
    for attempt in 0..COMMAND_DISCOVERY_ATTEMPTS {
        let Some(json) = fetch_json(&conn.client, &url).await else {
            // 端点不可用（HTTP 非 2xx / 解析失败）：协议声称支持却拿不到数据 →
            // 视为本轮失败，交给下一次重试；最终仍失败则报错（不是 Unsupported：
            // 能力位已声明支持，静默空列表会让「支持但坏了」看起来像「不支持」）。
            if attempt + 1 == COMMAND_DISCOVERY_ATTEMPTS {
                return Err(AppError::Agent(format!(
                    "serve GET {path} failed after {COMMAND_DISCOVERY_ATTEMPTS} attempts"
                )));
            }
            tokio::time::sleep(COMMAND_DISCOVERY_INTERVAL).await;
            continue;
        };
        let commands = commands_from_response(&json);
        if !commands.is_empty() {
            return Ok(commands);
        }
        tokio::time::sleep(COMMAND_DISCOVERY_INTERVAL).await;
    }
    // 预算用尽仍为空：真的没有命令（协议是支持的），返回空列表而不是错误。
    Ok(Vec::new())
}

/// 拼命令端点 URL（含 `?directory=`）—— 项目级命令要靠它才被发现。
#[must_use]
pub(super) fn commands_url(path: &str, base_url: &str, directory: Option<&str>) -> String {
    match directory {
        Some(dir) if !dir.is_empty() => {
            format!("{base_url}{path}?directory={}", urlencoding::encode(dir))
        }
        _ => format!("{base_url}{path}"),
    }
}

/// `GET /api/command` 响应 → 命令列表（纯函数，独立单测）。
///
/// 实测形状：`{"location":{"directory":...},"data":[{"name":"init",
/// "description":"guided AGENTS.md setup",…}]}`。
///
/// 容忍两种包装：`{data:[…]}`（V2 实测）与裸数组（防御未来变化）。
/// 缺 `name` 的条目直接丢弃 —— 没有名字的命令无法插入文本。
#[must_use]
pub(super) fn commands_from_response(json: &serde_json::Value) -> Vec<AgentCommand> {
    let entries = json
        .get("data")
        .and_then(serde_json::Value::as_array)
        .or_else(|| json.as_array());
    let Some(entries) = entries else {
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(|entry| {
            let name = entry.get("name").and_then(serde_json::Value::as_str)?;
            if name.is_empty() {
                return None;
            }
            Some(AgentCommand {
                name: name.to_string(),
                description: entry
                    .get("description")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                // opencode 的命令没有 pi 那种 source 分类；用 agent 自己的
                // 命令来源（若给出）而不是编一个。
                source: entry
                    .get("source")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect()
}
