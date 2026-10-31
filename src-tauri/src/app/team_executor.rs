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
//! # 一次 spawn 的六步
//!
//! ```text
//! 端点坐标        → 起进程前就知道「成员该连哪里」；端点没起来直接拒绝
//! 成员行 / 团队行  → 内存镜像（锁内无 I/O）
//! 项目环境        → 由团队根反查项目（`Team` 只持久化路径，不持凭证）
//! 启动计划        → 纯函数 + canonicalize（I/O ⇒ 阻塞池）
//! 配置目录        → 只有 `ConfigDir` 档有：mkdir + 符号链接镜像 + 该 CLI 自己的 `mcp add`
//! create_session  → 起 PTY（`Argv` 形态：不经 shell，无引号规则）
//! 回填 terminal_id→ 成员从此可被 `team_send` 投递（写库 ⇒ 阻塞池）
//! ```
//!
//! # 红线 3
//!
//! `plan_member_spawn`（`canonicalize`）、配置目录的全部 fs / 进程动作、
//! `set_member_terminal`（SQLite）与投递的 `150ms` 等待全部在 `AppRuntime::spawn_blocking` 里。
//! 只有 `create_session` 是 async。
//!
//! # 配置目录的归属（清理归谁）
//!
//! 隔离目录里有一份成员 token 的明文（CLI 自己写出的 `mcp.json`），所以它**不能被忘掉**：
//!
//! | 时机 | 谁清 |
//! | --- | --- |
//! | `mcp add` 或镜像失败 | 本文件的 [`provision_config_dir`]（失败即删，不留残留）|
//! | PTY 起进程失败 | 本文件的 `spawn`（删掉刚 provision 的目录）|
//! | 成员/团队关闭 | **关队命令**（尚未实现）—— 那是唯一有权判“这个成员真的不在了”的地方 |
//!
//! 成功路径**不在这里删**：目录还要给那个还在跑的成员进程读。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::agent::team::delivery::{self, DeliveryRoute};
use crate::agent::team::execution::{self, ConfigDirPlan, MemberExecutor, SpawnPlan};
use crate::agent::team::manager::now_millis;
use crate::agent::team::types::{Team, TeamMember};
use crate::common::error::AppError;
use crate::common::executor::SpawnOptions;
use crate::core::exec;
use crate::core::project::ProjectEnvironment;
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
        let environment = state
            .project_environment_for_path(&team.project_path)
            .await?;

        // 可执行程序名一次算出（含用户覆盖）：隔离目录的 `mcp add` 与 PTY 必须是**同一个**
        // 程序，否则会出现“配置写给了 A、成员跑的是 B”。
        let program = program_for(&state, &member.agent_id)?;

        // 计划：`canonicalize` 是 I/O ⇒ 阻塞池（红线 3）。纯函数本身在 `execution`。
        // 成员行按值搬进闭包；隔离配置目录的根由**组合根**给（Neeko 自己的状态目录）。
        let member_for_plan = member.clone();
        let endpoint_for_plan = endpoint.clone();
        let token_for_plan = token.to_owned();
        let state_root = state.storage_manager.get_config_dir().to_path_buf();
        let plan = state
            .runtime
            .spawn_blocking(move || {
                execution::plan_member_spawn(
                    &team,
                    &member_for_plan,
                    &endpoint_for_plan,
                    &token_for_plan,
                    &state_root,
                )
            })
            .await
            .map_err(|err| AppError::Unknown(format!("member spawn planning failed: {err}")))??;

        let SpawnPlan {
            cwd,
            env,
            args,
            credentials_env,
            config_dir,
        } = plan;

        // 隔离配置目录：唯一有 fs / 进程副作用的一步（红线 3 ⇒ 阻塞池）。
        let config_dir = match config_dir {
            Some(cfg) => {
                let program = program.clone();
                let cfg_for_provision = cfg.clone();
                let environment_for_provision = environment.clone();
                state
                    .runtime
                    .spawn_blocking(move || {
                        provision_config_dir(
                            &cfg_for_provision,
                            &program,
                            &environment_for_provision,
                        )
                    })
                    .await
                    .map_err(|err| {
                        AppError::Unknown(format!(
                            "provisioning the member config directory failed: {err}"
                        ))
                    })??;
                Some(cfg)
            }
            None => None,
        };

        // 启动 argv = 程序 + 注入档给的参数（+ Bypass 的旁路开关）。
        let argv = launch_argv(program, args, &member);
        let cwd_str = cwd.to_string_lossy().to_string();

        // 三份 env 合流：身份 → 凭证 → 配置目录重定向。
        // 前两份刻意分开（`SpawnPlan` 的文档），这里只是它们最终的同一张表。
        let mut extra_env = env;
        extra_env.extend(credentials_env);
        if let Some(cfg) = &config_dir {
            extra_env.extend(cfg.add_env.iter().cloned());
        }

        let session = match state
            .terminal_router
            .create_session(
                SessionSpec {
                    env: environment,
                    // 成员的工作树就是它的 Workspace 根（项目级产物落在同一处）。
                    workspace_root: cwd_str.clone(),
                    cwd: cwd_str,
                    cols: MEMBER_COLS,
                    rows: MEMBER_ROWS,
                    shell: None,
                    // **Argv 形态**：不经 shell，`--mcp-config` 里的 JSON 引号原样送达（红线 2）。
                    launch: Some(TerminalLaunch::Argv(argv)),
                    extra_env,
                },
                self.app.clone(),
            )
            .await
        {
            Ok(session) => session,
            Err(err) => {
                // 起进程失败：隔离目录里已有一份带 token 的 `mcp.json`，必须删掉
                // （成功时才留给成员读，见模块文档的归属表）。
                discard_config_dir(&state, config_dir).await;
                return Err(err);
            }
        };

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
fn launch_argv(program: String, mcp_args: Vec<String>, member: &TeamMember) -> Vec<String> {
    let mut argv = Vec::with_capacity(mcp_args.len() + 2);
    argv.push(program);
    argv.extend(mcp_args);

    // `approval_policy = Bypass` 时追加该 CLI 自己的旁路开关（per-CLI 数据，红线 15）。
    if let Some(admission) = crate::agent::team::admission_for(&member.agent_id) {
        argv.extend(admission.bypass_args(member.approval_policy));
    }
    argv
}

