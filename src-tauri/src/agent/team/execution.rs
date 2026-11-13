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
//! | [`plan_member_spawn`] | 纯函数：成员行 → `cwd` / `env` / `args` / `credentials_env` / `config_dir` | 全部输入可从库重建，可直测 |
//! | [`MemberExecutor`] / [`CredentialLedger`] | 端口：进程副作用与凭证签发 | 端点只该「交出结论」，不该认识 PTY / 项目库 / 门 |
//! | [`Effect`] / [`apply_effect`] | 领域副作用 → 动手（起进程 / 投递 / 关闭）| 换一处 = 换全部；散在 handler 里会漂移 |
//!
//! 依赖方向：本文件只依赖 `admission`（per-CLI 数据）与 `mcp::protocol`（wire 常量），**不认识**
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

use crate::agent::team::admission::{
    admission_for, needs_credentials_env, render_argv, AgentAdmission, ConfigDirSpec, RenderContext,
};
use crate::agent::team::identity;
use crate::agent::team::mcp::protocol::TOKEN_HEADER;
use crate::agent::team::options::options_for;
use crate::agent::team::types::{
    McpInjection, MemberRole, MemberState, Team, TeamMember, TeamState, Workspace,
};
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
///
/// # 队长与成员的不对称（在 `args` 里）
///
/// 两种角色都会在 `args` 末尾拿到**角色 preamble**（`prompt_argv`）：起来之后它才知道
/// 自己是队长 / 成员、team_id 是什么、有哪些工具。差别只在**拒绝了谁**：
///
/// - 该 CLI 的 `prompt_argv` 为空且角色是队长 ⇒ **拒绝**（`lead_refusal`）：队长的第一个
///   动作（`team_status` / `task_create`）没有人能替它触发，空提示的队长就是一个不动的会话；
/// - 同样的 CLI 当**成员** ⇒ 照常起：它的第一条上下文可以由 `team_send` 带来。
///
/// 这就是同一个空模板在两个角色上得到两种回答的理由，也是不能把判据合并的原因。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpawnPlan {
    /// 进程工作目录（`Workspace` 的落地形态；worktree 已在计划期 canonicalize）。
    pub cwd: PathBuf,
    /// 注入子进程的身份 env（`identity::member_env` 的结果，**不含凭证**）。
    pub env: Vec<(String, String)>,
    /// 追加到启动命令行的参数（`McpInjection::Argv` 档的 MCP 配置 + 角色 preamble + 旁路开关）。
    ///
    /// # 位置契约（**唯一**组合点就是本类型的生产者）
    ///
    /// ```text
    /// args = resume 片段 ++ mcp_argv ++ prompt_argv ++ bypass_args
    /// ```
    ///
    /// **resume 片段必须在紧跟 program 的位置**：codex 的 `resume` 是子命令，追加到末尾
    /// 会被它当成 PROMPT（2026-11-11 实测）。旁路开关保持在 preamble **之后** ——
    /// 那个相对顺序是今天每一家 CLI 的参数解析都被实测过的形状，`resume = None` 时
    /// 必须逐字节等于旧输出。
    pub args: Vec<String>,
    /// 需要注入子进程的**凭证** env（与 [`Self::env`] 分开：那份是身份，这份含密）。
    ///
    /// # 为什么凭证可以进 env（唯一例外）
    ///
    /// 今天只有 `bearer_token_env_var` 这一族需要它：那台 CLI 的鉴权通道**就是** env，
    /// 而它的 argv 里只放 env **名字**（`-c mcp_servers.…bearer_token_env_var="NEEKO_TEAM_TOKEN"`）。
    /// 于是凭证会在 argv 的 `--mcp-config <json>`（其它档）与这里的 env 各出现一次 ——
    /// 两者的可见性差别是“同用户 `ps` / 同用户 `/proc`”，**都不出本机同用户边界**：
    /// Neeko 不会把成员进程的 env 或 argv 发给任何人，也不写进日志。
    ///
    /// 存在的前提是 `{{token_env}}` 在模板里：判据 [`admission::needs_credentials_env`]，
    /// 不靠 `agent_id` 分支（红线 15）。
    pub credentials_env: Vec<(String, String)>,
    /// `McpInjection::ConfigDir` 档的副作用计划（其余档 `None`）。
    ///
    /// 它是**计划**而不是副作用：建目录 / 镜像 / 跑 `mcp add` 全在组合根
    /// （`app::team_executor`），因为本域不做 I/O（红线 3）也不认识 `AppHandle`。
    pub config_dir: Option<ConfigDirPlan>,
}

/// 「重定向配置目录」档的**副作用计划**（唯一有 fs / 进程副作用的一步）。
///
/// 每个字段都对组合根是一道动作：`dir` → mkdir、`mirror_source` + `mirror` → 建符号链接、
/// `add_args` + `add_env` → 跑一次该 CLI 的 `mcp add`、`add_env` → 同时给 PTY（同一个
/// 目录必须是**同一个字符串**，否则 `mcp add` 写进去的配置 CLI 读不到）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigDirPlan {
    /// 隔离目录（`{state_root}/team/{team}/{member}`；由调用方给的根推导）。
    pub dir: PathBuf,
    /// 目录内的配置文件名（清理与断言用；机制不解释其格式）。
    pub mcp_file: &'static str,
    /// 已渲染的 `mcp add` 参数（含端点与凭证）。
    pub add_args: Vec<String>,
    /// 跑 `mcp add` 时要带的 env（重定向变量 → 隔离目录）。
    ///
    /// 与 PTY 用的是**同一份**：`mcp add` 写进去的目录必须是 CLI 启动时读的那个。
    pub add_env: Vec<(String, String)>,
    /// 用户配置目录（镜像源；执行前 canonicalize，红线 8）。
    pub mirror_source: PathBuf,
    /// 要镜像的条目（数据来自准入表那一行）。
    pub mirror: &'static [&'static str],
}

/// 算出一个成员的启动计划。
///
/// # 失败即拒绝，不做降级
///
/// 四种拒绝都不是“暂时不支持的耐心问题”，而是**不能假装能跑**：
///
/// | 情形 | 为什么必须拒绝 |
/// | --- | --- |
/// | 该 CLI 没有 MCP 面（`omp` / `reasonix`） | 起得来也收不到任务（`channel = None`），花名册里多一个永远不动的成员 |
/// | 注入档未实现（`Subcommand` / `ConfigFile`） | 写用户全局配置需要备份 / 幂等 / 拆除，v1 一件都没有 |
/// | 模板里有渲染不了的占位符 | 拼错的 URL / 字面量 `{{token}}` 都会得到“起得来、连不上”的成员 |
/// | worktree 落在团队根之外 | 红线 8：执行层要拿它当 cwd 与 `git worktree` 的目标 |
///
/// # 参数
///
/// - `mcp_url`：团队 MCP 端点的完整 URL（含端口的 `/team/mcp`）。
/// - `token`：该成员的凭证**明文**（由 `TeamManager::issue_token` 取一次；本函数不签、不存）。
/// - `state_root`：Neeko 配置目录（`~/.neeko`）。隔离配置目录落在
///   `{state_root}/team/{team}/{member}` —— 根**由调用方给**，因为「Neeko 的状态放在哪」
///   是组合根的事实，不是团队域的事实（域里硬编码 `std::env::temp_dir()` 会让 macOS 上的
///   成员配置被系统清理进程当垃圾删掉）。
/// - `member_count`：该团队**当前已有成员数（不含队长）**，用来算「这个队还允许谁」
///   （[`options_for`]）。由调用方从 `TeamManager` 的花名册取 —— 执行层不读库（本模块
///   只做纯推导 + `canonicalize`）。
/// - `resume_argv`：续接片段（来自会话域，见
///   [`crate::conversation::adapters::resume_argv_for`]）。**不是**准入事实：
///   它回答「接着哪个对话」，而准入表回答「这个 CLI 怎么被拉起来」。位置由本函数决定
///   （紧跟 program，见 [`SpawnPlan::args`]），`None` = 新开一个空白对话。
pub fn plan_member_spawn(
    team: &Team,
    member: &TeamMember,
    mcp_url: &str,
    token: &str,
    state_root: &Path,
    member_count: u32,
    resume_argv: Option<&[String]>,
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

    // 「起得来但用不了」的条件在 `team_spawn` 已经早拒过一次（不留下永远不动的成员
    // 行）；这里再问一次是**执行前确认**：成员行可以被重新启动 / 被别的路径写进库，
    // 而判据只该有一份（`AgentAdmission::launch_refusal` / `lead_refusal`）。
    // 「队长比成员多一条」的那一条也在这里 —— 两个角色因此走**同一条**执行路径。
    if let Some(why) = refusal_for(member.role, admission) {
        return Err(AppError::Unsupported(why));
    }

    // 角色 preamble：让被拉起的 CLI 知道自己是团队里的谁（否则它就是一个裸 CLI ——
    // 「不知道自己是队长」正是团队跑不起来的那个故障）。成员清单只给队长版用，且必须与
    // `team_spawn` / `team_options` **同一份判据**：池内的可启动者（`options_for`），
    // 而不是全部可启动者 —— 向队长广告一个池外的 CLI，等于让它挑一个永远被拒的选项。
    // persona（成员行上的快照）附加在骨架之后；`None` 时逐字节等于旧输出。
    let options = options_for(team, member_count);
    let preamble = identity::with_persona(
        identity::preamble(member.role, team, member, &options.members),
        member.persona.as_ref().map(|p| p.preamble.as_str()),
    );
    let ctx = RenderContext::new(
        mcp_config_json(mcp_url, token),
        mcp_url,
        token,
        Some(&preamble),
    );

    // 凭证 env：**只**在模板引用了 `{{token_env}}` 时注入（判据在数据上，不在 CLI 名上）。
    let credentials_env = if needs_credentials_env(admission.mcp_argv) {
        vec![(identity::TEAM_TOKEN_ENV.to_owned(), token.to_owned())]
    } else {
        Vec::new()
    };

    // resume 片段是**第一个**参数：codex 的 `resume` 是子命令，必须紧跟 program
    // （追加到末尾会被当成 PROMPT —— 2026-11-11 实测）。它是会话域来的事实（「接着哪个
    // 对话」），不是准入表的一部分，所以只在这里并入，不与 `mcp_argv` / `prompt_argv` 混排。
    let mut args: Vec<String> = resume_argv.map(<[String]>::to_vec).unwrap_or_default();
    let config_dir = match admission.mcp_injection {
        McpInjection::Argv => {
            args.extend(render_argv(admission.mcp_argv, &ctx)?);
            None
        }
        // 启动参数为空：这条 CLI 的 MCP 配置不是从命令行进去的，而是它自己的 `mcp add`
        // 写进**重定向后的**配置目录。
        McpInjection::ConfigDir => {
            let spec = admission.config_dir.ok_or_else(|| {
                AppError::Unsupported(format!(
                    "agent `{}` is marked as config-directory injection but the admission table \
                     carries no facts for it",
                    member.agent_id
                ))
            })?;
            Some(config_dir_plan(team, member, spec, &ctx, state_root)?)
        }
        // `launch_refusal` 已经把这两档拒了；到这里说明数据在两处之间漂了，
        // 拒绝而不是拿空参数起一个哑巴成员。
        other => {
            return Err(AppError::Unsupported(format!(
                "agent `{}` injects MCP via {other:?}, which this planner cannot turn into a \
                 launch",
                member.agent_id
            )))
        }
    };

    // 角色 preamble 追加在**末尾**：前面是「怎么连上工具面」，这里是「你在这个队里是谁」。
    // 两个位置都合法，选末尾是为了让注入档的参数保持一个连续前缀（排查时肉眼可比对）。
    // 空模板 ⇒ 空 vec ⇒ 该 CLI 拿不到这段文本（成员侧可接受，队长侧上面已拒）。
    args.extend(render_argv(admission.prompt_argv, &ctx)?);

    // 旁路开关在**最后**：`Bypass` 是 per-CLI 数据（红线 15），而位置由本函数决定 ——
    // 组合根只负责 `[program] ++ args`，它不再知道任何 argv 顺序。
    args.extend(admission.bypass_args(member.approval_policy));

    Ok(SpawnPlan {
        cwd: resolve_cwd(team, member)?,
        // 身份 env 与凭证刻意分开：env 会进 `/proc/<pid>/environ` 与子进程继承，
        // 凭证明文只出现在启动参数的 MCP 配置里（`ConfigDir` 档则是那个隔离目录里的
        // `mcp.json`）。唯一的例外是 `bearer_token_env_var` 那一族，见
        // [`SpawnPlan::credentials_env`] 的文档。
        env: identity::member_env(&member.team_id, &member.id),
        args,
        credentials_env,
        config_dir,
    })
}

