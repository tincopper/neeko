//! 能力声明的**可执行校验**。
//!
//! 照搬根 `AGENTS.md` 红线 14 的判据（「LSP 能力声明必须与实现一致」）：
//! 声明了什么，就必须在同一处给出实现，且由测试钉住。
//!
//! # 为什么必须有它
//!
//! P1 的成因是能力声明有三份互不校验的真相。其中 `SessionStart.capabilities`
//! 曾被四个 adapter 各自硬编码 —— **四个全填 `approvals: true`，包括
//! `deepseek`（495 行里没有任何审批实现）**。这类谎报靠人读代码发现不了，
//! 只能让测试去建一个真会话、观察它到底会不会发 `RequestApproval`。
//!
//! # 用法
//!
//! 每个 adapter 的测试调用 [`assert_capabilities_hold`]。对 MockAgent 必须
//! **无条件通过**（它是契约的参考实现）；对真实 adapter 标 `#[ignore]`
//!（需要外部进程，CI 不跑）。
//!
//! # MockAgent 优先策略
//!
//! 契约先在进程内 mock 上改到对，再拿去校验真实 adapter —— 那时失败的一定是
//! adapter 而不是契约本身。反馈周期从分钟级降到毫秒级。

use std::time::Duration;

use crate::agent::chat::adapter::{AgentAdapter, AgentContext, AgentSession};
use crate::agent::chat::capabilities::{ChatCapabilities, ConfigCapability};
use crate::agent::chat::events::StreamEvent;

/// 单条事件的等待上限。mock 是进程内的，10 秒足够；真实 adapter 更慢，
/// 但超时即判失败比挂死 40 分钟好（本项目有过这个教训）。
const EVENT_TIMEOUT: Duration = Duration::from_secs(10);

/// 断言 `adapter` 声明的能力与它的**实际行为**一致。
///
/// # Errors
///
/// 返回第一条不满足的约束描述。调用方在测试里 `.expect(...)` 即可。
pub async fn assert_capabilities_hold(
    adapter: &dyn AgentAdapter,
    ctx: &AgentContext,
) -> Result<(), String> {
    let caps = adapter.chat_capabilities();
    let mut session = adapter
        .create(ctx)
        .await
        .map_err(|e| format!("create() failed: {e}"))?;

    let start = wait_for_session_start(&mut session, caps).await?;

    check_config_capability(caps, &start)?;

    // 审批：声明 true 的 adapter 必须能**发出** RequestApproval。
    // 这里只做「声明与握手一致」的静态部分；「是否真的会发」需要造出触发场景，
    // 由各 adapter 自己的集成测试覆盖（mock 的审批在 `mock.rs` 里已有用例）。
    Ok(())
}

/// 等 `SessionStart`（必须出现，且必须在开头附近）。
async fn wait_for_session_start(
    session: &mut Box<dyn AgentSession>,
    caps: ChatCapabilities,
) -> Result<StreamEvent, String> {
    for _ in 0..32 {
        let next = tokio::time::timeout(EVENT_TIMEOUT, session.next())
            .await
            .map_err(|_| format!("timeout waiting for SessionStart (caps: {caps:?})"))?
            .ok_or_else(|| "session ended before SessionStart".to_string())?;
        let ev = next.map_err(|e| format!("session error before SessionStart: {e}"))?;
        if matches!(ev, StreamEvent::SessionStart { .. }) {
            return Ok(ev);
        }
    }
    Err("SessionStart never arrived".into())
}

