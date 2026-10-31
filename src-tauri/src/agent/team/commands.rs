//! 团队域的 `#[tauri::command]`（**极薄**，红线 6）。
//!
//! 四条命令：
//!
//! | 命令 | 方向 | 载荷 |
//! | --- | --- | --- |
//! | `start_team_session` | 写 | 建队 + 起队长 PTY（`create_team` 的唯一生产调用方）|
//! | `team_snapshot` | 读 | 团队行 + 花名册 + 任务板列（**无 `body`**，红线 4）|
//! | `team_task_detail` | 读 | 列视图 + 派活正文（点开才拉）|
//! | `team_launchable_agents` | 读 | 每个可选 agent 一条 `{ agentId, refusal }`（面板置灰依据）|
//!
//! 四条都只做「接收参数 → 校验 → 调度」：视图构造在 [`crate::agent::team::view`]，建队/起进程
//! 在 `bootstrap` + `execution`，准入判定在 [`crate::agent::team::admission`]（红线 6）。
//!
//! # 两条读命令**不做 principal 校验**（不是漏了）
//!
//! 它们是**本地 Tauri 入口**，不是 MCP 工具：调用方是本机用户点开自己机器上的面板。授权矩阵
//! [`crate::agent::team::authorize`] 回答的是「**成员**（模型进程）能不能对**队友**做某件事」——
//! 那是把不可信主体放进同一个写面之后的约束。本机用户不在这条判定里：他能直接写 `~/.neeko`，
//! 用面板比绕过面板去改库还费劲。MCP 侧（`mcp::dispatch`）仍然逐工具授权，那条路一行没动。
//!
//! # 读＝阻塞 I/O ⇒ 阻塞池（红线 3）
//!
//! 花名册走 `TeamStore::list_members`（rusqlite 同步 API）。两条读命令都通过
//! [`crate::common::runtime::run_blocking_result`] 进阻塞池：本域**不自己** spawn（同
//! `TeamManager` 的取舍），命令层是唯一知道自己在哪个 runtime 上的地方。
//!
//! # 为什么不叫「提升为队长」
//!
//! 提升在技术上不成立：CLI 的 MCP 配置是启动期读取的，已在跑的进程塞不进新的 MCP server。
//! 所以入口是**新开一个会话**（`bootstrap` 的模块文档详细记了这条裁决）。用户看到的差别
//! 只是「队长会话」是新开的那一个。
//!
//! # 顺序即契约（`start_team_session`）
//!
//! ```text
//! 端点门面        → 没有它，队长起来了也连不上工具面 ⇒ 先拒（此时库里什么也没有）
//! 规范化项目路径   → 信任根（红线 8），I/O ⇒ 阻塞池
//! plan_team        → 纯函数：准入 + 两行装配（拒绝都发生在写库之前）
//! create_team_with_lead → 一次写入，不留「没有队长的团队」
//! start_member     → **与成员完全同一条**执行路径（签发凭证 → 起 PTY → 回填句柄）
//! ```
//!
//! # 残余失败面（已记账，C11）
//!
//! `create_team_with_lead` 成功而 `start_member` 失败时，库里会留下「有队长行、无进程」的
//! 团队。那是两相位设计**刻意接受**的可查询状态（同 `team_spawn` 的失败语义），缺的是
//! 一条「重试起进程」的入口 —— 那是下一步，不在本命令里偷偷做回滚（回滚会删掉用户刚
//! 建的队，而失败原因可能只是 CLI 二进制没装）。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::agent::team::admission::{self, LaunchableAgent};
use crate::agent::team::bootstrap::{new_team_id, plan_team};
use crate::agent::team::execution;
use crate::agent::team::manager::now_millis;
use crate::agent::team::view::{self, TaskDetail, TeamSnapshot};
use crate::common::error::AppError;
use crate::common::runtime::run_blocking_result;
use crate::AppStateWrapper;

/// `start_team_session` 的返回：**队长能行动的三样**（队 / 成员 / 落脚的终端）。
#[derive(Debug, serde::Serialize)]
pub struct TeamSession {
    /// 新团队 id。
    pub team_id: String,
    /// 队长成员 id（`lead@{team}`）。
    pub member_id: String,
    /// 队长 PTY 的会话 id —— 前端据此在 dock 里打开那个终端。
    ///
    /// 理论上是 `Some`（`apply_reply` 已成功）；`None` 只会出现在「成员行绑定时被别处
    /// 改坏」这种不一致上，保留可空是为了不假装。
    pub terminal_id: Option<String>,
    /// 队员 MCP 配置里要连的端点（与执行层同源，便于排查）。
    pub endpoint_url: String,
}

