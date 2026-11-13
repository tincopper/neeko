//! 团队 MCP 端点的**域级 boot 入口**（与 `session` / `agent` / `library` / `lsp` 四域对称）。
//!
//! ```text
//! boot(runtime, manager)
//!   ├─ bind 127.0.0.1:0                     ← 端口由 OS 分配，本域自己知道（红线 8 同族）
//!   ├─ principals_from(manager)             ← **从库**组装身份表（过滤空 hash）
//!   ├─ AuthGate::with_shared_hashed_tokens  ← 门装的是**活集合**（C8）
//!   └─ serve(route_group(state))            ← FailClosed 路由组
//! ```
//!
//! # 为什么是独立 listener（design §3.1b）
//!
//! hooks 那道门是**进程唯一 token**、恒定时间比较，而且 `authorize` 是全局层：同一 listener
//! 上所有路由组共享它。若团队与 hooks 共用端口，成员的 token 就能 `POST /hook/{source}`
//! 伪造队友的 `turn_completed` —— 与 §5.4 在防的串台是同一类事故。
//!
//! # 为什么门装「活集合」而不是快照
//!
//! 团队的成员是在 listener 起来**之后**才 spawn 的（promote → spawn → 轮换 → 关队）。
//! 快照门会让先 promote 的团队永远只有 promote 那一刻的凭证；而重建 listener 会换端口，
//! 已下发到成员 MCP 配置里的 URL 全部失效（`--mcp-config` 只在启动时读）。
//! 所以门持有 [`SharedTokenSet`]，组合根在成员变动后调 [`TeamServer::refresh`]。
//!
//! # 超时预算与 hooks **不同**
//!
//! `team_wait` 会在一个工具调用里阻塞至多 [`WAIT_TIMEOUT_MAX_SECS`]（1800s）。引擎的
//! `request_timeout` 一旦小于它，队长会收到 408 而不是 `WaitOutcome::Timeout` ——
//! 而「超时是结果不是错误」是本设计的核心语义。所以这里的超时必须**高于**等待上限。

use std::sync::{Arc, RwLock};

use crate::agent::team::execution::{CredentialLedger, MemberExecutor};
use crate::agent::team::manager::TeamManager;
use crate::agent::team::mcp::dispatch::WAIT_TIMEOUT_MAX_SECS;
use crate::agent::team::mcp::principals::{principals_from, token_hashes};
use crate::agent::team::mcp::protocol::ENDPOINT_PATH;
use crate::agent::team::mcp::server::{self, TeamServerState};
use crate::common::error::AppError;
use crate::common::runtime::AppRuntime;
use crate::server::{AuthGate, ServerConfig, ServerHandle, SharedTokenSet};

/// 在途上限：与 hooks 同量级。团队成员是个位数，16 已经远超实际并发。
const MAX_INFLIGHT: usize = 16;

/// 单请求 body 上限。
///
/// 比 hooks（64 KiB）大得多，因为 `task_create` 的 `body` 就是一段派活 prompt，
/// 而 hooks 的载荷只有状态键。1 MiB 足够容纳长任务描述，仍远低于红线 4 的 2 MB ——
/// 团队端点的响应本身也必须守那条线（`ToolReply` 全是小载荷）。
const MAX_BODY_BYTES: usize = 1024 * 1024;

/// 逐请求超时：**必须高于** `team_wait` 的等待上限（见模块文档）。
///
/// 多出的 60s 是给「等待结束后写库 + 序列化」的余量，不是给网络。
const REQUEST_TIMEOUT: std::time::Duration =
    std::time::Duration::from_secs(WAIT_TIMEOUT_MAX_SECS as u64 + 60);

/// 已启动的团队端点。
///
/// 组合根持有它：`endpoint_url()` 交给执行层拼进成员的 MCP 配置，`stop()` 走关闭协议。
///
/// **没有 `refresh()`**：身份表与门的同步是「签发凭证」的一半（`CredentialLedger::admit`，
/// 实现在 `TeamServerState`）。再开一个公开的同步入口，等于让「什么时候刷新」有两个答案，
/// 而漏一处的表现是「新成员永远 401」。
pub struct TeamServer {
    handle: ServerHandle,
    /// 端点状态（与 handler 共用同一份身份表 / 活集合）。
    ///
    /// 生产路径上**不需要再读它** —— 凭证签发与认门由 handler 经 `CredentialLedger::admit`
    /// 完成（那才是唯一的写入点）。组合根持有它才能保证「端点 / 身份表 / 门」是同一份；
    /// `boot` 的单测也从这里驱动 `admit`（不能只靠假体证明门的语义）；
    /// 生产路径经 [`TeamServer::credentials`] 取它 —— 「以队长身份开会话」也要签发凭证。
    state: TeamServerState,
}

