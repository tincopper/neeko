//! 团队成员执行者的**生产实现**（[`MemberExecutor`] 的唯一 impl）。
//!
//! # 为什么在组合根（`app/`）而不是团队域
//!
//! 它要同时认识四样东西：`AppStateWrapper`（团队管理器 + terminal 路由 + 项目库）、
//! `AppHandle`（PTY 需要）、团队端点的 URL、`AgentManager`（成员要启动哪个程序）。把这四样
//! 放进团队域会让 `agent::team` → `app_state` → `agent::team` 成环。组合根是唯一同时认识
//! 两端的地方 —— 与 hooks 的 `ExtraConsumer` 接线同一个判据。
//!
//! 域侧只留**契约**（`execution::{MemberExecutor, CredentialLedger}` 与纯函数计划），
//! 因此那个域仍然可以在没有 `AppHandle`、没有 HTTP 的情况下被单测驱动。
//!
//! # 一次 spawn 的五步
//!
//! ```text
//! 端点坐标        → 起进程前就知道「成员该连哪里」；端点没起来直接拒绝
//! 成员行 / 团队行  → 内存镜像（锁内无 I/O）
//! 项目环境        → 由团队根反查项目（`Team` 只持久化路径，不持凭证）
//! 启动计划        → 纯函数 + canonicalize（I/O ⇒ 阻塞池）
//! create_session  → 起 PTY（`Argv` 形态：不经 shell，无引号规则）
//! 回填 terminal_id→ 成员从此可被 `team_send` 投递（写库 ⇒ 阻塞池）
//! ```
//!
//! # 红线 3
//!
//! `plan_member_spawn`（`canonicalize`）、`set_member_terminal`（SQLite）与投递的
//! `150ms` 等待全部在 `AppRuntime::spawn_blocking` 里。只有 `create_session` 是 async。

use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::agent::team::delivery::{self, DeliveryRoute};
use crate::agent::team::execution::{self, MemberExecutor};
use crate::agent::team::manager::now_millis;
use crate::agent::team::types::{Team, TeamMember};
use crate::common::error::AppError;
use crate::terminal::{SessionSpec, TerminalLaunch};
use crate::AppStateWrapper;

/// 成员 PTY 的初始尺寸（成员没有 UI 视图，给一个够用的默认值；要改走 `resize_session`）。
const MEMBER_COLS: u16 = 120;
const MEMBER_ROWS: u16 = 32;

/// 生产执行者：只持 `AppHandle`，其余状态在调用时从 Tauri 托管状态取。
///
/// 只持 `AppHandle`（不 clone 各 manager）是为了避免「服务器状态里再装一份 AppState」那种
/// 环：端点自己就挂在 `AppStateWrapper` 上。
pub struct PtyMemberExecutor {
    app: AppHandle,
}

impl PtyMemberExecutor {
    /// 由组合根构造（它才有 `AppHandle`）。
    #[must_use]
    pub const fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

#[async_trait::async_trait]
impl MemberExecutor for PtyMemberExecutor {
    async fn spawn(&self, member_id: &str, token: &str) -> Result<(), AppError> {
        let state = self.app.state::<AppStateWrapper>();

        // 端点没起来时**拒绝**：给成员一个空 URL 等于让它「起来了但连不上工具面」，
        // 而那种状态在花名册上看起来和正常成员一样。
        let endpoint = state.team_endpoint_url().ok_or_else(|| {
            AppError::Unsupported(
                "team mcp endpoint is not running; refusing to start a member that could not \
                 reach the tool surface"
                    .to_string(),
            )
        })?;

        // 成员行与团队行都是内存镜像（`TeamManager` 的锁内无 I/O）。
        let (member, team) = member_and_team(&state, member_id)?;
        // 环境是**项目**的事实，不是团队的：`Team` 只持久化 `project_path`（不持凭证）。
        // 反查失败 = 团队根不属于任何项目 ⇒ 拒绝（不降级成 Local，见该方法文档）。
        let env = state
            .project_environment_for_path(&team.project_path)
            .await?;

        // 计划：`canonicalize` 是 I/O ⇒ 阻塞池（红线 3）。纯函数本身在 `execution`。
        // 成员行按值搬进闭包（克隆一份给后面的 argv 用，省掉一次重复查表）。
        let member_for_plan = member.clone();
        let endpoint_for_plan = endpoint.clone();
        let token_for_plan = token.to_owned();
        let plan = state
            .runtime
            .spawn_blocking(move || {
                execution::plan_member_spawn(
                    &team,
                    &member_for_plan,
                    &endpoint_for_plan,
                    &token_for_plan,
                )
            })
            .await
            .map_err(|err| AppError::Unknown(format!("member spawn planning failed: {err}")))??;

        // 启动 argv = 该 agent 的可执行程序 + 准入表给的 MCP 参数（+ Bypass 的旁路开关）。
        let argv = launch_argv(&state, &member, &plan.args)?;
        let cwd = plan.cwd.to_string_lossy().to_string();

        let session = state
            .terminal_router
            .create_session(
                SessionSpec {
                    env,
                    // 成员的工作树就是它的 Workspace 根（项目级产物落在同一处）。
                    workspace_root: cwd.clone(),
                    cwd,
                    cols: MEMBER_COLS,
                    rows: MEMBER_ROWS,
                    shell: None,
                    // **Argv 形态**：不经 shell，`--mcp-config` 里的 JSON 引号原样送达（红线 2）。
                    launch: Some(TerminalLaunch::Argv(argv)),
                    extra_env: plan.env,
                },
                self.app.clone(),
            )
            .await?;

        // 回填句柄：成员从此可被 `team_send` 投递。写库同样进阻塞池。
        let manager = Arc::clone(&state.team_manager);
        let session_id = session.id.clone();
        let member_id_owned = member_id.to_owned();
        state
            .runtime
            .spawn_blocking(move || {
                manager.set_member_terminal(&member_id_owned, &session_id, now_millis())
            })
            .await
            .map_err(|err| AppError::Unknown(format!("binding member terminal failed: {err}")))??;

        log::info!(
            "[agent-team] member {member_id} started in session {}",
            session.id
        );
        Ok(())
    }

