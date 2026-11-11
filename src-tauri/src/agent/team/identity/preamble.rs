//! 注入给队长 / 成员的**角色 preamble**（起进程时进 argv，不是任务体）。
//!
//! # 为什么需要它（真实故障）
//!
//! 被 spawn 的 CLI 是一个裸进程：它不知道自己是队长还是成员、不知道 team_id、不知道有
//! `task_create` / `team_wait` 这些工具，也不知道「不许自己动手，必须等」。用户的观察是
//! 「一个普通会话」——队长不会派活，成员不会 `task_claim`，于是即使任务板写满了字，
//! 也没有任何一个 agent 去读它。本文件就是那段**只在这里生成一次**的文本。
//!
//! # 为什么是纯函数
//!
//! 输入全是**已落库的事实**（团队行 / 成员行）+ 一份由准入表推导的可选成员清单，
//! 不读库、不读时钟、不读 `AgentManager`：所以两种角色的每一句话都能被单测直接问
//! 「它说了吗」，而不是靠启动一个真进程再肉眼读。
//!
//! # 三条不可协商的约束
//!
//! | 约束 | 为什么 |
//! |---|---|
//! | 工具名**从 [`TOOLS`] 派生** | 手写一份清单，新增工具时两处必然漂移；而漂移的表现是「模型不知道那个工具存在」——一个**不会报错**的缺陷 |
//! | 整段 ≤ [`MAX_PREAMBLE_CHARS`] | 它进 argv（有长度上限）**并且**进 CLI 的会话上下文（顶掉用户的真实指令） |
//! | **绝不含凭证** | preamble 会进模型上下文与会话记录；token 只走 header / env（`SpawnPlan::credentials_env`） |
//!
//! # 语言
//!
//! 文本是**英文**：这段是写给模型读的系统提示，多数 CLI 的模型对英文系统提示更稳；
//! 而本仓的代码注释仍是中文（两条不同的读者，各按各的习惯）。

use crate::agent::team::admission::{admission_for, tier_of, LaunchableAgent};
use crate::agent::team::mcp::schema::{known_wires, spec_for, ToolName};
use crate::agent::team::types::{AgentRoleHint, MemberRole, Team, TeamMember};

/// 整段 preamble 的字符上限。
///
/// 两个理由都要它：argv 有长度上限；而这段文本会进 CLI 的会话上下文，过长会顶掉
/// 用户真正的第一句话。判据是 [`tests::the_preamble_stays_within_the_argv_budget`]。
pub const MAX_PREAMBLE_CHARS: usize = 3200;

/// persona 正文的字符上限（[`RolePreset::preamble`](crate::agent::team::types::RolePreset)）。
///
/// persona 是**附加**在角色 preamble 之后的：成员版骨架已占 ~1600 字符，
/// persona 的余量以「拼完仍 ≤ [`MAX_PREAMBLE_CHARS`]」反推得出（判据：
/// [`tests::the_persona_fits_inside_the_preamble_budget`]）。超长在**保存时**拒绝
/// （manager 校验），不静默截断 —— 用户手写的文本被砍短比被拒绝更难排查。
pub const MAX_PERSONA_CHARS: usize = 350;

/// 把 persona 正文附加在角色 preamble 之后（成员行携带的快照；`None` / 空白 = 原样返回）。
///
/// 拼接点在**末尾**：前面的工具面、调用顺序、硬规则是每个成员相同的骨架，persona 是
/// 「这个人设在这个骨架上怎么干活」的补充。判据（同上）：拼完仍 ≤ [`MAX_PREAMBLE_CHARS`]。
#[must_use]
pub fn with_persona(base: String, persona: Option<&str>) -> String {
    let Some(text) = persona.map(str::trim).filter(|t| !t.is_empty()) else {
        return base;
    };
    let mut out = base;
    out.push_str("\nYour persona in this team (set by the human):\n");
    out.push_str(text);
    out.push('\n');
    out
}