// ─────────────────── 配置目录 provisioning（唯一有 fs / 进程副作用的一步） ───────────────────

/// 把 `McpInjection::ConfigDir` 档的隔离目录备好，并让该 CLI 把 MCP 配置写进去。
///
/// 四步，顺序即契约：
/// ```text
/// mkdir -p        → 先有目录
/// 镜像（symlink）  → 必须在 CLI **首次运行之前**：它会自己创建空 `auth.json` 占位，
///                   那以后再链接就晚了一一成员会以为未登录
/// mcp add         → 由 CLI 自己写 `mcp.json`（格式归它，机制不解释）
/// 失败 → 删目录    → 目录里有 token 明文，不得留残留
/// ```
///
/// **必须在阻塞池里调**（`std::fs` + 一次子进程等待，红线 3）。
fn provision_config_dir(
    plan: &ConfigDirPlan,
    program: &str,
    environment: &ProjectEnvironment,
) -> Result<(), AppError> {
    if let Err(err) = provision_inner(plan, program, environment) {
        discard(plan);
        return Err(err);
    }
    Ok(())
}

/// [`provision_config_dir`] 的正体（失败后的清理留给调用层）。
fn provision_inner(
    plan: &ConfigDirPlan,
    program: &str,
    environment: &ProjectEnvironment,
) -> Result<(), AppError> {
    std::fs::create_dir_all(&plan.dir).map_err(|err| {
        AppError::Io(format!(
            "cannot create the isolated config directory {}: {err}",
            plan.dir.display()
        ))
    })?;

    // 红线 8：镜像源先规范化（符号链接与 `/var` ↔ `/private/var` 会让“同一个目录”
    // 有两种字符串身份，而下游的链接目标必须是真实路径）。
    let source = canonical_mirror_source(plan, program)?;

    mirror_entries(&plan.dir, &source, plan.mirror)?;
    run_add_command(program, plan, environment)
}

