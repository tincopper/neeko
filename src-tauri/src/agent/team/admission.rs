//! 内置 agent 的准入事实表 —— **红线 15 的落点**（design §4.4）。
//!
//! # 为什么是一张数据表 + 一个纯函数
//!
//! 「这个 CLI 能不能当团队成员」由 P0 实测的四个事实决定（见
//! `research/admission-matrix.md`）：是否上报 hook、MCP 配置怎么注入、吃什么传输、
//! 审批旁路的命令行开关。这四条**完全是 per-CLI 的数据**。
//!
//! 把它们写成 `if id == "claude" { … }` 是红线 15 明令禁止的形状：那样「claude 支持
//! `--mcp-config`」这句实测结论会散落在通用模块的条件分支里，新增一个 CLI 就要改
//! 通用代码，而「哪些 CLI 支持参数注入」这个问题也随之无法被一条测试问出来。
//!
//! 所以本文件只有四类东西，没有一类是分支：**数据**（[`ADMISSIONS`] / [`NOT_SPAWNABLE`]）、
//! **查表**（[`admission_for`]）、**由数据推导的纯函数**（[`tier_of`] /
//! [`AgentAdmission::result_channel`] / [`AgentAdmission::launch_refusal`] /
//! [`launchable_agents`]）与**模板渲染**（[`render_argv`] —— 占位符的名字也是数据侧的事实）。
//! `per_cli_facts_live_only_in_the_table` 会读本文件**生产段**的源码，断言两件事：
//! 没有按 agent id 分支的形状，且每个已准入 id 只出现在它自己那行数据里。
//!
//! # 诚实原则
//!
//! [`AgentAdmission::unverified`] 里的每一条都**原样回给队长**（经
//! `ToolReply::MemberCreated.unverified`）。它存在的理由：B 级证据（配置已装、未跑一轮）
//! 与 A 级证据（实测）在矩阵里长得一样，只有把「我没验过这条」说出来，队长才不会
//! 把不确定的能力当成确定的。

use crate::agent::team::delivery::PtySubmit;
use crate::agent::team::identity::TEAM_TOKEN_ENV;
use crate::agent::team::types::{
    AdmissionTier, ApprovalPolicy, McpInjection, MemberRole, ResultChannel,
};
use crate::common::error::AppError;

/// `mcp_argv` / `ConfigDirSpec::add_argv` 模板里的占位符：执行层把它替换成 MCP 配置 JSON
/// （含端点与成员 token）。
///
/// 放在数据侧（而不是 `execution.rs`）：模板是**这台 CLI 的事实**，替换是执行层的动作。
/// 两侧引用同一个常量，改占位符时编译器会追着改。
pub const MCP_CONFIG_PLACEHOLDER: &str = "{{mcp_config}}";

/// 占位符：团队 MCP 端点 URL（`--url <url>` 那一族要它）。
pub const MCP_URL_PLACEHOLDER: &str = "{{url}}";

/// 占位符：成员凭证**明文**（可以嵌在更长的一段里，例如 `x-neeko-team-token={{token}}`）。
pub const TOKEN_PLACEHOLDER: &str = "{{token}}";

/// 占位符：凭证 env 的**名字**（`bearer_token_env_var` 那一族只收名字，值从 env 读）。
///
/// 它渲染出的一定是 [`TEAM_TOKEN_ENV`] —— 同一个名字在模板、`credentials_env` 的 key
/// 与端点读到的 header 值三处重合，所以不允许任何一处手写字面量。
pub const TOKEN_ENV_PLACEHOLDER: &str = "{{token_env}}";

/// 占位符：角色 preamble 的整段文本（[`crate::agent::team::identity::preamble`] 的产物）。
///
/// 只出现在 [`AgentAdmission::prompt_argv`] 里。它与 MCP 那四个占位符分开是有理由的：
/// 那四个描述**怎么连上工具面**，这一个描述**它在这个团队里是谁** —— 前者错了连不上，
/// 后者错了会连上一个不知道自己要干什么的 agent。
pub const PREAMBLE_PLACEHOLDER: &str = "{{preamble}}";

/// `prompt_argv` 的诚实面：**只验了参数解析**，没跑过完整会话。
///
/// 为什么必须说出来：参数被接受 ≠ 该 CLI 真的把这段文本当系统提示用。这条与矩阵里
/// 其它 B 级证据同一性质，会原样进 `team_spawn` 的工具返回（队长据此判断能信多少），
/// 所以它是**数据行里的一条字符串**，不是注释。
pub const PREAMBLE_UNVERIFIED: &str =
    "preamble argv was verified by argument parsing only, not by a full session";

/// 一个内置 agent 的准入事实。**全部来自 P0 实测**，逐字段注明证据来源。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AgentAdmission {
    /// `AgentConfig.id`（`agent/builtin/providers.rs`）。
    pub agent_id: &'static str,
    /// 是否上报 `turn_completed`（决定 L1 有没有机器信号）。
    pub hooks: bool,
    /// MCP 配置怎么塞给它。
    pub mcp_injection: McpInjection,
    /// MCP 客户端吃什么传输（`None` = 未知或不可用）。
    pub transport: Option<McpTransport>,
    /// `approval_policy = Bypass` 时追加的参数（per-CLI 数据，通用模块禁止按名分支）。
    pub bypass_args: &'static [&'static str],
    /// `McpInjection::Argv` 档的**启动参数模板**，含 [`MCP_CONFIG_PLACEHOLDER`]。
    ///
    /// 非 `Argv` 档为 `&[]` —— 不是"暂时留空"，而是那一档**不用启动参数**：
    /// `ConfigDir` 靠它自己的 `mcp add` 写隔离目录，`Subcommand` 写用户全局配置，
    /// `ConfigFile` 靠写配置文件。执行层据此拒绝，而不是拿一个空模板静默启动一个连不上
    /// 工具面的成员。
    pub mcp_argv: &'static [&'static str],
    /// `McpInjection::ConfigDir` 档的四个事实（其余档为 `None`）。
    ///
    /// 两处必须同时成立才算自洽：档位是 `ConfigDir` ⇒ 这里有值；档位不是 ⇒ 这里是 `None`。
    /// 判据在 `config_dir_facts_live_exactly_on_the_config_dir_rows`。
    pub config_dir: Option<ConfigDirSpec>,
    /// 把一行字变成**一次提交**的形态 —— 每 CLI 的实测事实（红线 15 同族）。
    ///
    /// # 为什么是数据，而不是投递层里的一个分支
    ///
    /// `research/00-evidence.md` §2 的证据是 codex 0.167.0 的 TUI 源码：它开着 bracketed
    /// paste，且内置 paste-burst——窗口内的回车被当成「粘贴里的换行」。躲开它的唯一稳定
    /// 办法是把正文声明成一次**显式粘贴**（`ESC[200~ … ESC[201~`），而那串字节对不认这个
    /// 转义的 TUI 是灾难（它们会把 ``ESC[200~`` 当字面量插进输入框）。
    ///
    /// 所以这里**没有默认值可偷懒**：只有「实测过能用」的那一行才填非 [`PtySubmit::Plain`]，
    /// 别的行保持与改动前逐字节相同。判据
    /// `codex_uses_bracketed_paste_and_everyone_else_is_plain`。
    ///
    /// 与 `channel` 的边界：`channel` 是「怎么把字节**送到**对方」（CLI 成员一律 `Pty`），
    /// 本字段是「送到之后怎么让它**提交**」。两者可独立变化，且都不按 agent 名分支。
    pub pty_submit: PtySubmit,
    /// 启动时把**角色 preamble** 交给该 CLI 的 argv 模板（含 [`PREAMBLE_PLACEHOLDER`]）。
    ///
    /// 空 = 这条 CLI 无法接收初始系统提示 ⇒ **不能当队长**（见
    /// [`AgentAdmission::lead_refusal`]）：起来一个不知道自己该干什么的队长，比在起进程之前
    /// 拒绝更糟 —— 用户会以为团队已经在干活。
    ///
    /// 成员侧空清单**不拒绝**：成员的第一条上下文可以由 `team_send` 带来，而队长不行
    /// （队长的第一个动作没有人能替它触发）。这个不对称是刻意的。
    ///
    /// 每一行都是**实测过的形态**（`--append-system-prompt` 那族 / codex 的位置参数 /
    /// opencode 的 `--prompt`），验法见该行的 `unverified` 与
    /// `the_preamble_argv_only_uses_normalised_placeholders`。
    pub prompt_argv: &'static [&'static str],
    /// 仍未实测确认的点。**必须诚实列出**，会原样进工具返回给队长。
    pub unverified: &'static [&'static str],
}

/// 「重定向配置目录」注入所需的**per-CLI 事实**（红线 15：只许挂在该 CLI 自己那一行）。
///
/// 为什么不是一个可复用的机制里带 CLI 名分支：这五项每一项都是实测出来的事实
/// （`PI_CODING_AGENT_DIR` 这个变量名、`mcp.json` 这个文件名、`--header` 收 `KEY=VALUE`
/// 这个语法、`~/.pi/agent` 这个默认目录、哪几个条目要镜像）。换一个 CLI 当第三档成员时，
/// 需要的是**加一行数据**，而不是在新代码里加一个 `if`。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConfigDirSpec {
    /// 重定向用的环境变量名（该 CLI 的事实）。
    pub env: &'static str,
    /// 目录内的配置文件名（用于测试断言与清理，机制不解释其格式）。
    pub mcp_file: &'static str,
    /// 用该 CLI 自己的写配置命令（模板占位符同 `Argv`）。
    ///
    /// **语法是数据**：`--header KEY=VALUE` 与 `--header KEY: VALUE` 是两台 CLI 的事实，
    /// 写错了 CLI 会直接报错（`pi` 实测如此）—— 所以它只能是行里的一串字面量。
    pub add_argv: &'static [&'static str],
    /// 用户配置目录（**家目录相对路径**；重定向 env 的默认值就是它）。
    ///
    /// 隔离目录里要镜像的源。用家目录相对路径而不是绝对路径：数据表是 `static`，
    /// 而家目录是宿主环境事实，只能在执行期拼。
    pub home_subdir: &'static str,
    /// 从用户配置目录镜像到隔离目录的条目（缺失即跳过，**用符号链接而不是复制**，
    /// 因此凭据不会多出一份拷贝；Windows 未开开发者模式时的退化见
    /// `crate::app::team_executor` 的镜像文档）。
    ///
    /// # 只镜像**只读**的条目（实测教训）
    ///
    /// 该 CLI 会**写**的东西一律不列：会话（`sessions/`）、它会自己安装的依赖（`npm/`）、
    /// 下载的二进制（`bin/`）、模型缓存（`models-store.json`）、以及它要写的 MCP 配置本身
    /// （`mcp_file`）。符号链接会把写入透传给用户自己的目录 —— 那正是本档要避免的事。
    /// 两条附带后果，都是可接受的：
    /// - 成员首次启动会自建这些状态（`pi` 实测会在隔离目录里跑一次 `npm install`，约 10s）；
    /// - 会话历史因此天然与用户自己的历史分开（design §7.3 的同一判据）。
    pub mirror: &'static [&'static str],
}