/// 生成注入给队长 / 成员的**角色 preamble**。
///
/// # 入参
///
/// - `role`：调用方的意图。**正常路径恒等于 `member.role`**（两条入口都从行里取）——
///   放在参数位而不是从 `member` 读，是为了让「这条文本属于哪个角色」在调用点可见，
///   也让两种角色都能被同一个纯函数直接测。
/// - `team` / `member`：已落库的团队行与成员行（team_id、member_id、项目根都从这两行取）。
/// - `members`：可选成员清单，**由 [`crate::agent::team::options::options_for`] 给出**
///   （= 这个队的池内可启动者）。只有队长版会用到它。两个过滤已经在那一步做完：
///   ① 池子外的 CLI 不列（否则队长会挑一个永远被 `team_spawn` 拒绝的选项）；
///   ② `refusal` 非空的 CLI 不列（向队长宣传一个起不来的 CLI，等于让它反复撞同一个拒绝）。
///   本文件**不再**从准入表全量推导一次 —— 那会让 preamble 与 `team_options` /
///   `team_spawn` 对同一件事给出三个答案。
#[must_use]
pub fn preamble(
    role: MemberRole,
    team: &Team,
    member: &TeamMember,
    members: &[LaunchableAgent],
) -> String {
    match role {
        MemberRole::Lead => lead_preamble(team, member, members),
        MemberRole::Worker => worker_preamble(team, member),
    }
}

/// 队长版：工具面 → 调用顺序 → 硬规则 → 可 spawn 的 CLI → 第一步。
fn lead_preamble(team: &Team, member: &TeamMember, members: &[LaunchableAgent]) -> String {
    // 池位角色预设（面板上每个成员位挑好的 persona）：队长据此**按角色匹配**，
    // 而 `team_spawn` 不传 `persona` 时也会自动套用它（`resolve_persona` 的解析链）。
    let hints = &team.role_hints;
    let mut out = identity_block("the lead", team, member);
    out.push_str(
        "You coordinate a team of CLI agents. You do not do the work yourself; your members do.\n\n",
    );
    out.push_str(&tool_block());
    out.push_str(&format!(
        "\nOrder of work (plan -> staff by persona -> assign; never skip 2):\n\
         1. `{}` - read the roster: who is here, what they hold.\n\
         2. `{}` - read the pool: allowed CLIs, free slots, **each CLI's persona**.\n\
         3. **Plan first**: write every deliverable as its own task with `{}`, using \
         `depends_on` when one needs another's output. One vague task is a failed plan.\n\
         4. **Staff to the plan**: for each task spawn (or reuse an idle member with) the \
         persona that fits - pass `persona` explicitly when several candidates match.\n\
         5. `{}` - block until the named members or tasks settle; a timeout is a result.\n\n",
        wire(ToolName::TeamStatus),
        wire(ToolName::TeamOptions),
        wire(ToolName::TaskCreate),
        wire(ToolName::TeamWait),
    ));
    out.push_str(
        "Hard rules:\n\
         - `idle` is not `done`. A member's turn ending means it stopped talking, not that the \
         work is finished. Only `",
    );
    out.push_str(wire(ToolName::TaskUpdate));
    out.push_str(
        "` with state \"done\" proves completion, and the board is the only place that fact lives.\n\
         - Do not do the work yourself. After you spawn and assign, call `",
    );
    out.push_str(wire(ToolName::TeamWait));
    out.push_str(
        "` and block on it. Editing files while members work duplicates their work and destroys \
         the record of who did what.\n\
         - Never report a command or a result you did not actually produce. If you did not run \
         it, say so.\n\
         - `",
    );
    out.push_str(wire(ToolName::TeamSend));
    out.push_str(
        "` fails with `target_blocked` when that member is waiting for a human; surface that \
         instead of guessing.\n\n",
    );
    out.push_str(
        "Planning rules:\n\
         - A request is not a task: split it into separately reviewable units, each with an \
         explicit done criterion in its body.\n\
         - Match persona to work (research / implementation / review). If no persona fits, say so.\n\
         - Do not let one member take everything; parallelize where the plan allows.\n\n",
    );
    out.push_str(&spawnable_block(members, hints));
    out.push_str(&format!(
        "\nStart here: `{}` to see the roster and the pool, then `{}` to write the plan down as \
         tasks, then `{}` (or reuse an idle member) matched to each task, then `{}`.\n",
        wire(ToolName::TeamStatus),
        wire(ToolName::TaskCreate),
        wire(ToolName::TeamSpawn),
        wire(ToolName::TeamWait),
    ));
    out
}