/// 规范化镜像源（红线 8）。
///
/// 两件事必须同时成立：
/// 1. **真实路径**而不是用户给的那个字符串 —— 符号链接（`/var` ↔ `/private/var`）会让
///    “同一个目录”有两种身份，于是隔离目录里的链接指向一个与用户配置不同的名字；
/// 2. **目录缺失即拒绝**：配置目录不存在意味着这台机器上该 CLI 从未初始化过，隔离目录里
///    不会有登录态。起一个未登录的成员在花名册上与正常成员一模一样 —— 那是我们能造出的
///    最糟的失败形态。
fn canonical_mirror_source(plan: &ConfigDirPlan, program: &str) -> Result<PathBuf, AppError> {
    std::fs::canonicalize(&plan.mirror_source).map_err(|err| {
        AppError::Unsupported(format!(
            "`{program}` has no user config directory at {} ({err}), so an isolated one could not \
             be populated from it; starting a member there would produce a not-logged-in process",
            plan.mirror_source.display()
        ))
    })
}

/// 把一个已 provision 的隔离目录删掉（失败清理点共用）。
///
/// `remove_dir_all` **不跟随符号链接**（标准库契约）：镜像进去的那些链接会被删掉，
/// 它们指向的用户文件不会被碰。
fn discard(plan: &ConfigDirPlan) {
    match std::fs::remove_dir_all(&plan.dir) {
        Ok(()) => log::info!(
            "[agent-team] removed the isolated config directory {}",
            plan.dir.display()
        ),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => log::warn!(
            "[agent-team] could not remove the isolated config directory {}: {err}",
            plan.dir.display()
        ),
    }
}

/// 异步侧的清理入口：fs 操作进阻塞池（红线 3）。
async fn discard_config_dir(state: &AppStateWrapper, plan: Option<ConfigDirPlan>) {
    let Some(plan) = plan else { return };
    let _ = state.runtime.spawn_blocking(move || discard(&plan)).await;
}

/// 把用户配置目录里的条目**以符号链接**镜像进隔离目录。
///
/// # 为什么不复制
///
/// 这几项里 `auth.json` 就是凭据。复制会让凭据多出第二份拷贝（第二处泄露面、第二处要
/// 归还的位置）；符号链接只有一份字节，两个目录看到的是同一个文件。
fn mirror_entries(dir: &Path, source: &Path, mirror: &[&str]) -> Result<(), AppError> {
    mirror_entries_with(&symlink_entry, dir, source, mirror)
}

/// [`mirror_entries`] 的可注入形式（`link` 供测试模拟不同平台的失败）。
///
/// # Windows 退化策略（只在这里发生）
///
/// Windows 未开开发者模式时建符号链接会 `PermissionDenied`。两道降级：
/// - **文件** → 复制（否则成员拿不到登录态，一个未登录的成员比一个多一份凭据副本更糟）；
/// - **目录** → 跳过并 warn（目录里是扩展/技能等附加物，缺了仍能跑；递归复制一个未知
///   大小的用户目录会带来不可控的耗时与空间）。
fn mirror_entries_with(
    link: &dyn Fn(&Path, &Path) -> std::io::Result<()>,
    dir: &Path,
    source: &Path,
    mirror: &[&str],
) -> Result<(), AppError> {
    for entry in mirror {
        let from = source.join(entry);
        // 缺失即跳过：不是每个用户都有 `themes/` / `skills/`。
        if !from.exists() {
            log::info!("[agent-team] {} is missing; not mirrored", from.display());
            continue;
        }
        let to = dir.join(entry);
        // 幂等：目录已 provision 过（重试起进程）就不重复建链。
        if std::fs::symlink_metadata(&to).is_ok() {
            continue;
        }
        match link(&from, &to) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
                if from.is_dir() {
                    log::warn!(
                        "[agent-team] cannot link directory {} (permission denied); skipping it",
                        from.display()
                    );
                } else {
                    // 明确的取舍：未登录的成员比多一份凭据副本更糟（见函数文档）。
                    std::fs::copy(&from, &to).map_err(|err| {
                        AppError::Io(format!(
                            "cannot link or copy {} to {}: {err}",
                            from.display(),
                            to.display()
                        ))
                    })?;
                    log::warn!(
                        "[agent-team] linked a copy of {} (permission denied); the user file is still the only source",
                        from.display()
                    );
                }
            }
            Err(err) => {
                return Err(AppError::Io(format!(
                    "cannot link {} to {}: {err}",
                    from.display(),
                    to.display()
                )))
            }
        }
    }
    Ok(())
}