impl AgentAdmission {
    /// 是否有可用的 MCP 面（注入方式与传输**两者都在**才算）。
    ///
    /// 两个条件缺一不可：知道怎么注入但没有传输 = 配置写出去了但客户端连不上；
    /// 有传输但不会注入 = 客户端根本不知道有这个 server。任一种都是「发不进去」。
    ///
    /// 这里 `matches!(…is_implemented())` 就是「有**已实现**的传输」—— [`McpTransport`] 的
    /// 变体集合被限定在本仓真正落地的传输上（红线 14：声明即实现）。将来补 stdio bridge 时
    /// 若忘了在同一个 diff 里开闸（`is_implemented`），这里会继续把「配了但发不进去」当成
    /// 没 MCP 面 —— 失败方向是「不声明能力」，而不是「声明了却用不了」。
    #[must_use]
    pub fn has_mcp(&self) -> bool {
        self.mcp_injection != McpInjection::None
            && matches!(self.transport, Some(transport) if transport.is_implemented())
    }

    // 「怎么给它**发**消息」**不在这里**：它不是 per-CLI 事实。CLI 成员的进程就在 PTY 里，
    // 通道一律 `WorkerChannel::CLI_MEMBER`（见该常量的文档）；按「有 MCP 面 ⇒ Mcp」推导
    // 会得到一条不存在的通道（MCP over HTTP 没有 server→client 推送）。
    // 这里保留的 `result_channel` 才是 per-CLI 的：它由「有没有 hook」决定。

    /// 它怎么**报**结果（design §4.4 的 `result_channel`）。
    ///
    /// 只由 **hooks** 决定：有 hook 走 MCP 工具调用（`task_update`）；没有 hook
    /// 就只能读它打到 stdout 的 sentinel 行。
    #[must_use]
    pub fn result_channel(&self) -> ResultChannel {
        if self.hooks && self.has_mcp() {
            ResultChannel::Mcp
        } else {
            ResultChannel::Sentinel
        }
    }

    /// 执行层**今天能不能真的把它起起来**：`None` = 能，`Some(理由)` = 不能。
    ///
    /// # 为什么要有这一条
    ///
    /// 五条拒绝（无 MCP 面 / 模板缺失 / 注入档会写用户全局配置 / 写配置文件的档未实现 /
    /// 数据自相矛盾）都属于「起得来但用不了」。放在**建成员之前**判，队长拿到的是一条
    /// 可读理由；放到执行层再判，成员已经落库 —— 花名册里多出一个永远不动的名字，而队长
    /// 以为它已开工（`implement.md` C5）。
    ///
    /// # 今天能起的两档
    ///
    /// [`McpInjection::Argv`]（本次启动的参数，零落盘）与 [`McpInjection::ConfigDir`]
    /// （写进 Neeko 自己的隔离目录，用户配置零写入）。其余两档拒绝的理由不是「不会写」
    /// 而是「不该写」：它们改的是**用户手改的那份配置**，需要备份 / 幂等 / 拆除三件套。
    ///
    /// # 判据的单一来源
    ///
    /// `mcp::dispatch::spawn`（早拒）与 `execution::plan_member_spawn`（执行前再确认）
    /// 都问这里。两处各写一遍的后果不是重复，而是**漂移**：早拒放行了、执行层才拒绝，
    /// 表现就是上面那种「落库但永不启动」。
    #[must_use]
    pub fn launch_refusal(&self) -> Option<String> {
        if !self.has_mcp() {
            return Some(no_surface_message(self.agent_id));
        }
        match self.mcp_injection {
            // 启动参数注入：本次启动就生效、零落盘（`{{token_env}}` 那一族的凭证走
            // `credentials_env`，见 `execution::SpawnPlan`）。
            McpInjection::Argv if !self.mcp_argv.is_empty() => None,
            McpInjection::Argv => Some(format!(
                "agent `{}` is marked as launch-argument injection but carries no `mcp_argv` \
                 template in the admission table; refusing instead of starting a member whose \
                 tool surface would be silently missing",
                self.agent_id
            )),
            // 隔离配置目录：写的是 Neeko 自己的目录，用户配置零写入。
            McpInjection::ConfigDir => match self.config_dir {
                Some(spec) if !spec.add_argv.is_empty() => None,
                // 声明了档却没给命令 = 数据自相矛盾。失败方向必须是「不声明能力」。
                _ => Some(format!(
                    "agent `{}` is marked as config-directory injection but the admission table \
                     carries no `mcp add` command for it, so the isolated directory would stay \
                     empty and the member would start without a tool surface",
                    self.agent_id
                )),
            },
            // 写**用户全局**配置：v1 不做 —— 它需要备份 / 幂等 / 拆除三件套，
            // 而现在一件都没有（implement.md C3）。
            McpInjection::Subcommand => Some(format!(
                "agent `{}` injects MCP via {:?}, which writes the user's own global config file \
                 (`<cli> mcp add`); v1 refuses that because it mutates configuration the user edits \
                 by hand. Only launch-argument injection ({:?}) and isolated config-directory \
                 injection ({:?}) are implemented",
                self.agent_id,
                McpInjection::Subcommand,
                McpInjection::Argv,
                McpInjection::ConfigDir
            )),
            // 直接改配置文件：同样需要备份 / 幂等 / 拆除，且各家格式不一。
            McpInjection::ConfigFile => Some(format!(
                "agent `{}` injects MCP via {:?}, which the executor does not implement yet: \
                 writing a CLI's config file needs backup / idempotency / teardown, and v1 has \
                 none of them",
                self.agent_id, self.mcp_injection
            )),
            // `has_mcp()` 已在上面把 `None` 拦下；保留这条是为了让 match 穷尽且不撒谎。
            McpInjection::None => Some(no_surface_message(self.agent_id)),
        }
    }

    /// `approval_policy = Bypass` 时要追加的启动参数（其余策略一律空）。
    ///
    /// # 为何归 admission 而不是 dispatch / 执行层
    ///
    /// 三件输入全部是数据：本行的 `bypass_args`（per-CLI，红线 15）+ 策略是否 `Bypass`。
    /// 把这条规则放在数据旁边，执行层（2.5b 的启动参数装配）只需
    /// `admission_for(member.agent_id).bypass_args(member.approval_policy)` —— 输入
    /// 全是已落库的成员行字段，不需要任何额外的传递通道。
    ///
    /// 空列表 = 该 CLI 没有已实测的旁路开关（`reasonix`）。这里**不**自造一个猜测的开关：
    /// 「看起来旁路了」比「没旁路」危险得多（队长会以为不再需要守着审批）—— 该行的
    /// `unverified` 已把「能力未核实」随工具返回交给队长。
    #[must_use]
    pub fn bypass_args(&self, policy: ApprovalPolicy) -> Vec<String> {
        if policy != ApprovalPolicy::Bypass {
            return Vec::new();
        }
        self.bypass_args
            .iter()
            .map(|arg| (*arg).to_owned())
            .collect()
    }

    /// 它能不能**当队长**：`None` = 能，`Some(理由)` = 不能。
    ///
    /// # 为什么不是第二个独立判据
    ///
    /// 队长的前置条件比成员多**一条**：它必须在启动时就知道自己是队长（`prompt_argv` 非空）。
    /// 所以这里 **先问 [`Self::launch_refusal`]**（同一个函数，不是同一段逻辑的副本），
    /// 再补那一条。两份判据各写一遍的后果不是重复，而是漂移：面板 / `team_spawn` 说能起，
    /// `start_team_session` 却拒，两条路径的回答从此不一致。
    ///
    /// # 为什么空 `prompt_argv` 必须是拒绝
    ///
    /// 队长的第一个动作（`team_status` / `task_create`）**没有人能替它触发**：它起来后
    /// 不会收到任何刺激，于是永远停在一个空白会话里。而成员可以靠 `team_send` 的第一条
    /// 消息开始工作 —— 这就是两个角色不对称的全部理由。
    #[must_use]
    pub fn lead_refusal(&self) -> Option<String> {
        if let Some(why) = self.launch_refusal() {
            return Some(why);
        }
        if self.prompt_argv.is_empty() {
            return Some(format!(
                "agent `{}` carries no `prompt_argv` template in the admission table, so it cannot \
                 receive the role preamble; leading a team that way would start a session that \
                 never learns it is a lead (it would sit there doing nothing, which looks exactly \
                 like a working team)",
                self.agent_id
            ));
        }
        None
    }
}

/// 「没有 MCP 面」的**唯一**文案（`has_mcp()` 与 `launch_refusal()` 两条路径共用）。
///
/// 两处各写一句的后果不是重复：面板（`team_launchable_agents`）看到的理由会与
/// `team_spawn` 拒绝的理由长得不一样，用户会以为遇到两个不同的故障。
fn no_surface_message(agent_id: &str) -> String {
    format!(
        "agent `{agent_id}` has no MCP surface, so a spawned member could never receive a task \
         (channel = none); refusing to create a member that can only sit in the roster"
    )
}

// ─────────────────────── 模板渲染（纯函数，无 I/O） ──────────────

/// 一次渲染需要的值 —— 全部由调用方（`execution::plan_member_spawn`）组装。
///
/// 这些值必须是**已算好的字符串**而不是源数据：把 `serde_json` 拼装搬到这里会让
/// 「模板渲染」认识 MCP 配置的形状，而那是执行层的事（同一依赖方向也避免 admission → execution）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RenderContext {
    /// 完整 MCP 配置 JSON（`{{mcp_config}}` 的替换值）。
    pub mcp_config: String,
    /// 团队 MCP 端点 URL。
    pub url: String,
    /// 成员凭证**明文**。
    pub token: String,
    /// 凭证 env 的名字 —— **恒为 [`TEAM_TOKEN_ENV`]**（构造时填，不给调用方改的机会）。
    pub token_env: String,
    /// 角色 preamble 全文（`{{preamble}}` 的替换值）。
    ///
    /// `None` = 这次渲染没有角色上下文。它**不是**空字符串的别名：模板引用了
    /// `{{preamble}}` 而这里是 `None` 时，渲染必须报错 —— 否则 CLI 会带着一条空的系统
    /// 提示启动（那个故障与「根本没有 preamble」无法区分）。
    pub preamble: Option<String>,
}

impl RenderContext {
    /// 用四份输入 + 常量 [`TEAM_TOKEN_ENV`] 构造。
    ///
    /// `token_env` 没有参数位：它不是一个自由值，而是“本仓凭证 env 的名字”这件事本身。
    /// `preamble` 是 `Option<&str>` 而不是默认空串：调用方必须**显式**回答“这次有没有角色
    /// 上下文”，而“忘了传”在渲染时会变成一条错误，而不是一个空参数。
    #[must_use]
    pub fn new(mcp_config: String, url: &str, token: &str, preamble: Option<&str>) -> Self {
        Self {
            mcp_config,
            url: url.to_owned(),
            token: token.to_owned(),
            token_env: TEAM_TOKEN_ENV.to_owned(),
            preamble: preamble.map(str::to_owned),
        }
    }