/// 角色 → 该问哪一条准入判据（**选路**，不是重写判据）。
///
/// 队长比成员多一条前置：它必须在启动时就收到角色 preamble（`prompt_argv` 非空），
/// 因为队长的第一个动作没有人能替它触发。两条判据本身都在准入表里
/// （[`AgentAdmission::launch_refusal`] / [`AgentAdmission::lead_refusal`]，后者复用前者），
/// 所以这里只有 `match`，没有任何一句复制的逻辑。
fn refusal_for(role: MemberRole, admission: &AgentAdmission) -> Option<String> {
    match role {
        MemberRole::Lead => admission.lead_refusal(),
        MemberRole::Worker => admission.launch_refusal(),
    }
}

/// `McpInjection::ConfigDir` 档的副作用计划。
///
/// 两件事在这里定形（之后组合根只执行、不再判断）：
/// - **目录**：`{state_root}/team/{team}/{member}`，两段都过 [`path_segment`]；
/// - **重定向 env**：`(spec.env, dir)`，`mcp add` 与 PTY 用同一份（同一个字符串身份）。
fn config_dir_plan(
    team: &Team,
    member: &TeamMember,
    spec: ConfigDirSpec,
    ctx: &RenderContext,
    state_root: &Path,
) -> Result<ConfigDirPlan, AppError> {
    let home = dirs::home_dir().ok_or_else(|| {
        AppError::Unsupported(
            "the user's home directory cannot be resolved, so the CLI's own config directory \
             cannot be mirrored into an isolated one"
                .to_string(),
        )
    })?;
    let dir = state_root
        .join("team")
        .join(path_segment(&team.id))
        .join(path_segment(&member.id));
    Ok(ConfigDirPlan {
        mcp_file: spec.mcp_file,
        add_args: render_argv(spec.add_argv, ctx)?,
        // 同一个目录必须是**同一个字符串**：`mcp add` 写的地方与 PTY 读的地方。
        add_env: vec![(spec.env.to_owned(), dir.to_string_lossy().to_string())],
        dir,
        mirror_source: home.join(spec.home_subdir),
        mirror: spec.mirror,
    })
}

/// 把 id 变成一个安全的**目录名**。
///
/// 成员名来自模型（`team_spawn` 的 `name`），只保证了不含 `@` 与控制字符 —— `/`、空格、
/// `:` 都在允许范围内，而它们会把目录名变成路径或非法的 Windows 名。空 / `.` / `..`
/// 会让 `create_dir_all` 落到意料之外的位置，所以统一换成一个显式占位。
fn path_segment(value: &str) -> String {
    const MAX_CHARS: usize = 96;
    let mut out: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if out.is_empty() || out == "." || out == ".." {
        return "member".to_string();
    }
    if out.chars().count() > MAX_CHARS {
        out.truncate(MAX_CHARS);
    }
    out
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

/// **工作区 → 落地目录**的唯一判据（红线 8）。
///
/// - `Shared` / `ReadOnly` → 团队根。只读是**策略**不是路径，执行层不据此换目录。
/// - `Worktree { path }` → 该路径，且必须是**绝对**路径并落在团队根之下。
///
/// # 两个调用方，一份判据
///
/// ① 执行层起进程时给成员算 `cwd`（[`plan_member_spawn`]）；
/// ② 建队时为 `Team.default_workspace` 做构造期校验（`bootstrap::validate_config`）。
///
/// 两处各写一份 `starts_with` 的话，它们迟早会对「符号链接下的同一棵树」给出两个答案，
/// 而其中一个会放行一个跑在团队根之外的成员 —— 那种错误在花名册上看不出来。
///
/// **团队根无条件规范化**（不是只在 worktree 分支）：它是 `starts_with` 的信任边界 ——
/// 在符号链接与 `/var` ↔ `/private/var` 这类平台差异上，未规范化的根会让「落在根内」的
/// 判据整体失效。`Shared` 分支同样要吃这条：成员进程的 cwd 与「根内」判据必须是同一个
/// 字符串身份，否则同一棵树上会存在两种写法。
///
/// # 阻塞（红线 3）
///
/// 会 `std::fs::canonicalize` ⇒ **必须在阻塞池里调**。
pub fn workspace_cwd(team_root: &Path, workspace: &Workspace) -> Result<PathBuf, AppError> {
    let root = canonicalize(team_root, "team root")?;
    match workspace {
        Workspace::Shared | Workspace::ReadOnly => Ok(root),
        Workspace::Worktree { path } => {
            // 绝对性是入口判据的另一半：相对路径会按**进程 cwd** 解析，而那不是团队根。
            // 放到 `canonicalize` 之后判会得到一个“看起来合法”的绝对路径 —— 那时错误
            // 信息已经无法说清用户到底传了什么。
            if !path.is_absolute() {
                return Err(AppError::InvalidInput(format!(
                    "workspace path {} must be absolute; a relative path would be resolved against \
                     the process cwd instead of the team root",
                    path.display()
                )));
            }
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

/// 团队**执行环境**的来源（v16 之后按项目 id 精确查表，旧行才退回路径前缀）。
///
/// # 为什么需要两个变体
///
/// 环境的权威是**项目**（`Project.environment`），而团队行记录了两件不同的事：
/// `project_path`（工作区根，可能是工作树）与 `project_id`（环境归属）。
///
/// v15 及更早的行**只有路径**，执行层只能拿它去项目库里做前缀反查
/// （[`crate::core::project::environment_for_path`]）—— 那条路对 Neeko 自己的工作树
/// （`~/.neeko/worktrees/<name>`，按设计落在项目目录**之外**）永远匹配不上，于是
/// 「从工作树单元开团队」必失败，而且失败发生在建队写入之后、起进程之前（孤儿团队行）。
///
/// v16 起 `project_id` 落库：建队时它来自 `activeProjectId`，**不是**从路径猜出来的。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EnvironmentSource {
    /// v16 之后：按项目 id 精确查表（主路径）。
    ProjectId(String),
    /// v16 之前的老行：只能退回路径前缀反查。
    LegacyPath(PathBuf),
}

/// 团队执行环境的来源判定（**纯函数**：执行层只读结果，不自己写匹配规则）。
///
/// # `LegacyPath` 为什么保留
///
/// 它是 **v15 行的兼容路径**，不是主路径：空 `project_id` 唯一的来源就是旧库
/// （写入路径 [`crate::agent::team::bootstrap::plan_team`] 拒绝空 id）。
///
/// 保留它的代价必须说清：**它对工作树无效** —— 一个 v15 时代建在工作树里的团队
/// （`~/.neeko/worktrees/<name>`）在路径前缀规则下仍然找不到项目，起成员依旧会失败。
/// 这不是这里能修的（那是旧数据缺失了「项目归属」这个事实），但它是**有意保留**的行为：
/// 默默降级成 `Local` 会让一个 SSH 项目的旧团队突然在老本机跑起来。
#[must_use]
pub fn environment_source(team: &Team) -> EnvironmentSource {
    if team.project_id.is_empty() {
        EnvironmentSource::LegacyPath(team.project_path.clone())
    } else {
        EnvironmentSource::ProjectId(team.project_id.clone())
    }
}

/// 成员进程的 cwd（[`workspace_cwd`] 的成员视图）。
fn resolve_cwd(team: &Team, member: &TeamMember) -> Result<PathBuf, AppError> {
    workspace_cwd(&team.project_path, &member.workspace)
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
    /// 为一个**已落库**的成员起进程，返回它的 PTY 会话 id。
    ///
    /// 返回 id 而不是回填成员行：句柄是**进程期资源**，成员行跨重启（v22 起不再有
    /// `terminal_id` 列）。归属与活性由登记时写入的 `SessionAttribution` 回答。
    /// 调用方拿到 id 只为「起完立刻打开 tab」这一类当次动作。
    ///
    /// `token` 是该成员的凭证**明文**（由 [`CredentialLedger::admit`] 签发并已让门认识）。
    /// 它只在本函数内出现一次，随即进启动参数的 MCP 配置（design §3.1「明文只下发一次」）。
    ///
    /// `resume_argv` 是**续接片段**（`None` = 新开一个空白对话）。它**不是身份**：成员的
    /// 身份是成员行上的 `agent_session_id`；片段只是「接着哪个对话」这条指令，由
    /// [`crate::conversation::adapters::resume_argv_for`] 给出、由
    /// [`plan_member_spawn`] 放到启动行的开头。
    ///
    /// 失败语义是「成员已落库但没有进程」——两相位设计里这是**可查询、可清理**的状态
    /// （见 `mcp::dispatch::ToolReply::MemberCreated` 的文档），所以错误原样上抛，不在这里
    /// 回滚成员。
    async fn spawn(
        &self,
        member_id: &str,
        token: &str,
        resume_argv: Option<Vec<String>>,
    ) -> Result<String, AppError>;

    /// 把一条队内消息投递给成员。
    ///
    /// 通道选择（`Pty` 写 stdin / `Mcp` 无法推送）是执行层的策略：端点不知道成员行里
    /// 那个 `channel` 字段，也不应该知道。
    async fn deliver(&self, member_id: &str, message: &str) -> Result<(), AppError>;

    /// **请求**关掉成员的进程（两相位里的「动手」那一半，design §7.1）。
    ///
    /// # 语义是**只关进程**，而且只是「请求」
    ///
    /// 状态迁移由调用方在关闭成功之后做（`TeamManager::finish_member_close`），因为
    /// 「先 close PTY，再归档成员」是 design §7.1 写死的顺序 —— 反过来会出现
    /// 「成员行已 `Offline`、PTY 还活着」的窗口：域侧认为它已消失，而那个会话还在收发，
    /// 谁也不会去收。
    ///
    /// **返回 `Ok` 只保证 kill 已发出**，不保证进程已经消失：PTY 的收尾在另一个线程里完成
    /// （`close_session` 是 remove-then-close 的 async 形态）。所以「归档成员 + 撤凭证」可能
    /// 先于「进程消失」发生 —— 这**不影响**正确性（凭证撤掉之后它再也调不动工具），但任何
    /// 面向用户的说明都不得写成「进程已关」（见 [`close_notes`] 的那条 note）。
    ///
    /// 不引入「等待进程消失」的形态是**有意的**：一个可能卡 30 秒的关闭会把面板与队长的
    /// 每一次 `team_close` 都变成一个可能超时的操作，而它换来的保证并不是安全性质的（安全
    /// 性由撤凭证给出）。
    ///
    /// # 幂等是契约（不是为了方便）
    ///
    /// 三种「本来就没有进程」的情形都算**成功**：
    ///
    /// | 情形 | 为什么算成功 |
    /// | --- | --- |
    /// | 从未起来过（活性注册表里没有它的会话） | 本来就没进程，目标状态已达成 |
    /// | 该会话已被关掉（terminal 域不认识它） | 目标状态已达成；把「已经不在」报成错误会让队长卡在一个终态上 |
    /// | 重复调用（整队关闭重试） | 整队关闭必须可重试，否则一个坏成员能把整个队钉在 `closing` |
    ///
    /// 反例（本契约挡的正是它）：把「会话不存在」返回成 `Err` ⇒ 队长每次重试都在同一个
    /// 成员上得到同一条错误，而它已经没有任何可做的事了。
    async fn close(&self, member_id: &str) -> Result<(), AppError>;
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

    /// 重新组装身份表与门的期望集合（不签发任何新凭证）。
    ///
    /// # 为什么这是一个独立动作，而不是「再 admit 一次」
    ///
    /// `admit` 会**轮换**凭证（旧明文立即失效）—— 用它来刷新等于在关闭成员时又把一把新
    /// 钥匙造出来。而关闭要的恰好是反面：把库里的 `token_hash` 清空之后，让门**忘掉**它。
    ///
    /// 实现只有一个（`TeamServerState::refresh_credentials`，从库重新组装 + 先表后门），
    /// 本方法只是它在端口上的名字：执行层不该认识 `TeamServerState`、HTTP 或门。
    async fn refresh(&self) -> Result<(), AppError>;
}

// ────────────────────── 领域副作用（执行层的输入） ──────────────────────

/// 一次调用**要执行层做的事**：领域词汇，不认识任何线协议。
///
/// # 为什么不是 `ToolReply`
///
/// `ToolReply` 是**线协议**词汇：变体名就是 wire 名、结构带 serde 属性、整段会进模型上下文。
/// 执行层只需要三件事 —— 起进程、投递一行文本、关闭一批成员 —— 让它认识 `ToolReply` 有两个
/// 具体代价：
///
/// 1. **本地入口被绑上一条它不用的协议**：面板的 `team_close` 命令与 MCP 工具走同一条执行
///    路径，但它没有 principal、也不背工具信封。复用一行调用就要 `commands.rs` import 一个
///    MCP 类型，再把回复的六个字段搬进 `ClosedReply`。
/// 2. **翻译点会分裂**：`ToolReply → 副作用` 只该在 MCP 入口发生一次
///    （[`crate::agent::team::mcp::dispatch::effect_for`]）。执行层认识 `ToolReply` 之后，
///    第二个入口就有理由再写一遍同样的 `match`。
///
/// # 为什么没有 `Nothing`
///
/// 「没有副作用」只有一种表示法：`effect_for` 返回 `None`。再加一个 `Effect::Nothing`
/// 就是给同一件事造两个答案（调用方得同时处理 `None` 与 `Nothing`，而两者永远不会同时出现）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Effect {
    /// 起一个**已落库**的成员：签发凭证（并认门）→ 起进程。
    StartMember {
        /// 成员 id（`{name}@{team}`）。
        member_id: String,
    },
    /// 把一段**已经拼好**的投递文本写进成员（`text` 就是接收方看到的那一行）。
    Deliver {
        /// 目标成员 id（队内）。
        to: String,
        /// 完整的投递文本（发送者已拼进正文，见 `delivery::delivery_text`）。
        text: String,
    },
    /// 关闭（见 [`ClosePlan`]）。
    Close(ClosePlan),
}

/// 关闭请求的**执行计划**：决定层产出，执行层兑现。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClosePlan {
    /// 被关闭的团队。
    pub team_id: String,
    /// 单成员关闭的目标；整队关闭 = `None`。
    pub member_id: Option<String>,
    /// **待关列表**（整队关闭时来自 `begin_team_close`；单成员关闭时为空，目标由
    /// [`Self::member_id`] 指明）。
    ///
    /// 决定层还不知道结果，所以它只能说「关这些」；真的关掉了谁由 [`CloseOutcome`] 带回。
    pub targets: Vec<String>,
    /// 决定层看到的状态（`closing` / `active`）。执行**之后**的状态另外读一次。
    pub team_state: TeamState,
    /// 决定层写下的诚实面（原样带回给调用方）。
    pub notes: Vec<String>,
}

/// [`apply_effect`] 的结果。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EffectOutcome {
    /// 起进程 / 投递：执行成功，决定层那条回复本身就是事实。
    Applied,
    /// 关闭：**执行之后**的事实（团队停在哪、谁真的被归档了）。
    Closed(CloseOutcome),
}