/// 以队长身份开一个会话（建队 + 起队长 PTY）。
///
/// 参数：
/// - `agent_id`：队长用哪个 CLI（必须是准入表里的 A 档，且注入方式已实现）。
/// - `project_path`：团队根（**绝对**路径；会被规范化成信任根）。
/// - `name`：团队显示名（缺省取项目目录名）。
#[tauri::command]
pub async fn start_team_session(
    state: tauri::State<'_, AppStateWrapper>,
    agent_id: String,
    project_path: String,
    name: Option<String>,
) -> Result<TeamSession, AppError> {
    // 端点门面 = 成员 MCP 配置里的 URL + 签发凭证的端口 + 起进程的执行者。
    // 三样同源（一次取出，不可能只拿半个）；没有端点就没有工具面，也就没有队长 ——
    // 在**任何写入之前**拒绝，不留死团队。
    let surface = state.team_surface().ok_or_else(no_endpoint)?;

    // 信任根（红线 8）：I/O ⇒ 阻塞池（红线 3）。
    let runtime = Arc::clone(&state.runtime);
    let root = runtime
        .spawn_blocking(move || canonical_project_root(&project_path))
        .await
        .map_err(|err| AppError::Unknown(format!("resolving the project path failed: {err}")))??;

    // 纯计划：准入拒绝（包括「起得来但连不上工具面」）全部发生在写库之前。
    let now = now_millis();
    let bootstrap = plan_team(&agent_id, &root, name.as_deref(), &new_team_id(now), now)?;

    // 团队 + 队长一次写入。
    let manager = Arc::clone(&state.team_manager);
    let (team, lead) = (bootstrap.team.clone(), bootstrap.lead.clone());
    runtime
        .spawn_blocking(move || manager.create_team_with_lead(team, lead))
        .await
        .map_err(|err| AppError::Unknown(format!("creating the team failed: {err}")))??;

    // 与成员**完全同一条**执行路径：签发凭证（并认门）→ 起 PTY → 回填句柄。
    // 这里只调动作、不碰工具回复的类型 —— 本地入口不该依赖 MCP 的词汇。
    execution::start_member(
        surface.credentials.as_ref(),
        surface.executor.as_ref(),
        &bootstrap.lead.id,
    )
    .await?;

    let terminal_id = state
        .team_manager
        .member(&bootstrap.lead.id)
        .and_then(|member| member.terminal_id);

    log::info!(
        "[agent-team] team {} started with lead {} ({})",
        bootstrap.team.id,
        bootstrap.lead.id,
        agent_id
    );
    Ok(TeamSession {
        team_id: bootstrap.team.id,
        member_id: bootstrap.lead.id,
        terminal_id,
        endpoint_url: surface.endpoint_url,
    })
}

/// 面板的**能力面**：每个可选 agent 一条 `{ agentId, refusal }`。
///
/// 面板据此置灰并显示原因（prd R0.4：能力缺口必须在 UI 上可见，而不是让用户点到
/// 必然失败的按钮）。
///
/// # 只做三件事（红线 6）
///
/// 取 id 列表 → 交给纯函数 → 返回。准入判定**不在命令里**：它是
/// [`admission::launchable_agents`]（`builtin_configs` × `admission_for` × `launch_refusal`），
/// 与 `team_spawn` / `start_team_session` 共用同一个判据。命令里再写一遍的后果是
/// 「面板说能起、`team_spawn` 拒绝」——两侧各有一套真相，用户看到的是两个互相矛盾的回答。
///
/// # 为什么要包含“不在准入表里”的 agent
///
/// 用户自定义 CLI 就在那份清单里（`AgentManager` 含用户覆盖）。静默漏掉它们，面板上
/// 就不会出现那些永远起不来的选项 —— 看起来像“不支持”，实际是“我们没说”。
///
/// 锁定读出一个 id 清单（`Mutex` 不是阻塞 I/O，不进阻塞池）。
#[tauri::command]
pub fn team_launchable_agents(
    state: tauri::State<'_, AppStateWrapper>,
) -> Result<Vec<LaunchableAgent>, AppError> {
    let agent_ids: Vec<String> = state
        .agent_manager
        .lock()
        .map_err(AppError::from)?
        .get_agents()
        .into_iter()
        .map(|config| config.id)
        .collect();
    Ok(admission::launchable_agents(&agent_ids))
}

/// 团队快照（面板的数据源）。
///
/// 载荷：`{ team, members, tasks, tasksTruncated }`（camelCase，同仓里 `team_status` 的口径）。
/// `tasks` 里**没有** `body`（红线 4：派活正文长度无上限，见 [`view`] 的模块文档）；要正文
/// 走 [`team_task_detail`]。任务数超过 [`view::MAX_BOARD_TASKS`] 时截断并置
/// `tasks_truncated`（列载荷上界，不是分页）。
///
/// 未知 `team_id` → `NotFound`（信息里带 id）。
#[tauri::command]
pub async fn team_snapshot(
    state: tauri::State<'_, AppStateWrapper>,
    team_id: String,
) -> Result<TeamSnapshot, AppError> {
    let team_id = require_id(team_id, "team_id")?;
    let manager = Arc::clone(&state.team_manager);
    run_blocking_result(move || view::team_snapshot(&manager, &team_id)).await
}

