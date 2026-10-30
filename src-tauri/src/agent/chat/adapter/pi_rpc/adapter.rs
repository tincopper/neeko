//! [`PiRpcAdapter`] —— 把 `pi --mode rpc` 传输接到 [`PiSession`] 上。
//!
//! 只做两件事：把 `AgentConfig` 的启动命令交给会话，声明本传输的能力。
//! 协议细节在 `process.rs` / `translate.rs` / `session.rs`，配置投影在 `config.rs`。

use async_trait::async_trait;
use serde_json::json;

use super::config::commands_from_response;
use super::process::PiRpcProcess;
use super::session::PiSession;
use crate::agent::chat::adapter::{
    AgentAdapter, AgentCommand, AgentContext, AgentKind, AgentSession,
};
use crate::agent::chat::capabilities::{ChatCapabilities, ConfigCapability};
use crate::common::agent::types::AgentConfig;
use crate::common::error::AppError;

/// Pi 的私有 rpc 协议适配器（`pi --mode rpc`，单进程）。
pub struct PiRpcAdapter {
    /// 完整的启动命令（`command` + 用户配置的 `args`）。
    cmd: Vec<String>,
    /// 注入给子进程的环境变量（追加，不替换继承）。
    env: std::collections::BTreeMap<String, String>,
}

impl PiRpcAdapter {
    /// 用 `AgentConfig::chat_cmd_vec()` + `chat_env()` 构造。
    #[must_use]
    pub const fn new(cmd: Vec<String>, env: std::collections::BTreeMap<String, String>) -> Self {
        Self { cmd, env }
    }

    /// spawn 的**唯一**入口：`program` + `cmd[1..]` + 适配器契约参数 `tail`，
    /// 交给 [`PiRpcProcess::spawn`]（后者再补自己的 `--mode rpc` 等）。
    ///
    /// 抽在一处只为让「program / args / env 怎么拼」只有一份 —— 会话与命令查询
    /// 两条 spawn 路径各自拼一遍，就是 env 漏传 / argv 形状漂移的来源。
    async fn spawn_in(&self, cwd: &str, tail: &[&str]) -> Result<PiRpcProcess, AppError> {
        let program = self
            .cmd
            .first()
            .ok_or_else(|| AppError::InvalidInput("pi-rpc: empty command".into()))?;
        let args = extra_args(&self.cmd, tail);
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let env_ref: Vec<(&str, &str)> = self
            .env
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        PiRpcProcess::spawn(program, cwd, &arg_refs, &env_ref).await
    }

    /// 会话路径的 spawn：cwd 取项目目录。
    ///
    /// `tail` 是适配器契约参数（恢复时是 `--session <id>`），必须排在用户 args
    /// **之后** —— 理由见 [`extra_args`] 与 [`PiRpcProcess::spawn`] 的顺序文档。
    async fn spawn_process(
        &self,
        ctx: &AgentContext,
        tail: &[&str],
    ) -> Result<PiRpcProcess, AppError> {
        self.spawn_in(&ctx.project_id, tail).await
    }
}

/// 拼装交给 [`PiRpcProcess::spawn`] 的参数：用户 args（`cmd[1..]`）在前，`tail` 在后。
///
/// # 为什么 `tail` 必须在后
///
/// pi 对重复选项是**后写者胜**（`process.rs` 的 `launch_args` 记录了实测）。用户在
/// `AgentConfig.chat.args` 里完全可能写了 `--session <别的 id>` 或 `-c`；若适配器的
/// `--session` 排在前面，user args 会**静默劫持恢复目标** —— 界面显示的是 A 会话历史，
/// 实际接续的是 B。
///
/// 抽成纯函数是为了能直测顺序（`spawn` 要起真进程，藏在里面就测不到）。
#[must_use]
fn extra_args(cmd: &[String], tail: &[&str]) -> Vec<String> {
    let mut args: Vec<String> = cmd.iter().skip(1).cloned().collect();
    args.extend(tail.iter().map(|s| (*s).to_string()));
    args
}

/// 恢复后校验 pi 真的绑定到了**请求的那个**原生会话。
///
/// # 为什么必须校验
///
/// `--session` 接受**部分 UUID**，匹配有歧义（0 或 1 个候选）；命中多个时 pi 可能
/// 取第一个。绑定错会话比失败更糟：用户以为在续写原会话，实际在污染另一条会话的
/// 上下文。校验用的是 pi 自己回报的权威值（`get_state.sessionId`），不复刻它的
/// 会话查找语义。
fn ensure_bound_to(requested: &str, actual: Option<&str>) -> Result<(), AppError> {
    match actual {
        Some(actual) if actual == requested => Ok(()),
        Some(actual) => Err(AppError::NotFound(format!(
            "pi resume: requested session `{requested}` but pi is bound to `{actual}`"
        ))),
        None => Err(AppError::NotFound(format!(
            "pi resume: pi reported no session id for `{requested}`"
        ))),
    }
}