    /// 占位符名 → 它的值。**未知名字返回 `None`**（调用方据此报错，而不是留字面量）。
    fn value(&self, name: &str) -> Option<&str> {
        match name {
            "mcp_config" => Some(&self.mcp_config),
            "url" => Some(&self.url),
            "token" => Some(&self.token),
            "token_env" => Some(&self.token_env),
            "preamble" => self.preamble.as_deref(),
            _ => None,
        }
    }
}

/// 把一份 argv 模板渲染成真实参数表。
///
/// # 行为（三条都是判据）
///
/// 1. 占位符可以**嵌在更长的参数里**：`--header x-neeko-team-token={{token}}` 是 pi 的
///    实测写法，只做“整元素等于占位符”的替换会让它把 `{{token}}` 原样发给 CLI。
/// 2. **未知占位符 = 错误**，不是原样保留：`--url {{uurl}}` 若无提示地发出去，成员会带着
///    一个拼错的 URL 启动 —— “起得来、连不上”是最难查的失败形态（红线 14 的同一理由）。
/// 3. 没有 `{{` 的参数原样输出（模板里大多数参数就是字面量）。
///
/// 错误类型是 `Unsupported`：模板来自静态数据表，走到这里说明数据本身不自洽 ——
/// 宁可拒启动，不可静默降级。
pub fn render_argv(template: &[&str], ctx: &RenderContext) -> Result<Vec<String>, AppError> {
    template.iter().map(|arg| render_arg(arg, ctx)).collect()
}

/// 渲染**单个**参数（[`render_argv`] 的元素级实现）。
fn render_arg(arg: &str, ctx: &RenderContext) -> Result<String, AppError> {
    let mut out = String::with_capacity(arg.len());
    let mut rest = arg;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        // 没有配对的 `}}` ⇒ 名字就是后面剩下的全部（错误信息里能看见拼错的那段）。
        let end = after.find("}}").unwrap_or(after.len());
        let name = &after[..end];
        let value = ctx
            .value(name)
            .ok_or_else(|| missing_placeholder(name, ctx))?;
        out.push_str(value);
        rest = if end < after.len() {
            &after[end + 2..]
        } else {
            ""
        };
    }
    out.push_str(rest);
    Ok(out)
}

/// 占位符拿不到值时的**唯一**错误出口。
///
/// 两条拆开是因为它们的修法不同：
/// - `{{preamble}}` 是**已知**占位符，缺的是这次调用没给角色上下文（执行层忘了传）；
/// - 其余名字是模板写错了（拼错），只能在数据行里改。
///
/// 两者都**不**允许静默降级：前者会把 `--append-system-prompt ""` 发给 CLI（一个不知道自己
/// 是队长的队长），后者会把 `{{token}}` 当参数发出去。
fn missing_placeholder(name: &str, ctx: &RenderContext) -> AppError {
    if name == "preamble" && ctx.preamble.is_none() {
        return AppError::Unsupported(
            "an argv template asks for `{{preamble}}` but this render carries no role preamble; \
             refusing instead of handing the CLI an empty system prompt (a member that never \
             learns what it is looks exactly like a team that is not doing anything)"
                .to_string(),
        );
    }
    unknown_placeholder(name)
}

/// 未知占位符的错误文报。
fn unknown_placeholder(name: &str) -> AppError {
    AppError::Unsupported(format!(
        "an MCP argv template references the placeholder `{name}`, which no renderer knows; \
         refusing instead of passing the literal text to the CLI (a literal placeholder on a \
         command line is a silent misconfiguration), known placeholders are: \
         mcp_config, url, token, token_env, preamble"
    ))
}

/// 这份模板是否需要**凭证 env**（即它引用了 `{{token_env}}`）。
///
/// # 为何判断在模板上而不是在 CLI 上
///
/// `bearer_token_env_var` 那一族只收 env **名字**，值必须从子进程环境里读 —— 而要不要
/// 注入那份 env，完全由「模板里有没有 `{{token_env}}`」决定。挂在模板上就不需要
/// 按 agent id 的等值分支（红线 15），且新增一家 CLI 只需加一行数据。
#[must_use]
pub fn needs_credentials_env(template: &[&str]) -> bool {
    template
        .iter()
        .any(|arg| arg.contains(TOKEN_ENV_PLACEHOLDER))
}

// ───────────────────── 能力面（面板置灰的数据面） ─────────────────

/// 一个可选 agent 的**启动可行性**：面板据此置灰并显示原因（prd R0.4）。
///
/// # 为何要把它做成数据而不是让 UI 自己拼
///
/// “能不能启动”是三个输入的函数（技能面 / 注入档 / 凭证路），其中两个今天还在变。
/// 让 UI 拼一遍，就多一个会漂移的阀值 —— 而它漂移的表现是「用户点到必然失败的按钮」
/// 或「明明能跑的成员被置灰」。两侧读同一份纯函数就不会。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchableAgent {
    /// `AgentConfig.id`。
    pub agent_id: String,
    /// `None` = 现在能拉起成员；`Some(理由)` = 置灰理由（可读，面向人）。
    pub refusal: Option<String>,
}

/// 准入表里全部 agent id（**域内可用的纯函数入口**，不读 `AgentManager`）。
///
/// # 为何需要它
///
/// [`launchable_agents`] 输入是一份 id 清单，而域里有两类调用方拿不到那份清单：
/// - 执行层（`execution::plan_member_spawn`）要在**域内部**渲染队长 preamble；
/// - 它不认识 `AgentManager`（那是组合根的东西），也不应该认识。
///
/// 所以“本域知道的 CLI”就取自本文件的数据表本身 —— 仍是**一个**真相源（红线 15）。
/// 用户自定义 CLI 不在表里（它们没有准入事实，`launchable_agents` 会逐个说清理由），
/// 因此这份清单不会漏掉任何**能起**的 CLI。
#[must_use]
pub fn admitted_agent_ids() -> Vec<String> {
    ADMISSIONS
        .iter()
        .map(|row| row.agent_id.to_owned())
        .collect()
}

/// 把一份 agent id 清单映射成能力面。**纯函数**，不读库、不读表以外的任何东西。
///
/// 输入由命令层给（`AgentManager::get_agents` — 含用户自定义 CLI，它们才是“不在准入表
/// 里”那一类的主体）。输出按 `agent_id` 排序并去重：面板按这个顺序渲染，不排序会让
/// 每次打开面板的顺序都有可能不同。
#[must_use]
pub fn launchable_agents(agent_ids: &[String], role: MemberRole) -> Vec<LaunchableAgent> {
    let mut ids: Vec<&str> = agent_ids.iter().map(String::as_str).collect();
    ids.sort_unstable();
    ids.dedup();
    ids.into_iter()
        .map(|agent_id| launchable_agent(agent_id, role))
        .collect()
}

/// 角色 → 该问哪一条判据（**选路**，不是重写判据）。
///
/// 队长比成员多一条前置：它必须在启动时就收到角色 preamble（`prompt_argv` 非空），
/// 因为队长的第一个动作没有人能替它触发。两条判据本身都在 [`AgentAdmission`] 上
/// （[`AgentAdmission::lead_refusal`] 复用 [`AgentAdmission::launch_refusal`]），
/// 所以这里只有 `match`，没有一句复制的逻辑。
///
/// 为什么放在准入域而不是执行层：**问「谁能当 X」是准入问题**，执行层只是另一个提问者。
/// 把它留在执行层，面板就只能问成员那一半（`team_launchable_agents` 曾因此回答错问题）。
#[must_use]
pub fn refusal_for(role: MemberRole, agent_id: &str) -> Option<String> {
    match (role, admission_for(agent_id)) {
        (MemberRole::Lead, Some(admission)) => admission.lead_refusal(),
        (MemberRole::Worker, Some(admission)) => admission.launch_refusal(),
        // 不在准入表里（`dsh` / 用户自定义 CLI）对**两种角色**都不是「可启动」：
        // `launch_refusal_for` 的拒绝文案已经说清缺的是哪个事实，直接复用 ——
        // 这里若返回 `None`，面板会把一个永远起不来的 CLI 显示成可用。
        _ => launch_refusal_for(agent_id),
    }
}

/// 单个 agent 的能力面：**准入表是唯一判据**（不在表里 = 也说清楚）。
fn launchable_agent(agent_id: &str, role: MemberRole) -> LaunchableAgent {
    LaunchableAgent {
        agent_id: agent_id.to_owned(),
        refusal: refusal_for(role, agent_id),
    }
}

