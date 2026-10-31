//! 授权矩阵 —— **纯函数**（design §3.2 逐格落地）。
//!
//! # 为什么是一个只吃 `(principal, tool)` 的函数
//!
//! 授权判据只有两个输入维度：**谁**（`TeamPrincipal.role`）与**想做什么**
//! （`ToolName`）。把它做成纯函数有三个直接收益：
//!
//! 1. 矩阵的 18 格（P2.5a 起从 16 格扩到 18 格：9 工具 × 2 角色）可以在一条表驱动
//!    测试里逐格断言（不需要起库、锁、线程）；
//! 2. 「谁能 close 团队」这类问题的答案只有一处，新增工具时 `match` 会强制补格；
//! 3. 它**不认识** `TeamManager`：授权与状态迁移彻底解耦，所以授权失败永远不会
//!    留下半截写操作。
//!
//! # 本函数**不**判的事
//!
//! - **任务归属**（「worker 只能改自己的任务」）：那需要读任务表，属 dispatch 的
//!   入参校验（[`crate::agent::team::mcp::dispatch`]）。本函数只知道角色，不知道任务。
//! - **团队存在性**：`TeamPrincipal` 是 token 解析的产物，能拿到它就说明团队与成员
//!   在签发时真实存在过。
//!
//! # 为什么拒绝用 `Conflict`
//!
//! `AppError` 没有 `Forbidden`，而 `TeamManager::force_done` 对「非本队队长」也返回
//! `Conflict`。在同一域里换一个错误类别会让调用方（MCP 路由组 / bridge）必须写两套
//! 分支才能区分「你没权限」与「状态不对」，收益为零。

use crate::agent::team::mcp::schema::{spec_for, ToolName};
use crate::agent::team::types::{MemberRole, TeamPrincipal};
use crate::common::error::AppError;