    async fn deliver(&self, member_id: &str, message: &str) -> Result<(), AppError> {
        let state = self.app.state::<AppStateWrapper>();
        let member = state
            .team_manager
            .member(member_id)
            .ok_or_else(|| AppError::NotFound(format!("member {member_id}")))?;

        // 通道选择是执行层策略（`delivery::route` 是纯函数，三档由数据决定）。
        // 不可投递的通道在这里拿到**可行动**的拒绝理由，而不是静默成功。
        let plan = match delivery::route(member.channel, message) {
            DeliveryRoute::Pty(plan) => plan,
            DeliveryRoute::Unsupported(why) => return Err(AppError::Unsupported(why.to_owned())),
        };

        let terminal_id = member.terminal_id.ok_or_else(|| {
            AppError::Unsupported(format!(
                "member `{member_id}` has no pty session yet (it was never started, or it has \
                 been retired), so the message cannot be written to its stdin"
            ))
        })?;

        // 投递 = emit + 150ms 等待 ⇒ 阻塞池（红线 3）。
        let app = self.app.clone();
        state
            .runtime
            .spawn_blocking(move || delivery::deliver_via_pty(&app, &terminal_id, &plan))
            .await
            .map_err(|err| AppError::Unknown(format!("delivering to member failed: {err}")))?
    }
}

/// 成员行 + 它的团队行（两者都在 `TeamManager` 的内存镜像里）。
///
/// 团队行是必需的一半：环境由 `team.project_path` 反查，而 `member` 只带 `team_id`。
fn member_and_team(
    state: &AppStateWrapper,
    member_id: &str,
) -> Result<(TeamMember, Team), AppError> {
    let member = state
        .team_manager
        .member(member_id)
        .ok_or_else(|| AppError::NotFound(format!("member {member_id}")))?;
    let team = state
        .team_manager
        .team(&member.team_id)
        .ok_or_else(|| AppError::NotFound(format!("team {}", member.team_id)))?;
    Ok((member, team))
}

/// 成员的启动 argv：`[program] ++ mcp args ++ bypass args`。
///
/// 程序名来自该 agent 的**已注册配置**（`AgentManager`，含用户覆盖），不是 id —— 拿 id
/// 当程序名猜是最容易在自定义 agent 上静默失败的做法。
fn launch_argv(
    state: &AppStateWrapper,
    member: &TeamMember,
    mcp_args: &[String],
) -> Result<Vec<String>, AppError> {
    let mut argv = Vec::with_capacity(mcp_args.len() + 2);
    argv.push(program_for(state, &member.agent_id)?);
    argv.extend(mcp_args.iter().cloned());

    // `approval_policy = Bypass` 时追加该 CLI 自己的旁路开关（per-CLI 数据，红线 15）。
    if let Some(admission) = crate::agent::team::admission_for(&member.agent_id) {
        argv.extend(admission.bypass_args(member.approval_policy));
    }
    Ok(argv)
}

/// `AgentConfig.id` → 可执行程序名（读 `AgentManager`，含用户覆盖）。
///
/// 查不到就拒绝：**不要**拿 id 当程序名猜。
fn program_for(state: &AppStateWrapper, agent_id: &str) -> Result<String, AppError> {
    let manager = state.agent_manager.lock().map_err(AppError::from)?;
    manager
        .get_agent(agent_id)
        .map(|config| config.command.clone())
        .filter(|command| !command.trim().is_empty())
        .ok_or_else(|| {
            AppError::Unsupported(format!(
                "agent `{agent_id}` is not a registered agent config with a launchable command, \
                 so a member cannot be started for it"
            ))
        })
}