/// 建一个符号链接（目录与文件都适用）。
///
/// 平台差异只允许出现在 **item 级门控**上（红线 10）：两个完整的函数各一条真实腿。
#[cfg(unix)]
fn symlink_entry(from: &Path, to: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(from, to)
}

/// Windows：目录与文件是两种 API（不区分会得到 `ERROR_INVALID_PARAMETER`）。
#[cfg(windows)]
fn symlink_entry(from: &Path, to: &Path) -> std::io::Result<()> {
    if from.is_dir() {
        std::os::windows::fs::symlink_dir(from, to)
    } else {
        std::os::windows::fs::symlink_file(from, to)
    }
}

/// 用该 CLI 自己的 `mcp add` 把 MCP 配置写进隔离目录（红线 1：走 `core::exec`）。
///
/// 非 0 退出即整个 spawn 失败：一个拿不到 MCP 配置的成员会“起得来、永远收不到任务”，
/// 而那种成员在花名册上与正常成员一模一样。
fn run_add_command(
    program: &str,
    plan: &ConfigDirPlan,
    environment: &ProjectEnvironment,
) -> Result<(), AppError> {
    let target = environment.to_exec_target();
    let args: Vec<&str> = plan.add_args.iter().map(String::as_str).collect();
    let env_pairs: Vec<(&str, &str)> = plan
        .add_env
        .iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect();

    let output = exec::collect_blocking_with(
        &target,
        SpawnOptions::new(program, &args).with_env(&env_pairs),
    )
    .map_err(|err| {
        AppError::Terminal(format!(
            "`{program}` could not register the team MCP server: {err}"
        ))
    })?;

    if output.exit_code != 0 {
        // 注意：错误里**不带完整 argv** —— 那里面有凭证明文（header 里的 token）。
        return Err(AppError::Terminal(format!(
            "`{program}` failed to register the team MCP server (exit {}): {}",
            output.exit_code,
            stderr_summary(&output.stderr)
        )));
    }
    Ok(())
}