/// 按 design §3.2 的矩阵裁决：`Ok(())` = 允许，`Err(Conflict)` = 拒绝。
///
/// | 工具 | Lead | Worker |
/// |---|---|---|
/// | `team_status` / `team_send` / `task_list` | ✅ | ✅ |
/// | `task_claim` / `task_update` | ✅ | ✅（自有任务；归属判定在 dispatch） |
/// | `team_wait` | ✅ | ✅（design §3.2：通常只有队长用，但成员等同伴是合法的） |
/// | `task_create` / `team_close` / `team_spawn` | ✅ | ❌ |
pub fn authorize(principal: &TeamPrincipal, tool: ToolName) -> Result<(), AppError> {
    // 队长全通（含 `force_done` 那条越权路径 —— 它自带审计，由 manager 负责）。
    if principal.role == MemberRole::Lead {
        return Ok(());
    }
    // Worker 列：只有「建任务」「关团队」「建成员」三格被拒。其余放行 —— 其中
    // `task_claim` / `task_update` 的安全边界是**任务归属**（需要读任务表，判定在
    // `mcp::dispatch`）；`team_wait` 的边界是**团队归属**（只等得到本队成员/任务，
    // 判定在 `wait::build_snapshot` 的 `team_id` 过滤）。
    //
    // `team_spawn` 在拒的那一组：成员能建成员 = 无限扇出，绕过队长的工作量控制
    // （design §3.2 「成员不能做的事」第三条）。
    match tool {
        ToolName::TeamStatus
        | ToolName::TeamSend
        | ToolName::TaskClaim
        | ToolName::TaskUpdate
        | ToolName::TaskList
        | ToolName::TeamWait => Ok(()),
        ToolName::TaskCreate | ToolName::TeamClose | ToolName::TeamSpawn => {
            Err(AppError::Conflict(format!(
                "tool `{}` requires the lead role; member `{}` is a worker in team `{}`",
                spec_for(tool).wire,
                principal.member_id,
                principal.team_id
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::mcp::schema::ALL_TOOL_NAMES;
    use crate::agent::team::types::{AdmissionTier, WorkerChannel};

    fn principal(role: MemberRole) -> TeamPrincipal {
        TeamPrincipal {
            team_id: "tm_1".into(),
            member_id: match role {
                MemberRole::Lead => "lead@tm_1".into(),
                MemberRole::Worker => "w1@tm_1".into(),
            },
            role,
            channel: WorkerChannel::Mcp,
            tier: AdmissionTier::A,
        }
    }

    /// **逐格**：9 工具 × 2 角色 = 18 格，一格一行断言。
    ///
    /// 保护的不变量：design §3.2 的两列（Lead 全通、Worker 除 `task_create` /
    /// `team_close` / `team_spawn` 外全通）逐格落地。写表而不是写「worker 被拒的三条」
    /// 是因为**多给权限**是最难在 code review 里看出来的缺陷 —— 表驱动会让新增工具的
    /// 人必须先回答「worker 能不能调」。
    #[test]
    fn matrix_is_enforced_cell_by_cell() {
        let table: [(MemberRole, ToolName, bool); 18] = [
            // ── Lead 列（9 格，全通过）──
            (MemberRole::Lead, ToolName::TeamStatus, true),
            (MemberRole::Lead, ToolName::TeamSpawn, true),
            (MemberRole::Lead, ToolName::TeamSend, true),
            (MemberRole::Lead, ToolName::TaskCreate, true),
            (MemberRole::Lead, ToolName::TaskClaim, true),
            (MemberRole::Lead, ToolName::TaskUpdate, true),
            (MemberRole::Lead, ToolName::TaskList, true),
            (MemberRole::Lead, ToolName::TeamWait, true),
            (MemberRole::Lead, ToolName::TeamClose, true),
            // ── Worker 列（9 格：只差 task_create / team_close / team_spawn）──
            (MemberRole::Worker, ToolName::TeamStatus, true),
            (MemberRole::Worker, ToolName::TeamSpawn, false),
            (MemberRole::Worker, ToolName::TeamSend, true),
            (MemberRole::Worker, ToolName::TaskCreate, false),
            (MemberRole::Worker, ToolName::TaskClaim, true),
            (MemberRole::Worker, ToolName::TaskUpdate, true),
            (MemberRole::Worker, ToolName::TaskList, true),
            (MemberRole::Worker, ToolName::TeamWait, true),
            (MemberRole::Worker, ToolName::TeamClose, false),
        ];

        // 表格本身必须覆盖 18 格（9 工具 × 2 角色），否则「漏掉一格」会静默变成放行。
        assert_eq!(table.len(), ALL_TOOL_NAMES.len() * 2);
        for name in ALL_TOOL_NAMES {
            for role in [MemberRole::Lead, MemberRole::Worker] {
                assert!(
                    table.iter().any(|(r, t, _)| *r == role && *t == name),
                    "{role:?} × {name:?} 这一格没被断言"
                );
            }
        }

        for (role, tool, allowed) in table {
            let outcome = authorize(&principal(role), tool);
            let wire = spec_for(tool).wire;
            if allowed {
                assert!(
                    outcome.is_ok(),
                    "{role:?} 调 {wire} 应当允许，实际 {outcome:?}"
                );
            } else {
                let err = outcome.expect_err(&format!("{role:?} 调 {wire} 必须被拒"));
                assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
            }
        }
    }

    /// 拒绝信息必须可读且点名工具（写进 MCP 错误响应，模型要据此纠正自己）。
    ///
    /// 保护的不变量：错误里出现的是 **wire 名**而不是 `TaskCreate` 这种 Rust 变体名，
    /// 否则模型看到的是它从未见过的标识符。
    #[test]
    fn rejection_names_the_wire_tool_and_the_required_role() {
        let err = authorize(&principal(MemberRole::Worker), ToolName::TaskCreate).unwrap_err();
        let message = err.to_string();
        assert!(message.contains("task_create"), "{message}");
        assert!(message.contains("lead"), "{message}");
    }

    /// 通道与准入档**不影响**授权（授权只看角色）。
    ///
    /// 保护的不变量：`channel=Pty` / `tier=C` 的成员不是「降权成员」—— 它们的
    /// 能力差异已经由 `result_channel` / 档位在别处表达，混进授权矩阵会让
    /// 「C 档成员不能认领任务」这种无法实现的规则悄悄成立。
    #[test]
    fn channel_and_tier_do_not_change_the_verdict() {
        let worker = TeamPrincipal {
            channel: WorkerChannel::Pty,
            tier: AdmissionTier::C,
            ..principal(MemberRole::Worker)
        };
        for name in ALL_TOOL_NAMES {
            let base = authorize(&principal(MemberRole::Worker), name);
            let varied = authorize(&worker, name);
            assert_eq!(base.is_ok(), varied.is_ok(), "{name:?} 受通道/档位影响");
        }
    }
}
