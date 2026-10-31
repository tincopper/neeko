//! **决策 → 执行**的交接面：启动计划（纯函数）+ 执行层端口 + 回复的副作用映射。
//!
//! # 为什么单独成文件
//!
//! `mcp::dispatch` 只决定（准入 + 落库）。执行层真正需要的是三件套：**cwd / env / 启动参数**。
//! 把这三件套的推导做成**纯函数**，执行层（组合根）就只剩「算计划 → 调 terminal 起 PTY」，
//! 而最后那一步是唯一无法单测的部分（要 `AppHandle`）。
//!
//! # 三个组成部分，各管一件事
//!
//! | 组成 | 是什么 | 为什么在这一层 |
//! | --- | --- | --- |
//! | [`plan_member_spawn`] | 纯函数：成员行 → `cwd` / `env` / `args` | 全部输入可从库重建，可直测 |
//! | [`MemberExecutor`] / [`CredentialLedger`] | 端口：进程副作用与凭证签发 | 端点只该「交出结论」，不该认识 PTY / 项目库 / 门 |
//! | [`apply_reply`] | 回复 → 副作用的**唯一**映射 | 换一处 = 换全部；散在 handler 里会漂移 |
//!
//! 依赖方向：本文件只依赖 `dispatch`（回复形态）与 `admission`（per-CLI 数据），**不认识**
//! `AppHandle` / `TerminalRouter` / `AppStateWrapper` —— 那三样只在组合根的
//! [`crate::app::team_executor`] 里出现（红线 3 与依赖倒置同时成立）。
//! # 输入全部来自**已落库的行**
//!
//! 工具返回只带 `member_id` / `tier` / `unverified`（红线 14 的输出侧），所以这里的每一个
//! 输入都必须能从持久化的成员行重新算出来：`member.workspace` → cwd、`member.agent_id` →
//! 准入表那一行、`identity::member_env` → env、`approval_policy` → 旁路参数。少一个字段就
//! 等于执行层推不出来 —— 判据在 `mcp::dispatch` 的
//! `member_row_carries_everything_the_executor_needs`。
//!
//! # 阻塞（红线 3）
//!
//! [`plan_member_spawn`] 会 `canonicalize`（红线 8 的消费点），那是阻塞 I/O：**调用方必须
//! 在阻塞池里调它**。本模块自身不 `spawn`（同 `TeamManager` 的取舍）。

use std::path::{Path, PathBuf};

use crate::agent::team::admission::{admission_for, MCP_CONFIG_PLACEHOLDER};
use crate::agent::team::identity;
use crate::agent::team::mcp::dispatch::ToolReply;
use crate::agent::team::mcp::protocol::TOKEN_HEADER;
use crate::agent::team::types::{Team, TeamMember, Workspace};
use crate::common::error::AppError;

/// MCP 配置里的 server 名（写进 `mcpServers` 的 key）。
///
/// 与 `neeko-report` 的 hook 名并列而不是复用：hook 与团队是两条流量、两套凭证
/// （design §3.1b），共用一个名字只会让配置看起来"只有一份"。
pub const TEAM_SERVER_NAME: &str = "neeko-team";

/// 一个成员进程的启动计划：**执行层需要的全部**，且没有多余字段。
///
/// 字段少是刻意的：`terminal::create_session` 收 `cwd` + `env`（不透明的键值对），
/// 启动参数由调用方拼进 shell 命令行 —— 计划里出现第三个东西就说明有职责跑错了层。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpawnPlan {
    /// 进程工作目录（`Workspace` 的落地形态；worktree 已在计划期 canonicalize）。
    pub cwd: PathBuf,
    /// 注入子进程的身份 env（`identity::member_env` 的结果，**不含凭证**）。
    pub env: Vec<(String, String)>,
    /// 追加到启动命令行的参数（`McpInjection::Argv` 档的 MCP 配置）。
    pub args: Vec<String>,
}