/// 端点对外提供的门面：[`TeamServer::surface`] 的返回值。
///
/// 三个字段同源（都在同一个 `TeamServer` 上），因此**不存在**「有 URL 但没人签凭证」这种
/// 半可用组合 —— 组合根拿到它就能起队长；域内代码拿不到它（它们只该认识端口）。
#[derive(Clone)]
pub struct TeamSurface {
    /// 成员 / 队长的 MCP 配置里要写的完整 URL。
    pub endpoint_url: String,
    /// 凭证面（签发 + 认门，一次动作）。
    pub credentials: std::sync::Arc<dyn CredentialLedger>,
    /// 成员执行者（与端点 handler 用的是**同一个**实例）。
    pub executor: std::sync::Arc<dyn MemberExecutor>,
}

/// 团队 MCP 门的**唯一构造点**：期望集合（活集合）与可接受的鉴权形状。
///
/// 单独成函数不是为了复用，是为了让「门认哪些形状」有一个可以被测试直接问的落点：
/// 只在 [`boot`] 里内联构造时，护栏测试只能自己另写一份凭证列表 —— 那正是漂移的写法。
///
/// # 形状的清单来自准入表宣传的那几种
///
/// 加一种形状的前提是**已经有一种成员配置会发出它**（红线 14：声明即实现）：
///
/// | 形状 | 谁发 |
/// | --- | --- |
/// | `x-neeko-team-token` | JSON 配置形态的成员（claude-code / codebuddy / qoder / pi） |
/// | `Authorization: Bearer` | codex 的 `bearer_token_env_var` |
///
/// 少装一种的症状是「那个 CLI 的成员首个 `initialize` 恒 403」—— rmcp 随即关掉传输层，
/// 工具面整体不存在，而板上看起来只是「没人认领」。
///
/// 形状清单的**唯一实现**是 `mcp::server::team_credentials()`：handler 的 `authenticate`
/// 也用它把请求头解析成主体。两边各写一份时会出现「门放行、handler 查不到主体」的
/// 静默组合（HTTP 200 + JSON-RPC `unauthorized`）。
pub(crate) fn team_gate(tokens: SharedTokenSet) -> AuthGate {
    AuthGate::with_shared_hashed_tokens(tokens, server::team_credentials())
}

/// 启动团队 MCP 端点。
///
/// # 失败即整体失败
///
/// 读库失败（组不出身份表）时**不降级成空表**：空表 = 谁都进不来，看起来像「所有成员都没
/// 权限」，比启动失败更难排查。
pub fn boot(
    runtime: &Arc<AppRuntime>,
    manager: &Arc<TeamManager>,
    executor: Arc<dyn MemberExecutor>,
    sessions: Arc<dyn crate::agent::team::view::MemberSessionLookup>,
) -> Result<TeamServer, AppError> {
    // 端口由 OS 分配：`serve` 拿到的 listener 就是它，事后从 handle 读（单一来源）。
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|err| AppError::Io(format!("team mcp endpoint cannot bind loopback: {err}")))?;

    // 身份表从**库**组装（见 `principals_from` 的文档）；门的期望集合与它是同一份 key。
    let principals = principals_from(manager)?;
    let tokens = SharedTokenSet::new(token_hashes(&principals));
    let principals = Arc::new(RwLock::new(principals));

    let gate = Arc::new(team_gate(tokens.clone()));

    let state = TeamServerState {
        manager: Arc::clone(manager),
        principals,
        runtime: Arc::clone(runtime),
        tokens: tokens.clone(),
        credentials: server::team_credentials(),
        executor,
        sessions,
    };

    let handle = crate::server::serve(
        runtime,
        ServerConfig {
            listener,
            max_inflight: MAX_INFLIGHT,
            request_timeout: REQUEST_TIMEOUT,
            max_body_bytes: MAX_BODY_BYTES,
        },
        gate,
        vec![server::route_group(state.clone())],
    )
    .map_err(|err| AppError::Io(format!("team mcp endpoint failed to serve: {err}")))?;

    log::info!(
        "[agent-team] mcp endpoint listening on 127.0.0.1:{}{}",
        handle.port(),
        ENDPOINT_PATH
    );

    Ok(TeamServer { handle, state })
}