/// stderr 的一行摘要（错误信息要能读，但不能把整段日志塞进 IPC 载荷）。
fn stderr_summary(stderr: &[u8]) -> String {
    const MAX_CHARS: usize = 300;
    let text = String::from_utf8_lossy(stderr);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return "no stderr output".to_string();
    }
    let summary: String = trimmed.chars().take(MAX_CHARS).collect();
    if trimmed.chars().count() > MAX_CHARS {
        format!("{summary}…")
    } else {
        summary
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::admission::{admission_for, render_argv, ConfigDirSpec, RenderContext};
    use crate::agent::team::execution::mcp_config_json;

    /// pi 那一行的 `ConfigDir` 事实（唯一来源：准入表）。
    ///
    /// 断言一律引用它而不是写第二份清单：`mirror` / `env` / `mcp_file` 漂移时这里跟着变，
    /// 于是测试断言的永远是**数据行**而不是另一份手抄。
    fn pi_spec() -> ConfigDirSpec {
        admission_for("pi")
            .expect("pi 在准入表里")
            .config_dir
            .expect("pi 用 ConfigDir 档")
    }

    /// 一个假“用户配置目录”：`mirror` 里的每一项都造出来（.json 造文件、其余造目录），
    /// 另外放一份**不该被镜像**的 `mcp.json`，并删掉一项来验证“缺失即跳过”。
    ///
    /// 路径全部由 `tempdir()` 推导（红线 13）。
    fn fake_user_config(spec: &ConfigDirSpec) -> tempfile::TempDir {
        let home = tempfile::tempdir().expect("home");
        for entry in spec.mirror {
            let path = home.path().join(entry);
            if entry.ends_with(".json") {
                std::fs::write(&path, b"{}").expect("write fixture file");
            } else {
                std::fs::create_dir_all(&path).expect("create fixture dir");
            }
        }
        // 上一次运行可能留下的 MCP 配置：它**不是**镜像项（CLI 会在隔离目录里自己写）。
        std::fs::write(home.path().join(spec.mcp_file), b"{\"mcpServers\":{}}")
            .expect("write mcp.json");
        // 缺失项：`mirror` 的最后一项删掉（“缺失即跳过”）。
        let missing = spec.mirror.last().expect("mirror 非空");
        let path = home.path().join(missing);
        if path.is_dir() {
            std::fs::remove_dir_all(&path).expect("remove fixture dir");
        } else {
            std::fs::remove_file(&path).expect("remove fixture file");
        }
        home
    }

    fn plan_at(dir: &Path, spec: ConfigDirSpec, source: &Path) -> ConfigDirPlan {
        ConfigDirPlan {
            dir: dir.to_path_buf(),
            mcp_file: spec.mcp_file,
            add_args: vec!["mcp".to_owned(), "add".to_owned(), "neeko-team".to_owned()],
            add_env: vec![(spec.env.to_owned(), dir.to_string_lossy().to_string())],
            mirror_source: source.to_path_buf(),
            mirror: spec.mirror,
        }
    }

    /// 镜像 = **符号链接**（凭据不多出第二份拷贝），缺失项跳过，`mcp.json` 不进来。
    ///
    /// 三条一起保护的是「隔离目录是用户配置的视图，不是副本」这个性质：一旦退化成复制，
    /// `auth.json` 就有了两份字节，而两份之中的任何一份都不会随另一份更新（成员登录态
    /// 会悄悄过期）。
    #[test]
    fn mirror_links_the_user_config_and_skips_missing_entries() {
        let spec = pi_spec();
        let home = fake_user_config(&spec);
        let source = std::fs::canonicalize(home.path()).expect("canonical source");
        let isolated = tempfile::tempdir().expect("isolated");

        mirror_entries(isolated.path(), &source, spec.mirror).expect("mirror");

        let missing = *spec.mirror.last().expect("mirror 非空");
        for entry in spec.mirror {
            let target = isolated.path().join(entry);
            if *entry == missing {
                assert!(
                    std::fs::symlink_metadata(&target).is_err(),
                    "{entry} 在用户配置里不存在，必须跳过而不是造一个空壳"
                );
                continue;
            }
            let meta = std::fs::symlink_metadata(&target)
                .unwrap_or_else(|err| panic!("{entry} 应已镜像：{err}"));
            assert!(
                meta.file_type().is_symlink(),
                "{entry} 必须是符号链接：复制会让凭据多一份拷贝"
            );
            assert_eq!(
                std::fs::read_link(&target).expect("read_link"),
                source.join(entry),
                "{entry} 必须指向**规范化后**的用户配置（红线 8）"
            );
        }
        assert!(
            !isolated.path().join(spec.mcp_file).exists(),
            "`{}` 不得被镜像：那正是 CLI 要在隔离目录里自己写的那一份（镜像会让它带上用户的旧配置）",
            spec.mcp_file
        );
    }

    /// 幂等：目录已 provision 过（重试起进程）时再镜像一次不得失败、不得改链接。
    ///
    /// 保护的不变量：`spawn` 的失败重试路径会再走一次同样的三步。第二次在建链接处失败
    /// 会让“重试”永远不可能成功（`File exists` 是个与用户意图无关的错误）。
    #[test]
    fn mirror_is_idempotent() {
        let spec = pi_spec();
        let home = fake_user_config(&spec);
        let source = std::fs::canonicalize(home.path()).expect("canonical source");
        let isolated = tempfile::tempdir().expect("isolated");

        mirror_entries(isolated.path(), &source, spec.mirror).expect("first pass");
        mirror_entries(isolated.path(), &source, spec.mirror).expect("second pass");

        assert!(isolated.path().join("auth.json").is_symlink());
    }

    /// Windows 未开开发者模式的退化：**文件**复制、**目录**跳过，且整体不失败。
    ///
    /// 判据是“成员的可用性优先于多一份凭据副本”（文件），而“不递归复制未知大小的用户
    /// 目录”优先（目录）。两条都是刻意的取舍，所以各有一条断言。
    #[test]
    fn a_denied_symlink_copies_files_and_skips_directories() {
        let spec = pi_spec();
        let home = fake_user_config(&spec);
        let source = std::fs::canonicalize(home.path()).expect("canonical source");
        let isolated = tempfile::tempdir().expect("isolated");
        let denied = |_: &Path, _: &Path| {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "symlinks need developer mode",
            ))
        };

        mirror_entries_with(&denied, isolated.path(), &source, spec.mirror)
            .expect("权限不足必须降级，而不是让整个 spawn 失败");

        // 文件 → 复制（内容一致，且它**不是**链接）。
        let auth = isolated.path().join("auth.json");
        let meta = std::fs::symlink_metadata(&auth).expect("auth.json");
        assert!(!meta.file_type().is_symlink());
        assert_eq!(
            std::fs::read(&auth).expect("read copy"),
            std::fs::read(source.join("auth.json")).expect("read source")
        );
        // 目录 → 跳过（`extensions` 是数据行里的目录项）。
        assert!(
            std::fs::symlink_metadata(isolated.path().join("extensions")).is_err(),
            "目录降级为跳过，不是递归复制"
        );
    }

    /// 失败清理：`mcp add` 失败 → 隔离目录被删（里面已有 token 明文）。
    ///
    /// 用**不存在的程序名**触发失败：单测禁止起真二进制（`check_unit_tests_spawn_real_binaries`），
    /// 而它们的判据是“走不走这条代码路径”——起不来的程序同样走完 provision 的整条链。
    #[test]
    fn a_failed_add_command_removes_the_isolated_directory() {
        let spec = pi_spec();
        let home = fake_user_config(&spec);
        let isolated = tempfile::tempdir().expect("isolated");
        let dir = isolated.path().join("member");
        let plan = plan_at(&dir, spec, home.path());

        let err = provision_config_dir(
            &plan,
            "neeko-no-such-cli-for-tests",
            &ProjectEnvironment::Local,
        )
        .expect_err("程序不存在 ⇒ 整个 spawn 必须失败");
        assert!(
            err.to_string().contains("neeko-no-such-cli-for-tests"),
            "错误必须点名 CLI：{err}"
        );
        assert!(
            !dir.exists(),
            "失败后不得留下隔离目录（里面有成员的 token 明文）"
        );
    }

    /// 镜像源必须先 **canonicalize**（红线 8）：链接目标必须是真实路径。
    ///
    /// 判据用“经符号链接给出的目录”：未规范化时链接目标会带着那个链接名（`home_link/…`），
    /// 于是一个目录在隔离区里指向了与用户配置**不同的字符串身份** —— 用户改了自己的配置，
    /// 成员读的可能是另一个地方，或者反之。
    #[test]
    fn the_mirror_source_is_canonicalized() {
        let spec = pi_spec();
        let home = fake_user_config(&spec);
        let link = tempfile::tempdir().expect("link parent");
        let linked_home = link.path().join("home_link");
        crate::common::testing::symlink_dir(home.path(), &linked_home);

        let plan = plan_at(&link.path().join("member"), spec, &linked_home);
        let source = canonical_mirror_source(&plan, "pi").expect("canonical source");

        assert_eq!(
            source,
            std::fs::canonicalize(home.path()).expect("canonical home"),
            "镜像源必须是真实路径，不能是用户给的那个链接"
        );
        assert!(!source.ends_with("home_link"));
    }

    /// 镜像源不存在 ⇒ **拒绝**，不降级成一个未登录的成员。
    ///
    /// 保护的不变量：配置目录缺失意味着这个 CLI 在这台机器上从未初始化过，隔离目录里
    /// 不会有登录态。起来一个未登录的成员在花名册上与正常成员一模一样 —— 那是我们能
    /// 造出的最糟的失败形态。
    #[test]
    fn a_missing_user_config_directory_is_refused() {
        let spec = pi_spec();
        let isolated = tempfile::tempdir().expect("isolated");
        let dir = isolated.path().join("member");
        let absent = isolated.path().join("no-such-home");
        let plan = plan_at(&dir, spec, &absent);

        let err = provision_config_dir(
            &plan,
            "neeko-no-such-cli-for-tests",
            &ProjectEnvironment::Local,
        )
        .expect_err("镜像源缺失必须拒绝");
        assert!(matches!(err, AppError::Unsupported(_)), "{err:?}");
        assert!(
            err.to_string().contains("no user config directory"),
            "{err}"
        );
        assert!(!dir.exists(), "拒绝路径也不留下目录");
    }

    /// 清理隔离目录不得碰用户文件（链接目标必须原样活着）。
    ///
    /// `remove_dir_all` 不跟随符号链接是**标准库契约**，但这条契约正是“删目录会不会
    /// 删掉用户 `auth.json`”的唯一防线 —— 它值得一条用例。
    #[test]
    fn discard_removes_the_directory_but_never_the_linked_sources() {
        let spec = pi_spec();
        let home = fake_user_config(&spec);
        let source = std::fs::canonicalize(home.path()).expect("canonical source");
        let isolated = tempfile::tempdir().expect("isolated");
        let dir = isolated.path().join("member");
        std::fs::create_dir_all(&dir).expect("mkdir");
        let plan = plan_at(&dir, spec, &source);
        mirror_entries(&dir, &source, spec.mirror).expect("mirror");
        assert!(dir.is_dir());

        discard(&plan);

        assert!(!dir.exists(), "隔离目录必须被删掉");
        assert!(
            source.join("auth.json").is_file(),
            "链接**目标**（用户自己的 auth.json）不得被删"
        );
    }

    /// stderr 摘要：空 → 可读一句话；超长 → 截断（错误信息不得变成一段日志）。
    #[test]
    fn stderr_summaries_are_short_and_never_empty() {
        assert_eq!(stderr_summary(b"  \n"), "no stderr output");
        assert_eq!(stderr_summary(b"boom\n"), "boom");
        let long = stderr_summary("x".repeat(1000).as_bytes());
        assert_eq!(long.chars().count(), 301, "300 字符 + 省略号");
        assert!(long.ends_with('…'));
    }

    /// **真实冒烟**（必须 `#[ignore]`）：本机装了 `pi` 才跑。
    ///
    /// ```bash
    /// cd src-tauri && cargo test --lib agent::team -- --ignored real_pi
    /// ```
    ///
    /// 它钉住两条**只有真跑才能证明**的事（其余都在纯函数层）：
    /// ① `PI_CODING_AGENT_DIR` 重定向真的让 `pi mcp add` 写进隔离目录；
    /// ② 用户自己的 `~/.pi/agent/mcp.json` 没有被创建 / 修改。
    #[test]
    #[ignore = "runs the real `pi` binary; needs pi installed and a populated ~/.pi/agent"]
    fn real_pi_writes_its_mcp_config_only_inside_the_isolated_directory() {
        let spec = pi_spec();
        let tmp = tempfile::tempdir().expect("tmp");
        let dir = tmp.path().join("member");
        let user_mcp = dirs::home_dir()
            .expect("home")
            .join(spec.home_subdir)
            .join(spec.mcp_file);
        let user_mcp_existed = user_mcp.exists();

        let url = "http://127.0.0.1:59999/team/mcp";
        let token = "smoke-token-0123456789";
        let mut plan = plan_at(
            &dir,
            spec,
            &dirs::home_dir().expect("home").join(spec.home_subdir),
        );
        plan.add_args = render_argv(
            spec.add_argv,
            // 这个忽略用例只验 `mcp add` 的落盘位置，不涉及角色 preamble。
            &RenderContext::new(mcp_config_json(url, token), url, token, None),
        )
        .expect("render");

        provision_config_dir(&plan, "pi", &ProjectEnvironment::Local).expect("provision");

        assert!(
            dir.join(spec.mcp_file).is_file(),
            "隔离目录里必须出现 `{}`（重定向没生效？）",
            spec.mcp_file
        );
        assert_eq!(
            user_mcp.exists(),
            user_mcp_existed,
            "用户全局 `{}` 不得被创建/修改：{}",
            spec.mcp_file,
            user_mcp.display()
        );
    }
}