/// 关闭**执行之后**的事实。
///
/// 与决定层的 [`ClosePlan`] 刻意是两个类型：那份说「关这些」，这份说「关掉了这些、团队停在
/// `closing` / `closed`」。合成一个类型就会出现「同一个字段两个时刻的含义」—— 而
/// `members_closed` 恰好是最危险的那一个（意图 vs 事实）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CloseOutcome {
    /// 被关闭的团队。
    pub team_id: String,
    /// 单成员关闭的目标；整队关闭 = `None`。
    pub member_id: Option<String>,
    /// **本次真的归档掉的**成员。
    pub members_closed: Vec<String>,
    /// 关不掉的成员与原因。成功路径恒空（有失败就以 `Err` 结束）。
    pub members_failed: Vec<(String, String)>,
    /// 执行之后的团队状态。
    pub team_state: TeamState,
    /// 诚实面（决定层那条原样带回）。
    pub notes: Vec<String>,
}

/// 兑现一个 [`Effect`]。
///
/// # 为什么在这里而不是在 handler 里
///
/// 「哪种动作、按什么顺序做」是域知识，不是传输知识。写在 handler 里会有两个后果：
/// `server.rs` 继续变胖（它已经同时管 RPC / 鉴权 / 路由 / 状态），而这段逻辑只能通过发真
/// HTTP 请求才能测。搬到这里之后，handler 只剩「翻译 → 调用 → 回翻」，副作用映射由本文件的
/// 单测直接钉住。
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
///
/// # 为什么返回 [`EffectOutcome`]（不是 `()`）
///
/// 两相位让「关闭」有两个版本：决定层能说的是**意图**（「我将关闭这些成员」），调用方要的是
/// 执行之后的**事实**（「团队现在是 `closed`」）。`team_state` 就是最明显的一例：决定层看到
/// 的是 `closing`，而调用返回时团队可能已经是 `closed`。让执行层把结果回写，比让队长自己去
/// 重试一次 `team_status` 才能确认真相便宜得多。
///
/// # 红线 3
///
/// 状态迁移（`finish_member_close` / `finish_team_close`）是 SQLite 写，必须进阻塞池。
/// 本函数因此要 `runtime`：本域**不自己** spawn（同 `TeamManager` 的取舍），但它是
/// 「一次动作 = 进程副作用 + 状态迁移」的唯一编排点，只能在这里成组地等它们。
pub async fn apply_effect(
    runtime: &crate::common::runtime::AppRuntime,
    credentials: &dyn CredentialLedger,
    executor: &dyn MemberExecutor,
    manager: &std::sync::Arc<crate::agent::team::manager::TeamManager>,
    effect: &Effect,
) -> Result<EffectOutcome, AppError> {
    match effect {
        Effect::StartMember { member_id } => {
            // `team_spawn` 永远新开一个对话（模型给的是一份全新的任务）；续接只由
            // `team_resume`（面板）发起 —— 它不是工具，也没有 principal。
            start_member(credentials, executor, member_id, None).await?;
            Ok(EffectOutcome::Applied)
        }
        // `text` 已经由决定层用 `delivery::delivery_text` 拼好：发送者身份是 principal 的
        // 事实（决定层知道），不是执行层的事实（它只该看到「要写进 stdin 的那一行」）。
        Effect::Deliver { to, text } => {
            executor.deliver(to, text).await?;
            Ok(EffectOutcome::Applied)
        }
        Effect::Close(plan) => Ok(EffectOutcome::Closed(
            close_targets(runtime, credentials, executor, manager, plan).await?,
        )),
    }
}

/// 关闭请求的**决策层**：校验 + 状态迁移 + 写审计，**没有进程副作用**。
///
/// # 为什么在 execution 而不是 `mcp::dispatch`
///
/// 它有两个入口：MCP 工具（有 principal）与本地面板命令（**没有** principal）。放在
/// `dispatch` 会让 `commands` 依赖工具回复的词汇；放在这里，两处都只依赖「关闭计划 +
/// 领域副作用」，而 execution 本来就是执行层（[`apply_effect`]）—— 于是「谁能关」由入口
/// 各自决定（MCP 走授权矩阵、本地走本机用户），「怎么关」只有这一份。
///
/// 返回 [`ClosePlan`]（不是 `ToolReply`）：决定层只该说「关这些」，说不上「哪些已经关掉了」
/// —— 那是 [`CloseOutcome`] 的事，而它只在执行之后存在。
///
/// # 秩等
///
/// 单成员关闭对已 `Offline` 的成员报 `Conflict`（既有的「不能关两次」语义）；整队关闭会把
/// 已 `Offline` 的成员也算进目标 —— 那是「成员行离线但 PTY 还活着」的唯一安全重试路径，
/// 而 `executor.close` 本身幂等。
pub fn plan_close(
    manager: &crate::agent::team::manager::TeamManager,
    team_id: &str,
    member_id: Option<&str>,
    graceful: bool,
    now: i64,
) -> Result<ClosePlan, AppError> {
    let team = manager
        .team(team_id)
        .ok_or_else(|| AppError::NotFound(format!("team `{team_id}` is not loaded")))?;

    match member_id.map(str::trim) {
        Some(id) => {
            let member = manager
                .member(id)
                .ok_or_else(|| AppError::NotFound(format!("member `{id}` is not loaded")))?;
            if member.team_id != team.id {
                return Err(AppError::InvalidInput(format!(
                    "member `{id}` belongs to team `{}`, not `{}`",
                    member.team_id, team.id
                )));
            }
            if member.role == MemberRole::Lead {
                return Err(AppError::Conflict(format!(
                    "member `{}` is the lead of team `{}`; closing the lead is closing the team — \
                     call this without `member_id` to close the team",
                    member.id, team.id
                )));
            }
            if member.state == MemberState::Offline {
                return Err(AppError::Conflict(format!(
                    "member `{}` process is already gone; a sole member cannot be closed twice — \
                     call this without `member_id` if the whole team still needs to be sealed",
                    member.id
                )));
            }
            manager.record_close_request(&team.id, Some(&member.id), graceful, now)?;
            Ok(ClosePlan {
                team_id: team.id.clone(),
                member_id: Some(member.id.clone()),
                // 决定层还没关掉任何东西（归档在执行层）：单成员关闭的目标由 `member_id`
                // 指明，`targets` 因此是空的（整队关闭才用它表达待关列表）。
                targets: Vec::new(),
                team_state: team.state,
                notes: close_notes(
                    manager,
                    graceful,
                    false,
                    std::slice::from_ref(&member),
                    &team,
                ),
            })
        }
        None => {
            let targets = manager.begin_team_close(&team.id, now)?;
            manager.record_close_request(&team.id, None, graceful, now)?;
            // 状态刚被推过，重读一次才是计划要说的那个状态（`closing`）。
            let team = manager
                .team(team_id)
                .ok_or_else(|| AppError::NotFound(format!("team `{team_id}` is not loaded")))?;
            let scoped: Vec<TeamMember> =
                targets.iter().filter_map(|id| manager.member(id)).collect();
            Ok(ClosePlan {
                team_id: team.id.clone(),
                member_id: None,
                targets,
                team_state: team.state,
                notes: close_notes(manager, graceful, true, &scoped, &team),
            })
        }
    }
}

/// 关闭回复里的**诚实面**：哪些事这次没做、哪些东西被留下了。
///
/// 四条各自对应一个「看起来做了其实没做」的陷阱：进程是异步退出的；`graceful` 没有协议
/// 可发；队长自己那个 PTY 不可能由它自己的调用关掉；worktree 一律不删（本期零 fs 操作）。
fn close_notes(
    manager: &crate::agent::team::manager::TeamManager,
    graceful: bool,
    whole_team: bool,
    members: &[TeamMember],
    team: &Team,
) -> Vec<String> {
    let mut notes = Vec::new();
    // 进程是**异步**退出的：`MemberExecutor::close` 只保证 kill 已发出（PTY 的收尾在另一个
    // 线程里完成）。所以「归档成员 + 撤凭证」可能先于「进程消失」发生 —— 这**不影响**正确性
    // （凭证撤掉之后它再也调不动工具），但话必须这么说：写成「进程已关」就是在撒谎。
    notes.push(
        "member processes exit asynchronously: closing a pty only asks the terminal to kill it, \
         so archiving a member and revoking its credential can happen before the process is \
         gone; the member cannot call a tool either way, because its credential is revoked"
            .to_owned(),
    );
    if graceful {
        notes.push(
            "graceful shutdown was requested but is not implemented: a pty has no shutdown \
             protocol to send, so this call asks the terminal to kill the process instead (the \
             request is recorded as `close_request` in the team audit trail)"
                .to_owned(),
        );
    }
    if whole_team {
        notes.push(
            "the lead's own pty is not closed by this call (it is the session running it); it \
             stays open until the app or the panel closes it"
                .to_owned(),
        );
    }
    let mut kept: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for member in members {
        if let Workspace::Worktree { path } = &member.workspace {
            kept.insert(path.display().to_string());
        }
    }
    for task in manager.tasks(&team.id) {
        if let Workspace::Worktree { path } = &task.workspace {
            kept.insert(path.display().to_string());
        }
    }
    for path in kept {
        notes.push(format!("worktree kept for manual review: {path}"));
    }
    notes
}