/// `ConfigCapability` 的三条承诺，逐条校验。
fn check_config_capability(caps: ChatCapabilities, start: &StreamEvent) -> Result<(), String> {
    let StreamEvent::SessionStart {
        config_options,
        capabilities,
        ..
    } = start
    else {
        return Err("expected SessionStart".into());
    };

    // ① 事件里的 config 字段必须与适配器声明一致（两份真相已合并，防止回退）
    if capabilities.config != caps.config {
        return Err(format!(
            "SessionStart.config {:?} != adapter declaration {:?}",
            capabilities.config, caps.config
        ));
    }

    match caps.config {
        ConfigCapability::SessionConfig => {
            if config_options.is_empty() {
                return Err(
                    "declared ConfigCapability::SessionConfig but SessionStart carried \
                     no config_options — the frontend would render no controls"
                        .into(),
                );
            }
        }
        ConfigCapability::PerTurn | ConfigCapability::None => {
            if !config_options.is_empty() {
                return Err(format!(
                    "declared {:?} but SessionStart carried {} config_options — \
                     the frontend would render controls that cannot be written",
                    caps.config,
                    config_options.len()
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::chat::adapter::acp::AcpAdapter;
    use crate::agent::chat::adapter::deepseek::DeepSeekHarnessAdapter;

    fn ctx(agent_id: &str) -> AgentContext {
        AgentContext {
            agent_id: agent_id.into(),
            session_id: "probe".into(),
            // 平台无关（红线 13）：Windows 上没有 `/tmp`。
            project_id: std::env::temp_dir().display().to_string(),
            project_name: "probe".into(),
            env: "local".into(),
            skills: vec![],
            files: vec![],
            mode: "auto".into(),
            prompt: String::new(),
            model_id: None,
        }
    }

    /// **MockAgent 是契约的参考实现，必须无条件通过。**
    ///
    /// 它声明 `SessionConfig` + 审批 + 命令 + 恢复，且真的实现了全部四项。
    /// 这个用例是「契约本身正确」的证明 —— 它绿了之后，真实 adapter 的失败
    /// 才可归因到 adapter。
    #[tokio::test]
    async fn mock_agent_satisfies_its_own_declaration() {
        let adapter = AcpAdapter::mock();
        assert_capabilities_hold(&adapter, &ctx("mockAgent"))
            .await
            .expect("mockAgent must satisfy its declaration");
    }

    /// `deepseek` 声明 `ConfigCapability::None` 且 `approvals: false` ——
    /// 探针必须接受这个声明，并验证它**没有**带 config_options。
    ///
    /// 这条曾经失败过：旧代码在 `SessionStart` 里硬编码 `approvals: true`，
    /// 而 harness 没有任何审批实现。现在两份真相已合并。
    #[tokio::test]
    async fn deepseek_declares_no_config_and_carries_none() {
        let adapter = DeepSeekHarnessAdapter::new(vec!["/bin/true".into()], Default::default());
        let caps = adapter.chat_capabilities();
        assert_eq!(caps.config, ConfigCapability::None);
        assert!(!caps.approvals, "harness has no approval implementation");
        assert!(!caps.resume, "resume_id is always None");
    }

    /// `ConfigCapability` 的语义契约：`uses_session_config` 才是「能发
    /// set_config_option」的判据，不是 `shows_controls`。
    #[test]
    fn per_turn_shows_controls_but_does_not_use_session_config() {
        let caps = ConfigCapability::PerTurn;
        assert!(caps.shows_controls());
        assert!(!caps.uses_session_config());
    }

    mod resume_contract {
        //! `resume` 能力位 ⇔ [`AgentAdapter::supports_chat_resume`] / [`AgentAdapter::resume`]
        //! 的一致性（红线 14 同源）。
        //!
        //! # 为什么在这里而不是各 adapter 自己的测试里
        //!
        //! 前端入口显隐的唯一数据源是 `agent_chat_supports_resume`（它直接读
        //! `supports_chat_resume()`）。一旦某个 adapter 的两位分叉，用户看到的就是
        //! 「按钮在、点了报错」或「能用但没入口」—— 两种都不报错、都不崩溃。
        //! 这条断言把四条传输放在一起对齐，新增传输忘填时它就会红。
        use super::*;
        use crate::agent::chat::adapter::opencode::ServeAdapter;
        use crate::agent::chat::adapter::pi_rpc::PiRpcAdapter;
        use crate::common::agent::chat_launch::ChatTransport;
        use crate::common::error::AppError;

        /// **每条传输一个适配器**，`binary` 控制真实 / 假二进制。
        ///
        /// 用表而不是各用例内联数组：这张表必须覆盖 `ChatTransport::ALL` 的每一条
        /// （等长断言见 `every_transport_list_stays_in_sync_with_the_variant_list`）——
        /// 否则「新增第五条传输」时本次护栏会静默漏掉它，而漏掉的表现恰好是
        /// 静默降级（正是本模块要防的东西）。
        fn every_transport(binary: &str) -> Vec<Box<dyn AgentAdapter>> {
            vec![
                Box::new(AcpAdapter::mock()),
                Box::new(ServeAdapter::new(
                    vec![binary.into(), "serve".into()],
                    Default::default(),
                )),
                Box::new(DeepSeekHarnessAdapter::new(
                    vec![binary.into()],
                    Default::default(),
                )),
                Box::new(PiRpcAdapter::new(
                    vec![binary.into(), "--mode".into(), "rpc".into()],
                    Default::default(),
                )),
            ]
        }

        /// 表与枚举变体清单等长：新增传输**必须**同时进 `every_transport()`。
        #[test]
        fn every_transport_list_stays_in_sync_with_the_variant_list() {
            assert_eq!(
                every_transport("probe").len(),
                ChatTransport::ALL.len(),
                "新增传输时把它追加到 every_transport()，否则 resume 护栏覆盖不到它"
            );
        }

        /// 每条传输：声明位与 `supports_chat_resume()` 必须相等。
        #[test]
        fn resume_bit_matches_supports_chat_resume_on_every_transport() {
            for adapter in every_transport("pi") {
                assert_eq!(
                    adapter.chat_capabilities().resume,
                    adapter.supports_chat_resume(),
                    "{:?}: resume 位与 supports_chat_resume() 分叉（入口会显隐错）",
                    adapter.kind()
                );
            }

            // 实测能恢复的两条（opencode serve / pi rpc）；ACP 的会话恢复不在本期。
            // 数量断言而不是逐个点名：新增一条声明 `resume: true` 的传输时本用例不需要改，
            // 但「少一条」说明某条位被改掉了（入口会静默消失）。
            let capable = every_transport("pi")
                .into_iter()
                .filter(|a| a.chat_capabilities().resume)
                .count();
            assert_eq!(capable, 2, "pi 与 opencode serve 是本期两条可恢复传输");
        }

        /// **位为 true ⇒ `resume()` 有覆写。**
        ///
        /// 判据是「走不走默认实现」：用不存在的二进制，失败必须是 spawn 类错误。
        /// 若覆写被删，会退回默认实现并返回一句 `does not support chat resume`，
        /// 前端入口随之变成死入口（本任务要消灭的形态）。
        ///
        /// 遍历的是**全部传输**、按能力位过滤：新增一条声明 `resume: true` 的传输
        /// 自动进入覆盖，不需要改本用例。
        #[tokio::test]
        async fn resume_bit_implies_resume_is_not_the_default_impl() {
            const NO_SUCH_BINARY: &str = "definitely-not-a-real-binary-mention-slash";
            let mut covered = 0;
            for adapter in every_transport(NO_SUCH_BINARY) {
                if !adapter.supports_chat_resume() {
                    continue;
                }
                covered += 1;
                let err = match adapter.resume(&ctx("pi"), "abc").await {
                    // 进程内实现（mock）可能真的恢复成功 —— 同为「非默认实现」的证明。
                    Ok(_) => continue,
                    Err(e) => e,
                };
                assert!(
                    !matches!(err, AppError::Unsupported(_)),
                    "{:?}: resume 覆写不见了: {err:?}",
                    adapter.kind()
                );
                assert!(
                    !err.to_string().contains("does not support chat resume"),
                    "{:?}: 走的是 trait 默认实现: {err}",
                    adapter.kind()
                );
            }
            assert!(
                covered >= 2,
                "pi 与 opencode serve 声明了 resume，覆盖数 {covered} 说明位被改掉了"
            );
        }
    }

    mod commands_contract {
        //! `commands` 能力位 ⇔ [`AgentAdapter::list_commands`] 实现的一致性
        //! （红线 14 同源：声明了却没人实现 = 静默功能缺失；该声明却没声明
        //! 同样违约）。
        use super::*;
        use crate::agent::chat::adapter::opencode::ServeAdapter;
        use crate::agent::chat::adapter::pi_rpc::PiRpcAdapter;
        use crate::common::error::AppError;

        fn agent_config(id: &str) -> crate::common::agent::types::AgentConfig {
            crate::common::agent::types::AgentConfig {
                id: id.into(),
                name: id.into(),
                command: "cli".into(),
                ..Default::default()
            }
        }

        /// 四条传输的能力快照。
        ///
        /// serve 与 pi 都能列命令：pi 走 `get_commands`（spawn 查询），
        /// opencode 走 `GET /api/command`（`/api/*` 共享层，两版同一路径）。
        ///
        /// 变异验证：改掉任一 adapter 的位 → 本用例红。
        #[test]
        fn command_capability_matches_each_transports_reality() {
            let pi = PiRpcAdapter::new(
                vec!["pi".into(), "--mode".into(), "rpc".into()],
                Default::default(),
            );
            assert!(
                pi.chat_capabilities().commands,
                "pi exposes get_commands and implements list_commands"
            );
            assert!(!AcpAdapter::mock().chat_capabilities().commands);
            assert!(
                ServeAdapter::new(vec!["opencode".into(), "serve".into()], Default::default())
                    .chat_capabilities()
                    .commands,
                "opencode exposes GET /api/command (shared /api/* layer)"
            );
            assert!(
                !DeepSeekHarnessAdapter::new(vec!["ds".into()], Default::default())
                    .chat_capabilities()
                    .commands
            );
        }

        /// **双向一致性**：位为 false ⇔ 查询返回 `Unsupported`；位为 true ⇔
        /// 查询有真实现（用不存在的二进制验证 —— spawn 失败是任何错误**除了**
        /// `Unsupported`；若覆写被删、退回默认实现，这里立即变红）。
        ///
        /// # 三条传输**全部**用假二进制
        ///
        /// 判据是「走不走默认实现」，不是「能不能真的查到命令」。真进程对这条断言
        /// **零增益**，却带来两个真实代价：
        ///
        /// 1. **副作用泄漏**：serve 是进程级 `OnceCell` 单例，测试二进制退出时
        ///    `tokio` runtime 被丢弃、`child` 从未被 kill ⇒ 每次跑 `cargo test` 都
        ///    留下一个 `opencode serve` 孤儿（实测累积到 7 个）。
        /// 2. **环境依赖**：本机装了 opencode 才能走到成功分支，CI 上走另一条 ——
        ///    同一断言两种路径，且 `STARTUP_TIMEOUT`(10s) + 命令发现重试(8×250ms)
        ///    把单元测试变成进程/网络依赖。
        ///
        /// 真实往返由 `adapter/opencode/integ.rs::serve_round_trip_streams_text_delta`
        /// 与 `tests/unit/acp_test.rs::acp_opencode_real_roundtrip` 两条 `#[ignore]`
        /// 用例覆盖 —— 不需要第三条不带 `#[ignore]` 的真进程用例。
        #[tokio::test]
        async fn commands_bit_implies_list_commands_is_not_unsupported() {
            // 位 false 且**无实现** → 默认 Unsupported。
            let ds = DeepSeekHarnessAdapter::new(vec!["ds".into()], Default::default());
            let err = ds
                .list_commands(&agent_config("deepseek"), None)
                .await
                .unwrap_err();
            assert!(matches!(err, AppError::Unsupported(_)), "{err:?}");
            let acp = AcpAdapter::mock();
            let err = acp
                .list_commands(&agent_config("mockAgent"), None)
                .await
                .unwrap_err();
            assert!(matches!(err, AppError::Unsupported(_)), "{err:?}");

            // 位 true ⇒ 必须有覆写：失败于 spawn/IO 而不是 `Unsupported`。
            // 用不存在的二进制 —— 覆写被删时它会退回默认实现并返回 Unsupported。
            const NO_SUCH_BINARY: &str = "definitely-not-a-real-binary-mention-slash";

            let serve = ServeAdapter::new(
                vec![NO_SUCH_BINARY.into(), "serve".into()],
                Default::default(),
            );
            let err = serve
                .list_commands(&agent_config("opencode"), None)
                .await
                .unwrap_err();
            assert!(
                !matches!(err, AppError::Unsupported(_)),
                "serve implements list_commands; an Unsupported here means the \
                 override is gone and the `/` entry would silently disappear: {err:?}"
            );

            let pi = PiRpcAdapter::new(vec![NO_SUCH_BINARY.into()], Default::default());
            let err = pi
                .list_commands(&agent_config("pi"), None)
                .await
                .unwrap_err();
            assert!(
                !matches!(err, AppError::Unsupported(_)),
                "commands bit true ⇒ list_commands must be implemented, got: {err:?}"
            );
        }
    }
}