/// 单个 id 的「能不能当成员」理由：`None` = 能，`Some(理由)` = 不能（可读，面向人）。
///
/// # 为何要把这个三行函数抽出来
///
/// 「不在准入表」与「在表里但起不来」是**两条不同的事实**，但调用方要的是同一个答案
/// （「能还是不能，为什么」）。三处需要它：面板（`team_launchable_agents`）、团队配置的
/// 构造期校验（`bootstrap::validate_config` 的池子校验）、以及 `TeamOptions.members`。
/// 各写一份的话，面板与配置校验会用两句不同的话描述同一个 CLI —— 用户以为遇到两个故障。
#[must_use]
pub fn launch_refusal_for(agent_id: &str) -> Option<String> {
    admission_for(agent_id)
        .map(|admission| admission.launch_refusal())
        // 不在准入表里（`dsh` / 用户自定义 CLI）：不说“不支持”而说清楚缺的是哪个事实，
        // 否则用户会以为再试一次就会好。
        .unwrap_or_else(|| {
            Some(format!(
                "agent `{agent_id}` is not in the team admission table, so Neeko does not know how \
                 to give it the team tool surface; admitted agent ids: {}",
                ADMISSIONS
                    .iter()
                    .map(|row| row.agent_id)
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })
}

/// MCP 传输形态（矩阵第 ③ 列）。
///
/// # 变体集合 = **本仓已实现的传输集合**（红线 14）
///
/// 这里的每一行都意味着「Neeko 有办法把 MCP 流量送进去」。所以 stdio 不在列：
/// `neeko-team-mcp.mjs` 的 bridge 尚未落地，加一个 `Stdio` 变体只会让
/// `AgentAdmission::has_mcp()` 把一条其实用不起来的配置宣传成「有工具面」。
/// 补 bridge 时同 diff 补变体，并在这里删掉这段说明。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum McpTransport {
    /// streamable HTTP（Neeko 的 axum 服务端直接当 endpoint）。
    Http,
}

impl McpTransport {
    /// 该传输的**实现**是否已在仓里（今天只有 [`McpTransport::Http`]）。
    ///
    /// 存在理由：将来引入 stdio 时，`has_mcp()` 不必改，只需要在 bridge 落地的同一个
    /// diff 里让这里返回 `true` —— 判据只有一个落点。
    #[must_use]
    pub const fn is_implemented(self) -> bool {
        matches!(self, McpTransport::Http)
    }
}

/// 准入事实表 —— **恰好 10 行**，与 `research/admission-matrix.md` 逐行一致。
///
/// 排序只按 id 字典序（让 diff 可读）；**没有任何逻辑依赖顺序**。
/// `dsh` 与 `mockAgent` 不在表内：前者 hook-only 且无 `AgentConfig`、后者是进程内
/// mock，二者都起不了 CLI 进程 —— 见 [`NOT_SPAWNABLE`]。
///
/// 每行的 `unverified` 就是矩阵里 B 级证据（配置已装、未跑一轮）与未实测项的原话，
/// **不要美化或删减**：它是队长判断「这条能力我能信多少」的唯一来源。
pub static ADMISSIONS: &[AgentAdmission] = &[
    // ① `claude --help`：`--mcp-config <file|string>` + `-H header`（实际有 stdio，只列 HTTP）；
    //    ② `~/.claude/settings.json` 有 `Stop` hook（B 级：已装未跑）；
    //    ③ preamble：`--append-system-prompt <prompt>`（实测见该行 unverified 那条的来源）。
    AgentAdmission {
        agent_id: "claude-code",
        hooks: true,
        mcp_injection: McpInjection::Argv,
        transport: Some(McpTransport::Http),
        bypass_args: &["--dangerously-skip-permissions"],
        // 本行原来是唯一一条 `unverified: &[]`（能力全实测）—— 现在多一条：preamble 这条路
        // 只验到参数解析（见 `PREAMBLE_UNVERIFIED`）。
        unverified: &[PREAMBLE_UNVERIFIED],
        mcp_argv: &["--mcp-config", MCP_CONFIG_PLACEHOLDER],
        config_dir: None,
        pty_submit: PtySubmit::Plain,
        prompt_argv: &["--append-system-prompt", PREAMBLE_PLACEHOLDER],
    },
    // ① `--mcp-config <fileOrString>`；② `Stop` / `PermissionRequest` / `StopFailure` 已装。
    //    传输「由 `--mcp-config` 的 JSON 决定」⇒ 未实测确认，见 unverified。
    AgentAdmission {
        agent_id: "codebuddy",
        hooks: true,
        mcp_injection: McpInjection::Argv,
        transport: Some(McpTransport::Http),
        bypass_args: &["-y", "--dangerously-skip-permissions"],
        unverified: &[
            "MCP transport is decided by the `--mcp-config` payload and was never probed on this machine",
            PREAMBLE_UNVERIFIED,
        ],
        mcp_argv: &["--mcp-config", MCP_CONFIG_PLACEHOLDER],
        config_dir: None,
        pty_submit: PtySubmit::Plain,
        prompt_argv: &["--append-system-prompt", PREAMBLE_PLACEHOLDER],
    },
    // ① `codex mcp add` → `config.toml [mcp_servers]`，但 `-c key=value` 可在**本次启动**
    //    覆盖而不碰文件（实测：`codex -c mcp_servers.neeko.url=… -c … mcp list` 看得到，
    //    `config.toml` 未被修改）；② `Stop` + `notify agent-turn-complete` 已装；
    //    传输 streamable HTTP；③ 鉴权用 `bearer_token_env_var`（`mcp list` 里显示
    //    `Bearer token`），而 `codex mcp add` **没有** header 选项。
    AgentAdmission {
        agent_id: "codex",
        hooks: true,
        mcp_injection: McpInjection::Argv,
        transport: Some(McpTransport::Http),
        bypass_args: &["--dangerously-bypass-approvals-and-sandbox"],
        unverified: &[
            "codex's header form (`http_headers`) parses but was never proven to be sent, so only the \
             verified `bearer_token_env_var` route is wired",
            "the complete approval-bypass switch set was not re-verified (only `--approve-for-me` was observed)",
            PREAMBLE_UNVERIFIED,
        ],
        mcp_argv: &[
            "-c",
            "mcp_servers.neeko-team.url=\"{{url}}\"",
            "-c",
            "mcp_servers.neeko-team.bearer_token_env_var=\"{{token_env}}\"",
        ],
        config_dir: None,
        // 裸正文 + `\r` 会被 codex 的 paste-burst 吞成「粘贴里的换行」（见 `PtySubmit` 的文档）。
        pty_submit: PtySubmit::BracketedPaste,
        // codex 的系统提示只能从**位置参数** `[PROMPT]` 进去（它没有 `--append-system-prompt`）：
        // 实测 `codex --model definitely-not-a-model <probe>` 会走过 argv 解析而停在 TUI 启动，
        // 而两个位置参数会直接报 `unexpected argument`。
        prompt_argv: &[PREAMBLE_PLACEHOLDER],
    },
    // 未安装、无任何实测 ⇒ 只能按「有配置文件注入面」推断。C 档。
    AgentAdmission {
        agent_id: "gemini",
        hooks: false,
        mcp_injection: McpInjection::ConfigFile,
        transport: Some(McpTransport::Http),
        bypass_args: &["--skip-trust", "--approval-mode", "yolo"],
        unverified: &[
            "not installed on this machine and never probed: hooks, transport and bypass args are all inferred",
        ],
        mcp_argv: &[],
        config_dir: None,
        pty_submit: PtySubmit::Plain,
        // 未安装 ⇒ 无法实测任何 argv 形态 ⇒ 空模板（**不能当队长**，也不会被误当成能当）。
        prompt_argv: &[],
    },
    // ① `grok mcp add --transport http|stdio|sse` + `-H`；② Neeko 无 grok hook 目标。C 档。
    AgentAdmission {
        agent_id: "grok",
        hooks: false,
        mcp_injection: McpInjection::Subcommand,
        transport: Some(McpTransport::Http),
        bypass_args: &["--always-approve"],
        unverified: &[
            "Neeko has no grok hook target, so completion signals are invisible (tier C) even though the MCP surface works",
        ],
        mcp_argv: &[],
        config_dir: None,
        pty_submit: PtySubmit::Plain,
        // 未实测：这一档连成员都做不了（`Subcommand` 写用户全局配置，v1 拒绝），preamble 无从验。
        // 空模板 = 不能当队长 —— 与本行「连成员也做不了」同一个方向。
        prompt_argv: &[],
    },
    // ① 无 `mcp` 子命令、`config.yml` 无 mcp 键 ⇒ 无 MCP 表面；② `agent_end` 已装。B 档。
    AgentAdmission {
        agent_id: "omp",
        hooks: true,
        mcp_injection: McpInjection::None,
        transport: None,
        bypass_args: &["--auto-approve"],
        unverified: &[
            "no MCP surface at all: results can only be recovered from the sentinel channel (tier B)",
        ],
        mcp_argv: &[],
        config_dir: None,
        pty_submit: PtySubmit::Plain,
        // 未实测：本行连工具面都没有（成员都做不了），没有理由去验一个用不上的启动参数。
        prompt_argv: &[],
    },
    // ① `opencode mcp add --url` + `--header`；② 插件 v2 模板存在但 `plugin: []` ⇒ **未安装**。
    AgentAdmission {
        agent_id: "opencode",
        hooks: true,
        mcp_injection: McpInjection::Subcommand,
        transport: Some(McpTransport::Http),
        bypass_args: &["--auto"],
        unverified: &[
            "the Neeko plugin is not installed in this user's opencode config, so turn hooks will not fire yet",
            "`opencode mcp add` writes the user's own config (`--global` or the project's), which v1 refuses",
            PREAMBLE_UNVERIFIED,
        ],
        mcp_argv: &[],
        config_dir: None,
        pty_submit: PtySubmit::Plain,
        // `--prompt <string>`（实测 `opencode --prompt <probe>` 把那段文字摆在 TUI 的输入框里），
        // 但本行今天不能当成员（`Subcommand` 档 v1 拒绝）—— 数据留着，等到它解除拒绝时
        // 不必重新实测。
        prompt_argv: &["--prompt", PREAMBLE_PLACEHOLDER],
    },
    // ① `pi mcp add --url <u> --header KEY=VALUE` → 写 `mcp.json`，且 `PI_CODING_AGENT_DIR`
    //    能把整个配置目录重定向到隔离目录（实测：隔离目录里出现 `mcp.json`、用户全局
    //    `mcp.json` 未被创建、symlink 的 `auth.json` 让 `pi -p` 仍能登录）；
    //    ② `agent_end` extension 已装。
    //
    // 三个实测出来的坑写在这行数据里（不是机制里）：
    // ① header 语法是 `KEY=VALUE`（`KEY: VALUE` 直接报错）；
    // ② symlink 必须在**首次运行之前**建好（pi 会自己创建空 `auth.json` 占位）；
    // ③ 镜像分两类（实测代价驱动的取舍）：
    //    · **用户资产**（`auth.json` / `models.json` / `settings.json` / `trust.json` /
    //      `extensions` / `skills` / `themes`）—— 必须镜像，否则成员是「未登录、无扩展」的裸进程；
    //    · **运行时缓存**（`npm` / `bin` / `models-store.json`）—— 也镜像：不镜像时 pi 会在隔离
    //      目录里现场跑一次 `npm install`（实测 ~10s **且需要网络**，离线时直接起不来）。
    //      代价是成员的写入会透传回用户缓存目录 —— 那正是用户自己跑 pi 时发生的事，且它是缓存
    //      （损坏即重建），不是用户编写的配置。
    //    · **绝不镜像**：`sessions/`（团队成员会话与用户历史分开）、`mcp.json`（我们自己写的）、
    //      `mcp-auth.json`（每成员 OAuth 态）。
    AgentAdmission {
        agent_id: "pi",
        hooks: true,
        mcp_injection: McpInjection::ConfigDir,
        transport: Some(McpTransport::Http),
        bypass_args: &["--approve"],
        unverified: &[
            "`--approve` semantics were never verified: it trusts the project files, it may not waive every prompt",
            PREAMBLE_UNVERIFIED,
        ],
        mcp_argv: &[],
        config_dir: Some(ConfigDirSpec {
            env: "PI_CODING_AGENT_DIR",
            mcp_file: "mcp.json",
            add_argv: &[
                "mcp",
                "add",
                "neeko-team",
                "--url",
                MCP_URL_PLACEHOLDER,
                "--header",
                "x-neeko-team-token={{token}}",
            ],
            home_subdir: ".pi/agent",
            mirror: &[
                "auth.json",
                "models.json",
                "settings.json",
                "trust.json",
                "extensions",
                "skills",
                "themes",
                // 运行时缓存：不镜像 = 每成员第一次启动付一次 `npm install` + 网络
                "npm",
                "bin",
                "models-store.json",
            ],
        }),
        pty_submit: PtySubmit::Plain,
        // 实测：`pi --append-system-prompt <probe> --model definitely-not-a-model -p …` 停在
        // `Model "…" not found`（即 argv 已被完整解析），而未知开关会得到 `Unknown option`。
        prompt_argv: &["--append-system-prompt", PREAMBLE_PLACEHOLDER],
    },
    // ① `--mcp-config` + `--strict-mcp-config` + `--allowed-mcp-server-names`；
    //    ② `Stop` / `PermissionRequest` / `StopFailure` 已装。传输同 codebuddy，未实测。
    AgentAdmission {
        agent_id: "qoder",
        hooks: true,
        mcp_injection: McpInjection::Argv,
        transport: Some(McpTransport::Http),
        bypass_args: &["--dangerously-skip-permissions"],
        unverified: &[
            "MCP transport is decided by the `--mcp-config` payload and was never probed on this machine",
            PREAMBLE_UNVERIFIED,
        ],
        mcp_argv: &["--mcp-config", MCP_CONFIG_PLACEHOLDER, "--strict-mcp-config"],
        config_dir: None,
        pty_submit: PtySubmit::Plain,
        prompt_argv: &["--append-system-prompt", PREAMBLE_PLACEHOLDER],
    },
    // ① 无 mcp 子命令实测；② Neeko 无 reasonix hook 目标 ⇒ 三档里最小的一种。C 档。
    AgentAdmission {
        agent_id: "reasonix",
        hooks: false,
        mcp_injection: McpInjection::ConfigFile,
        transport: None,
        bypass_args: &[],
        unverified: &[
            "Neeko has no reasonix hook target and no MCP transport was verified, so nothing can be injected or reported",
        ],
        mcp_argv: &[],
        config_dir: None,
        pty_submit: PtySubmit::Plain,
        // 未实测（本行连成员都做不了）：空模板 = 不能当队长，失败方向与其余各列一致。
        prompt_argv: &[],
    },
];

/// 已知但**不可**作为团队的进程成员（[`refusal`] 会点名它们，防止队长反复重试）。
struct NotSpawnable {
    /// `AgentConfig.id`（或不可 spawn 的已知 id）。
    agent_id: &'static str,
    /// 可读理由（会原样进 `NotFound` 的错误信息）。
    reason: &'static str,
}

/// 「这些 id 真的存在，但起不了进程」的两条事实。
static NOT_SPAWNABLE: &[NotSpawnable] = &[
    NotSpawnable {
        agent_id: "dsh",
        // hook-only：它自己往 `/hook/dsh` 上报回合，本仓没有它的 `AgentConfig`。
        //
        // 文案是**英文**：这条字符串经 `NotFound` 进 `tools/call` 的 `content`，是写给
        // 队长模型读的纠正提示。同一句里混两种语言会降低它照抄/自纠的准确率。
        reason: "hook-only CLI that reports its own turns but has no `AgentConfig` in this repo, \
                 so `team_spawn` cannot launch a process for it",
    },
    NotSpawnable {
        agent_id: "mockAgent",
        // 进程内 mock（`ChatLaunch { inprocess: true }`）—— 没有 CLI 进程可注入。
        reason:
            "in-process mock agent (chat only, `ChatLaunch { inprocess: true }`), not a CLI process",
    },
];

/// 把「查表」与「比较」隔开，理由见 `per_cli_facts_live_only_in_the_table`。
///
/// 这是一条**查表原语**，不是按 CLI 名分支：它对表里每一行一视同仁，调用方拿到的
/// 是行本身而不是「命中某个特例后执行的专用逻辑」。
fn same_id(left: &str, right: &str) -> bool {
    left == right
}

/// 按 `AgentConfig.id` 查准入事实；不可作成员（含未知 id）一律 `None`。
#[must_use]
pub fn admission_for(agent_id: &str) -> Option<&'static AgentAdmission> {
    ADMISSIONS
        .iter()
        .find(|row| same_id(row.agent_id, agent_id))
}