impl TeamServer {
    /// 实得端口（OS 分配，`boot` 时从 listener 读一次）。
    #[must_use]
    pub const fn port(&self) -> u16 {
        self.handle.port()
    }

    /// 成员 MCP 配置里要写的完整 URL。
    ///
    /// 唯一的拼装点：执行层（`execution::plan_member_spawn` 的 `mcp_url`）与诊断日志都从这里取，
    /// 免得「端口对了但路径错了」这类拼接错误散落两处。
    #[must_use]
    pub fn endpoint_url(&self) -> String {
        endpoint_url(self.port())
    }

    /// 端点交给**域外入口**的那一份东西：URL + 两个端口。
    ///
    /// # 为什么成对交出
    ///
    /// 三个字段都是「端点起来了」的同一件事。拆成三个 `Option` 访问器会让调用方有能力
    /// 只取一半 —— 「签发了凭证但没有执行者」或「有 URL 但门不认它」都是**不可用**状态，
    /// 而端点的启动是原子的。一次返回，就不可能只拿半个。
    ///
    /// 交出的是**端口**（`CredentialLedger` / `MemberExecutor`）而不是 `TeamServerState`：
    /// `admit` 仍是唯一的「签发 + 认门」写入点，所以「什么时候刷新身份表」只有一个答案。
    #[must_use]
    pub fn surface(&self) -> TeamSurface {
        TeamSurface {
            endpoint_url: self.endpoint_url(),
            credentials: std::sync::Arc::new(self.state.clone()),
            executor: std::sync::Arc::clone(&self.state.executor),
        }
    }

    /// 优雅停机。只可在**非 runtime 线程**调用（`ServerHandle::stop` 的契约）。
    pub fn stop(mut self) {
        self.handle.stop();
    }
}