#[async_trait]
impl AgentAdapter for PiRpcAdapter {
    /// Pi 的 rpc 协议：模型 / 档位经 `configOptions`（变更全量回推），
    /// `select` / `confirm` 映射为审批，`get_state.sessionId` 提供恢复句柄，
    /// `get_commands` 提供 slash 命令列表。
    ///
    /// # `commands: true` 的依据
    ///
    /// pi 的 `get_commands` 实测返回 157 条（`prompt` / `skill` / `extension`，
    /// spec `agent-chat-transports.md` §9.4），本 adapter 以独立查询
    /// [`AgentAdapter::list_commands`] 提供它（短暂 spawn rpc 进程 → 查询 →
    /// 关闭，与会话生命周期解耦，同 `list_models` 一类）—— 不是「握手时推
    /// 事件给前端」的方案。前端 `/` 入口由 `SessionStart.capabilities.commands`
    /// 能力位门控；声明与实现的一致性由 `capability_probe.rs` 的契约测试钉住。
    fn chat_capabilities(&self) -> ChatCapabilities {
        ChatCapabilities {
            config: ConfigCapability::SessionConfig,
            approvals: true,
            commands: true,
            resume: true,
        }
    }

    /// 短暂 spawn 一个 rpc 进程查 `get_commands` 后即弃（方案 B，design §3）。
    ///
    /// 命令列表基本是用户级事实（`~/.pi/agent/**` 的 prompt/skill/extension），
    /// 所以 cwd 用当前目录即可；项目级 `.pi/prompts` 需要项目 cwd，属后续
    /// 增量。解析在 [`commands_from_response`]（纯函数，独立单测）。
    async fn list_commands(
        &self,
        _config: &AgentConfig,
        _directory: Option<&str>,
    ) -> Result<Vec<AgentCommand>, AppError> {
        let proc = self.spawn_in(".", &[]).await?;
        let result = list_commands_with(&proc).await;
        proc.dispose();
        result
    }

    fn kind(&self) -> AgentKind {
        AgentKind::Custom
    }

    async fn create(&self, ctx: &AgentContext) -> Result<Box<dyn AgentSession>, AppError> {
        let proc = self.spawn_process(ctx, &[]).await?;
        Ok(Box::new(
            PiSession::start_with(proc, ctx, self.chat_capabilities()).await?,
        ))
    }

    /// 用 `pi … --session <native_session_id>` 重新绑定一条**已存在**的 pi 会话。
    ///
    /// 静默启动（`ctx.prompt` 为空 → 不发首轮）：历史回放归 conversation 域，
    /// 把历史塞成 prompt 会双写、双倍 token 且污染原生会话。
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
        let proc = self
            .spawn_process(ctx, &["--session", native_session_id])
            .await?;
        // 握手失败已在 `start_with` 里附带 pi 的 stderr 尾部（可归因）。
        let mut session = PiSession::start_with(proc, ctx, self.chat_capabilities()).await?;
        if let Err(e) = ensure_bound_to(native_session_id, session.resume_id().as_deref()) {
            // 绑定错了就不要留着这条进程：它会在错误的会话上继续跑。
            session.cancel().await;
            return Err(e);
        }
        Ok(Box::new(session))
    }

    /// 单一真相：能恢复 ⇔ 能力快照里的 `resume` 位（红线 14 同源）。
    fn supports_chat_resume(&self) -> bool {
        self.chat_capabilities().resume
    }
}