/// 算出一个成员的启动计划。
///
/// # 失败即拒绝，不做降级
///
/// 三种拒绝都不是"暂时不支持的耐心问题"，而是**不能假装能跑**：
///
/// | 情形 | 为什么必须拒绝 |
/// | --- | --- |
/// | 该 CLI 没有 MCP 面（`omp` / `reasonix`） | 起得来也收不到任务（`channel = None`），花名册里多一个永远不动的成员 |
/// | 注入方式不是 `Argv`（`Subcommand` / `ConfigFile`） | 执行层传不了它认的参数：成员起来、tool 面静默不可见 |
/// | worktree 落在团队根之外 | 红线 8：执行层要拿它当 cwd 与 `git worktree` 的目标 |
///
/// # 参数
///
/// - `mcp_url`：团队 MCP 端点的完整 URL（含端口的 `/team/mcp`）。
/// - `token`：该成员的凭证**明文**（由 `TeamManager::issue_token` 取一次；本函数不签、不存）。
pub fn plan_member_spawn(
    team: &Team,
    member: &TeamMember,
    mcp_url: &str,
    token: &str,
) -> Result<SpawnPlan, AppError> {
    if member.team_id != team.id {
        return Err(AppError::InvalidInput(format!(
            "member {} belongs to team {}, not {}",
            member.id, member.team_id, team.id
        )));
    }

    let admission = admission_for(&member.agent_id).ok_or_else(|| {
        AppError::Unsupported(format!(
            "agent `{}` has no admission row, so its launch cannot be planned",
            member.agent_id
        ))
    })?;

    // 「起得来但用不了」的两个条件在 `team_spawn` 已经早拒过一次（不留下永远不动的成员
    // 行）；这里再问一次是**执行前确认**：成员行可以被重新启动 / 被别的路径写进库，
    // 而判据只该有一份（`AgentAdmission::launch_refusal`）。
    if let Some(why) = admission.launch_refusal() {
        return Err(AppError::Unsupported(why));
    }

    Ok(SpawnPlan {
        cwd: resolve_cwd(team, member)?,
        // 身份 env 与凭证刻意分开：env 会进 `/proc/<pid>/environ` 与子进程继承，
        // 凭证明文只出现在启动参数的 MCP 配置里（design §3.1「明文只下发一次」）。
        env: identity::member_env(&member.team_id, &member.id),
        args: mcp_argv(admission.mcp_argv, mcp_url, token),
    })
}

/// 把 `mcp_argv` 模板里的占位符替换成 MCP 配置 JSON。
///
/// 只替换**完整等于占位符**的元素，不做字符串内替换：模板里的其他参数万一含有 `{{`，
/// 也不该被当成占位符吃掉（有测试钉住）。
fn mcp_argv(template: &[&str], mcp_url: &str, token: &str) -> Vec<String> {
    let config = mcp_config_json(mcp_url, token);
    template
        .iter()
        .map(|arg| {
            if *arg == MCP_CONFIG_PLACEHOLDER {
                config.clone()
            } else {
                (*arg).to_owned()
            }
        })
        .collect()
}

/// MCP 配置 JSON（streamable HTTP + header 凭证）。
///
/// 用 `serde_json` 构造而不是拼字符串：端点 URL 与 token 都是外部输入，拼字符串是最容易
/// 在引号上出事的地方。`type: "http"` 是各家 CLI 共用的 streamable-HTTP 写法；
/// header 名取自 `mcp::protocol::TOKEN_HEADER`（**单一源**：端点读 header、这里写 header）。
#[must_use]
pub fn mcp_config_json(mcp_url: &str, token: &str) -> String {
    serde_json::json!({
        "mcpServers": {
            TEAM_SERVER_NAME: {
                "type": "http",
                "url": mcp_url,
                "headers": { TOKEN_HEADER: token },
            }
        }
    })
    .to_string()
}

/// 成员进程的 cwd。
///
/// - `Shared` / `ReadOnly` → 团队根。只读是**策略**不是路径，执行层不据此换目录。
/// - `Worktree { path }` → 该路径，且必须落在团队根之下（红线 8）。
///
/// **团队根无条件规范化**（不是只在 worktree 分支）：它是下面的信任边界 —— `starts_with`
/// 在符号链接与 `/var` ↔ `/private/var` 这类平台差异上会给出与肉眼相反的答案，而一个未
/// 规范化的根会让「落在根内」的判据整体失效。`Shared` 分支同样要吃这条：成员进程的 cwd
/// 与「根内」判据必须是同一个字符串身份，否则同一棵树上会存在两种写法。
fn resolve_cwd(team: &Team, member: &TeamMember) -> Result<PathBuf, AppError> {
    let root = canonicalize(&team.project_path, "team root")?;
    match member.workspace {
        Workspace::Shared | Workspace::ReadOnly => Ok(root),
        Workspace::Worktree { ref path } => {
            let target = canonicalize(path, "member worktree")?;
            if !target.starts_with(&root) {
                return Err(AppError::InvalidInput(format!(
                    "member workspace {} is outside the team root {}; a member must not be \
                     launched outside its team's project",
                    target.display(),
                    root.display()
                )));
            }
            Ok(target)
        }
    }
}

