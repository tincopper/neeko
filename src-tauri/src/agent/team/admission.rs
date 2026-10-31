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
//! 所以本文件只有三种东西：**数据**（[`ADMISSIONS`] / [`NOT_SPAWNABLE`]）、
//! **查表**（[`admission_for`]）、**由数据推导的纯函数**（[`tier_of`] 与
//! [`AgentAdmission::channel`] / [`AgentAdmission::result_channel`]）。
//! `per_cli_facts_live_only_in_the_table` 会读本文件**生产段**的源码，断言两件事：
//! 没有按 agent id 分支的形状，且每个已准入 id 只出现在它自己那行数据里。
//!
//! # 诚实原则
//!
//! [`AgentAdmission::unverified`] 里的每一条都**原样回给队长**（经
//! `ToolReply::MemberCreated.unverified`）。它存在的理由：B 级证据（配置已装、未跑一轮）
//! 与 A 级证据（实测）在矩阵里长得一样，只有把「我没验过这条」说出来，队长才不会
//! 把不确定的能力当成确定的。

use crate::agent::team::types::{
    AdmissionTier, ApprovalPolicy, McpInjection, ResultChannel, WorkerChannel,
};

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
    /// 仍未实测确认的点。**必须诚实列出**，会原样进工具返回给队长。
    pub unverified: &'static [&'static str],
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

    /// 怎么给它**发**消息（design §4.4 的 `channel`）。
    ///
    /// 只由 **MCP 面**决定，与档位无关：C 档的 `grok` 照样能收
    /// （`channel = Mcp`）—— 只是它的结果得靠 sentinel 打印。按档位一刀切会把
    /// 这条真实能力白白丢掉。
    #[must_use]
    pub fn channel(&self) -> WorkerChannel {
        if self.has_mcp() {
            WorkerChannel::Mcp
        } else {
            WorkerChannel::None
        }
    }

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
}

/// MCP 传输形态（矩阵第 ③ 列）。
///
/// # 变体集合 = **本仓已实现的传输集合**（红线 14）
///
/// 这里的每一行都意味着「Neeko 有办法把 MCP 流量送进去」。所以 stdio 不在列：
/// `neeko-team-mcp.mjs` 的 bridge 尚未落地，加一个 `Stdio` 变体只会让
/// `AgentAdmission::has_mcp()` 把一条其实发不进去的配置宣传成 `channel = Mcp`。
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
    //    ② `~/.claude/settings.json` 有 `Stop` hook（B 级：已装未跑）。
    AgentAdmission {
        agent_id: "claude-code",
        hooks: true,
        mcp_injection: McpInjection::Argv,
        transport: Some(McpTransport::Http),
        bypass_args: &["--dangerously-skip-permissions"],
        unverified: &[],
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
        ],
    },
    // ① `codex mcp add` → `config.toml [mcp_servers]` + `-c key=value` 覆盖；
    //    ② `Stop` + `notify agent-turn-complete` 已装；传输 streamable HTTP。
    AgentAdmission {
        agent_id: "codex",
        hooks: true,
        mcp_injection: McpInjection::ConfigFile,
        transport: Some(McpTransport::Http),
        bypass_args: &["--dangerously-bypass-approvals-and-sandbox"],
        unverified: &[
            "the complete approval-bypass switch set was not re-verified (only `--approve-for-me` was observed)",
        ],
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
    },
    // ① `grok mcp add --transport http|stdio|sse` + `-H`；② Neeko 无 grok hook 目标。C 档。
    AgentAdmission {
        agent_id: "grok",
        hooks: false,
        mcp_injection: McpInjection::Argv,
        transport: Some(McpTransport::Http),
        bypass_args: &["--always-approve"],
        unverified: &[
            "Neeko has no grok hook target, so completion signals are invisible (tier C) even though the MCP surface works",
        ],
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
    },
    // ① `opencode mcp add --url` + `--header`；② 插件 v2 模板存在但 `plugin: []` ⇒ **未安装**。
    AgentAdmission {
        agent_id: "opencode",
        hooks: true,
        mcp_injection: McpInjection::ConfigFile,
        transport: Some(McpTransport::Http),
        bypass_args: &["--auto"],
        unverified: &[
            "the Neeko plugin is not installed in this user's opencode config, so turn hooks will not fire yet",
        ],
    },
    // ① `pi mcp add --url` → `~/.pi/agent/mcp.json`；② `agent_end` extension 已装。
    AgentAdmission {
        agent_id: "pi",
        hooks: true,
        mcp_injection: McpInjection::ConfigFile,
        transport: Some(McpTransport::Http),
        bypass_args: &["--approve"],
        unverified: &[
            "`--approve` semantics were never verified: it trusts the project files, it may not waive every prompt",
        ],
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
        ],
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
                McpInjection::ConfigFile,
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
                McpInjection::Argv,
                Some(McpTransport::Http),
                &["--always-approve"],
            ),
            ("omp", true, McpInjection::None, None, &["--auto-approve"]),
            (
                "opencode",
                true,
                McpInjection::ConfigFile,
                Some(McpTransport::Http),
                &["--auto"],
            ),
            (
                "pi",
                true,
                McpInjection::ConfigFile,
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
            unverified: &[],
        };
        assert_eq!(tier_of(&grok), AdmissionTier::C);
    }

    /// `channel` 由 **MCP 面**决定，`result_channel` 由 **hooks** 决定 —— 两列不合并。
    ///
    /// 保护的不变量（design §4.4 的通道三分）：`grok` 是「能收不能报」的反例 ——
    /// 若按档位一刀切（C ⇒ 全 `None`/`Sentinel`），它会白白丢掉可用的 MCP 面；
    /// 若把 `channel` 与 `result_channel` 合成一个字段，`TeamPrincipal` 就无法同时
    /// 表达「能发 MCP、结果靠 sentinel」。
    #[test]
    fn channel_and_result_channel_are_derived_from_different_columns() {
        let cases: [(&str, WorkerChannel, ResultChannel); 4] = [
            // A 档：两条通道都在。
            ("claude-code", WorkerChannel::Mcp, ResultChannel::Mcp),
            // B 档：能发不能用 —— 结果靠 sentinel 打印。
            ("omp", WorkerChannel::None, ResultChannel::Sentinel),
            // C 档但有 MCP：能收（channel=Mcp）、报不了（sentinel）。
            ("grok", WorkerChannel::Mcp, ResultChannel::Sentinel),
            // C 档且只写配置文件、无传输：连发都发不进去。
            ("reasonix", WorkerChannel::None, ResultChannel::Sentinel),
        ];
        for (agent_id, channel, result_channel) in cases {
            let admission = admission_for(agent_id).expect("admitted");
            assert_eq!(admission.channel(), channel, "{agent_id} 的 channel");
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