/// `Close` 的「动手」那一半：关进程 → 归档成员 → （整队）落终态 → 凭证作废。
///
/// # 顺序即契约（design §7.1）
///
/// ```text
/// executor.close(id)         → 请求关 PTY（幂等；「本来就没有进程」也算成功）
/// finish_member_close(id)    → Offline + sealed_at 落定 + token 作废 + 在飞任务回 pending
/// finish_team_close(team)    → 全部成员归档之后才 closing → sealed + sealed_at
/// credentials.refresh()      → 门忘掉刚被作废的那些 hash（**无 `?` 的收尾**）
/// ```
///
/// 反过来（先归档再关进程）会出现「成员行已 `Offline`、PTY 还活着」的窗口：域侧认为它
/// 已消失，而 terminal 域里那个会话还在跑，谁也不会去收。
///
/// # 「关闭」是**一条**不可分割的后置条件
///
/// 关掉一个成员之后，库里有三件事必须同时成立：`state = Offline`、`sealed_at` 落定、
/// `token_hash` 为空；再加门**忘掉**那把钥匙。前三件由 `finish_member_close` 在同一把锁内
/// 一次写完；第四件不属于任何单个成员 —— 它属于整次关闭，所以它的位置不是「某一步之后」，
/// 而是**收尾**：
///
/// - 循环里每一步都只把结果记进 `closed` / `failed`，**没有一个 `?`**；
/// - seal 的失败也记进变量，**没有一个 `?`**；
/// - 只有在这之后，只要有任何成员的凭证被作废，`refresh` 才会被调用。
///
/// 反例（这段形状挡的正是它）：`finish_team_close(...)??` 放在 `refresh()` 之前，任何一个
/// `?` 都会让一个**已经归档**的成员保留着能用的旧 token —— 而那个 token 还能调 `team_close`。
/// 判据：`a_failed_seal_still_revokes_the_credentials`。
///
/// # 一个坏成员不得卡死整队关闭
///
/// 每个成员的失败只记进 `failed`（带原因），循环继续。整队关闭在**全部成功**时才落终态；
/// 有失败就停在 `closing` 并回 `Err`（错误里点名每个关不掉的成员与原因）。停在 `closing`
/// 是**可查询、可重试**的状态：再次 `team_close` 会把同样的目标集再走一遍（每一步都幂等）。
///
/// # 凭证作废在**失败路径上也要发生**
///
/// 已经归档的成员，它们的 token 必须立即失效。把 `refresh` 放在任何失败判断之前是刻意的：
/// 一个「关了一半」的队里，已关成员拿着能用的 token 比整个队卡在 `closing` 危险得多。
///
/// # 进程是**异步**退出的（不写成「进程已关」）
///
/// [`MemberExecutor::close`] 只保证 kill **已发出**：PTY 的收尾在另一个线程里完成。所以
/// 「归档成员 + 撤凭证」可能先于「进程消失」，这**不影响**正确性（凭证撤掉之后它再也调不动
/// 工具），但诚实面必须这么说 —— 那条说明由决定层写进 `notes`（见 [`close_notes`]）。
async fn close_targets(
    runtime: &crate::common::runtime::AppRuntime,
    credentials: &dyn CredentialLedger,
    executor: &dyn MemberExecutor,
    manager: &std::sync::Arc<crate::agent::team::manager::TeamManager>,
    plan: &ClosePlan,
) -> Result<CloseOutcome, AppError> {
    let now = crate::agent::team::manager::now_millis();
    // 单成员关闭由 `member_id` 指明；整队关闭的待关列表由决定层放在 `targets` 里
    // （决定层还不知道结果，所以才需要这一步把它改成事实）。
    let single = plan.member_id.is_some();
    let targets: Vec<String> = match &plan.member_id {
        Some(id) => vec![id.clone()],
        None => plan.targets.clone(),
    };

    let mut closed: Vec<String> = Vec::with_capacity(targets.len());
    let mut failed: Vec<(String, String)> = Vec::new();
    for id in &targets {
        if let Err(err) = executor.close(id).await {
            failed.push((id.clone(), err.to_string()));
            continue;
        }
        let manager_for_close = std::sync::Arc::clone(manager);
        let member = id.clone();
        let archived = runtime
            .spawn_blocking(move || manager_for_close.finish_member_close(&member, now))
            .await;
        match archived {
            // 被释放的任务 id 不需要回给调用方：`pending` 是它在板上本来就该有的样子，
            // 而任务行的最新态从 `task_list` 读得到（载荷只带能行动的信息）。
            Ok(Ok(_released)) => closed.push(id.clone()),
            Ok(Err(err)) => failed.push((id.clone(), err.to_string())),
            // 阻塞任务 panic 也只落进 `failed`：它跳过的只是**这一个**成员，不能顺手把
            // 整次关闭的收尾（`refresh`）也跳掉。
            Err(err) => failed.push((id.clone(), format!("archiving the member panicked: {err}"))),
        }
    }

    // 整队关闭才 seal；全部成员都已归档才试（`finish_team_close` 自己还会复核一遍）。
    let mut seal: Option<Result<(), AppError>> = None;
    if !single && failed.is_empty() {
        let manager_for_seal = std::sync::Arc::clone(manager);
        let team = plan.team_id.clone();
        let attempted = runtime
            .spawn_blocking(move || manager_for_seal.finish_team_close(&team, now))
            .await;
        seal = Some(match attempted {
            Ok(result) => result,
            Err(err) => Err(AppError::Unknown(format!(
                "sealing team `{}` panicked: {err}",
                plan.team_id
            ))),
        });
    }

    // ─────────── 收尾：**无 `?`**。凭证作废必须在任何失败判断之前发生 ───────────
    //
    // 只要有任何一名成员的凭证被作废（含 seal 顺手归档的队长），门就必须重新组装，
    // 否则旧 hash 仍在门的期望集合里 —— 一个「已关闭」的成员还能调工具（含 `team_close`）。
    let sealed = matches!(seal, Some(Ok(())));
    let revoked = !closed.is_empty() || sealed;
    let refreshed = if revoked {
        Some(credentials.refresh().await)
    } else {
        None
    };

    if !failed.is_empty() {
        return Err(close_failure(
            &plan.team_id,
            &closed,
            &failed,
            single,
            revoked,
        ));
    }
    if let Some(Err(err)) = refreshed {
        return Err(refresh_failure(&plan.team_id, &closed, &err));
    }
    if let Some(Err(err)) = seal {
        return Err(seal_failure(&plan.team_id, &closed, &err, revoked));
    }

    let state = manager
        .team(&plan.team_id)
        .map(|team| team.state)
        .ok_or_else(|| AppError::NotFound(format!("team `{}` is not loaded", plan.team_id)))?;
    Ok(CloseOutcome {
        team_id: plan.team_id.clone(),
        member_id: plan.member_id.clone(),
        members_closed: closed,
        // 成功路径上恒为空：有失败就以 `Err` 结束（见 [`close_failure`]），
        // 这个键属于失败面的形状（将来若允许部分成功，它已经在这里）。
        members_failed: Vec::new(),
        team_state: state,
        notes: plan.notes.clone(),
    })
}

/// id 列表的可读形态（错误信息里用；空 = `none`）。
///
/// `pub(crate)`：错误信息里的「有谁」只能有一份拼法 —— `dispatch` 列本队成员时
/// 复用它（各写一份 `join` 会让「空清单怎么读」在两处漂移：一处 `none`、一处空串）。
pub(crate) fn join_ids(ids: &[String]) -> String {
    if ids.is_empty() {
        "none".to_owned()
    } else {
        ids.join(", ")
    }
}

/// 凭证面在错误信息里的**事实陈述**（撤了 / 没撤），三处共用一句话。
const fn revoke_text(revoked: bool) -> &'static str {
    if revoked {
        "credentials were revoked (the credential table was refreshed)"
    } else {
        "no credential needed revoking"
    }
}

/// 关不掉成员时的错误：逐个点名失败的成员 + 已经归档的 + 凭证面 + 当前停在哪。
///
/// 错误是写给**队长模型**看的提示（同 `dispatch` 的可读性契约）：它必须能判断「重试有用吗」
/// 「还有谁在」 —— 只报一句「关闭失败」会让它去猜，而猜的代价是又一个回合。
fn close_failure(
    team_id: &str,
    closed: &[String],
    failed: &[(String, String)],
    single: bool,
    revoked: bool,
) -> AppError {
    let failed_list = failed
        .iter()
        .map(|(id, why)| format!("`{id}`: {why}"))
        .collect::<Vec<_>>()
        .join("; ");
    let next = if single {
        "the member was not archived, so it is still in the roster and this call can be retried"
    } else {
        "the team stays in `closing` so the whole close can be retried; members already archived \
         stay archived (every step is idempotent)"
    };
    AppError::Terminal(format!(
        "team `{team_id}`: could not close {failed_list}; already archived: {}; {}; {next}",
        join_ids(closed),
        revoke_text(revoked)
    ))
}

/// 成员都归档了、团队却 seal 不掉时的错误。
///
/// 这条路径必须存在且必须诚实：团队**没有**进入 `closed`，但已归档成员的凭证是**真的**被撤了
/// —— 两件事一起说，队长才知道「重试 seal」不会让那些成员复活。
fn seal_failure(team_id: &str, closed: &[String], err: &AppError, revoked: bool) -> AppError {
    AppError::Terminal(format!(
        "team `{team_id}`: members archived ({}) and {}, but the team could not be sealed: {err}; \
         it is not `closed` yet — call `team_close` again to retry the seal",
        join_ids(closed),
        revoke_text(revoked)
    ))
}

/// 归档成功、门却重建失败时的错误（安全面最重的一条：旧 token 还能用）。
fn refresh_failure(team_id: &str, closed: &[String], err: &AppError) -> AppError {
    AppError::Terminal(format!(
        "team `{team_id}`: archived {} but the credential table could not be refreshed: {err}; \
         their old tokens stay usable until the endpoint rebuilds its principals — call \
         `team_close` again to retry",
        join_ids(closed)
    ))
}