/// 成员版：工具面 → 调用顺序 → 硬规则 → 第一步（**没有**可 spawn 的 CLI 清单）。
fn worker_preamble(team: &Team, member: &TeamMember) -> String {
    let mut out = identity_block("a worker", team, member);
    out.push_str(
        "The lead writes work onto the shared task board. You take tasks from that board and \
         report back to it; you do not invent your own scope.\n\n",
    );
    out.push_str(&tool_block());
    out.push_str(&format!(
        "\nOrder of work:\n\
         1. `{}` - see what is pending and what is already yours.\n\
         2. `{}` - claim one pending task, then work on it.\n\
         3. do the work the task body asks for.\n\
         4. `{}` - set state \"done\" (or \"failed\" / \"blocked\") with a short summary.\n\n",
        wire(ToolName::TaskList),
        wire(ToolName::TaskClaim),
        wire(ToolName::TaskUpdate),
    ));
    out.push_str(
        "Hard rules:\n\
         - `idle` is not `done`. Your turn ending finishes nothing: only `",
    );
    out.push_str(wire(ToolName::TaskUpdate));
    out.push_str(
        "` with state \"done\" does, and the lead reads the board, not your transcript. A task \
         that was never updated stays in progress forever.\n\
         - Claim before working: a task you never claimed is a task nobody knows you are doing.\n\
         - Never report a command or a result you did not actually produce.\n\
         - If you are blocked or you need a human, `",
    );
    out.push_str(wire(ToolName::TaskUpdate));
    out.push_str(
        "` with state \"blocked\" and say what you need. Do not guess at an approval.\n\
         - `",
    );
    out.push_str(wire(ToolName::TeamSend));
    out.push_str("` reaches the lead; `");
    out.push_str(wire(ToolName::TeamStatus));
    out.push_str("` shows the roster and the board.\n\n");
    // 授权矩阵里这两条是队长专属：不写出来的后果是成员花一个回合去撞一个必然的拒绝。
    out.push_str(&format!(
        "Hard boundary: `{}` and `{}` are lead-only. The server rejects them for a worker, so \
         do not spend a turn trying them.\n\n",
        wire(ToolName::TeamSpawn),
        wire(ToolName::TaskCreate),
    ));
    out.push_str(&format!(
        "Start here: `{}`, then `{}` the first pending task, then do the work.\n",
        wire(ToolName::TaskList),
        wire(ToolName::TaskClaim),
    ));
    out
}

/// 「你是谁、在哪」的三行头（两种角色共用，只有角色词不同）。
///
/// 项目根按原样嵌入（它已经由 `plan_team` / `bootstrap` 规范化为绝对路径）。
fn identity_block(role: &str, team: &Team, member: &TeamMember) -> String {
    format!(
        "You are {role} of Neeko team \"{}\" (team_id {}), the CLI agent `{}`.\n\
         Your member id is {}, and the team's project root is {}.\n",
        team.name,
        team.id,
        member.agent_id,
        member.id,
        team.project_path.display(),
    )
}

/// 工具面：**从 [`TOOLS`] 派生**（[`known_wires`] 是同一张表的可读列表）。
fn tool_block() -> String {
    format!(
        "Team tools (MCP server `neeko-team`; every call is scoped to this team):\n{}\n",
        known_wires(),
    )
}

/// 队长版独有：**这个队**允许 spawn 的 CLI（`refusal` 非空的一律不列）。
fn spawnable_block(members: &[LaunchableAgent], hints: &[AgentRoleHint]) -> String {
    // 每一行都带**角色**（池位预设）：队长的「按角色挑人」需要看得见角色，
    // 否则 `team_spawn(persona=…)` 的参数只能靠猜。没有预设的显式说 none。
    let roster = members
        .iter()
        .filter(|row| row.refusal.is_none())
        .filter_map(|row| {
            admission_for(&row.agent_id).map(|admission| {
                let persona = hints
                    .iter()
                    .find(|hint| hint.agent_id == row.agent_id)
                    .map_or("no preset persona", |hint| hint.persona.as_str());
                format!(
                    "{} (tier {:?}, persona: {persona})",
                    row.agent_id,
                    tier_of(admission)
                )
            })
        })
        .collect::<Vec<_>>();
    if roster.is_empty() {
        // 空清单不是「没有 CLI」而是「这个队的池子里没有可启动的 CLI」（池子被限制到 0 个
        // 可启动项，或本机的准入表推不出任何可启动项）—— 说出来，别让队长以为
        // `team_spawn` 的参数格式有问题。
        return "Worker CLIs you can spawn in this team: none is launchable for it right now, so \
                `team_spawn` will refuse every agent id; call `team_options` to read the pool.\n"
            .to_string();
    }
    format!(
        "Worker CLIs you can spawn in this team: {}\n",
        roster.join(", ")
    )
}