/// `canonicalize` + 把「路径不存在 / 不可读」翻成可读的 `InvalidInput`。
fn canonicalize(path: &Path, what: &str) -> Result<PathBuf, AppError> {
    std::fs::canonicalize(path).map_err(|err| {
        AppError::InvalidInput(format!(
            "{what} {} cannot be used as a working directory: {err}",
            path.display()
        ))
    })
}

// ─────────────────────────── 执行层端口 ───────────────────────────

/// 执行层：**唯一**能制造进程副作用的接口。
///
/// # 为什么是端口
///
/// 端点跑在 HTTP handler 里，只看得见「工具说了什么」。真正起进程 / 写字节需要
/// `AppHandle` + `TerminalRouter` + 项目库 —— 三样都只有组合根有。把执行者作为端口注入，
/// 本域就仍然可以只用 `TeamManager` + 两张假表被单测驱动。
///
/// # 为什么两个方法在同一个 trait
///
/// 它们是**同一个角色**（成员进程的持有者）的两个动作：起进程、往它嘴里写话。拆成两个
/// trait 只会让组合根实现两个空壳（同一个 `AppHandle` 被存两次），而调用方要在两个
/// `Option` 之间做同一个判断（「执行层接了吗」）。
///
/// # 为什么是 `async`
///
/// 起 PTY 走 `TerminalRouter::create_session`（async），投递要进阻塞池。在同步签名里做这两件
/// 事就只剩 `block_on` 一条路 —— 那会在 handler 线程上阻塞 tokio worker（红线 3）。
#[async_trait::async_trait]
pub trait MemberExecutor: Send + Sync {
    /// 为一个**已落库**的成员起进程，并把得到的 PTY 句柄回填到成员行。
    ///
    /// `token` 是该成员的凭证**明文**（由 [`CredentialLedger::admit`] 签发并已让门认识）。
    /// 它只在本函数内出现一次，随即进启动参数的 MCP 配置（design §3.1「明文只下发一次」）。
    ///
    /// 失败语义是「成员已落库但没有进程」——两相位设计里这是**可查询、可清理**的状态
    /// （见 [`ToolReply::MemberCreated`] 的文档），所以错误原样上抛，不在这里回滚成员。
    async fn spawn(&self, member_id: &str, token: &str) -> Result<(), AppError>;

    /// 把一条队内消息投递给成员。
    ///
    /// 通道选择（`Pty` 写 stdin / `Mcp` 无法推送）是执行层的策略：端点不知道成员行里
    /// 那个 `channel` 字段，也不应该知道。
    async fn deliver(&self, member_id: &str, message: &str) -> Result<(), AppError>;
}

/// 凭证面：为成员签发**一次**明文凭证，并让端点的门**立即**接受它。
///
/// # 为什么「签发 + 认门」是一个动作
///
/// 两件事分开做就会出现一个窗口：库里已有新凭证、门却还不认识它 —— 成员的**首次**调用
/// 因此 401（而它就在窗口里刚启动）。归并成一个动作，窗口就不存在，调用方也不可能
/// 只做一半。
///
/// # 为什么由端点实现
///
/// 门与「谁能进来」是同一件事（同一个 `TeamServerState`）。让本域去实现会把门拖进来，
/// 而本文件现在的依赖是「回复形态 + per-CLI 数据」—— 保持这个依赖集，执行层才能在没有
/// HTTP、没有 `AppHandle` 的情况下被测试。
#[async_trait::async_trait]
pub trait CredentialLedger: Send + Sync {
    /// 返回该成员的凭证**明文**（落库只存 hash）。
    async fn admit(&self, member_id: &str) -> Result<String, AppError>;
}