/// `http://127.0.0.1:{port}/team/mcp`。
///
/// loopback 而不是 `localhost`：后者在某些平台会先解析到 `::1`，而 listener 只绑了 IPv4。
#[must_use]
pub fn endpoint_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}{ENDPOINT_PATH}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::fixtures::{fixture_member, fixture_team, NoopExecutor, TEAM, W1};
    use crate::agent::team::identity;
    use crate::agent::team::mcp::protocol::TOKEN_HEADER;
    use crate::agent::team::store::TeamStore;

    const OTHER: &str = "w2@tm_1";

    /// 端点用例不关心活性：`NoSessions` 恒答「没有活会话」（`view` 里的零实现）。
    fn no_sessions() -> Arc<dyn crate::agent::team::view::MemberSessionLookup> {
        Arc::new(crate::agent::team::view::NoSessions)
    }

    fn seeded_manager() -> Arc<TeamManager> {
        let manager = TeamManager::new(TeamStore::open_in_memory().expect("in-memory store"));
        manager
            .create_team(fixture_team(TEAM))
            .expect("create_team");
        manager
            .add_member(fixture_member(W1, TEAM))
            .expect("add_member");
        Arc::new(manager)
    }

    /// 门的构造与测试共用同一个落点：`team_gate()`（不是各写一份凭证列表）。
    fn gate_for(token: &str) -> AuthGate {
        team_gate(SharedTokenSet::new(vec![identity::hash_token(token)]))
    }

    fn header(name: &'static str, value: &str) -> axum::http::HeaderMap {
        let mut map = axum::http::HeaderMap::new();
        map.insert(name, value.parse().expect("valid header value"));
        map
    }

    const TOKEN: &str = "tok-team-gate";

    /// 门必须接受准入表向成员**宣传的每一种**鉴权形状。
    ///
    /// 两侧的落点：形状来源是 `admission::ADMISSIONS`（JSON 配置形态的成员写
    /// `TOKEN_HEADER`，codex 走 `bearer_token_env_var` ⇒ `Authorization: Bearer`），
    /// 接受方是本函数测的 [`team_gate`]。少装一种形状的症状是「那个 CLI 的成员恒 403，
    /// 工具面整体不存在」—— 而它只落一条 warn，看起来像 token 错了。
    #[test]
    fn the_team_gate_accepts_both_advertised_shapes() {
        let gate = gate_for(TOKEN);

        assert!(
            gate.authorize(&header(TOKEN_HEADER, TOKEN)),
            "JSON 配置形态的成员（claude-code / codebuddy / qoder / pi）必须能进门"
        );
        assert!(
            gate.authorize(&header("authorization", &format!("Bearer {TOKEN}"))),
            "codex 的 bearer_token_env_var 形态必须能进门"
        );

        // 反例：错 token / 没带凭证仍然拒绝 —— 门的单一比较点没有因此放宽。
        assert!(!gate.authorize(&header("authorization", "Bearer tok-team-gatf")));
        assert!(!gate.authorize(&axum::http::HeaderMap::new()));
    }

    /// 空集合恒拒，**新形状**上也要再断言一次。
    ///
    /// 「空集合 + Bearer」是最容易被顺手放宽的组合：放宽它等于给「本组免鉴权」开一条
    /// 谁也不审计的路（门对每个路由组强制生效）。
    #[test]
    fn the_team_gate_rejects_everything_when_the_set_is_empty() {
        let gate = team_gate(SharedTokenSet::new(Vec::new()));

        assert!(!gate.authorize(&header(TOKEN_HEADER, TOKEN)));
        assert!(!gate.authorize(&header("authorization", &format!("Bearer {TOKEN}"))));
        assert!(!gate.authorize(&axum::http::HeaderMap::new()));
    }

    /// 坐标拼装只有一个实现：loopback + 端点路径。
    #[test]
    fn the_endpoint_url_is_one_loopback_url() {
        assert_eq!(endpoint_url(1234), "http://127.0.0.1:1234/team/mcp");
        assert!(endpoint_url(1).ends_with(ENDPOINT_PATH));
    }

    /// `boot` 真的绑上了 loopback 端口，且暴露的 URL 与该端口一致。
    ///
    /// 不在测试里发请求：真 TCP 往返由 `agent::team::mcp::server` 的 handler 级测试覆盖，
    /// 这里只证明「组合根能拿到一个活着且地址正确的端点」。
    #[tokio::test]
    async fn boot_binds_a_loopback_port_and_exposes_its_url() {
        let runtime = Arc::new(AppRuntime::from_handle(tokio::runtime::Handle::current()));
        let manager = seeded_manager();
        let server = boot(&runtime, &manager, Arc::new(NoopExecutor), no_sessions()).expect("boot");

        assert_ne!(server.port(), 0, "OS 分配的端口不应为 0");
        assert_eq!(server.endpoint_url(), endpoint_url(server.port()));

        // 停机要在非 runtime 线程（`ServerHandle::stop` 的线程契约）。
        let owned = server;
        std::thread::spawn(move || owned.stop())
            .join()
            .expect("stop");
    }

    /// `admit` 把**新签发**的凭证带进门 —— 否则先 promote、后 spawn 的成员永远进不来。
    ///
    /// 这是生产路径：`CredentialLedger::admit` = 签发 + 认门（同一动作）。本用例同时钉住
    /// 「读库重建」与「门立即生效」两半，以及门的期望集合保持排序。
    #[tokio::test]
    async fn admitting_a_credential_makes_it_reachable_through_the_gate() {
        use crate::agent::team::execution::CredentialLedger;

        let runtime = Arc::new(AppRuntime::from_handle(tokio::runtime::Handle::current()));
        let manager = seeded_manager();
        let server = boot(&runtime, &manager, Arc::new(NoopExecutor), no_sessions()).expect("boot");

        // 起初：库里只有一个夹具凭证。
        assert_eq!(
            server.state.tokens.snapshot(),
            token_hashes(&server.state.principals.read().expect("principals"))
        );

        // 新增一名成员并走生产路径签发 + 认门。
        manager
            .add_member(fixture_member(OTHER, TEAM))
            .expect("add_member");
        let issued = server.state.admit(OTHER).await.expect("admit");

        let after = server.state.tokens.snapshot();
        assert!(
            after.contains(&identity::hash_token(&issued)),
            "admit 必须把新 hash 装进门"
        );
        assert_eq!(
            server
                .state
                .principals
                .read()
                .expect("principals")
                .get(&identity::hash_token(&issued))
                .map(|principal| principal.member_id.as_str()),
            Some(OTHER),
            "门放行谁 / 认出谁必须来自同一份表"
        );
        assert_eq!(
            after,
            {
                let mut sorted = after.clone();
                sorted.sort_unstable();
                sorted
            },
            "期望集合保持排序"
        );

        let owned = server;
        std::thread::spawn(move || owned.stop())
            .join()
            .expect("stop");
    }
}