/// 工具 wire 名的**唯一来源**（[`spec_for`] 是那张表的查表原语）。
fn wire(name: ToolName) -> &'static str {
    spec_for(name).wire
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::admission::{admitted_agent_ids, launchable_agents};
    use crate::agent::team::fixtures::{fixture_member, fixture_team};
    use crate::agent::team::mcp::schema::TOOLS;
    use crate::agent::team::types::AdmissionTier;

    const TEAM: &str = "tm_1";
    const LEAD: &str = "lead@tm_1";
    const W1: &str = "w1@tm_1";

    /// 生产路径的成员清单：**准入表**（域内纯函数，不读 `AgentManager`）。
    fn roster() -> Vec<LaunchableAgent> {
        launchable_agents(&admitted_agent_ids(), MemberRole::Worker)
    }

    fn lead_member() -> TeamMember {
        TeamMember {
            role: MemberRole::Lead,
            ..fixture_member(LEAD, TEAM)
        }
    }

    fn worker() -> TeamMember {
        fixture_member(W1, TEAM)
    }

    fn lead_text() -> String {
        preamble(
            MemberRole::Lead,
            &fixture_team(TEAM),
            &lead_member(),
            &roster(),
        )
    }

    fn worker_text() -> String {
        preamble(
            MemberRole::Worker,
            &fixture_team(TEAM),
            &worker(),
            &roster(),
        )
    }

    /// 工具面**从表派生**：每一个 wire 名都必须出现在两种角色的文本里。
    ///
    /// 保护的不变量：工具清单一旦手写进文本，新增工具时就会漂移 —— 而漂移的表现是
    /// 「模型不知道那个工具存在」，一个不会在启动期报错的缺陷。遍历 [`TOOLS`]（而不是
    /// 一份字面量列表）让新增工具**自动**把这条测试变成红灯，逼着人决定它在文本里的位置。
    #[test]
    fn preamble_is_derived_from_the_tool_table() {
        for text in [lead_text(), worker_text()] {
            for spec in TOOLS {
                assert!(
                    text.contains(spec.wire),
                    "preamble 漏了工具 `{}`（工具清单必须从 TOOLS 派生）",
                    spec.wire
                );
            }
            // 派生的证据不只是「逐个出现」：那张表渲染出的整行也要原样在文本里。
            assert!(
                text.contains(&known_wires()),
                "工具面必须是 TOOLS 渲染出的同一行：{text}"
            );
        }
    }

    /// 队长版必须**命令式地禁止自己动手**，并点名 `team_wait` 是那个阻塞点。
    ///
    /// 保护的不变量：这正是本设计对「行业已知缺陷：lead 自己动手不等队友」的解法 ——
    /// 队长侧的等待是**工具调用语义**（后端阻塞），但「去调它」这件事只能靠这段文本。
    #[test]
    fn the_lead_preamble_forbids_doing_the_work_itself() {
        let lead = lead_text();
        assert!(
            lead.contains("You do not do the work yourself"),
            "队长版必须说明它不动手：{lead}"
        );
        assert!(
            lead.contains(
                "Do not do the work yourself. After you spawn and assign, call `team_wait`"
            ),
            "队长版必须把「派完活就阻塞等待」写成一条硬规则：{lead}"
        );
        assert!(lead.contains("You are the lead of Neeko team"));
        // 成员版不该收到「你是队长」的指令（角色错位 = 成员自己去派活）。
        let worker = worker_text();
        assert!(
            !worker.contains("You do not do the work yourself"),
            "{worker}"
        );
        assert!(worker.contains("You are a worker of Neeko team"));
    }

    /// 成员版必须**先 claim 再 update**，且把 `idle ≠ done` 说清。
    ///
    /// 保护的不变量：没有这两句，成员干完活就结束回合 —— 板上那条任务永远停在
    /// `in_progress`，队长等 `team_wait` 等到超时，而「成员偷懒」与「没人让它汇报」
    /// 在花名册上无法区分。
    #[test]
    fn the_worker_preamble_requires_claim_and_done() {
        let worker = worker_text();
        assert!(worker.contains("`task_claim`"), "{worker}");
        assert!(worker.contains("Claim before working"), "{worker}");
        // 队长专属工具要写出来（否则成员会花一个回合去撞一个必然的拒绝）。
        assert!(
            worker.contains("`team_spawn` and `task_create` are lead-only"),
            "{worker}"
        );
        assert!(
            worker.contains("only `task_update` with state \"done\" does"),
            "成员版必须说明回合结束 ≠ 任务完成：{worker}"
        );
        assert!(worker.contains("`task_update`"), "{worker}");
        // 顺序：claim 出现在 update 之前（它是工作顺序，不是一句并列的建议）。
        let claim = worker.find("`task_claim`").expect("claim");
        let update = worker.find("`task_update`").expect("update");
        assert!(claim < update, "claim 必须出现在 update 之前：{worker}");
    }

    /// 队长必须先**规划**再派人，并且知道每个 CLI 的角色（用户报障：lead 直接派一个
    /// 任务、不看角色池）。
    ///
    /// 判据不是「文本里有没有 plan 这个词」，而是三条承重句子都在：
    /// ① 计划先行且一个交付一个任务；② 按 persona 匹配；③ 池位清单带 persona。
    #[test]
    fn the_lead_is_told_to_plan_first_and_match_personas() {
        let lead = lead_text();
        assert!(
            lead.contains("Plan first"),
            "队长版必须要求先规划再委派：{lead}"
        );
        assert!(
            lead.contains("One vague task is a failed plan"),
            "必须把「一个含糊任务 = 失败的规划」说清楚：{lead}"
        );
        assert!(
            lead.contains("Staff to the plan"),
            "必须要求按计划配人（而不是抓第一个空闲的人）：{lead}"
        );
        assert!(
            lead.contains("persona that fits"),
            "必须要求把 persona 与任务类型匹配：{lead}"
        );
        // 池位清单里每个可用 CLI 都带 persona（没有预设的显式写 none）。
        assert!(
            lead.contains("persona: no preset persona"),
            "没有角色预设的 CLI 也要显式说明，不能让队长以为漏了：{lead}"
        );
    }

    /// 整段 ≤ [`MAX_PREAMBLE_CHARS`]：argv 有长度上限，且这段会顶掉用户的真实指令。
    ///
    /// 用一个**很深的**项目根一起断言：路径是唯一随环境变长的字段，只测短路径等于没测
    /// 边界（真实仓库根可以是两百多个字符）。
    #[test]
    fn the_preamble_stays_within_the_argv_budget() {
        let short = fixture_team(TEAM);
        let deep = Team {
            project_path: short
                .project_path
                .join("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                .join("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
            ..short.clone()
        };
        for team in [&short, &deep] {
            for (role, member) in [
                (MemberRole::Lead, lead_member()),
                (MemberRole::Worker, worker()),
            ] {
                let text = preamble(role, team, &member, &roster());
                let len = text.chars().count();
                assert!(
                    len <= MAX_PREAMBLE_CHARS,
                    "{role:?} 版 preamble 有 {len} 个字符，超出 {MAX_PREAMBLE_CHARS} 的预算"
                );
            }
        }
    }

    /// **绝不含凭证**：token 只走 header / env，preamble 会进模型上下文与会话记录。
    ///
    /// 用「hash 与明文两个负例」各断言一次：hash 在成员行上（夹具里非空），明文是执行层
    /// 才持有的一次性值 —— 两样都不该出现在这段文本里。
    #[test]
    fn the_preamble_never_carries_the_credential() {
        const PLAINTEXT: &str = "0123456789abcdef0123456789abcdef";
        let member = worker();
        assert!(!member.token_hash.is_empty(), "夹具必须带一个非空 hash");
        for text in [lead_text(), worker_text()] {
            assert!(
                !text.contains(&member.token_hash),
                "preamble 里出现了 `token_hash`：{text}"
            );
            assert!(
                !text.contains(PLAINTEXT),
                "preamble 里出现了凭证明文：{text}"
            );
        }
    }

    /// 身份事实按原样嵌入：team_id / member_id / 项目根 / agent id。
    ///
    /// 保护的不变量：这三样是 `team_spawn` / `task_update` 的入参来源。任何一个漏掉，
    /// 模型都只能靠猜（猜错的形态是「工具调用参数不合法」，而错误信息读起来像我们自己的 bug）。
    #[test]
    fn the_identity_facts_are_embedded_verbatim() {
        let team = fixture_team(TEAM);
        let member = worker();
        let text = preamble(MemberRole::Worker, &team, &member, &roster());
        for needle in [
            TEAM,
            W1,
            "claude-code",
            &team.project_path.display().to_string(),
        ] {
            assert!(text.contains(needle), "preamble 缺 `{needle}`：{text}");
        }
    }

    /// 可 spawn 的 CLI 清单**只有队长版有**，且 `refusal` 非空的一律不列。
    ///
    /// 保护的不变量：向队长宣传一个起不来的 CLI，等于让它反复撞同一个拒绝
    /// （`grok` 是 Subcommand 档、`omp` 无 MCP 面 —— 两条都已被 `launch_refusal` 拒绝）。
    #[test]
    fn only_the_lead_is_told_which_clis_it_can_spawn() {
        let lead = lead_text();
        let roster = roster();
        for row in &roster {
            match row.refusal {
                None => assert!(
                    lead.contains(&row.agent_id),
                    "队长版必须列出可 spawn 的 `{}`：{lead}",
                    row.agent_id
                ),
                Some(_) => assert!(
                    !lead.contains(&format!("{} (tier", row.agent_id)),
                    "队长版不得列起不来的 `{}`：{lead}",
                    row.agent_id
                ),
            }
        }
        // 具体形状：名字 + 档位（档位来自准入表的推导，不是这里手写的）。
        // 格式是 `{id} (tier {档}, persona: {角色})` —— 角色是「按角色挑人」的前提。
        assert!(lead.contains("claude-code (tier A, persona: "), "{lead}");
        assert!(lead.contains("pi (tier A, persona: "), "{lead}");
        // 成员版没有这份清单：它的世界里只有任务板。
        assert!(!worker_text().contains("Worker CLIs you can spawn"));
        // 空清单也要说话（而不是渲染成一句半截话）。
        let none = preamble(MemberRole::Lead, &fixture_team(TEAM), &lead_member(), &[]);
        assert!(
            none.contains("none is launchable for it right now"),
            "{none}"
        );
    }

    /// 档位来自**准入表**：清单里的 tier 与 `tier_of` 的推导逐条一致。
    ///
    /// 单独一条的理由：`spawnable_block` 里若改成手写档位，上面那条用例仍然会绿
    /// （它只查 `(tier ` 前缀），而这里会红。
    #[test]
    fn the_advertised_tier_comes_from_the_admission_table() {
        let lead = lead_text();
        for row in roster() {
            let Some(admission) = admission_for(&row.agent_id) else {
                continue;
            };
            let expected = format!("{} (tier {:?}, persona: ", row.agent_id, tier_of(admission));
            if row.refusal.is_none() {
                assert!(lead.contains(&expected), "档位必须与准入表一致：{expected}");
            }
        }
        // 反向：A 档之外不会有可 spawn 的行被误标成 A（`omp` 是 B 但被拒，`grok` 是 C 且被拒）。
        assert!(
            !lead.contains(&format!("omp (tier {:?})", AdmissionTier::B)),
            "{lead}"
        );
    }

    /// persona 附加在角色 preamble **之后**；`None` 与空白都原样返回（逐字节不变）。
    ///
    /// 保护的不变量：persona 是可选能力 —— 无人设的成员拿到的文本必须与旧版本
    /// **逐字节一致**，否则「加了 persona 层」就悄悄改变了所有既有成员的启动 argv。
    #[test]
    fn a_persona_is_appended_after_the_role_preamble() {
        let base = worker_text();
        assert_eq!(
            with_persona(base.clone(), None),
            base,
            "无人设必须逐字节不变"
        );
        assert_eq!(
            with_persona(base.clone(), Some("  ")),
            base,
            "空白等同无人设"
        );
        let with = with_persona(
            base.clone(),
            Some("Focus on research; never edit production code."),
        );
        assert!(
            with.starts_with(&base),
            "persona 必须附加在骨架之后：{with}"
        );
        assert!(
            with.contains("Your persona in this team"),
            "persona 段要有可识别的头：{with}"
        );
        assert!(with.contains("Focus on research"));
    }

    /// 拼上**最长合法**的 persona 后仍 ≤ [`MAX_PREAMBLE_CHARS`]：persona 的余量是
    /// 从角色 preamble 的预算里让出来的，超了就在保存时拒，不在 spawn 时爆。
    #[test]
    fn the_persona_fits_inside_the_preamble_budget() {
        let base = worker_text();
        let longest = "x".repeat(MAX_PERSONA_CHARS);
        let combined = with_persona(base, Some(&longest));
        let len = combined.chars().count();
        assert!(
            len <= MAX_PREAMBLE_CHARS,
            "骨架 + 最长 persona = {len} 字符，超出 {MAX_PREAMBLE_CHARS} 的预算 —— \
             先调 MAX_PERSONA_CHARS 或瘦身骨架，不要放宽断言"
        );
    }
}