/// 查询并解析命令列表（与 spawn 路径拆开：测试可用假连接注入，
/// 不必起真 pi 进程 —— 与 `PiSession::start_with` 同一拆法）。
async fn list_commands_with(proc: &PiRpcProcess) -> Result<Vec<AgentCommand>, AppError> {
    let data = proc.request(json!({"type": "get_commands"}), None).await?;
    Ok(commands_from_response(&data))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> AgentContext {
        AgentContext {
            agent_id: "pi".into(),
            session_id: "s1".into(),
            // 平台无关（红线 13）：`project_id` 会作为 spawn 的 cwd 交给执行层。
            project_id: std::env::temp_dir().display().to_string(),
            project_name: "proj".into(),
            env: "local".into(),
            skills: vec![],
            files: vec![],
            mode: "auto".into(),
            prompt: String::new(),
            model_id: None,
        }
    }

    fn cmd() -> Vec<String> {
        vec!["pi".into(), "--mode".into(), "rpc".into()]
    }

    /// **顺序护栏**：`tail`（恢复用的 `--session <id>`）必须排在用户 args 之后。
    ///
    /// 变异验证：把 `extra_args` 改成 `tail` 在前 → 本用例红；真机上则表现为
    /// 「界面显示 A 会话历史，实际续写 B」—— 静默污染，比失败更糟。
    #[test]
    fn adapter_tail_comes_after_user_args() {
        let cmd = vec![
            "pi".into(),
            "--provider".into(),
            "x".into(),
            "-c".to_string(),
        ];
        let args = extra_args(&cmd, &["--session", "abc"]);

        assert_eq!(args, ["--provider", "x", "-c", "--session", "abc"]);
    }

    /// `argv[0]` 属于 `PiRpcProcess::spawn` 的 `command` 参数，**不进** args。
    #[test]
    fn program_name_is_not_repeated_in_args() {
        assert_eq!(extra_args(&cmd(), &[]), ["--mode", "rpc"]);
    }

    /// 空 tail（`create` 路径）= 用户 args 原样，行为与改动前一致。
    #[test]
    fn empty_tail_keeps_user_args_verbatim() {
        assert!(extra_args(&cmd(), &[]).iter().all(|a| a != "--session"));
    }

    /// 绑定相等 → Ok。
    #[test]
    fn ensure_bound_to_accepts_the_requested_session() {
        assert!(ensure_bound_to("abc", Some("abc")).is_ok());
    }

    /// 绑定了**别的**会话 → 报错（不是静默接受）。
    #[test]
    fn ensure_bound_to_rejects_a_different_session() {
        let err = ensure_bound_to("abc", Some("def")).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
        assert!(err.to_string().contains("abc") && err.to_string().contains("def"));
    }

    /// pi 没回报 id（旧版 / 异常响应）→ 也报错：不能假定「它就是那个会话」。
    #[test]
    fn ensure_bound_to_rejects_a_missing_session_id() {
        let err = ensure_bound_to("abc", None).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
    }

    /// **红线 14 同源**：`chat_capabilities().resume` 与 `supports_chat_resume()`
    /// 是同一个事实的两处表达，必须同源。
    ///
    /// 变异验证：把 `supports_chat_resume` 改回 trait 默认（`false`）→ 本用例红，
    /// 且前端入口会静默消失（`agent_chat_supports_resume` 返 false）。
    #[test]
    fn resume_capability_bit_matches_supports_chat_resume() {
        let adapter = PiRpcAdapter::new(cmd(), Default::default());
        assert!(
            adapter.chat_capabilities().resume,
            "pi rpc 实测能 `--session <id>` 重新绑定（get_state.sessionId 相同）"
        );
        assert_eq!(
            adapter.chat_capabilities().resume,
            adapter.supports_chat_resume(),
            "声明位与 supports_chat_resume() 必须同源"
        );
    }

    /// **位为 true ⇒ `resume()` 有覆写。**
    ///
    /// 判据是「走不走 trait 默认实现」，不是「真 pi 能不能恢复」：用不存在的二进制，
    /// 失败必须是 spawn 类错误（`AppError::Io`）。若覆写被删，会退回默认实现并返回
    /// 一句 `does not support chat resume` —— 前端入口随之变成死入口。
    #[tokio::test]
    async fn resume_is_implemented_and_fails_on_spawn() {
        const NO_SUCH_BINARY: &str = "definitely-not-a-real-binary-mention-slash";
        let adapter = PiRpcAdapter::new(vec![NO_SUCH_BINARY.into()], Default::default());

        let err = match adapter.resume(&ctx(), "abc").await {
            Ok(_) => panic!("spawning a nonexistent binary must fail"),
            Err(e) => e,
        };
        assert!(
            matches!(err, AppError::Io(_)),
            "expected a spawn error, got {err:?}"
        );
        assert!(
            !err.to_string().contains("does not support chat resume"),
            "trait 默认实现还在 —— resume() 覆写被删了: {err}"
        );
    }

    /// 空 id 在 spawn 之前就拒绝（不浪费一次进程启动）。
    #[tokio::test]
    async fn resume_rejects_an_empty_session_id() {
        let adapter = PiRpcAdapter::new(cmd(), Default::default());
        let err = match adapter.resume(&ctx(), "").await {
            Ok(_) => panic!("empty id must not spawn"),
            Err(e) => e,
        };
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
    }
}