// ────────────────────── 回复 → 副作用（唯一映射） ──────────────────────

/// 把一条工具回复的**副作用**交给执行层。
///
/// # 为什么在这里而不是在 handler 里
///
/// 「哪种回复有副作用、按什么顺序做」是域知识，不是传输知识。写在 handler 里会有两个
/// 后果：`server.rs` 继续变胖（它已经同时管 RPC / 鉴权 / 路由 / 状态），而这段逻辑
/// 只能通过发真 HTTP 请求才能测。搬到这里之后，handler 只剩一行调用，副作用映射由
/// 本文件的单测直接钉住。
///
/// # 顺序是契约
///
/// `admit` **先于** `spawn`：成员进程一启动就会发第一次工具调用，门若还不认识它的凭证
/// 就是 401。把认门放在起进程之后只能靠「CLI 启动慢」这种概率事件遮掩。
///
/// # 执行层是**必填**的
///
/// 没有「`executor = None` 时假装成功」的分支：静默通过会让队长以为成员已开工 / 消息已送达，
/// 而实际上什么都没有发生。组合根**总是**注入执行者（它没有构造失败的可能），所以这个分支
/// 只会在测试里出现 —— 那里用一个 `NoopExecutor` 比一条会撒谎的生产路径便宜得多。
pub async fn apply_reply(
    credentials: &dyn CredentialLedger,
    executor: &dyn MemberExecutor,
    reply: &ToolReply,
) -> Result<(), AppError> {
    match reply {
        ToolReply::MemberCreated { member_id, .. } => {
            start_member(credentials, executor, member_id).await
        }
        ToolReply::NeedsDelivery { to, message } => executor.deliver(to, message).await,
        // 其余变体是纯数据（板视图 / 任务行 / 等待结局）：没有进程副作用。
        _ => Ok(()),
    }
}

/// 起一个**已落库**的成员：签发凭证（并认门）→ 起进程。
///
/// # 为什么独立于 [`apply_reply`]
///
/// 两个入口都做同一件事：`team_spawn` 的回复副作用（队长经 MCP 工具）与「以队长身份开会话」
/// 的本地命令（人经 Tauri 命令）。若本地入口复用的是 `apply_reply`，它就必须**认识
/// `ToolReply`** —— 那是 MCP 的词汇，于是团队域的本地入口被绑在一条它并不使用的协议上
/// （改 `ToolReply` 会让本地入口跟着改）。
///
/// 抽成这个动作后，`ToolReply` 只出现在「工具回复 → 副作用」的那一层，本地入口只依赖两个端口。
///
/// # 顺序不可交换
///
/// `admit` **先于** `spawn`：成员进程一启动就会发第一次工具调用，门若还不认识它的凭证就是 401。
pub async fn start_member(
    credentials: &dyn CredentialLedger,
    executor: &dyn MemberExecutor,
    member_id: &str,
) -> Result<(), AppError> {
    let token = credentials.admit(member_id).await?;
    executor
        .spawn(member_id, &token)
        .await
        .map_err(|err| spawn_failure(member_id, err))
}