/// 成员那台 CLI 的**提交形态**（投递协议的第一个事实）。
///
/// 内部复用 [`admission_for`]：查表与 id 归一化（`same_id`）只有那一处，另写一遍查表
/// 就会让「哪些 id 算同一台 CLI」有两个答案（而 `per_cli_facts_live_only_in_the_table`
/// 会把它当成第二条事实源）。未登记的 id → [`PtySubmit::Plain`]：未登记的不可能是成员，
/// 而 `Plain` 与改动前逐字节相同 —— 失败方向是「不变」。
#[must_use]
pub fn pty_submit_for(agent_id: &str) -> PtySubmit {
    admission_for(agent_id).map_or(PtySubmit::Plain, |row| row.pty_submit)
}

/// 由 `(hooks, mcp)` 推导准入档位。**纯函数**（design §4.4 的三档）。
///
/// - `hooks == false` ⇒ C：完成信号只能靠 sentinel 打印，**卡住永远不可知**；
/// - `hooks == true` 且有 MCP 面 ⇒ A；
/// - `hooks == true` 但无 MCP 面 ⇒ B（结果多一跳，可信度不降）。
#[must_use]
pub fn tier_of(admission: &AgentAdmission) -> AdmissionTier {
    match (admission.hooks, admission.has_mcp()) {
        (false, _) => AdmissionTier::C,
        (true, true) => AdmissionTier::A,
        (true, false) => AdmissionTier::B,
    }
}