/// 起一个**已落库**的成员：签发凭证（并认门）→ 起进程。
///
/// # 为什么独立于 [`Effect::StartMember`]
///
/// 两个入口都做同一件事：`team_spawn` 的结果（队长经 MCP 工具）与「以队长身份开会话」的
/// 本地命令（人经 Tauri 命令）。`Effect::StartMember` 走的是本函数的封装（一次反序列化 /
/// 一次匹配），而本地入口只需要这个**动作**本身 —— 它没有「工具回复」这个东西。
///
/// 抽成这个动作后，本地入口只依赖两个端口（`CredentialLedger` + `MemberExecutor`），
/// 连 [`Effect`] 都不需要认识。
///
/// # 顺序不可交换
///
/// `admit` **先于** `spawn`：成员进程一启动就会发第一次工具调用，门若还不认识它的凭证就是 401。
pub async fn start_member(
    credentials: &dyn CredentialLedger,
    executor: &dyn MemberExecutor,
    member_id: &str,
    resume_argv: Option<Vec<String>>,
) -> Result<String, AppError> {
    let token = credentials.admit(member_id).await?;
    executor
        .spawn(member_id, &token, resume_argv)
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
    use crate::agent::team::admission::{
        McpTransport, MCP_CONFIG_PLACEHOLDER, MCP_URL_PLACEHOLDER,
    };
    use crate::agent::team::delivery::PtySubmit;
    use crate::agent::team::fixtures::{fixture_member, fixture_team};
    use crate::agent::team::manager::TeamManager;
    use crate::agent::team::store::TeamStore;
    use crate::agent::team::types::{
        MemberRole, MemberState, Persona, TaskRef, TeamMember, TeamState, TeamTask, TeamTaskState,
        Workspace,
    };

    const TEAM: &str = "tm_1";
    const W1: &str = "w1@tm_1";
    const W2: &str = "w2@tm_1";
    const LEAD: &str = "lead@tm_1";
    const MCP_URL: &str = "http://127.0.0.1:43210/team/mcp";
    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    /// 一个 worker，`agent_id` 可指定（测试按 CLI 的注入档分组）。
    fn worker(agent_id: &str) -> TeamMember {
        TeamMember {
            agent_id: agent_id.into(),
            ..fixture_member(W1, TEAM)
        }
    }

    /// 一个队长行（与 `bootstrap::plan_team` 造出来的同一形状）。
    fn lead(agent_id: &str) -> TeamMember {
        TeamMember {
            role: MemberRole::Lead,
            agent_id: agent_id.into(),
            ..fixture_member(LEAD, TEAM)
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

    // ══════════════════════════════════════════════════════════════
    // 环境来源（v16）：按项目 id 精确查表，旧行才退回路径前缀
    // ══════════════════════════════════════════════════════════════

    /// v16 之后的行：环境**按项目 id** 查。
    ///
    /// 夹具的团队根特意放在一个**不属于任何项目目录**的临时目录里（模拟 Neeko 自己的
    /// 工作树 `~/.neeko/worktrees/<name>`）：这正是旧路径前缀规则永远匹配不上的形状。
    /// 只要 `project_id` 在，环境来源就与那个路径无关。
    #[test]
    fn a_team_row_with_a_project_id_resolves_the_environment_by_id() {
        let tmp = tempdir();
        let team = Team {
            project_id: "p1".into(),
            ..team_at(tmp.path())
        };
        assert_eq!(
            environment_source(&team),
            EnvironmentSource::ProjectId("p1".into()),
            "有 id 就必须走 id，不得再看路径"
        );
    }

    /// v15 及更早的行（空 id）：只能退回路径前缀反查。
    ///
    /// 断言的是**选择**（交给哪个参数），不是前缀规则本身 —— 那条规则属于项目域
    /// （`core::project::environment_for_path`），本域不重写它。
    #[test]
    fn a_legacy_team_row_falls_back_to_the_path() {
        let tmp = tempdir();
        let team = Team {
            project_id: String::new(),
            ..team_at(tmp.path())
        };
        assert_eq!(
            environment_source(&team),
            EnvironmentSource::LegacyPath(tmp.path().to_path_buf()),
            "空 id = v16 之前建的行；退回的必须是团队根本身"
        );
    }

    /// 计划用的 Neeko 配置根（隔离配置目录落在它下面）。
    ///
    /// **不要求存在**：`mkdir -p` 是执行层的事（本域只算计划）。
    fn state_root(tmp: &tempfile::TempDir) -> PathBuf {
        tmp.path().join("neeko")
    }

    /// 多数用例只需要“团队根 = 临时目录”：把两个根接在一起，调用点只写成员。
    ///
    /// `member_count = 0`：花名册为空时「池内可启动者」是最大值，所以这里测的是
    /// **不受上限影响**的推导。
    fn plan_for(tmp: &tempfile::TempDir, member: &TeamMember) -> Result<SpawnPlan, AppError> {
        plan_for_team(&team_at(tmp.path()), tmp, member, 0)
    }

    /// 同上，但团队行由调用方给（池 / 默认值 / 上限影响推导的用例用它）。
    ///
    /// `resume = None`：绝大多数用例不关心续接（新开的对话是常态），需要续接的用例
    /// 用 [`plan_for_team_resumed`]。
    fn plan_for_team(
        team: &Team,
        tmp: &tempfile::TempDir,
        member: &TeamMember,
        member_count: u32,
    ) -> Result<SpawnPlan, AppError> {
        plan_member_spawn(
            team,
            member,
            MCP_URL,
            TOKEN,
            &state_root(tmp),
            member_count,
            None,
        )
    }

    /// 带续接片段的计划（`team_resume` 的形状：身份不变，只多一段 argv）。
    fn plan_for_team_resumed(
        team: &Team,
        tmp: &tempfile::TempDir,
        member: &TeamMember,
        resume: &[&str],
    ) -> Result<SpawnPlan, AppError> {
        let resume: Vec<String> = resume.iter().map(|arg| (*arg).to_owned()).collect();
        plan_member_spawn(
            team,
            member,
            MCP_URL,
            TOKEN,
            &state_root(tmp),
            0,
            Some(&resume),
        )
    }

    /// happy path：三件套各自来自一个**已落库**的字段（+ 末尾的角色 preamble）。
    ///
    /// cwd 断言对的是**规范化后**的临时目录：`resolve_cwd` 无条件规范化团队根（它是下面
    /// `starts_with` 的信任边界），所以在 macOS 上 `/var/...` → `/private/var/...` 是**预期**
    /// 行为，而不是测试的噪音。
    #[test]
    fn claude_plan_carries_env_argv_and_the_team_root() {
        let tmp = tempdir();
        let plan = plan_for(&tmp, &worker("claude-code")).expect("plan");

        assert_eq!(
            plan.cwd,
            std::fs::canonicalize(tmp.path()).expect("canonical"),
            "cwd 必须是规范化后的团队根（与 `starts_with` 判据同一个字符串身份）"
        );
        assert_eq!(plan.env, identity::member_env(TEAM, W1));
        // MCP 参数（两条）+ 角色 preamble 的参数（两条）。
        assert_eq!(plan.args.len(), 4, "{:?}", plan.args);
        assert_eq!(plan.args[0], "--mcp-config");
        // 凭证在 JSON 里 ⇒ 不需要 `credentials_env`，也没有隔离目录。
        assert!(
            plan.credentials_env.is_empty(),
            "{:?}",
            plan.credentials_env
        );
        assert_eq!(plan.config_dir, None);
        let config: serde_json::Value =
            serde_json::from_str(&plan.args[1]).expect("MCP 配置必须是合法 JSON");
        assert_eq!(config["mcpServers"][TEAM_SERVER_NAME]["type"], "http");
        assert_eq!(config["mcpServers"][TEAM_SERVER_NAME]["url"], MCP_URL);
        assert_eq!(
            config["mcpServers"][TEAM_SERVER_NAME]["headers"][TOKEN_HEADER],
            TOKEN
        );
    }

    /// **position 契约**：续接片段紧跟 program（`args[0..]` 的最前面）。
    ///
    /// codex 是这条契约的钉子：它的 `resume` 是**子命令**，把它追加到启动行末尾会被当成
    /// `PROMPT` 位置参数（2026-11-11 实测）—— 于是「恢复」起来的是一个以 `resume` 为开场白
    /// 的新对话，而用户看到的是一个空白聊天框。
    #[test]
    fn planning_a_resumed_member_puts_the_fragment_right_after_the_program() {
        let tmp = tempdir();
        let team = team_at(tmp.path());
        let plan =
            plan_for_team_resumed(&team, &tmp, &worker("codex"), &["resume", "s1"]).expect("plan");

        assert_eq!(&plan.args[..2], ["resume", "s1"], "{:?}", plan.args);
        // MCP 参数（`-c …`）紧跟在片段之后，preamble 仍在最后。
        assert_eq!(plan.args[2], "-c", "{:?}", plan.args);
        let preamble = plan.args.last().expect("preamble 在末尾");
        assert!(
            preamble.contains("You are a worker of Neeko team"),
            "preamble 必须是最后一个参数：{preamble}"
        );
    }

    /// `resume = None` 时的启动行**逐字节等于旧输出**：`mcp → prompt → bypass`。
    ///
    /// 反例（本用例挡的正是它）：把旁路开关挪到 preamble 之前 / 之后再加一段别的顺序 ——
    /// 那会改变今天每一家 CLI 都被实测过的参数序，而症状只在「成员起来后行为怪」时显形。
    #[test]
    fn planning_a_fresh_member_is_byte_identical_to_before() {
        let tmp = tempdir();
        let member = TeamMember {
            approval_policy: crate::agent::team::types::ApprovalPolicy::Bypass,
            ..worker("claude-code")
        };
        let plan = plan_for(&tmp, &member).expect("plan");

        assert_eq!(plan.args.len(), 5, "{:?}", plan.args);
        assert_eq!(plan.args[0], "--mcp-config");
        assert_eq!(plan.args[2], "--append-system-prompt");
        assert!(
            plan.args[3].contains("You are a worker of Neeko team"),
            "{:?}",
            plan.args[3]
        );
        assert_eq!(
            plan.args[4], "--dangerously-skip-permissions",
            "旁路开关仍在最后（per-CLI 数据，位置由本层定）"
        );
        assert!(
            !plan
                .args
                .iter()
                .any(|arg| arg == "--resume" || arg == "resume"),
            "新开的对话不得带续接片段：{:?}",
            plan.args
        );
    }

    /// 新开 vs 续接：**差异只有那一段 argv**（cwd / env / 凭证 env / 隔离目录全同）。
    ///
    /// 这就是「恢复 = 用同一份身份 + 同一份原生 id 重建资源」的机器形式：两个计划只该在
    /// 「接着哪个对话」上不同。
    #[test]
    fn the_only_argv_difference_between_fresh_and_resumed_is_the_fragment() {
        let tmp = tempdir();
        let team = team_at(tmp.path());
        let member = worker("codex");
        let fresh = plan_for_team(&team, &tmp, &member, 0).expect("fresh");
        let fragment = ["resume", "s1"];
        let resumed = plan_for_team_resumed(&team, &tmp, &member, &fragment).expect("resumed");

        assert_eq!(
            resumed.args[fragment.len()..],
            fresh.args[..],
            "片段之后必须逐字节相等：{:?} vs {:?}",
            resumed.args,
            fresh.args
        );
        assert_eq!(&resumed.args[..fragment.len()], fragment);
        assert_eq!(fresh.cwd, resumed.cwd);
        assert_eq!(fresh.env, resumed.env);
        assert_eq!(fresh.credentials_env, resumed.credentials_env);
        assert_eq!(fresh.config_dir, resumed.config_dir);
    }

    /// qoder 额外要 `--strict-mcp-config`（模板是数据，不是通用模板的特例分支）。
    #[test]
    fn qoder_plan_appends_its_strict_flag() {
        let tmp = tempdir();
        let plan = plan_for(&tmp, &worker("qoder")).expect("plan");
        // 三条 MCP 参数 + 两条 preamble 参数（preamble 一律在**末尾**）。
        assert_eq!(plan.args.len(), 5, "{:?}", plan.args);
        assert_eq!(plan.args[2], "--strict-mcp-config");
    }

    /// 队长/成员都拿到**角色** preamble，而且它追加在 argv **末尾**。
    ///
    /// 保护的不变量（本轮要修的那个故障）：没有这段文本，起来的是一个不知道自己是队长
    /// 的裸 CLI —— 它不会派活、不会 `task_wait`，用户看到的只是一个普通会话。末尾是
    /// 与 MCP 参数的分界：先「怎么连上工具面」，后「你是队里的谁」，且 MCP 参数保持一个
    /// 连续前缀（排查时肉眼可比对）。
    #[test]
    fn a_lead_spawn_appends_the_preamble_argv() {
        let tmp = tempdir();
        let plan = plan_for(&tmp, &lead("claude-code")).expect("plan");
        let len = plan.args.len();
        assert_eq!(
            plan.args[len - 2],
            "--append-system-prompt",
            "{:?}",
            plan.args
        );
        let text = &plan.args[len - 1];
        assert!(text.contains("You are the lead of Neeko team"), "{text}");
        assert!(text.contains("team_wait"), "队长版必须点名阻塞等待：{text}");
        assert!(text.contains(LEAD), "preamble 必须带上 member id：{text}");
        // 前面仍是那两条 MCP 参数（preamble 没有把它们挤掉）。
        assert_eq!(plan.args[0], "--mcp-config");
        assert!(plan.args[1].contains("mcpServers"));
    }

    /// preamble 只广告**池内**的 CLI：向队长列一个池外的选项，等于让它挑一个永远被拒的
    /// 选项（`team_spawn` 的池子校验会拒绝它）。
    ///
    /// 两条判据：池子只有 `["pi"]` 时 `claude-code` **不出现**；空池（= 不限制）时
    /// 全部可启动项都在。夹具团队根由 `tempdir()` 推导（红线 13）。
    #[test]
    fn the_lead_preamble_only_advertises_the_teams_pool() {
        use crate::agent::team::fixtures::fixture_team_configured;
        use crate::agent::team::types::TeamConfig;

        let tmp = tempdir();
        let restricted = Team {
            project_path: tmp.path().to_path_buf(),
            ..fixture_team_configured(
                TEAM,
                &TeamConfig {
                    allowed_agent_ids: vec!["pi".into()],
                    ..TeamConfig::default()
                },
            )
        };
        let plan = plan_for_team(&restricted, &tmp, &lead("claude-code"), 0).expect("plan");
        let text = plan.args.last().expect("preamble 在末尾");
        assert!(text.contains("pi (tier"), "池内的 pi 必须被广告：{text}");
        // 注意不能用裸名字断言：preamble 的身份行里本来就有队长自己的 `agent_id`
        // （`The CLI agent \`claude-code\``）—— 要断言的是**可 spawn 清单**里没有它。
        assert!(
            !text.contains("claude-code (tier"),
            "池外的 claude-code 不得出现在队长版的可 spawn 清单里：{text}"
        );

        // 空池 = 不限制 ⇒ 全部可启动项都出现（两个已知 A 档成员各断言一次）。
        let open = team_at(tmp.path());
        let plan = plan_for_team(&open, &tmp, &lead("claude-code"), 0).expect("plan");
        let text = plan.args.last().expect("preamble 在末尾");
        for agent_id in ["claude-code", "pi"] {
            assert!(
                text.contains(&format!("{agent_id} (tier")),
                "空池必须广告 {agent_id}：{text}"
            );
        }
    }

    /// `member_count` 走到 `options_for`（而不是被丢掉）：它决定 `TeamOptions.member_count`。
    ///
    /// 这条只看“参数有没有真的被用上”——它不改变 preamble 的成员清单（清单只由池子过滤），
    /// 而「成员数与上限的比较」在下游（`team_spawn` 与面板）才发生。断言点是一个可见差异：
    /// 同一个团队、同一个成员，不同 `member_count` 得到相同的清单（证明清单不受它影响），
    /// 而 `options_for` 那一侧有它自己的断言（见 `options` 模块）。
    #[test]
    fn the_preamble_does_not_depend_on_the_member_count() {
        let tmp = tempdir();
        let team = team_at(tmp.path());
        let empty = plan_for_team(&team, &tmp, &lead("claude-code"), 0).expect("plan");
        let full = plan_for_team(&team, &tmp, &lead("claude-code"), 3).expect("plan");
        assert_eq!(empty.args, full.args);
    }

    /// 成员侧：同一份 preamble 机制，文本**不是**队长的（它不该去派活）。
    #[test]
    fn a_worker_spawn_gets_the_worker_preamble() {
        let tmp = tempdir();
        let plan = plan_for(&tmp, &worker("claude-code")).expect("plan");
        let text = plan.args.last().expect("最后一条是 preamble");
        assert!(text.contains("You are a worker of Neeko team"), "{text}");
        assert!(!text.contains("You are the lead"), "{text}");
        // 成员版不得收到「你可以 spawn 谁来干活」那份清单。
        assert!(!text.contains("Worker CLIs you can spawn"), "{text}");
    }

    /// 能当成员但**不能**收系统提示的 CLI ⇒ 当队长必须被拒。
    ///
    /// 用**合成行**而不是表里的一行：今天表里能起成员的 5 家都验过 `prompt_argv`（数据
    /// 是对的），而这条判据必须在「明天的第 6 家」上也成立。
    #[test]
    fn a_cli_without_a_preamble_cannot_be_a_lead() {
        let row = synthetic_without_prompt();
        assert_eq!(row.launch_refusal(), None, "作为成员它起得来（有 MCP 面）");
        let why = refusal_for(MemberRole::Lead, &row).expect("当队长必须被拒绝");
        assert!(why.contains("prompt_argv"), "{why}");
        assert!(
            why.contains("never learns it is a lead"),
            "理由必须说清「会起来一个不动的会话」：{why}"
        );
    }

    /// 同一个空模板，成员侧**不拒绝**：成员的第一条上下文可以由 `team_send` 带来。
    ///
    /// 这就是队长/成员的不对称。两个方向都需要一条断言 —— 只测「队长被拒」会让判据
    /// 演化成「空模板一律拒绝」，而那会把能跑的成员挡在外面。
    #[test]
    fn a_worker_without_a_preamble_is_still_spawned() {
        let row = synthetic_without_prompt();
        assert_eq!(
            refusal_for(MemberRole::Worker, &row),
            None,
            "成员侧空模板必须放行"
        );
    }

    /// 合成一行：能起成员（`Argv` + MCP 面）、但 `prompt_argv` 为空。
    fn synthetic_without_prompt() -> AgentAdmission {
        AgentAdmission {
            agent_id: "synthetic-no-prompt",
            hooks: true,
            mcp_injection: McpInjection::Argv,
            transport: Some(McpTransport::Http),
            bypass_args: &[],
            mcp_argv: &["--mcp-config", MCP_CONFIG_PLACEHOLDER],
            config_dir: None,
            pty_submit: PtySubmit::Plain,
            prompt_argv: &[],
            unverified: &[],
        }
    }

    /// 端点的渲染值里可以有 `{{url}}` / `{{mcp_config}}`，但 `args` 里**不得**出现任何
    /// 未渲染的占位符字面量（`{{preamble}}` 拼错时最典型）。
    #[test]
    fn no_unrendered_placeholder_survives_in_the_argv() {
        for member in [
            lead("claude-code"),
            worker("claude-code"),
            worker("codex"),
            worker("pi"),
        ] {
            let tmp = tempdir();
            let plan = plan_for(&tmp, &member).expect("plan");
            for arg in &plan.args {
                assert!(
                    !arg.contains(MCP_URL_PLACEHOLDER) && !arg.contains(MCP_CONFIG_PLACEHOLDER),
                    "argv 里留下了未渲染的占位符：{arg}"
                );
                assert!(
                    !arg.contains("{{preamble}}"),
                    "argv 里留下了未渲染的 `{{{{preamble}}}}`：{arg}"
                );
            }
        }
    }

    /// 凭证**只在启动参数里**，不进 env：env 会被子进程继承、会进 `/proc/<pid>/environ`。
    #[test]
    fn the_token_never_appears_in_the_env() {
        let tmp = tempdir();
        let plan = plan_for(&tmp, &worker("claude-code")).expect("plan");
        for (key, value) in &plan.env {
            assert!(
                !value.contains(TOKEN),
                "env `{key}` 里出现了凭证明文 —— 凭证只允许出现在启动参数里"
            );
        }
        // 反向：它确实在启动参数的那段 JSON 里（否则成员连不上）。
        assert!(plan.args.iter().any(|arg| arg.contains(TOKEN)));
    }

    /// codex：凭证走**唯一**的 env 例外，且 argv 里放的是 env **名字**。
    ///
    /// 三条判据缺一不可：
    /// ① `credentials_env` 恰好一条（多一条 = 又多一份落进 `/proc/<pid>/environ` 的秘密）；
    /// ② 它的 key 与 argv 里渲染出的那个名字是**同一个字符串**（不同就是 401）；
    /// ③ 那个名字就是 [`identity::TEAM_TOKEN_ENV`] 常量（不是任何一处手写字面量）。
    #[test]
    fn codex_plan_puts_the_token_into_the_credentials_env_only() {
        let tmp = tempdir();
        let plan = plan_for(&tmp, &worker("codex")).expect("plan");

        assert_eq!(plan.credentials_env.len(), 1, "{:?}", plan.credentials_env);
        assert_eq!(plan.credentials_env[0].0, identity::TEAM_TOKEN_ENV);
        assert_eq!(plan.credentials_env[0].1, TOKEN);
        // argv 里只有名字，没有明文。
        assert!(
            plan.args.iter().all(|arg| !arg.contains(TOKEN)),
            "codex 的 argv 不该带明文：{:?}",
            plan.args
        );
        let env_name_in_argv = plan
            .args
            .iter()
            .find_map(|arg| arg.split_once("bearer_token_env_var=\""))
            .map(|(_, rest)| rest.trim_end_matches('"').to_owned())
            .expect("argv 里必须有 bearer_token_env_var");
        assert_eq!(
            env_name_in_argv, plan.credentials_env[0].0,
            "argv 里的 env 名与注入的 env key 必须同源"
        );
        // 身份 env 里仍然没有凭证（两份 env 刻意分开）。
        assert!(plan.env.iter().all(|(_, value)| !value.contains(TOKEN)));
        assert_eq!(plan.config_dir, None, "codex 不写任何配置文件");
    }

    /// pi：MCP 参数为空，副作用计划全在 `config_dir` 里（并落在**调用方给的**根下）。
    ///
    /// 保护的不变量：
    /// ① 目录根来自调用方（`state_root`）—— 域里硬编码临时目录会让配置被系统清理掉；
    /// ② 重定向 env 与目录是同一个字符串（`mcp add` 写的与 PTY 读的必须是同一处）；
    /// ③ `add_args` 已是**渲染后**的真实参数（含端点与凭证），执行层不再拼字符串；
    /// ④ 镜像源是用户自己的配置目录，且**不镜像**会话目录（数据行里没有它）；
    /// ⑤ `args` 里只有角色 preamble 那两条 —— **不得**混进 MCP 参数（pi 的 MCP 配置走
    ///    隔离目录，`--mcp-config` 不是它的语法）。
    #[test]
    fn pi_plan_provisions_an_isolated_config_directory() {
        let tmp = tempdir();
        let plan = plan_for(&tmp, &worker("pi")).expect("plan");

        assert_eq!(plan.args[0], "--append-system-prompt", "{:?}", plan.args);
        assert_eq!(plan.args.len(), 2, "{:?}", plan.args);
        assert!(
            plan.args[1].contains("You are a worker of Neeko team"),
            "第二条必须是角色 preamble：{:?}",
            plan.args
        );
        assert!(
            plan.args.iter().all(|arg| !arg.contains("mcpServers")),
            "pi 的 MCP 配置不得从启动参数进去（那是隔离目录的事）：{:?}",
            plan.args
        );
        assert!(plan.credentials_env.is_empty(), "凭证写在 mcp.json 里");

        let cfg = plan.config_dir.expect("pi 必须有隔离目录计划");
        let expected_dir = state_root(&tmp).join("team").join(TEAM).join("w1_tm_1");
        assert_eq!(
            cfg.dir, expected_dir,
            "目录根必须来自调用方给的 `state_root`"
        );
        assert_eq!(cfg.mcp_file, "mcp.json");
        assert_eq!(
            cfg.add_env,
            vec![(
                "PI_CODING_AGENT_DIR".to_owned(),
                cfg.dir.to_string_lossy().to_string()
            )],
            "重定向 env 与目录必须是同一个字符串身份"
        );
        assert_eq!(cfg.add_args.first().map(String::as_str), Some("mcp"));
        assert!(
            cfg.add_args.iter().any(|arg| arg.contains(TOKEN)),
            "`mcp add` 的参数里必须有凭证（否则写出的配置连不上）：{:?}",
            cfg.add_args
        );
        assert!(
            cfg.mirror_source.ends_with(".pi/agent"),
            "镜像源是用户自己的配置目录：{:?}",
            cfg.mirror_source
        );
        assert!(cfg.mirror.contains(&"auth.json"), "登录态必须镜像");
        assert!(
            !cfg.mirror.iter().any(|entry| entry.contains("session")),
            "会话目录不镜像（团队成员的历史与用户自己的分开）：{:?}",
            cfg.mirror
        );
    }

    /// codex 的覆盖项里那个 server 名必须与**下发 JSON 用的** server 名一致。
    ///
    /// 保护的不变量：两处各写一个字面量（`mcp_servers.<name>…` 与 `TEAM_SERVER_NAME`）是
    /// **不可避免的**（模板是 `&'static str`，不能在编译期拼接），所以要有一条用例把它们
    /// 钉在一起 —— 否则改名时只有一侧会改，成员命令行里会多出一个没人知道的 server。
    #[test]
    fn codex_overrides_name_the_same_server_as_the_handed_out_json() {
        let tmp = tempdir();
        let plan = plan_for(&tmp, &worker("codex")).expect("plan");
        for arg in &plan.args {
            if arg.contains("mcp_servers.") {
                assert!(
                    arg.contains(&format!("mcp_servers.{TEAM_SERVER_NAME}.")),
                    "`{arg}` 里的 server 名必须等于 TEAM_SERVER_NAME={TEAM_SERVER_NAME}"
                );
            }
        }
    }

    /// 成员名里的危险字符不得把隔离目录变成任意路径（`name` 只保证不含 `@` 与控制字符）。
    ///
    /// 保护的不变量：`/` 会让目录名变成嵌套路径（`create_dir_all` 在别处建目录）；
    /// 空 / `.` / `..` 会让 `create_dir_all` 落到意料之外的位置。
    #[test]
    fn config_dir_segments_are_sanitised() {
        assert_eq!(path_segment("w1_tm_1"), "w1_tm_1");
        assert_eq!(path_segment("a/b"), "a_b");
        assert_eq!(path_segment(".."), "member");
        assert_eq!(path_segment(""), "member");
        assert_eq!(path_segment("a b:c"), "a_b_c");
        assert_eq!(path_segment(&"x".repeat(200)).chars().count(), 96);
    }

    /// persona（v19）：快照文本附加在成员 argv 末尾的 preamble 里；
    /// 无人设时 preamble 与旧输出**逐字节一致**（可选能力不得改变既有成员的启动参数）。
    #[test]
    fn a_member_with_a_persona_gets_it_in_its_preamble_argv() {
        let tmp = tempdir();
        let base_plan = plan_for(&tmp, &fixture_member(W1, TEAM)).expect("plan");
        let base_preamble = base_plan.args.last().expect("preamble 在末尾").clone();

        let member = TeamMember {
            persona: Some(Persona {
                name: "研究员".into(),
                preamble: "Research only; never edit production code.".into(),
            }),
            ..fixture_member(W1, TEAM)
        };
        let plan = plan_for(&tmp, &member).expect("plan");
        let preamble = plan.args.last().expect("preamble 在末尾");
        assert!(
            preamble.starts_with(base_preamble.as_str()),
            "persona 必须附加在骨架之后：{preamble}"
        );
        assert!(preamble.contains("Research only"), "{preamble}");
        assert!(preamble.contains("Your persona in this team"), "{preamble}");
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

        let plan = plan_for(&tmp, &member).expect("plan");
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

        let err = plan_for(&team_tmp, &member).expect_err("团队根之外的 worktree 必须被拒绝");
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
        let err = plan_for(&tmp, &member).expect_err("不存在的路径必须被拒绝");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
        assert!(
            err.to_string()
                .contains("cannot be used as a working directory"),
            "{err}"
        );
    }

    /// 未实现的注入档一律拒绝，且错误里点名档位（看日志就知道是哪种）。
    ///
    /// 注意这里**不再包含 codex**：它已从 `Subcommand`（写全局 `config.toml`）改为
    /// `Argv`（`-c` 覆盖，不写文件）—— 这正是本步要拆出来的两种能力。
    #[test]
    fn subcommand_and_config_file_agents_are_refused() {
        let tmp = tempdir();
        // `reasonix` 不列在这里：它连传输都没有，先被「没有 MCP 面」那一句拦下
        // （见 `agents_without_an_mcp_surface_are_refused`）。
        for (agent_id, mode) in [
            ("grok", "Subcommand"),
            ("opencode", "Subcommand"),
            ("gemini", "ConfigFile"),
        ] {
            let err = plan_for(&tmp, &worker(agent_id)).expect_err("未实现的注入档必须被拒绝");
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

    /// 今天能起的两档都不拒绝（`Argv` 与 `ConfigDir`）：拒绝判据变宽会把能跑的 CLI 挡在外面。
    #[test]
    fn both_implemented_gears_can_be_planned() {
        let tmp = tempdir();
        for agent_id in ["claude-code", "codebuddy", "qoder", "codex", "pi"] {
            plan_for(&tmp, &worker(agent_id))
                .unwrap_or_else(|err| panic!("{agent_id} 今天应该能起：{err}"));
        }
    }

    /// 无 MCP 面的 CLI（`omp` / `reasonix`）拒绝：起得来也收不到任务。
    #[test]
    fn agents_without_an_mcp_surface_are_refused() {
        let tmp = tempdir();
        for agent_id in ["omp", "reasonix"] {
            let err = plan_for(&tmp, &worker(agent_id)).expect_err("无 MCP 面必须拒绝");
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
        let err = plan_for(&tmp, &member).expect_err("跨队成员必须被拒绝");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
    }

    /// 占位符可以**嵌在更长的参数里**（pi 的 header 就是 `KEY={{token}}`）。
    ///
    /// 旧行为（只替换“整元素等于占位符”）会把 `{{token}}` 原样发给 CLI，于是成员带一个
    /// 无效 header 启动 —— 错误在 401 那一层才出现，离家很远。
    #[test]
    fn placeholders_are_substituted_inside_arguments_too() {
        let ctx = RenderContext::new("{}".to_owned(), "u", "t", Some("role"));
        let args =
            render_argv(&["--x", MCP_CONFIG_PLACEHOLDER, "prefix-{{url}}"], &ctx).expect("render");
        assert_eq!(args[0], "--x");
        assert_eq!(args[1], "{}");
        assert_eq!(args[2], "prefix-u");
    }

    // ─────────────── `apply_effect`：领域副作用 → 动手（AC14 的接线判据） ───────────────

    /// 记录端口：把「谁被要求做什么」按发生顺序记下来。
    ///
    /// 一个类型同时实现两个端口是刻意的 —— 它们就是同一个角色的两半，拆成两个假体会让
    /// 「`admit` 与 `spawn` 的先后」这条契约在测试里也无处安放。
    struct Recorder {
        calls: std::sync::Mutex<Vec<String>>,
        token: &'static str,
        spawn_error: Option<&'static str>,
        /// `Some(message)` ⇒ 每一次 `close` 都失败（关闭的失败面 / 顺序判据）。
        close_error: Option<&'static str>,
    }

    impl Recorder {
        fn new() -> Self {
            Self {
                calls: std::sync::Mutex::new(Vec::new()),
                token: "issued-token",
                spawn_error: None,
                close_error: None,
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

        async fn refresh(&self) -> Result<(), AppError> {
            self.record("refresh".to_owned());
            Ok(())
        }
    }

    #[async_trait::async_trait]
    impl MemberExecutor for Recorder {
        async fn spawn(
            &self,
            member_id: &str,
            token: &str,
            resume_argv: Option<Vec<String>>,
        ) -> Result<String, AppError> {
            self.record(format!(
                "spawn:{member_id}:{token}:{}",
                resume_argv.map_or_else(|| "fresh".to_owned(), |argv| argv.join(" "))
            ));
            match self.spawn_error {
                Some(message) => Err(AppError::Terminal(message.to_owned())),
                None => Ok(format!("term-{member_id}")),
            }
        }

        async fn deliver(&self, member_id: &str, message: &str) -> Result<(), AppError> {
            self.record(format!("deliver:{member_id}:{message}"));
            Ok(())
        }

        async fn close(&self, member_id: &str) -> Result<(), AppError> {
            self.record(format!("close:{member_id}"));
            match self.close_error {
                Some(message) => Err(AppError::Terminal(message.to_owned())),
                None => Ok(()),
            }
        }
    }

    /// 一个团队 + 队长 + 两名 worker（夹具成员的 `token_hash` 非空 = 已签发凭证）。
    fn seeded_manager() -> std::sync::Arc<TeamManager> {
        let manager = TeamManager::new(TeamStore::open_in_memory().expect("in-memory store"));
        manager.create_team(fixture_team(TEAM)).expect("team");
        for (id, role) in [
            (LEAD, MemberRole::Lead),
            (W1, MemberRole::Worker),
            (W2, MemberRole::Worker),
        ] {
            manager
                .add_member(TeamMember {
                    role,
                    ..fixture_member(id, TEAM)
                })
                .expect("member");
        }
        std::sync::Arc::new(manager)
    }

    /// 一个**已被 `W1` 认领**的任务（`reclaim_count = 2`，用来证明关闭不改它）。
    fn claimed_task(manager: &TeamManager, task_id: &str, member_id: &str) {
        manager
            .create_task(TeamTask {
                id: task_id.into(),
                team_id: TEAM.into(),
                title: "do it".into(),
                body: "body".into(),
                state: TeamTaskState::Pending,
                owner: None,
                assignee: None,
                workspace: Workspace::Shared,
                depends_on: vec![],
                claimed_at: None,
                lease_ttl: 1800,
                summary: None,
                summary_truncated: false,
                artifacts: vec![],
                reclaim_count: 2,
            })
            .expect("task");
        manager
            .claim_task(&TaskRef::new(TEAM, task_id), member_id, 1_000)
            .expect("claim");
    }

    /// `team_spawn` 的结果 → 执行层要做的那件事。
    fn start_member_effect(member_id: &str) -> Effect {
        Effect::StartMember {
            member_id: member_id.to_owned(),
        }
    }

    /// `team_send` 的结果 → 执行层要做的那件事（`text` 由决定层拼好，见 `dispatch::send`）。
    fn deliver_effect(from: &str, to: &str, message: &str) -> Effect {
        Effect::Deliver {
            to: to.to_owned(),
            text: crate::agent::team::delivery::delivery_text(from, message),
        }
    }

    /// 决定层对单成员关闭给出的计划（`targets` 还空着 —— 目标由 `member_id` 指明）。
    fn closed_member(member_id: &str) -> Effect {
        Effect::Close(ClosePlan {
            team_id: TEAM.to_owned(),
            member_id: Some(member_id.to_owned()),
            targets: Vec::new(),
            team_state: TeamState::Open,
            notes: vec!["a note from the decision layer".to_owned()],
        })
    }

    /// 走一遍决定层的整队关闭前置（`open → closing`），返回待关列表。
    ///
    /// 生产路径上这一步发生在 `plan_close` 里（`begin_team_close`）；本模块的用例
    /// 只负责「动手」那一半，所以在这里显式补上 —— 跳过它会被 `finish_team_close`
    /// 以 `Conflict` 拒绝（那正是状态机在起作用）。
    fn begin_close(manager: &TeamManager) -> Vec<String> {
        manager
            .begin_team_close(TEAM, crate::agent::team::manager::now_millis())
            .expect("begin_team_close")
    }

    /// 决定层对整队关闭给出的计划（`targets` = 待关列表，`team_state` = `closing`）。
    fn closed_team(targets: &[&str]) -> Effect {
        Effect::Close(ClosePlan {
            team_id: TEAM.to_owned(),
            member_id: None,
            targets: targets.iter().map(|id| (*id).to_owned()).collect(),
            team_state: TeamState::Closing,
            notes: Vec::new(),
        })
    }

    fn rt() -> crate::common::runtime::AppRuntime {
        crate::common::runtime::AppRuntime::from_handle(tokio::runtime::Handle::current())
    }

    /// 取关闭执行之后的事实（其余结局都是测试自己的写法错误）。
    fn closed_outcome(outcome: EffectOutcome) -> CloseOutcome {
        match outcome {
            EffectOutcome::Closed(closed) => closed,
            other => panic!("必须回 Closed，实际 {other:?}"),
        }
    }

    /// `StartMember`：**先**认门**再**起进程，且把刚签发的明文交过去。
    ///
    /// 顺序是契约：反过来的话成员的首次工具调用会 401（它就在那个窗口里刚启动）。
    #[tokio::test]
    async fn starting_a_member_admits_first_then_spawns_with_that_token() {
        let recorder = Recorder::new();
        let manager = seeded_manager();
        let outcome = apply_effect(
            &rt(),
            &recorder,
            &recorder,
            &manager,
            &start_member_effect(W1),
        )
        .await
        .expect("apply");

        assert_eq!(outcome, EffectOutcome::Applied, "起进程之后回复就是事实");
        assert_eq!(
            recorder.calls(),
            vec![
                format!("admit:{W1}"),
                format!("spawn:{W1}:issued-token:fresh"),
            ],
            "顺序与载荷都是契约：认门在前，明文只在 spawn 的入参里出现；\
             `team_spawn` 永远新开对话（续接只走 `team_resume`）"
        );
    }

    /// `Deliver`：**执行层收到的就是接收方看到的那一行**（正文逐字，不多不少）。
    ///
    /// 反例（本用例挡的正是它）：`team_send` 只走到「已校验」而没有任何消费方 ——
    /// 队长以为消息送达，成员一个字节也没收到。
    #[tokio::test]
    async fn delivering_a_message_reaches_the_executor() {
        let recorder = Recorder::new();
        let manager = seeded_manager();
        let outcome = apply_effect(
            &rt(),
            &recorder,
            &recorder,
            &manager,
            &deliver_effect(LEAD, W1, "run the tests"),
        )
        .await
        .expect("apply");

        assert_eq!(outcome, EffectOutcome::Applied, "投递之后回复就是事实");
        assert_eq!(
            recorder.calls(),
            vec![format!("deliver:{W1}:[team] {LEAD}: run the tests")],
            "执行层只该收到最终文本（发送者已在决定层拼进正文）"
        );
    }

    /// 正文**逐字**保留：前后空白与多行都不被加工（`trim()` 会让粘贴的代码块变形）。
    #[tokio::test]
    async fn the_delivered_body_is_verbatim() {
        let recorder = Recorder::new();
        let manager = seeded_manager();
        let body = "\n  line1\n\tline2  \n";
        apply_effect(
            &rt(),
            &recorder,
            &recorder,
            &manager,
            &deliver_effect(LEAD, W1, body),
        )
        .await
        .expect("apply");

        assert_eq!(
            recorder.calls(),
            vec![format!("deliver:{W1}:[team] {LEAD}: {body}")]
        );
    }

    /// 起进程失败时错误里**必须带着 `member_id`** —— 否则队长既查不到也清不掉那个成员。
    #[tokio::test]
    async fn a_failed_spawn_keeps_the_member_id_in_the_error() {
        let recorder = Recorder {
            spawn_error: Some("pty refused"),
            ..Recorder::new()
        };
        let manager = seeded_manager();
        let err = apply_effect(
            &rt(),
            &recorder,
            &recorder,
            &manager,
            &start_member_effect(W1),
        )
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

    /// 关单个成员：**先关进程**（执行者被调用）→ 再归档（`Offline` + 凭证作废 + 任务回 pending）。
    ///
    /// 保护的不变量：`reclaim_count` **不动**（手动关队不是任务失败）。若这里 +1，
    /// 「反复失败」这个指标就把人的决定算成了成员的无能 —— 四轮之后任务会被冻结。
    #[tokio::test]
    async fn closing_a_member_closes_the_process_then_archives_it() {
        let recorder = Recorder::new();
        let manager = seeded_manager();
        claimed_task(&manager, "t1", W1);

        let outcome = apply_effect(&rt(), &recorder, &recorder, &manager, &closed_member(W1))
            .await
            .expect("close");

        // 顺序：进程先关，凭证表后刷新（`close:*` 在 `refresh` 之前）。
        assert_eq!(
            recorder.calls(),
            vec![format!("close:{W1}"), "refresh".to_owned()],
            "先关进程、再让门忘掉那把钥匙"
        );

        let member = manager.member(W1).expect("member");
        assert_eq!(member.state, MemberState::Offline, "关闭成功后必须归档");
        assert!(
            member.token_hash.is_empty(),
            "凭证必须立即作废（空 hash 会让身份表跳过它）"
        );
        assert!(
            member.sealed_at.is_some(),
            "归档必须写下封存时刻（否则面板分不清「跑到一半退了」与「用户关掉了」）\
             —— 只判非空：这个字段的可读者只关心「用户封存过没有」，不读它的绝对值"
        );

        let task = manager.task(&TaskRef::new(TEAM, "t1")).expect("task");
        assert_eq!(task.state, TeamTaskState::Pending, "在飞任务必须回到板上");
        assert_eq!(task.owner, None);
        assert_eq!(task.claimed_at, None);
        assert_eq!(
            task.reclaim_count, 2,
            "手动关队不是失败：reclaim_count 不得 +1"
        );

        // 结果是**执行之后**的事实。
        let closed = closed_outcome(outcome);
        assert_eq!(closed.members_closed, vec![W1.to_owned()]);
        assert!(closed.members_failed.is_empty());
        assert_eq!(closed.team_state, TeamState::Open, "关一个成员不改团队状态");
        assert!(
            closed
                .notes
                .contains(&"a note from the decision layer".to_owned()),
            "决定层给的 notes 必须原样带回：{:?}",
            closed.notes
        );
    }

    /// **顺序判据**：关不掉进程的成员**不得**被归档。
    ///
    /// 变异验证：把「先关进程、再归档」换成「先归档」时本用例变红（成员已 `Offline`，
    /// 而进程还活着 —— 那正是「域以为它消失了、会话还在收发」的成因）。
    #[tokio::test]
    async fn a_member_whose_process_survives_is_not_archived() {
        let recorder = Recorder {
            close_error: Some("pty refused to die"),
            ..Recorder::new()
        };
        let manager = seeded_manager();
        claimed_task(&manager, "t1", W1);

        let err = apply_effect(&rt(), &recorder, &recorder, &manager, &closed_member(W1))
            .await
            .expect_err("关不掉必须报错");

        assert!(matches!(err, AppError::Terminal(_)), "{err:?}");
        let message = err.to_string();
        assert!(message.contains(W1), "错误必须点名关不掉的成员：{message}");
        assert!(
            message.contains("pty refused to die"),
            "原始原因不得被吞：{message}"
        );
        assert!(
            message.contains("retried"),
            "必须告诉队长重试有用：{message}"
        );

        let member = manager.member(W1).expect("member");
        assert_ne!(member.state, MemberState::Offline, "进程还活着就不能归档");
        assert!(!member.token_hash.is_empty(), "关不掉就不该作废凭证");
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).expect("task").state,
            TeamTaskState::Claimed,
            "在飞任务不能被释放（成员还在干活）"
        );
        // 什么都没作废 ⇒ 不需要（也不该）重建身份表。
        assert!(
            recorder.calls().iter().all(|call| call != "refresh"),
            "没有凭证被撤时不该刷新门：{:?}",
            recorder.calls()
        );
    }

    /// 整队关闭：全部关掉之后才落终态 —— `sealed` + `sealed_at` + 全队 `Offline`。
    #[tokio::test]
    async fn closing_the_whole_team_seals_it_only_when_every_member_closed() {
        let recorder = Recorder::new();
        let manager = seeded_manager();
        let targets = begin_close(&manager);
        assert_eq!(targets, vec![W1.to_owned(), W2.to_owned()]);

        let outcome = apply_effect(
            &rt(),
            &recorder,
            &recorder,
            &manager,
            &closed_team(&[W1, W2]),
        )
        .await
        .expect("close");

        assert_eq!(
            recorder.calls(),
            vec![
                format!("close:{W1}"),
                format!("close:{W2}"),
                "refresh".to_owned()
            ],
            "每个成员一次关闭，最后一次凭证刷新"
        );

        let team = manager.team(TEAM).expect("team");
        assert_eq!(team.state, TeamState::Sealed);
        assert!(team.sealed_at.is_some(), "终态必须写 sealed_at");
        for member_id in [LEAD, W1, W2] {
            let member = manager.member(member_id).expect("member");
            assert_eq!(
                member.state,
                MemberState::Offline,
                "{member_id} 必须随团队归档"
            );
            assert!(
                member.sealed_at.is_some(),
                "{member_id} 归档后必须留下封存时刻"
            );
            assert!(member.token_hash.is_empty(), "{member_id} 凭证必须作废");
        }

        let closed = closed_outcome(outcome);
        assert_eq!(closed.members_closed, vec![W1.to_owned(), W2.to_owned()]);
        assert_eq!(
            closed.team_state,
            TeamState::Sealed,
            "结果说的必须是执行之后的真相"
        );
    }

    /// **关闭的后置条件是一条不可分割的动作**：seal 失败**不得**跳过凭证作废。
    ///
    /// # 靶子（本用例钉住的那个 bug）
    ///
    /// 旧形状是 `finish_team_close(...)??` 在 `credentials.refresh()` **之前**：任一 `?` 提前
    /// 返回 ⇒ 已经归档的成员 `token_hash` 已在库里清空，**但门还认那把钥匙** ⇒ 一个「已关闭」
    /// 的成员旧 token 照样能调工具（含 `team_close`）。
    ///
    /// # 怎么让 seal 失败
    ///
    /// `finish_team_close` 对 `Active` 团队报 `Conflict`（它要求先进入 `closing`）。这里直接
    /// 构造一个「没走过 `begin_team_close` 的计划」把团队留在 `Active` —— 这正是生产里
    /// 「计划与执行之间状态被改过」的那一类冲突。
    #[tokio::test]
    async fn a_failed_seal_still_revokes_the_credentials() {
        let credentials = Recorder::new();
        let executor = Recorder::new();
        let manager = seeded_manager();
        // 反证：成员此刻确实带着凭证（否则下面的「已清空」不成判据）。
        assert!(!manager.member(W1).expect("w1").token_hash.is_empty());

        let plan = ClosePlan {
            team_id: TEAM.to_owned(),
            member_id: None,
            targets: vec![W1.to_owned(), W2.to_owned()],
            team_state: TeamState::Closing,
            notes: Vec::new(),
        };
        let err = apply_effect(
            &rt(),
            &credentials,
            &executor,
            &manager,
            &Effect::Close(plan),
        )
        .await
        .expect_err("seal 失败必须报错");

        // 判据一：凭证刷新**不能**被 seal 的失败跳过。
        assert_eq!(
            credentials.calls(),
            vec!["refresh".to_owned()],
            "只要有一个成员的凭证被作废，门就必须重建 —— 不管 seal 成没成功"
        );
        // 判据二：库里的 hash 已经清空（重建之后旧 token 再也进不来）。
        for id in [W1, W2] {
            let member = manager.member(id).expect("member");
            assert_eq!(member.state, MemberState::Offline, "{id} 已归档");
            assert!(member.token_hash.is_empty(), "{id} 的凭证必须已作废");
        }
        // 判据三：状态没有被伪造成 `closed`（seal 真的失败了）。
        assert_eq!(manager.team(TEAM).expect("team").state, TeamState::Open);

        let message = err.to_string();
        assert!(message.contains(W1), "错误必须点名已归档的成员：{message}");
        assert!(
            message.contains("credentials were revoked"),
            "错误必须诚实说明凭证已经撤了：{message}"
        );
        assert!(
            message.contains("not `closed` yet"),
            "错误必须说明团队还没 sealed：{message}"
        );
    }

    /// 一个成员关不掉时：其它成员照关、队停在 `closing`、错误里点名它。
    ///
    /// 停在哪里是一条状态事实（可查询、可重试），而不是「什么都没发生」。
    #[tokio::test]
    async fn a_partially_closed_team_stays_closing() {
        // 只让 W2 关不掉：`close_error` 是全局开关，所以这里用一个先成功后失败的假体。
        struct Flaky {
            inner: Recorder,
        }

        #[async_trait::async_trait]
        impl MemberExecutor for Flaky {
            async fn spawn(
                &self,
                member_id: &str,
                token: &str,
                resume_argv: Option<Vec<String>>,
            ) -> Result<String, AppError> {
                self.inner.spawn(member_id, token, resume_argv).await
            }

            async fn deliver(&self, member_id: &str, message: &str) -> Result<(), AppError> {
                self.inner.deliver(member_id, message).await
            }

            async fn close(&self, member_id: &str) -> Result<(), AppError> {
                if member_id == W2 {
                    self.inner.record(format!("close:{member_id}"));
                    return Err(AppError::Terminal(
                        "pty is gone but will not confirm".into(),
                    ));
                }
                self.inner.close(member_id).await
            }
        }

        let credentials = Recorder::new();
        let executor = Flaky {
            inner: Recorder::new(),
        };
        let manager = seeded_manager();
        begin_close(&manager);

        let err = apply_effect(
            &rt(),
            &credentials,
            &executor,
            &manager,
            &closed_team(&[W1, W2]),
        )
        .await
        .expect_err("有成员关不掉就必须报错");

        let message = err.to_string();
        assert!(message.contains(W2), "错误必须点名关不掉的成员：{message}");
        assert!(message.contains("closing"), "必须说明团队停在哪：{message}");

        let team = manager.team(TEAM).expect("team");
        assert_eq!(team.state, TeamState::Closing, "有失败就停在 closing");
        assert!(team.sealed_at.is_none(), "没关干净就不能写 sealed_at");
        assert_eq!(
            manager.member(W1).expect("member").state,
            MemberState::Offline,
            "其它成员必须已经关掉（不能被一个坏成员卡死）"
        );
        assert_ne!(
            manager.member(W2).expect("member").state,
            MemberState::Offline,
            "关不掉的成员不能归档"
        );
        // 已关掉的成员凭证仍然要失效（失败路径上也不许留着能用的钥匙）。
        assert_eq!(
            credentials.calls(),
            vec!["refresh".to_owned()],
            "凭证刷新必须在失败判断之前"
        );
    }

    /// 关闭的诚实面里必须有一条「进程是**异步**退出的」。
    ///
    /// 反例：`notes` 写成「进程已关」—— 归档与撤凭证可能先于进程消失（PTY 的收尾在另一个
    /// 线程），那句话就是撒谎。判据只看这一条 note **存在且只有一条**（重复的诚实面等于噪声，
    /// 队长会以为发生了两件事）。
    #[tokio::test]
    async fn the_close_notes_say_processes_exit_asynchronously() {
        let manager = seeded_manager();
        let plan = crate::agent::team::execution::plan_close(
            &manager,
            TEAM,
            Some(W1),
            true,
            crate::agent::team::manager::now_millis(),
        )
        .expect("plan");

        let async_notes: Vec<&String> = plan
            .notes
            .iter()
            .filter(|note| note.contains("exit asynchronously"))
            .collect();
        assert_eq!(async_notes.len(), 1, "{:?}", plan.notes);
        assert!(
            !plan
                .notes
                .iter()
                .any(|note| note.contains("process is closed")),
            "不得声称进程已经关掉：{:?}",
            plan.notes
        );
        // `graceful` 那条仍然在，而且说的是「请求 kill」而不是「已经关掉」。
        let graceful = plan
            .notes
            .iter()
            .find(|note| note.contains("graceful shutdown"))
            .expect("graceful 的诚实面必须还在");
        assert!(graceful.contains("asks the terminal to kill"), "{graceful}");
    }
}