/// 起进程失败必须**带着 `member_id`** 回去。
///
/// 成员已经落库（决策层成功），丢掉 id 的后果是：队长看到一条裸错误，既不知道是哪个成员
/// 没起来，也无法 `team_status` / `team_close` 收拾它 —— 而「可查询、可清理」正是两相位
/// 设计的全部理由。
fn spawn_failure(member_id: &str, err: AppError) -> AppError {
    AppError::Terminal(format!(
        "member `{member_id}` was created but could not be started: {err}; it is still in the \
         roster, so `team_status` lists it and `team_close` can retire it"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::admission::tier_of;
    use crate::agent::team::fixtures::{fixture_member, fixture_team};
    use crate::agent::team::types::Workspace;

    const TEAM: &str = "tm_1";
    const W1: &str = "w1@tm_1";
    const MCP_URL: &str = "http://127.0.0.1:43210/team/mcp";
    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    /// 一个 worker，`agent_id` 可指定（测试按 CLI 的注入档分组）。
    fn worker(agent_id: &str) -> TeamMember {
        TeamMember {
            agent_id: agent_id.into(),
            ..fixture_member(W1, TEAM)
        }
    }

    /// 团队根指向真实存在且可规范化的目录（红线 13：由 tempdir 推导，不手写绝对路径）。
    fn team_at(root: &Path) -> Team {
        Team {
            project_path: root.to_path_buf(),
            ..fixture_team(TEAM)
        }
    }

    fn tempdir() -> tempfile::TempDir {
        tempfile::tempdir().expect("tempdir")
    }

    /// happy path：三件套各自来自一个**已落库**的字段。
    ///
    /// cwd 断言对的是**规范化后**的临时目录：`resolve_cwd` 无条件规范化团队根（它是下面
    /// `starts_with` 的信任边界），所以在 macOS 上 `/var/...` → `/private/var/...` 是**预期**
    /// 行为，而不是测试的噪音。
    #[test]
    fn claude_plan_carries_env_argv_and_the_team_root() {
        let tmp = tempdir();
        let plan = plan_member_spawn(&team_at(tmp.path()), &worker("claude-code"), MCP_URL, TOKEN)
            .expect("plan");

        assert_eq!(
            plan.cwd,
            std::fs::canonicalize(tmp.path()).expect("canonical"),
            "cwd 必须是规范化后的团队根（与 `starts_with` 判据同一个字符串身份）"
        );
        assert_eq!(plan.env, identity::member_env(TEAM, W1));
        assert_eq!(plan.args.len(), 2, "{:?}", plan.args);
        assert_eq!(plan.args[0], "--mcp-config");
        let config: serde_json::Value =
            serde_json::from_str(&plan.args[1]).expect("MCP 配置必须是合法 JSON");
        assert_eq!(config["mcpServers"][TEAM_SERVER_NAME]["type"], "http");
        assert_eq!(config["mcpServers"][TEAM_SERVER_NAME]["url"], MCP_URL);
        assert_eq!(
            config["mcpServers"][TEAM_SERVER_NAME]["headers"][TOKEN_HEADER],
            TOKEN
        );
    }

    /// qoder 额外要 `--strict-mcp-config`（模板是数据，不是通用模板的特例分支）。
    #[test]
    fn qoder_plan_appends_its_strict_flag() {
        let tmp = tempdir();
        let plan = plan_member_spawn(&team_at(tmp.path()), &worker("qoder"), MCP_URL, TOKEN)
            .expect("plan");
        assert_eq!(plan.args.len(), 3, "{:?}", plan.args);
        assert_eq!(plan.args[2], "--strict-mcp-config");
    }

    /// 凭证**只在启动参数里**，不进 env：env 会被子进程继承、会进 `/proc/<pid>/environ`。
    #[test]
    fn the_token_never_appears_in_the_env() {
        let tmp = tempdir();
        let plan = plan_member_spawn(&team_at(tmp.path()), &worker("claude-code"), MCP_URL, TOKEN)
            .expect("plan");
        for (key, value) in &plan.env {
            assert!(
                !value.contains(TOKEN),
                "env `{key}` 里出现了凭证明文 —— 凭证只允许出现在启动参数里"
            );
        }
        // 反向：它确实在启动参数的那段 JSON 里（否则成员连不上）。
        assert!(plan.args.iter().any(|arg| arg.contains(TOKEN)));
    }

    /// worktree 成员：cwd 是该路径（已规范化），且必须落在团队根之内。
    #[test]
    fn worktree_inside_the_team_root_becomes_the_cwd() {
        let tmp = tempdir();
        let wt = tmp.path().join("wt-w1");
        std::fs::create_dir_all(&wt).expect("worktree dir");
        let member = TeamMember {
            workspace: Workspace::Worktree { path: wt.clone() },
            ..fixture_member(W1, TEAM)
        };

        let plan = plan_member_spawn(&team_at(tmp.path()), &member, MCP_URL, TOKEN).expect("plan");
        assert_eq!(
            plan.cwd,
            std::fs::canonicalize(&wt).expect("canonical"),
            "cwd 必须已规范化（否则 `starts_with` 在符号链接上会给出相反的答案）"
        );
    }

    /// 红线 8：团队根之外的 worktree 一律拒绝（否则等于给成员一个任意的 cwd）。
    #[test]
    fn worktree_outside_the_team_root_is_rejected() {
        let team_tmp = tempdir();
        let outside_tmp = tempdir();
        let member = TeamMember {
            workspace: Workspace::Worktree {
                path: outside_tmp.path().to_path_buf(),
            },
            ..fixture_member(W1, TEAM)
        };

        let err = plan_member_spawn(&team_at(team_tmp.path()), &member, MCP_URL, TOKEN)
            .expect_err("团队根之外的 worktree 必须被拒绝");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
        assert!(err.to_string().contains("outside the team root"), "{err}");
    }

    /// 不存在的 worktree 路径 → `InvalidInput`（不静默回退到团队根）。
    #[test]
    fn a_missing_worktree_path_is_rejected() {
        let tmp = tempdir();
        let member = TeamMember {
            workspace: Workspace::Worktree {
                path: tmp.path().join("does-not-exist"),
            },
            ..fixture_member(W1, TEAM)
        };
        let err = plan_member_spawn(&team_at(tmp.path()), &member, MCP_URL, TOKEN)
            .expect_err("不存在的路径必须被拒绝");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
        assert!(
            err.to_string()
                .contains("cannot be used as a working directory"),
            "{err}"
        );
    }

    /// 非 `Argv` 注入档一律拒绝，且错误里点名档位（下一轮实现时看日志就知道是哪种）。
    #[test]
    fn subcommand_and_config_file_agents_are_refused() {
        let tmp = tempdir();
        for (agent_id, mode) in [
            ("grok", "Subcommand"),
            ("codex", "Subcommand"),
            ("gemini", "ConfigFile"),
        ] {
            let err = plan_member_spawn(&team_at(tmp.path()), &worker(agent_id), MCP_URL, TOKEN)
                .expect_err("非 Argv 档必须被拒绝");
            assert!(
                matches!(err, AppError::Unsupported(_)),
                "{agent_id}: {err:?}"
            );
            assert!(
                err.to_string().contains(mode),
                "{agent_id} 的错误信息必须点名注入档：{err}"
            );
        }
    }

    /// 无 MCP 面的 CLI（`omp` / `reasonix`）拒绝：起得来也收不到任务。
    #[test]
    fn agents_without_an_mcp_surface_are_refused() {
        let tmp = tempdir();
        for agent_id in ["omp", "reasonix"] {
            let err = plan_member_spawn(&team_at(tmp.path()), &worker(agent_id), MCP_URL, TOKEN)
                .expect_err("无 MCP 面必须拒绝");
            assert!(
                matches!(err, AppError::Unsupported(_)),
                "{agent_id}: {err:?}"
            );
            assert!(
                err.to_string().contains("no MCP surface"),
                "{agent_id}: {err}"
            );
        }
    }

    /// 成员行与团队不匹配 → `InvalidInput`（防御性：跨队 spawn 等于让 A 队扮演 B 队）。
    #[test]
    fn a_member_of_another_team_is_rejected() {
        let tmp = tempdir();
        let member = fixture_member(W1, "tm_other");
        let err = plan_member_spawn(&team_at(tmp.path()), &member, MCP_URL, TOKEN)
            .expect_err("跨队成员必须被拒绝");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
    }

    /// 模板替换只认**完整等于**占位符的元素（模板里其他参数不会被误替换）。
    #[test]
    fn only_the_placeholder_element_is_substituted() {
        let args = mcp_argv(
            &["--x", MCP_CONFIG_PLACEHOLDER, "prefix-{{mcp_config}}"],
            "u",
            "t",
        );
        assert_eq!(args[0], "--x");
        assert!(args[1].contains("\"mcpServers\""));
        assert_eq!(
            args[2], "prefix-{{mcp_config}}",
            "字符串内的占位符不替换 —— 模板是数据，不是格式化字符串"
        );
    }

    // ─────────────── `apply_reply`：副作用映射（AC14 的接线判据） ───────────────

    /// 记录端口：把「谁被要求做什么」按发生顺序记下来。
    ///
    /// 一个类型同时实现两个端口是刻意的 —— 它们就是同一个角色的两半，拆成两个假体会让
    /// 「`admit` 与 `spawn` 的先后」这条契约在测试里也无处安放。
    struct Recorder {
        calls: std::sync::Mutex<Vec<String>>,
        token: &'static str,
        spawn_error: Option<&'static str>,
    }

    impl Recorder {
        fn new() -> Self {
            Self {
                calls: std::sync::Mutex::new(Vec::new()),
                token: "issued-token",
                spawn_error: None,
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.lock().expect("calls").clone()
        }

        fn record(&self, call: String) {
            self.calls.lock().expect("calls").push(call);
        }
    }

    #[async_trait::async_trait]
    impl CredentialLedger for Recorder {
        async fn admit(&self, member_id: &str) -> Result<String, AppError> {
            self.record(format!("admit:{member_id}"));
            Ok(self.token.to_owned())
        }
    }

    #[async_trait::async_trait]
    impl MemberExecutor for Recorder {
        async fn spawn(&self, member_id: &str, token: &str) -> Result<(), AppError> {
            self.record(format!("spawn:{member_id}:{token}"));
            match self.spawn_error {
                Some(message) => Err(AppError::Terminal(message.to_owned())),
                None => Ok(()),
            }
        }

        async fn deliver(&self, member_id: &str, message: &str) -> Result<(), AppError> {
            self.record(format!("deliver:{member_id}:{message}"));
            Ok(())
        }
    }

    fn member_created(member_id: &str) -> ToolReply {
        ToolReply::MemberCreated {
            member_id: member_id.to_owned(),
            tier: tier_of(admission_for("claude-code").expect("admitted")),
            unverified: Vec::new(),
        }
    }

    /// `MemberCreated`：**先**认门**再**起进程，且把刚签发的明文交过去。
    ///
    /// 顺序是契约：反过来的话成员的首次工具调用会 401（它就在那个窗口里刚启动）。
    #[tokio::test]
    async fn member_created_admits_first_then_spawns_with_that_token() {
        let recorder = Recorder::new();
        apply_reply(&recorder, &recorder, &member_created(W1))
            .await
            .expect("apply");

        assert_eq!(
            recorder.calls(),
            vec![format!("admit:{W1}"), format!("spawn:{W1}:issued-token"),],
            "顺序与载荷都是契约：认门在前，明文只在 spawn 的入参里出现"
        );
    }

    /// `NeedsDelivery`：必须真的交到执行层（而不是止步于「已校验」）。
    ///
    /// 反例（本用例挡的正是它）：`team_send` 返回 `NeedsDelivery` 而没有任何消费方 ——
    /// 队长以为消息送达，成员一个字节也没收到。
    #[tokio::test]
    async fn needs_delivery_reaches_the_executor() {
        let recorder = Recorder::new();
        let reply = ToolReply::NeedsDelivery {
            to: W1.to_owned(),
            message: "run the tests".to_owned(),
        };
        apply_reply(&recorder, &recorder, &reply)
            .await
            .expect("apply");

        assert_eq!(
            recorder.calls(),
            vec![format!("deliver:{W1}:run the tests")]
        );
    }

    /// 起进程失败时错误里**必须带着 `member_id`** —— 否则队长既查不到也清不掉那个成员。
    #[tokio::test]
    async fn a_failed_spawn_keeps_the_member_id_in_the_error() {
        let recorder = Recorder {
            spawn_error: Some("pty refused"),
            ..Recorder::new()
        };
        let err = apply_reply(&recorder, &recorder, &member_created(W1))
            .await
            .expect_err("spawn 失败必须上抛");

        assert!(matches!(err, AppError::Terminal(_)), "{err:?}");
        let message = err.to_string();
        assert!(message.contains(W1), "错误必须点名成员：{message}");
        assert!(
            message.contains("team_status"),
            "必须告诉队长怎么查：{message}"
        );
        assert!(
            message.contains("pty refused"),
            "原始原因不得被吞：{message}"
        );
    }

    /// 纯数据回复（板视图 / 任务行）不得产生任何进程副作用。
    #[tokio::test]
    async fn pure_replies_have_no_side_effects() {
        let recorder = Recorder::new();
        apply_reply(&recorder, &recorder, &ToolReply::Tasks(Vec::new()))
            .await
            .expect("apply");
        assert!(recorder.calls().is_empty(), "{:?}", recorder.calls());
    }
}