/// 单个任务的详情（**点开才拉**）：列视图 + 派活正文。
///
/// 与「成员 transcript 按需拉取」同一条原则（design §7.3）：默认载荷只带恒定小的列，
/// 正文/全文只在用户真的要看的时候走一次 IPC。
///
/// 未知 `task_id` → `NotFound`（信息里带 id）。
#[tauri::command]
pub async fn team_task_detail(
    state: tauri::State<'_, AppStateWrapper>,
    task_id: String,
) -> Result<TaskDetail, AppError> {
    let task_id = require_id(task_id, "task_id")?;
    let manager = Arc::clone(&state.team_manager);
    run_blocking_result(move || view::task_detail(&manager, &task_id)).await
}

/// id 入参的**唯一**校验：不能为空。
///
/// 空白 id 给一句 `InvalidInput` 而不是让它落成 `NotFound`：两者对调用方含义完全不同
/// （「你传错了」vs「它不在了」），而 `team_id: ""` 几乎只能是面板的 bug。
fn require_id(value: String, field: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(format!("{field} must not be empty")));
    }
    Ok(trimmed.to_owned())
}

/// 一条统一的拒绝：「团队端点没起来」。
///
/// 两类调用（凭证 / URL）拿到**同一句**话：它们缺的是同一个东西，给两种措辞只会让
/// 排查者以为是两个故障。
fn no_endpoint() -> AppError {
    AppError::Unsupported(
        "the team mcp endpoint is not running, so a lead could not reach the tool surface; \
         refusing to create a team that has no way to be driven"
            .to_string(),
    )
}

/// 项目路径 → 规范化后的团队根。
///
/// **调用契约：必须在阻塞池里调**（`canonicalize` 是 `std::fs`，红线 3）。本函数不自己
/// `spawn`，与 `plan_member_spawn` / `TeamManager` 的取舍一致 —— 谁在 async 上下文里，
/// 谁负责把同步 I/O 挪出去。
///
/// 三条都在这一层判，因为它们共用同一个 I/O：
/// ① 存在且是目录（否则成员 PTY 的 `cwd` 起不来）；
/// ② `canonicalize`（`..` / 符号链接在 `starts_with` 判据下会产生与肉眼相反的答案，红线 8）；
/// ③ 规范化后仍是绝对路径（Windows 的 `\\?\` 前缀由 `canonicalize` 自己给出，这里只复核）。
fn canonical_project_root(raw: &str) -> Result<PathBuf, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(
            "project_path must not be empty".to_string(),
        ));
    }
    let path = Path::new(trimmed);
    let canonical = std::fs::canonicalize(path)
        .map_err(|err| AppError::Io(format!("project path {trimmed} is not usable: {err}")))?;
    if !canonical.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "project path {trimmed} is not a directory"
        )));
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 夹具路径由 manifest 目录推导（红线 13：不许手写平台相关的绝对路径）。
    const ROOT: &str = env!("CARGO_MANIFEST_DIR");

    #[test]
    fn a_project_root_is_canonicalized() {
        let root = canonical_project_root(ROOT).expect("manifest 目录可用");
        assert!(root.is_absolute());
        // 规范化是幂等的：这正是「同一棵树只有一种字符串身份」的要求。
        assert_eq!(
            root,
            canonical_project_root(&root.to_string_lossy()).expect("再规范化一次")
        );
    }

    #[test]
    fn an_empty_or_missing_project_root_is_refused() {
        let err = canonical_project_root("  ").expect_err("空路径必须拒绝");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");

        // 夹具由 manifest 目录推导（红线 13：不写平台相关的绝对路径）。
        let missing = Path::new(ROOT).join("this-directory-does-not-exist");
        let err =
            canonical_project_root(&missing.to_string_lossy()).expect_err("不存在的路径必须拒绝");
        assert!(matches!(err, AppError::Io(_)), "{err:?}");
    }

    /// 文件（不是目录）不能当团队根：成员 PTY 的 cwd 会是它，`create_session` 会失败得
    /// 更难懂。判据放在这里，错误就有可读来源。
    #[test]
    fn a_file_is_not_a_team_root() {
        let file = Path::new(ROOT).join("Cargo.toml");
        let err = canonical_project_root(&file.to_string_lossy()).expect_err("文件不是目录");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
    }

    /// 空白 id 是**入参错误**，不是 `NotFound`：两者对面板的含义完全不同
    /// （「你传错了」vs「它不在了」），而空串几乎只能是面板的 bug。
    #[test]
    fn an_id_is_validated_before_reaching_the_manager() {
        let err = require_id("   ".to_string(), "team_id").expect_err("空白 id");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
        assert!(err.to_string().contains("team_id"), "{err}");
        assert_eq!(require_id(" tm_1 ".to_string(), "team_id").unwrap(), "tm_1");
    }

    /// 端点缺失的两种调用拿到同一句理由（它们是同一个前提）。
    #[test]
    fn a_missing_endpoint_has_one_readable_reason() {
        let err = no_endpoint();
        assert!(matches!(err, AppError::Unsupported(_)), "{err:?}");
        assert!(err.to_string().contains("team mcp endpoint"), "{err}");
    }
}