/// 不可作为成员时给出**可读**理由（列出已知 agent id）。
///
/// 写给**队长模型**看的：它拿到这条错误要能自己纠正（换一个 id 重试），
/// 所以必须同时给出「能用的 id 有哪些」与「某些 id 为什么不能用」。
#[must_use]
pub fn refusal(agent_id: &str) -> String {
    let spawnable = ADMISSIONS
        .iter()
        .map(|row| row.agent_id)
        .collect::<Vec<_>>()
        .join(", ");
    let blocked = NOT_SPAWNABLE
        .iter()
        .map(|row| format!("{} ({})", row.agent_id, row.reason))
        .collect::<Vec<_>>()
        .join("; ");
    let head = match NOT_SPAWNABLE
        .iter()
        .find(|row| same_id(row.agent_id, agent_id))
    {
        // 已知但起不了进程：直接说清是哪一条事实拦住了它。
        Some(row) => format!(
            "`{agent_id}` is a known agent but cannot be a team member: {}",
            row.reason
        ),
        // 完全不认识：错误信息的价值全在后面的两张清单上。
        None => format!("`{agent_id}` is not a known agent id"),
    };
    format!("{head}; spawnable agent ids: {spawnable}; known but not spawnable: {blocked}")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 矩阵 10 行 → `tier_of` 结果（P0 实测产物，**逐行一条断言**）。
    ///
    /// 保护的不变量：档位**由数据推导**而不是被声明。任何一行漂移（例如给 `omp`
    /// 补上一个并不存在的 MCP 传输）都会让它从 B 变成 A，而 A 意味着「结果走 MCP
    /// 工具调用」—— 那是一条它根本发不出来的路径（红线 14）。
    #[test]
    fn tier_matches_the_admission_matrix_row_by_row() {
        let expected: [(&str, AdmissionTier); 10] = [
            ("claude-code", AdmissionTier::A),
            ("codebuddy", AdmissionTier::A),
            ("codex", AdmissionTier::A),
            ("gemini", AdmissionTier::C),
            ("grok", AdmissionTier::C),
            ("omp", AdmissionTier::B),
            ("opencode", AdmissionTier::A),
            ("pi", AdmissionTier::A),
            ("qoder", AdmissionTier::A),
            ("reasonix", AdmissionTier::C),
        ];
        assert_eq!(ADMISSIONS.len(), expected.len(), "准入表行数与矩阵不符");
        for (agent_id, tier) in expected {
            let admission =
                admission_for(agent_id).unwrap_or_else(|| panic!("{agent_id} 必须在准入表里"));
            assert_eq!(tier_of(admission), tier, "{agent_id} 的档位与矩阵不符");
        }
    }

    /// 矩阵一行的四列：`hooks` / 注入方式 / 传输 / 旁路参数。
    type MatrixRow = (
        &'static str,
        bool,
        McpInjection,
        Option<McpTransport>,
        &'static [&'static str],
    );

    /// 矩阵的其余四列（hooks / injection / transport / bypass_args）逐行对齐。
    ///
    /// 保护的不变量：`tier_of` 只吃 `hooks` + MCP 两列，所以档位测试**证明不了**
    /// 注入方式、传输与旁路参数是对的 —— 而这三列恰好是 `team_spawn` 真正要往下传
    /// 的东西（注入方式决定 2.5b 怎么配 MCP，旁路参数决定 Bypass 能不能生效）。
    #[test]
    fn admission_rows_match_the_p0_matrix_column_by_column() {
        let expected: [MatrixRow; 10] = [
            (
                "claude-code",
                true,
                McpInjection::Argv,
                Some(McpTransport::Http),
                &["--dangerously-skip-permissions"],
            ),
            (
                "codebuddy",
                true,
                McpInjection::Argv,
                Some(McpTransport::Http),
                &["-y", "--dangerously-skip-permissions"],
            ),
            (
                "codex",
                true,
                McpInjection::Argv,
                Some(McpTransport::Http),
                &["--dangerously-bypass-approvals-and-sandbox"],
            ),
            (
                "gemini",
                false,
                McpInjection::ConfigFile,
                Some(McpTransport::Http),
                &["--skip-trust", "--approval-mode", "yolo"],
            ),
            (
                "grok",
                false,
                McpInjection::Subcommand,
                Some(McpTransport::Http),
                &["--always-approve"],
            ),
            ("omp", true, McpInjection::None, None, &["--auto-approve"]),
            (
                "opencode",
                true,
                McpInjection::Subcommand,
                Some(McpTransport::Http),
                &["--auto"],
            ),
            (
                "pi",
                true,
                McpInjection::ConfigDir,
                Some(McpTransport::Http),
                &["--approve"],
            ),
            (
                "qoder",
                true,
                McpInjection::Argv,
                Some(McpTransport::Http),
                &["--dangerously-skip-permissions"],
            ),
            ("reasonix", false, McpInjection::ConfigFile, None, &[]),
        ];

        assert_eq!(ADMISSIONS.len(), expected.len());
        for (agent_id, hooks, injection, transport, bypass_args) in expected {
            let admission =
                admission_for(agent_id).unwrap_or_else(|| panic!("{agent_id} 必须在准入表里"));
            assert_eq!(admission.hooks, hooks, "{agent_id} 的 hooks 列不符");
            assert_eq!(
                admission.mcp_injection, injection,
                "{agent_id} 的 MCP 注入方式不符"
            );
            assert_eq!(admission.transport, transport, "{agent_id} 的传输不符");
            assert_eq!(
                admission.bypass_args, bypass_args,
                "{agent_id} 的审批旁路参数不符"
            );
        }
    }

    /// 表长 10 且 id 唯一。
    ///
    /// 保护的不变量：`ADMISSIONS` 是 `team_spawn` 的唯一准入源。多一行 = 向模型
    /// 声明一个没实测过的能力；少一行 = 那个 CLI 永远起不来成员（且错误信息还会
    /// 说着「不是已知 agent id」）。
    ///
    /// **不再写第三份 id 字面量清单**：集合完整性由上两个表驱动用例负责（它们遍历
    /// 矩阵的 10 个 id 并逐个 `admission_for`，多/少/重复都会在那一侧红），这里只钉
    /// 「行数 + 唯一性」这两条与具体 id **无关**的性质。同一份事实在三个地方各写一遍，
    /// 改矩阵时就要改三处。
    #[test]
    fn table_has_ten_unique_ids() {
        assert_eq!(ADMISSIONS.len(), 10);
        let mut ids: Vec<&str> = ADMISSIONS.iter().map(|row| row.agent_id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 10, "准入表的 agent id 必须唯一");
    }

    /// 准入表与 `builtin_configs()` 必须指着同一批 agent —— 两个真相源之间的唯一桥。
    ///
    /// # 为何这条不能用「读起来一样」代替
    ///
    /// 准入表的 `agent_id` 是**查 AgentConfig 的 key**（`agent/builtin/providers.rs`），
    /// 而 `dsh` 被拒的理由恰恰是「没有 `AgentConfig`」。但那道判据以前只对 `dsh`
    /// 一个人做了人肉检查 —— 其余 10 行只需“看起来拼得对”就能进表。这条用例把它变成
    /// 机器判据：准入表里任何一个 id 在 `builtin_configs()` 里找不到，`team_spawn` 就会
    /// 接受一个**永远拉不起进程**的 agent（失败点在 2.5b 的接线段，离家很远）。
    #[test]
    fn every_admitted_agent_has_an_agent_config() {
        let configs = crate::agent::builtin::builtin_configs();
        for row in ADMISSIONS {
            let config = configs.iter().find(|config| config.id == row.agent_id);
            let config = config.unwrap_or_else(|| {
                panic!(
                    "`{}` 在准入表里但没有 `AgentConfig` —— team_spawn 无法为它拉起进程",
                    row.agent_id
                )
            });
            assert!(
                !config.command.trim().is_empty(),
                "`{}` 的 `AgentConfig.command` 是空的：没有可执行程序就起不了成员",
                row.agent_id
            );
        }
        // 反向：`dsh` 被拒的那条理由（无 `AgentConfig`）必须仍然成立。
        assert!(
            !configs.iter().any(|config| config.id == "dsh"),
            "dsh 若长出了 AgentConfig，`NOT_SPAWNABLE` 里那条理由就过期了"
        );
    }

    /// 模板必须与注入档**逐行一致**（执行层按档位决定用哪一列）。
    ///
    /// 四条不变量（一条一档）：
    /// - `Argv` 行必须有模板，且模板里含**至少一个**占位符 —— 否则执行层拿到一条不带 MCP
    ///   配置的启动命令，成员起来但 tool 面静默不可见（最难查的失败形态）；
    /// - `ConfigDir` 行必须有 `config_dir` 事实且 `add_argv` 含占位符（同理，写出的配置
    ///   里没有端点/凭证 = 哑巴成员）；
    /// - 两种“已实现”的档**不得同时**携带：有模板却不用 = 第二个真相源，改档时必然漏一处；
    /// - 其余档两列都必须为空。
    ///
    /// 这里只钉“档与数据同生共死”和几个**实测确定的**形状，不复制整张表：逐行内容由
    /// `admission_rows_match_the_p0_matrix_column_by_column` 负责。
    #[test]
    fn injection_gear_and_its_data_column_live_and_die_together() {
        let has_placeholder = |template: &[&str]| template.iter().any(|arg| arg.contains("{{"));
        for row in ADMISSIONS {
            let is_argv = row.mcp_injection == McpInjection::Argv;
            let is_config_dir = row.mcp_injection == McpInjection::ConfigDir;
            assert_eq!(
                is_argv,
                !row.mcp_argv.is_empty(),
                "`{}`: 注入档 {:?} 与 argv 模板不一致",
                row.agent_id,
                row.mcp_injection
            );
            assert_eq!(
                is_config_dir,
                row.config_dir.is_some(),
                "`{}`: 注入档 {:?} 与 `config_dir` 事实列不一致",
                row.agent_id,
                row.mcp_injection
            );
            if is_argv {
                assert!(
                    has_placeholder(row.mcp_argv),
                    "`{}`: Argv 档的模板必须含占位符，否则拼不出 MCP 配置",
                    row.agent_id
                );
            }
            if let Some(spec) = row.config_dir {
                assert!(
                    has_placeholder(spec.add_argv),
                    "`{}`: ConfigDir 档的 `add_argv` 必须含占位符，否则写出的配置没有端点/凭证",
                    row.agent_id
                );
                assert!(
                    !spec.env.is_empty(),
                    "{}: 重定向 env 名不得为空",
                    row.agent_id
                );
                assert!(
                    !spec.mcp_file.is_empty(),
                    "{}: 配置文件名不得为空",
                    row.agent_id
                );
                assert!(
                    !spec.mirror.is_empty(),
                    "{}: 镜像条目不得为空",
                    row.agent_id
                );
            }
        }

        // 三家 `--mcp-config` CLI 的具体形状（qoder 额外要 `--strict-mcp-config`）。
        for (agent_id, len) in [("claude-code", 2), ("codebuddy", 2), ("qoder", 3)] {
            let row = admission_for(agent_id).expect("admitted");
            assert_eq!(row.mcp_argv.len(), len, "{agent_id} 的启动参数个数");
            assert_eq!(row.mcp_argv[0], "--mcp-config", "{agent_id}");
        }
        assert_eq!(
            admission_for("qoder").expect("admitted").mcp_argv[2],
            "--strict-mcp-config"
        );
    }

    /// 渲染：**五种**占位符都能替，且可以嵌在更长的参数里。
    ///
    /// 保护的不变量：pi 的 header 写法是 `x-neeko-team-token={{token}}`（实测）—— 只做
    /// “整元素等于占位符”的替换会把 `{{token}}` 原样发给 CLI，于是成员带一个无效 header
    /// 启动，而错误在 401 那一层才出现（离家很远）。
    #[test]
    fn render_substitutes_all_five_placeholders_even_inside_an_argument() {
        let ctx = RenderContext::new(
            "{}".to_owned(),
            "http://h/team/mcp",
            "tok",
            Some("You are a worker."),
        );
        let rendered = render_argv(
            &[
                "--json",
                MCP_CONFIG_PLACEHOLDER,
                MCP_URL_PLACEHOLDER,
                TOKEN_PLACEHOLDER,
                TOKEN_ENV_PLACEHOLDER,
                "x-neeko-team-token={{token}}",
                PREAMBLE_PLACEHOLDER,
                "plain",
            ],
            &ctx,
        )
        .expect("render");
        assert_eq!(
            rendered,
            vec![
                "--json".to_owned(),
                "{}".to_owned(),
                "http://h/team/mcp".to_owned(),
                "tok".to_owned(),
                TEAM_TOKEN_ENV.to_owned(),
                "x-neeko-team-token=tok".to_owned(),
                "You are a worker.".to_owned(),
                "plain".to_owned(),
            ]
        );
    }

    /// 五个占位符**常量**与渲染器认识的名字是同一份（改名即断链）。
    ///
    /// 保护的不变量：`render_arg` 里那张 `value()` 表用的是裸名（`"url"`），而常量带
    /// 花括号（`"{{url}}"`）—— 两处各自手写就会在改名时只改一处，于是模板里的占位符变成
    /// “未知”，每个成员都在启动期被拒。这条用例把它们钉在一起。
    #[test]
    fn every_placeholder_constant_is_known_to_the_renderer() {
        let ctx = RenderContext::new("{cfg}".to_owned(), "u", "t", Some("role"));
        for (placeholder, expected) in [
            (MCP_CONFIG_PLACEHOLDER, "{cfg}"),
            (MCP_URL_PLACEHOLDER, "u"),
            (TOKEN_PLACEHOLDER, "t"),
            (TOKEN_ENV_PLACEHOLDER, TEAM_TOKEN_ENV),
            (PREAMBLE_PLACEHOLDER, "role"),
        ] {
            let rendered = render_argv(&[placeholder], &ctx)
                .unwrap_or_else(|err| panic!("{placeholder}: {err}"));
            assert_eq!(rendered[0], expected, "{placeholder} 渲染出的值不对");
        }
    }

    /// `{{preamble}}` 是**已知**占位符：缺的是调用方没给角色上下文，不是模板写错。
    ///
    /// 保护的不变量（本轮故障的同一个形态）：把空串当值发出去，CLI 会带着一条空的系统
    /// 提示启动 —— 一个不知道自己是谁的队长与一个正常团队看起来毫无区别。
    #[test]
    fn a_missing_preamble_is_an_error_not_an_empty_argument() {
        let ctx = RenderContext::new("{}".to_owned(), "u", "t", None);
        let err = render_argv(&["--append-system-prompt", PREAMBLE_PLACEHOLDER], &ctx)
            .expect_err("没有角色上下文时必须报错");
        assert!(matches!(err, AppError::Unsupported(_)), "{err:?}");
        assert!(err.to_string().contains("preamble"), "{err}");
        assert!(!err.to_string().contains("no renderer knows"), "{err}");
    }

    /// 未知 / 未闭合的占位符 = **错误**，不是原样保留。
    ///
    /// 保护的不变量：静默保留字面量的错误形态是“成员带着 `{{token}}` 启动”——
    /// 既能跑、又永远 401，且磁盘上没有任何一处能看出原因。
    #[test]
    fn render_refuses_unknown_and_unclosed_placeholders() {
        let ctx = RenderContext::new("{}".to_owned(), "u", "t", Some("role"));
        for template in [vec!["{{uurl}}"], vec!["--url", "x={{url}"], vec!["{{}}"]] {
            let err = render_argv(&template, &ctx).expect_err("未知/未闭合的占位符必须报错");
            assert!(
                matches!(err, AppError::Unsupported(_)),
                "{template:?}: {err:?}"
            );
            assert!(
                err.to_string().contains("placeholder"),
                "{template:?}: {err}"
            );
        }
    }

    /// codex 的启动参数：**逐字**钉住实测形状（`-c key=value` 覆盖，不写任何文件）。
    ///
    /// 三条判据串联，任一条单独都不够：
    /// ① 形状是 `-c` + `mcp_servers.<server>.<key>="<value>"`（写错 codex 会静默忽略）；
    /// ② 鉴权走 `bearer_token_env_var`，它的值必须**恰好**是 [`TEAM_TOKEN_ENV`]
    ///    （否则子进程 env 里的凭证对不上，成 401）；
    /// ③ 模板确实需要凭证 env（`needs_credentials_env`）—— 这就是执行层注入只那一条 env 的判据。
    #[test]
    fn codex_argv_is_the_verified_config_override() {
        let row = admission_for("codex").expect("admitted");
        let ctx = RenderContext::new(
            "{}".to_owned(),
            "http://127.0.0.1:1/team/mcp",
            "tok",
            Some("role"),
        );
        let rendered = render_argv(row.mcp_argv, &ctx).expect("render");
        assert_eq!(
            rendered,
            vec![
                "-c".to_owned(),
                "mcp_servers.neeko-team.url=\"http://127.0.0.1:1/team/mcp\"".to_owned(),
                "-c".to_owned(),
                format!("mcp_servers.neeko-team.bearer_token_env_var=\"{TEAM_TOKEN_ENV}\""),
            ]
        );
        assert!(
            needs_credentials_env(row.mcp_argv),
            "codex 的 argv 只放 env 名字，值必须由 `credentials_env` 提供"
        );
        // 反例：`--mcp-config` 三家不需要凭证 env（凭证在 JSON 里）。
        for agent_id in ["claude-code", "codebuddy", "qoder"] {
            let row = admission_for(agent_id).expect("admitted");
            assert!(
                !needs_credentials_env(row.mcp_argv),
                "{agent_id}: 凭证已在 `--mcp-config` 的 JSON 里，不该再注入 env"
            );
        }
    }

    /// pi 的 `mcp add` 命令：**逐字**钉住实测形状，特别是 `--header` 的 `KEY=VALUE` 语法。
    ///
    /// 保护的不变量（变异验证：把 `=` 改成 `: ` 本用例变红）：实测 `pi mcp add` 的 header
    /// 参数只收 `KEY=VALUE`，写成 `KEY: VALUE` 直接报错。header 名还必须等于端点读的
    /// [`crate::agent::team::mcp::protocol::TOKEN_HEADER`]（单源，否则成员带错 header 名登录）。
    #[test]
    fn pi_add_argv_is_the_verified_key_value_form() {
        let row = admission_for("pi").expect("admitted");
        let spec = row.config_dir.expect("pi 用 ConfigDir 档");
        let ctx = RenderContext::new(
            "{}".to_owned(),
            "http://127.0.0.1:1/team/mcp",
            "tok",
            Some("role"),
        );
        let rendered = render_argv(spec.add_argv, &ctx).expect("render");

        assert_eq!(rendered[0], "mcp");
        assert_eq!(rendered[1], "add");
        // server 名必须与下发 JSON 用的是同一个（两处字面量不可避免，用例把它们钉在一起）。
        assert_eq!(rendered[2], crate::agent::team::execution::TEAM_SERVER_NAME);
        assert_eq!(rendered[3], "--url");
        assert_eq!(rendered[4], "http://127.0.0.1:1/team/mcp");
        assert_eq!(rendered[5], "--header");
        // 实测的两条：语法是 `KEY=VALUE`；header 名与端点同源。
        let header = rendered[6].as_str();
        let (name, value) = header
            .split_once('=')
            .unwrap_or_else(|| panic!("header 必须是 KEY=VALUE 形式，实际 {header:?}"));
        assert_eq!(name, crate::agent::team::mcp::protocol::TOKEN_HEADER);
        assert_eq!(value, "tok");
        assert!(
            !header.contains(": "),
            "`pi mcp add --header` 不收 `KEY: VALUE`，实测直接报错：{header:?}"
        );
        // 凭证走 header，不需要凭证 env。
        assert!(!needs_credentials_env(spec.add_argv));
    }

    /// 启动可行性：**已实现的两档能起**，其余档拒绝且理由可读（含该 CLI 自己写全局配置这一句）。
    ///
    /// 保护的不变量（红线 14）：`launch_refusal` 是 `team_spawn` 与 `plan_member_spawn`
    /// 共用的唯一判据。它变宽 = 声明了做不到的能力（成员永远不动）；变窄 = 一个能跑
    /// 的 CLI 被莫名拒绝。
    #[test]
    fn launch_refusal_admits_the_implemented_gears_only() {
        for agent_id in ["claude-code", "codebuddy", "qoder", "codex", "pi"] {
            let row = admission_for(agent_id).expect("admitted");
            assert_eq!(row.launch_refusal(), None, "{agent_id} 今天应该能起");
        }
        // `Subcommand`：拒绝理由必须说清“写的是用户全局配置”（而不是“执行层没实现”）。
        for agent_id in ["grok", "opencode"] {
            let why = admission_for(agent_id)
                .expect("admitted")
                .launch_refusal()
                .unwrap_or_else(|| panic!("{agent_id} 必须被拒绝"));
            assert!(why.contains("Subcommand"), "{agent_id}: {why}");
            assert!(why.contains("global config"), "{agent_id}: {why}");
        }
        // `ConfigFile`：拒绝理由必须说清缺的是备份/幂等/拆除三件套。
        // （`reasonix` 不在这条里：它连传输都没有，先被「没有 MCP 面」拦下 ——
        // 所以今天的 `ConfigFile` 反例只有一家，不写成单元素循环。）
        let why = admission_for("gemini")
            .expect("admitted")
            .launch_refusal()
            .expect("gemini 必须被拒绝");
        assert!(why.contains("ConfigFile"), "gemini: {why}");
        assert!(why.contains("backup"), "gemini: {why}");
        // 无 MCP 面：理由与 `no_surface_message` 同一句（面板与工具返回不得长得不一样）。
        let why = admission_for("omp")
            .expect("admitted")
            .launch_refusal()
            .expect("omp 必须被拒绝");
        assert!(why.contains("no MCP surface"), "{why}");
    }

    /// 队长判据 = `launch_refusal` + **一条**：能不能收到角色 preamble。
    ///
    /// 三层断言，合起来才完整：
    /// ① 今天能当成员的 5 家**都能当队长**（它们都验过 `prompt_argv`）；
    /// ② 拒绝的 5 家，`lead_refusal` 与 `launch_refusal` 是**同一句**（复用而不是重写）；
    /// ③ 合成一行（能当成员、无 `prompt_argv`）⇒ 成员放行、队长拒绝。
    ///
    /// 第 ③ 条是本轮真正新增的判据：只测 ①② 的话，把 `lead_refusal` 写成
    /// `launch_refusal` 的别名也能全绿（今天恰好没有这样的行）—— 那种漂移会在表里出现
    /// 第一个「能起不能当队长」的 CLI 时静默放行一个不动的队长。
    #[test]
    fn lead_refusal_is_launch_refusal_plus_the_preamble_condition() {
        for row in ADMISSIONS {
            match row.launch_refusal() {
                Some(why) => assert_eq!(
                    row.lead_refusal(),
                    Some(why),
                    "`{}`: 成员都当不了的 CLI，理由不得被改写成另一句",
                    row.agent_id
                ),
                None => assert_eq!(
                    row.lead_refusal(),
                    None,
                    "`{}` 今天能当成员且验过 prompt_argv，就该能当队长",
                    row.agent_id
                ),
            }
        }

        // ③ 合成行：能当成员，但无法接收系统提示。
        let row = AgentAdmission {
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
        };
        assert_eq!(row.launch_refusal(), None, "作为成员它应该能起");
        let why = row.lead_refusal().expect("作为队长必须被拒绝");
        assert!(why.contains("prompt_argv"), "{why}");
        assert!(
            why.contains("never learns it is a lead"),
            "理由必须说清「会起来一个不动的会话」：{why}"
        );
    }

    /// `prompt_argv` 这一列的内部一致性（红线 14 的数据侧）。
    ///
    /// 三条判据：
    /// - 非空 ⇒ **必须**含 `{{preamble}}`：没有占位符的模板就是把角色文本丢掉，而
    ///   「起来了但不知道自己是队长」正是本轮要修的故障；
    /// - 非空 ⇒ 本行 `unverified` 必须带上「只验了参数解析」那句（诚实面随能力一起进表）；
    /// - 空 ⇒ 只能是「本行连成员都当不了」（否则一个能跑的 CLI 被默默剥夺了队长资格）。
    #[test]
    fn the_prompt_argv_column_is_consistent_with_the_row() {
        for row in ADMISSIONS {
            if row.prompt_argv.is_empty() {
                assert!(
                    row.launch_refusal().is_some(),
                    "`{}`: 能起成员的 CLI 不得没有 prompt_argv（那样它永远当不了队长）",
                    row.agent_id
                );
                continue;
            }
            assert!(
                row.prompt_argv
                    .iter()
                    .any(|arg| arg.contains(PREAMBLE_PLACEHOLDER)),
                "`{}`: prompt_argv 里没有 {PREAMBLE_PLACEHOLDER}，角色文本会被静默丢掉",
                row.agent_id
            );
            assert!(
                row.unverified.contains(&PREAMBLE_UNVERIFIED),
                "`{}`: 声明了 prompt_argv 就必须把「只验了参数解析」写进 unverified",
                row.agent_id
            );
        }
        // 反向：今天确实至少有五家能当队长（否则上面两个循环可以全空集通過）。
        let leads = ADMISSIONS
            .iter()
            .filter(|row| row.lead_refusal().is_none())
            .count();
        assert!(leads >= 5, "能当队长的 CLI 只剩 {leads} 家，与矩阵不符");
    }

    /// `prompt_argv` 里的 profile —— 只有三种已实测的形态，没有第四种。
    ///
    /// 保护的不变量（红线 14）：这里每多一种「看起来能行」的写法，就多一个
    /// 「参数被忽略、会话静默没有系统提示」的可能。本仓实测过的只有：
    ///
    /// | 形态 | 谁 | 验法 |
    /// | --- | --- | --- |
    /// | `--append-system-prompt {{preamble}}` | claude-code / codebuddy / pi / qoder | 未知开关会报 `unknown option`，而这四家在 `--model <不存在>` 上报的是**模型**错误 |
    /// | `{{preamble}}`（位置参数） | codex | 两个位置参数 → `unexpected argument` |
    /// | `--prompt {{preamble}}` | opencode | 未知开关 → 打印 usage；`--prompt <probe>` → probe 出现在输入框 |
    #[test]
    fn the_prompt_argv_only_uses_the_three_verified_shapes() {
        for row in ADMISSIONS {
            match row.prompt_argv {
                // 未实测的 CLI：空模板（不是“许一个猜测的开关”）。
                [] => {}
                [flag, placeholder] if *flag == "--append-system-prompt" || *flag == "--prompt" => {
                    assert_eq!(*placeholder, PREAMBLE_PLACEHOLDER, "`{}`", row.agent_id);
                }
                // codex：系统提示只能从位置参数 `[PROMPT]` 进去（它没有 `--append-system-prompt`）。
                [placeholder] => assert_eq!(*placeholder, PREAMBLE_PLACEHOLDER, "`{}`", row.agent_id),
                other => panic!(
                    "`{}` 的 prompt_argv 是未实测的形状：{other:?}（只允许 ① --append-system-prompt ② --prompt ③ 位置参数）",
                    row.agent_id
                ),
            }
        }
    }

    /// 面板数据面：**每个 id 都过同一个判据**，不在表里的也说清缺什么。
    ///
    /// 保护的不变量（prd R0.4）：能力缺口必须在 UI 上可见。用一份“不在表里”的输入
    /// （用户自定义 CLI / `dsh`）验证它不会静默变成“能启动”—— 那种失败形态正是用户
    /// 点到一个必然报错的按钮。
    #[test]
    fn launchable_agents_maps_every_id_through_the_admission_table() {
        let ids: Vec<String> = vec![
            "pi".to_owned(),
            "claude-code".to_owned(),
            "grok".to_owned(),
            "dsh".to_owned(),
            "my-custom-cli".to_owned(),
            // 重复项必须去重（面板不该出现两行同名）。
            "pi".to_owned(),
        ];
        let rows = launchable_agents(&ids, MemberRole::Worker);
        let ids_out: Vec<&str> = rows.iter().map(|row| row.agent_id.as_str()).collect();
        assert_eq!(
            ids_out,
            vec!["claude-code", "dsh", "grok", "my-custom-cli", "pi"],
            "输出按 id 排序且去重"
        );

        for row in &rows {
            match row.agent_id.as_str() {
                "claude-code" | "pi" => assert_eq!(row.refusal, None, "{} 应该能起", row.agent_id),
                "grok" => {
                    let why = row.refusal.as_deref().expect("grok 必须置灰");
                    // 与 `launch_refusal` **同一句**（不是第二个判据）。
                    assert_eq!(
                        why,
                        admission_for("grok").unwrap().launch_refusal().unwrap()
                    );
                }
                // 不在准入表里：理由里必须点名这件事，而不是只说“不支持”。
                other => {
                    let why = row.refusal.as_deref().expect("不在表里必须置灰");
                    assert!(
                        why.contains("not in the team admission table"),
                        "{other}: {why}"
                    );
                }
            }
        }
    }

    /// 空输入 → 空输出（命令层不需要为“没有任何 agent”写特例）。
    #[test]
    fn launchable_agents_of_an_empty_list_is_empty() {
        assert!(launchable_agents(&[], MemberRole::Worker).is_empty());
    }

    /// `McpInjection::None` ⇒ B 档（hook 在、MCP 面不在）。
    ///
    /// 保护的不变量：B 档的判据是**缺 MCP**，不是缺 hook。合并二者会把 `omp`
    /// 误判成 C（于是 UI 会对一个能上报 `agent_end` 的成员写「卡住不可知」）。
    #[test]
    fn missing_mcp_surface_means_tier_b() {
        let omp = AgentAdmission {
            agent_id: "offline-probe",
            hooks: true,
            mcp_injection: McpInjection::None,
            transport: None,
            bypass_args: &[],
            mcp_argv: &[],
            config_dir: None,
            pty_submit: PtySubmit::Plain,
            prompt_argv: &[],
            unverified: &[],
        };
        assert_eq!(tier_of(&omp), AdmissionTier::B);
        // 传输缺失与注入方式为 None 等价（两者任一缺失都意味着「发不进去」）。
        let half = AgentAdmission {
            transport: None,
            mcp_injection: McpInjection::Argv,
            ..omp
        };
        assert_eq!(
            tier_of(&half),
            AdmissionTier::B,
            "只有注入方式没有传输 = 发不进去"
        );
    }

    /// `hooks == false` ⇒ C 档（**即使 MCP 面完整**）。
    ///
    /// 保护的不变量：C 档不是「什么都缺」，而是「完成信号这一项缺」——
    /// `grok` 有完整 MCP 却仍是 C。判据写反会把 C 档的成员宣传成 A 档。
    #[test]
    fn missing_hooks_means_tier_c_even_with_mcp() {
        let grok = AgentAdmission {
            agent_id: "offline-probe",
            hooks: false,
            mcp_injection: McpInjection::Argv,
            transport: Some(McpTransport::Http),
            bypass_args: &[],
            mcp_argv: &[],
            config_dir: None,
            pty_submit: PtySubmit::Plain,
            prompt_argv: &[],
            unverified: &[],
        };
        assert_eq!(tier_of(&grok), AdmissionTier::C);
    }

    /// `result_channel` 由 **hooks** 决定；**工具面**（`has_mcp`）是另一列，两者不合并。
    ///
    /// 保护的不变量：`grok` 是「有工具面但报不上来」的反例 —— 按档位一刀切
    /// （C ⇒ 两列全 `None`/`Sentinel`）会白白丢掉它可用的 MCP 面。而「能收」这件事
    /// 由 `has_mcp` 表达，**不是** `channel`：CLI 成员的入站通道一律 PTY
    /// （`WorkerChannel::CLI_MEMBER` —— MCP over HTTP 没有 server→client 推送）。
    #[test]
    fn result_channel_comes_from_hooks_while_the_tool_surface_is_its_own_column() {
        let cases: [(&str, bool, ResultChannel); 4] = [
            // A 档：hook + 工具面都在 ⇒ 结果走工具调用。
            ("claude-code", true, ResultChannel::Mcp),
            // B 档：无工具面（收不到任务，`team_spawn` 早拒），结果也只能靠 sentinel。
            ("omp", false, ResultChannel::Sentinel),
            // C 档但有工具面：能用工具，但报不上来 ⇒ sentinel。
            ("grok", true, ResultChannel::Sentinel),
            // C 档且只写配置文件、无传输：工具面不成立。
            ("reasonix", false, ResultChannel::Sentinel),
        ];
        for (agent_id, has_mcp, result_channel) in cases {
            let admission = admission_for(agent_id).expect("admitted");
            assert_eq!(admission.has_mcp(), has_mcp, "{agent_id} 的 MCP 工具面");
            assert_eq!(
                admission.result_channel(),
                result_channel,
                "{agent_id} 的 result_channel"
            );
        }
    }

    /// `dsh` 不进表（hook-only、无 `AgentConfig`），且拒绝理由点名这一条。
    ///
    /// 保护的不变量：`dsh` 是「看起来属于本仓」的陷阱 —— 它的 hook 能上报，
    /// 所以很容易被顺手加进准入表；但它没有 `AgentConfig`，`team_spawn` 无法
    /// 为它拉起进程（失败会在 2.5b 的接线段炸出一个半生不死的成员）。
    #[test]
    fn dsh_is_not_admitted_and_the_refusal_names_the_missing_agent_config() {
        assert!(admission_for("dsh").is_none(), "dsh 不得进入准入表");
        let message = refusal("dsh");
        // 断言英文原文（而不是中文子串）：错误文案只允许一种语言。
        assert!(message.contains("no `AgentConfig`"), "{message}");
        assert!(message.contains("dsh"), "{message}");
    }

    /// 未知 id 的拒绝信息**逐条列出可用的 agent id**（队长据此自我纠正）。
    ///
    /// 保护的不变量：错误信息是给模型的提示，不是给日志的状态码。只说
    /// "unknown agent" 会让队长在同一个拼写上反复重试。
    #[test]
    fn unknown_agent_refusal_lists_the_known_agent_ids() {
        let message = refusal("no-such-agent");
        assert!(message.contains("no-such-agent"), "{message}");
        for admission in ADMISSIONS {
            assert!(
                message.contains(admission.agent_id),
                "拒绝信息漏了 {}：{message}",
                admission.agent_id
            );
        }
        // 「已知但不可 spawn」的 id 也要点名（否则队长会一直拿 dsh 试）。
        assert!(message.contains("dsh"), "{message}");
    }

    /// 提交形态是**per-CLI 数据**（红线 15 同族）：只有 codex 实测需要 bracketed paste。
    ///
    /// 两个方向都要有判据：
    /// - codex 被改回 `Plain` ⇒ 它的 paste-burst 把窗口内的回车当成「粘贴里的换行」，
    ///   消息停在输入框（`research/00-evidence.md` §2）；
    /// - 别的行被顺手改成 `BracketedPaste` ⇒ 不认这个转义的 TUI 会把 `ESC[200~` 当字面量
    ///   插进输入框 —— 比今天的形态更糟，而且同样是静默的。
    #[test]
    fn codex_uses_bracketed_paste_and_everyone_else_is_plain() {
        use crate::agent::team::delivery::PtySubmit;

        assert_eq!(
            admission_for("codex").expect("codex 已准入").pty_submit,
            PtySubmit::BracketedPaste,
            "codex 的 paste-burst 只认显式粘贴：裸正文 + `\\r` 会被吞成换行"
        );
        for row in ADMISSIONS.iter().filter(|row| row.agent_id != "codex") {
            assert_eq!(
                row.pty_submit,
                PtySubmit::Plain,
                "`{}` 的投递字节必须与改动前逐字节相同（未实测的 CLI 不进代码）",
                row.agent_id
            );
        }
        // 未登记的 id 不可能是一个成员；失败方向是「不变」（`Plain`），不是「包起来」。
        assert_eq!(pty_submit_for("no-such-agent"), PtySubmit::Plain);
    }

    /// 源码级护栏（红线 15）：per-CLI 事实在生产代码里**只能以表里一行的形式存在**。
    ///
    /// 两条判据，各自堵一个方向：
    ///
    /// 1. **无分支形状** —— `agent_id` 参与 `==` / `matches!` / `match` 的任意一个方向都算违规：
    ///    「哪些 CLI 支持 X」一旦变成代码分支，新增 CLI 就要改通用模块，测试也无法再枚举
    ///    全部 CLI 来问这个问题。
    /// 2. **每个已准入 id 恰好出现一次** —— 词表里的 id 只允许出现在它自己那行的
    ///    `agent_id:` 字段上。再出现一次，就意味着有人把某条实测结论在别处又写了一遍
    ///    （典型：给某个 CLI 加一个 `side_effect` 白名单），而那条事实从此有两个源。
    ///
    /// 只审**生产段**（`#[cfg(test)]` 之前）：测试自己的字面量是允许的（它们就是在断言矩阵）。
    ///
    /// 用 `concat!` 拼接被禁字面量：否则**本测试自身的源码**会命中断言。
    /// 别把它「简化」成一个完整字面量。
    #[test]
    fn per_cli_facts_live_only_in_the_table() {
        let source = include_str!("admission.rs");
        let production = source
            .split_once("#[cfg(test)]")
            .map_or(source, |(production, _)| production);

        for needle in [
            concat!("agent_id", " == "),
            concat!(" == ", "agent_id"),
            concat!("match ", "agent_id"),
            concat!("match admission.", "agent_id"),
            concat!("matches!(", "agent_id"),
            concat!("matches!(admission.", "agent_id"),
            concat!("agent_id", ".eq("),
            concat!(".eq(", "agent_id"),
        ] {
            assert!(
                !production.contains(needle),
                "admission.rs 生产段里出现了按 agent id 分支的形状 `{needle}` —— \
                 这类判断必须变成表里的一列（红线 15）"
            );
        }

        for row in ADMISSIONS {
            let literal = format!("\"{}\"", row.agent_id);
            let hits = production.matches(&literal).count();
            assert_eq!(
                hits, 1,
                "`{}` 在生产段出现 {hits} 次：per-CLI 事实只能作为表里的一行（红线 15）",
                row.agent_id
            );
        }
    }
}
