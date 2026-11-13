//! `team_resume` 的**全部语义**：把「离线成员」变回「同一个对话的新进程」。
//!
//! # 恢复 = 用同一份身份 + 同一份原生 id 重建资源
//!
//! 不是「把旧进程找回来」：进程句柄是进程期资源（跨重启必死）。可恢复的东西只有两件 ——
//! 成员行（身份）与 `agent_session_id`（这个成员的对话）。所以恢复的动作是
//! `admit` → `provision` → `spawn`（三相位不变），唯一的差别是启动行开头多一段
//! 「续接这个原生会话」的 argv 片段。
//!
//! # 这里没有 `if agent_id`（红线 15）
//!
//! 「哪个 CLI 怎么续接」是适配器的事实（`conversation::adapters::resume_argv_for`），
//! 本文件只做三件事：判定谁在候选集里、拿片段、交给 [`crate::agent::team::execution::start_member`]。
//! 片段为 `None` 的 CLI（qoder / gemini）落进 `cold{UnsupportedCli}` —— **绝不**静默起一个
//! 空白对话（那正是本任务要消灭的用户可见缺陷）。

use crate::agent::team::execution::{start_member, CredentialLedger, MemberExecutor};
use crate::agent::team::manager::{now_millis, TeamManager};
use crate::agent::team::types::{TeamMember, TeamState};
use crate::agent::team::view::MemberSessionLookup;
use crate::common::error::AppError;

/// 审计事件类别：一次恢复动作的**全景**（一次调用恰好一条）。
pub const EVENT_RESUME_TEAM: &str = "resume_team";
/// 审计事件类别：一名成员被恢复（逐成员一条）。
pub const EVENT_RESUME_MEMBER: &str = "resume_member";
/// 本机用户（面板）发起的动作的审计 actor —— 不是模型、不是 boot。
pub const LOCAL_ACTOR: &str = "neeko:local";

/// 一次恢复的结果：四个桶**互斥且穷尽**（每个候选成员只会在一个桶里）。
///
/// `resumed + skipped_already_live + cold + failed` = 候选集，没有第五种结局。
/// 这个不变式是 UI 的判据：面板不必再问一次「它到底怎么了」。
#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamResumeReport {
    /// 被恢复的团队。
    pub team_id: String,
    /// 真的起了新进程的成员（按 id 排序）。
    pub resumed: Vec<String>,
    /// 本来就有活进程、因此跳过的成员（幂等的证据）。
    pub skipped_already_live: Vec<String>,
    /// 只能新开的成员（没有原生 id，或该 CLI 没有续接形态）。
    pub cold: Vec<ColdMember>,
    /// 起不来的成员与原因（逐成员失败**不吞**：一个坏成员不能钉死整队）。
    pub failed: Vec<MemberFailure>,
}

/// 一个「只能新开」的成员。
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColdMember {
    /// 成员 id。
    pub member_id: String,
    /// 为什么回不来。
    pub reason: ColdReason,
}

/// 冷启动的两个理由（各自的修法不同：一个是「这个成员还没说过话」，另一个是「这个 CLI
/// 没有续接语法」）。
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ColdReason {
    /// 成员行上没有原生会话 id（它从未跑出一个回合，或历史被清过）。
    NoNativeSession,
    /// 有原生 id，但该 CLI 没有可用的续接形态（qoder / gemini）。
    UnsupportedCli,
}

/// 一个起不来的成员。
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberFailure {
    /// 成员 id。
    pub member_id: String,
    /// 原始错误（已带 `member_id` 的可读文本）。
    pub error: String,
}

/// 恢复一个团队的**进程**（`member_id = None`）或其中一名成员。
///
/// 语义（每一条都有测试）：
///
/// 1. 未知团队 ⇒ `NotFound`；`sealed` / `closing` ⇒ `Conflict`（两者理由不同：
///    一个是被用户关掉了，另一个正在拆，重试 `team_close` 才是下一步）。
/// 2. 候选集 = 该团队成员（按 id 排序）；`only_member` 收窄到一个，未知 id ⇒ `NotFound`。
/// 3. 已封存的成员**不是一个候选**（不落在任何桶里）：封存是用户决定，恢复不得撤销它。
/// 4. 有活进程 ⇒ `skipped_already_live`（幂等：进程才是活性的判据，不是成员行状态）。
/// 5. 没有原生 id ⇒ `cold{NoNativeSession}`；有 id 但 CLI 无续接形态 ⇒
///    `cold{UnsupportedCli}`。**绝不静默新开**。
/// 6. 否则 `start_member(.., Some(片段))`：成功 ⇒ `resumed` + `mark_member_resumed`，
///    失败 ⇒ `failed` 且继续下一个（一个坏成员不能钉死整队）。
/// 7. 审计：一次 `resume_team`（四个桶的 id + 计数）+ 每名成功成员一条 `resume_member`。
///    **argv 不进审计**（它含 MCP 凭证明文）。
///
/// # 为什么收 `&Arc<TeamManager>`（不是 `&TeamManager`）
///
/// 两次写库（`mark_member_resumed` / `record_team_resume`）必须进阻塞池（红线 3：管理器
/// 的写路径是同步 SQLite，而本函数在 async 上下文里）。`spawn_blocking` 的闭包要求
/// `'static`，所以调用方交出共享所有权；读路径（`team` / `members_of`）只读内存镜像，
/// 仍留在原线程。改为 `&TeamManager` 会让那两次写回到 tokio worker 上。
pub async fn resume_team(
    manager: &std::sync::Arc<TeamManager>,
    sessions: &dyn MemberSessionLookup,
    credentials: &dyn CredentialLedger,
    executor: &dyn MemberExecutor,
    team_id: &str,
    only_member: Option<&str>,
) -> Result<TeamResumeReport, AppError> {
    let team = manager
        .team(team_id)
        .ok_or_else(|| AppError::NotFound(format!("team `{team_id}` is not loaded")))?;
    match team.state {
        // 封存的队是**用户关掉的**：恢复它等于撤销一个明确决定（且成员行都已封存）。
        TeamState::Sealed => {
            return Err(AppError::Conflict(format!(
                "team `{team_id}` is sealed; a sealed team cannot be resumed — create a new team \
                 instead (sealed members keep their transcripts for history, but they are not \
                 restartable)"
            )))
        }
        // 拆到一半的队不能恢复：先把关闭走完（那个动作可重试、且会把凭证全部作废）。
        TeamState::Closing => {
            return Err(AppError::Conflict(format!(
                "team `{team_id}` is being closed, so it cannot be resumed; retry `team_close` \
                 to finish the teardown first"
            )))
        }
        TeamState::Open => {}
    }

    let candidates = candidates(manager, &team.id, only_member)?;
    let mut report = TeamResumeReport {
        team_id: team.id.clone(),
        ..TeamResumeReport::default()
    };
    let project_path = team.project_path.to_string_lossy().to_string();

    for member in candidates {
        // 封存是用户意图：不进任何桶（既不是成功也不是失败），恢复不能把它翻回来。
        if member.sealed_at.is_some() {
            continue;
        }
        // 活性只问拥有它的域（红线 17）：成员行上的 `state` 可能还在说 `offline`。
        if sessions.live_terminal_of(&team.id, &member.id).is_some() {
            report.skipped_already_live.push(member.id);
            continue;
        }
        let native = member
            .agent_session_id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty());
        let Some(native) = native else {
            report.cold.push(ColdMember {
                member_id: member.id,
                reason: ColdReason::NoNativeSession,
            });
            continue;
        };
        // 「这个 CLI 怎么续接」是适配器的事实（红线 15），位置由执行层决定。
        let Some(fragment) =
            crate::conversation::adapters::resume_argv_for(&member.agent_id, native, &project_path)
        else {
            // 有原生 id 但没续接语法：只能新开。**不静默新开** —— 那会让用户以为
            // 「恢复成功」，而对话从零开始（本任务要消灭的正是这个）。
            report.cold.push(ColdMember {
                member_id: member.id,
                reason: ColdReason::UnsupportedCli,
            });
            continue;
        };

        match start_member(credentials, executor, &member.id, Some(fragment)).await {
            Ok(_terminal_id) => {
                // 状态写库 ⇒ 阻塞池（红线 3）：`TeamManager` 的写路径是同步 SQLite，
                // 而本函数在 async 上下文里（只为 `start_member` 才需要 async）。
                let manager_for_write = std::sync::Arc::clone(manager);
                let id = member.id.clone();
                let written = crate::common::runtime::run_blocking_result(move || {
                    manager_for_write.mark_member_resumed(&id, now_millis())
                })
                .await;
                match written {
                    Ok(()) => report.resumed.push(member.id),
                    Err(err) => report.failed.push(MemberFailure {
                        member_id: member.id,
                        error: err.to_string(),
                    }),
                }
            }
            Err(err) => report.failed.push(MemberFailure {
                member_id: member.id,
                error: err.to_string(),
            }),
        }
    }

    // 全景审计写在循环之后：逐成员的失败不能让这次动作连记录都没有。写库 ⇒ 阻塞池
    // （红线 3，与上面那条同一个理由）。
    //
    // 这条审计失败 ⇒ 整条命令 `Err`（响亮失败）：进程可能其实都已起来，但重试幂等
    // （已 live 的成员 `skipped_already_live`）可自愈。与「逐成员失败不吞」不矛盾 ——
    // 那是「一个成员失败不拖累其他成员」，这里是「记录本身没写进去就必须让调用方知道」。
    let detail = resume_detail(&report);
    let manager_for_audit = std::sync::Arc::clone(manager);
    let team_id_owned = team.id.clone();
    crate::common::runtime::run_blocking_result(move || {
        manager_for_audit.record_team_resume(&team_id_owned, detail)
    })
    .await?;
    Ok(report)
}

/// 候选集：该团队的成员（按 id 排序），`only_member` 收窄到一个。
fn candidates(
    manager: &TeamManager,
    team_id: &str,
    only_member: Option<&str>,
) -> Result<Vec<TeamMember>, AppError> {
    let members = manager.members_of(team_id);
    let Some(only) = only_member else {
        return Ok(members);
    };
    members
        .into_iter()
        .find(|member| member.id == only)
        .map(|member| vec![member])
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "member `{only}` is not in team `{team_id}`; resuming is scoped to one team"
            ))
        })
}

/// `resume_team` 的审计 detail（camelCase JSON，四个桶的 id + 计数）。
///
/// **不放 argv**：启动行里有 MCP 凭证明文（`--mcp-config` 的 JSON / 隔离目录的参数），
/// 而审计行会进成员详情抽屉。
fn resume_detail(report: &TeamResumeReport) -> String {
    serde_json::json!({
        "resumed": report.resumed,
        "skippedAlreadyLive": report.skipped_already_live,
        "cold": report.cold,
        "failed": report.failed,
        "resumedCount": report.resumed.len(),
        "skippedAlreadyLiveCount": report.skipped_already_live.len(),
        "coldCount": report.cold.len(),
        "failedCount": report.failed.len(),
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        resume_team, ColdMember, ColdReason, MemberFailure, TeamResumeReport, EVENT_RESUME_MEMBER,
        EVENT_RESUME_TEAM, LOCAL_ACTOR,
    };
    use crate::agent::team::execution::{CredentialLedger, MemberExecutor};
    use crate::agent::team::fixtures::{fixture_member, fixture_team};
    use crate::agent::team::manager::TeamManager;
    use crate::agent::team::store::TeamStore;
    use crate::agent::team::types::{MemberState, Team, TeamMember, TeamState};
    use crate::agent::team::view::MemberSessionLookup;
    use crate::common::error::AppError;
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};

    const TEAM: &str = "tm_1";
    const LEAD: &str = "lead@tm_1";
    const W1: &str = "w1@tm_1";
    const W2: &str = "w2@tm_1";

    /// 根因判据（本任务的 I1/I2）：一个成员的「对话」是 `(agent_id, native_session_id)`。
    /// 夹具因此给每名成员一个**不同的**原生 id（`fixture_member` 的默认值三个人都一样，
    /// 那样 `resumed` 里的片段就无法区分「谁接着哪个对话」）。
    fn member(id: &str, role: crate::agent::team::types::MemberRole) -> TeamMember {
        let name = id.split('@').next().unwrap_or(id);
        TeamMember {
            role,
            agent_session_id: Some(format!("native-{name}")),
            state: MemberState::Offline,
            ..fixture_member(id, TEAM)
        }
    }

    fn seeded_members() -> Vec<TeamMember> {
        vec![
            member(LEAD, crate::agent::team::types::MemberRole::Lead),
            member(W1, crate::agent::team::types::MemberRole::Worker),
            member(W2, crate::agent::team::types::MemberRole::Worker),
        ]
    }

    /// 活会话集合（**可变**）：`resume_team` 的幂等靠它证明 —— 起进程成功后把它插进去，
    /// 第二次调用就必须看到「已经有进程」。
    #[derive(Default)]
    struct FakeSessions {
        live: Mutex<HashSet<(String, String)>>,
    }

    impl FakeSessions {
        fn mark_live(&self, team_id: &str, member_id: &str) {
            self.live
                .lock()
                .expect("live")
                .insert((team_id.to_owned(), member_id.to_owned()));
        }
    }

    impl MemberSessionLookup for FakeSessions {
        fn live_terminal_of(&self, team_id: &str, member_id: &str) -> Option<String> {
            self.live
                .lock()
                .expect("live")
                .contains(&(team_id.to_owned(), member_id.to_owned()))
                .then(|| format!("term-{member_id}"))
        }
    }

    /// 两个端口的调用记录（`admit` 与 `spawn` 是同一个角色的两半，共用一个记录器）。
    #[derive(Default)]
    struct Calls {
        admitted: Mutex<Vec<String>>,
        spawns: Mutex<Vec<(String, Option<Vec<String>>)>>,
    }

    type SharedCalls = Arc<Calls>;

    struct FakeExecutor {
        sessions: Arc<FakeSessions>,
        calls: SharedCalls,
        fail_for: Option<String>,
    }

    #[async_trait::async_trait]
    impl MemberExecutor for FakeExecutor {
        async fn spawn(
            &self,
            member_id: &str,
            _token: &str,
            resume_argv: Option<Vec<String>>,
        ) -> Result<String, AppError> {
            self.calls
                .spawns
                .lock()
                .expect("spawns")
                .push((member_id.to_owned(), resume_argv));
            if self.fail_for.as_deref() == Some(member_id) {
                return Err(AppError::Terminal(format!(
                    "member `{member_id}` could not be started: pty refused"
                )));
            }
            // 起进程成功 ⇒ 注册表里立刻有一条活会话（幂等的物理基础）。
            self.sessions.mark_live(TEAM, member_id);
            Ok(format!("term-{member_id}"))
        }

        async fn deliver(&self, _member_id: &str, _message: &str) -> Result<(), AppError> {
            panic!("恢复不该触发投递")
        }

        async fn close(&self, _member_id: &str) -> Result<(), AppError> {
            panic!("恢复不该触发关闭")
        }
    }

    struct FakeCredentials {
        calls: SharedCalls,
    }

    #[async_trait::async_trait]
    impl CredentialLedger for FakeCredentials {
        async fn admit(&self, member_id: &str) -> Result<String, AppError> {
            self.calls
                .admitted
                .lock()
                .expect("admitted")
                .push(member_id.to_owned());
            Ok(format!("token-{member_id}"))
        }

        async fn refresh(&self) -> Result<(), AppError> {
            panic!("恢复不撤凭证，不该刷新门")
        }
    }

    struct Harness {
        manager: Arc<TeamManager>,
        sessions: Arc<FakeSessions>,
        calls: SharedCalls,
        fail_for: Option<String>,
    }

    impl Harness {
        fn new() -> Self {
            Self::with_team(fixture_team(TEAM), seeded_members())
        }

        fn with_team(team: Team, members: Vec<TeamMember>) -> Self {
            let manager = TeamManager::new(TeamStore::open_in_memory().expect("in-memory store"));
            manager.create_team(team).expect("team");
            for member in members {
                manager.add_member(member).expect("member");
            }
            Self {
                manager: Arc::new(manager),
                sessions: Arc::new(FakeSessions::default()),
                calls: Arc::new(Calls::default()),
                fail_for: None,
            }
        }

        async fn resume(&self, only: Option<&str>) -> Result<TeamResumeReport, AppError> {
            let executor = FakeExecutor {
                sessions: Arc::clone(&self.sessions),
                calls: Arc::clone(&self.calls),
                fail_for: self.fail_for.clone(),
            };
            let credentials = FakeCredentials {
                calls: Arc::clone(&self.calls),
            };
            resume_team(
                &self.manager,
                self.sessions.as_ref(),
                &credentials,
                &executor,
                TEAM,
                only,
            )
            .await
        }

        fn spawns(&self) -> Vec<(String, Option<Vec<String>>)> {
            self.calls.spawns.lock().expect("spawns").clone()
        }

        fn spawn_call(&self, member_id: &str) -> Option<Option<Vec<String>>> {
            self.spawns()
                .into_iter()
                .find(|(id, _)| id == member_id)
                .map(|(_, fragment)| fragment)
        }

        fn events_of(&self, kind: &str) -> Vec<crate::agent::team::store::TeamEventRecord> {
            self.manager
                .events(TEAM)
                .expect("events")
                .into_iter()
                .filter(|event| event.kind == kind)
                .collect()
        }

        fn state_of(&self, member_id: &str) -> MemberState {
            self.manager.member(member_id).expect("member").state
        }
    }

    /// 恢复一个离线团队：每名成员都拿到**自己的**原生 id 片段，成员行回到 `spawned`。
    #[tokio::test]
    async fn resuming_a_team_restarts_every_offline_member_with_its_native_id() {
        let harness = Harness::new();
        let report = harness.resume(None).await.expect("resume");

        assert_eq!(report.team_id, TEAM);
        assert_eq!(report.resumed, vec![LEAD, W1, W2], "按 id 排序，一个不漏");
        assert!(report.skipped_already_live.is_empty());
        assert!(report.cold.is_empty());
        assert!(report.failed.is_empty());

        for member_id in [LEAD, W1, W2] {
            let native = format!("native-{}", member_id.split('@').next().unwrap());
            assert_eq!(
                harness.spawn_call(member_id),
                Some(Some(vec!["--resume".to_owned(), native])),
                "{member_id} 必须用**自己的**原生 id 续接（claude-code 的形态）"
            );
            assert_eq!(harness.state_of(member_id), MemberState::Spawned);
        }
        // 每个成员各签发一次凭证（admit 在 spawn 之前，顺序由 `start_member` 保证）。
        assert_eq!(harness.calls.admitted.lock().expect("admitted").len(), 3);
    }

    /// 没有原生 id ⇒ `cold{NoNativeSession}`，**不起进程**（不得静默新开）。
    #[tokio::test]
    async fn a_member_without_a_native_id_is_cold_and_not_started() {
        let mut cold = member(W1, crate::agent::team::types::MemberRole::Worker);
        cold.agent_session_id = None;
        let harness = Harness::with_team(
            fixture_team(TEAM),
            vec![
                member(LEAD, crate::agent::team::types::MemberRole::Lead),
                cold,
            ],
        );

        let report = harness.resume(None).await.expect("resume");

        assert_eq!(
            report.cold,
            vec![ColdMember {
                member_id: W1.to_owned(),
                reason: ColdReason::NoNativeSession,
            }]
        );
        assert_eq!(report.resumed, vec![LEAD]);
        assert_eq!(harness.spawn_call(W1), None, "冷成员不得被起进程");
        assert_eq!(harness.state_of(W1), MemberState::Offline);
    }

    /// 有原生 id 但该 CLI 没有续接形态（qoder）⇒ `cold{UnsupportedCli}`，同样不起进程。
    ///
    /// 这一条是本任务的核心承诺：**绝不**用一个空白对话冒充「恢复成功」。
    #[tokio::test]
    async fn a_cli_without_a_resume_form_is_cold_and_not_started() {
        let mut qoder = member(W1, crate::agent::team::types::MemberRole::Worker);
        qoder.agent_id = "qoder".into();
        assert!(
            qoder.agent_session_id.is_some(),
            "前提：它确实有过一个原生会话"
        );
        let harness = Harness::with_team(fixture_team(TEAM), vec![qoder]);

        let report = harness.resume(None).await.expect("resume");

        assert_eq!(
            report.cold,
            vec![ColdMember {
                member_id: W1.to_owned(),
                reason: ColdReason::UnsupportedCli,
            }]
        );
        assert!(report.resumed.is_empty());
        assert_eq!(harness.spawn_call(W1), None, "不支持续接 ⇒ 不得起进程");
    }

    /// 已经有活进程 ⇒ 跳过（成员行上的 `offline` 不是活性判据）。
    #[tokio::test]
    async fn a_live_member_is_skipped() {
        let harness = Harness::new();
        harness.sessions.mark_live(TEAM, W1);

        let report = harness.resume(None).await.expect("resume");

        assert_eq!(report.skipped_already_live, vec![W1]);
        assert_eq!(report.resumed, vec![LEAD, W2]);
        assert_eq!(harness.spawn_call(W1), None);
    }

    /// 再调一次是幂等的：第一次真的起了进程，第二次全部进 `skipped_already_live`。
    #[tokio::test]
    async fn resuming_twice_is_idempotent() {
        let harness = Harness::new();
        let first = harness.resume(None).await.expect("first");
        assert_eq!(first.resumed.len(), 3);

        let second = harness.resume(None).await.expect("second");
        assert!(second.resumed.is_empty(), "{second:?}");
        assert_eq!(second.skipped_already_live, vec![LEAD, W1, W2]);
        assert!(
            second.failed.is_empty() && second.cold.is_empty(),
            "已 live 不是失败也不是冷启动：{second:?}"
        );
        assert_eq!(harness.spawns().len(), 3, "第二次一次进程都没起");
    }

    /// `sealed` 团队拒绝（AC-9）：理由必须说「封存」，而不是「离线」。
    #[tokio::test]
    async fn a_sealed_team_is_refused() {
        let sealed = Team {
            state: TeamState::Sealed,
            sealed_at: Some(2),
            ..fixture_team(TEAM)
        };
        let harness = Harness::with_team(sealed, seeded_members());

        let err = harness.resume(None).await.expect_err("封存的队不可恢复");
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert!(err.to_string().contains("sealed"), "{err}");
        assert!(harness.spawns().is_empty(), "拒绝必须发生在起进程之前");
    }

    /// `closing` 团队拒绝，并指向「把关闭走完」这个可重试的下一步。
    #[tokio::test]
    async fn a_closing_team_is_refused() {
        let closing = Team {
            state: TeamState::Closing,
            ..fixture_team(TEAM)
        };
        let harness = Harness::with_team(closing, seeded_members());

        let err = harness
            .resume(None)
            .await
            .expect_err("关到一半的队不可恢复");
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert!(err.to_string().contains("team_close"), "{err}");
        assert!(harness.spawns().is_empty());
    }

    /// 已封存的成员**不在候选集里**（任何桶都没有它）：封存是用户决定，恢复不得撤销。
    #[tokio::test]
    async fn a_sealed_member_is_never_resumed() {
        let sealed = TeamMember {
            sealed_at: Some(7),
            ..member(W1, crate::agent::team::types::MemberRole::Worker)
        };
        let harness = Harness::with_team(
            fixture_team(TEAM),
            vec![
                member(LEAD, crate::agent::team::types::MemberRole::Lead),
                sealed,
            ],
        );

        let report = harness.resume(None).await.expect("resume");

        assert_eq!(report.resumed, vec![LEAD]);
        assert!(
            !report.skipped_already_live.contains(&W1.to_owned()),
            "封存成员不是「已 live」：{report:?}"
        );
        assert!(
            !report.cold.iter().any(|cold| cold.member_id == W1),
            "封存成员不是「冷启动」：{report:?}"
        );
        assert!(report.failed.is_empty());
        assert_eq!(harness.spawn_call(W1), None);
        assert_eq!(
            harness.manager.member(W1).expect("w1").sealed_at,
            Some(7),
            "封存时刻不得被恢复清掉"
        );
    }

    /// 一个成员起不来不影响其它人（逐成员失败不吞、继续下一个）。
    #[tokio::test]
    async fn one_failing_member_does_not_stop_the_others() {
        let mut harness = Harness::new();
        harness.fail_for = Some(W2.to_owned());

        let report = harness.resume(None).await.expect("部分失败不是整次失败");

        assert_eq!(report.resumed, vec![LEAD, W1]);
        assert_eq!(report.failed.len(), 1, "{report:?}");
        assert_eq!(report.failed[0].member_id, W2);
        assert!(report.failed[0].error.contains("pty refused"), "{report:?}");
        assert_eq!(
            harness.state_of(W2),
            MemberState::Offline,
            "起不来就还是离线"
        );
        // 失败不能吞掉全景审计。
        assert_eq!(harness.events_of(EVENT_RESUME_TEAM).len(), 1);
    }

    /// 只恢复一名成员：其它人一次进程都不起、状态不变。
    #[tokio::test]
    async fn resuming_one_member_leaves_the_others_alone() {
        let harness = Harness::new();

        let report = harness.resume(Some(W1)).await.expect("resume");

        assert_eq!(report.resumed, vec![W1]);
        assert_eq!(harness.spawns().len(), 1);
        assert_eq!(harness.state_of(LEAD), MemberState::Offline);
        assert_eq!(harness.state_of(W2), MemberState::Offline);
    }

    /// 成员级恢复把行写回 `spawned` 并留一条 `resume_member` 审计（带原生 id）。
    #[tokio::test]
    async fn a_resumed_member_goes_back_to_spawned_and_is_audited() {
        let harness = Harness::new();
        harness.resume(Some(W1)).await.expect("resume");

        assert_eq!(harness.state_of(W1), MemberState::Spawned);
        let events = harness.events_of(EVENT_RESUME_MEMBER);
        assert_eq!(events.len(), 1, "{events:?}");
        assert_eq!(events[0].actor, LOCAL_ACTOR);
        assert_eq!(events[0].subject.as_deref(), Some(W1));
        let detail = events[0].detail.as_deref().expect("detail");
        assert!(detail.contains("native=native-w1"), "{detail}");
        assert!(detail.contains("Spawned"), "{detail}");

        // 全景审计：一次调用恰好一条，且四个桶都在。
        let team_events = harness.events_of(EVENT_RESUME_TEAM);
        assert_eq!(team_events.len(), 1, "{team_events:?}");
        let detail = team_events[0].detail.as_deref().expect("detail");
        for key in [
            "resumed",
            "skippedAlreadyLive",
            "cold",
            "failed",
            "resumedCount",
        ] {
            assert!(detail.contains(key), "审计 detail 缺 `{key}`：{detail}");
        }
        assert!(
            !detail.contains("--resume"),
            "审计不得记录 argv（启动行里有凭证明文）：{detail}"
        );
    }

    /// 未知团队 / 未知成员都是 `NotFound`（分得清「拉错了」与「它不在了」）。
    #[tokio::test]
    async fn resuming_an_unknown_team_or_member_is_not_found() {
        let harness = Harness::new();
        let executor = FakeExecutor {
            sessions: Arc::clone(&harness.sessions),
            calls: Arc::clone(&harness.calls),
            fail_for: None,
        };
        let credentials = FakeCredentials {
            calls: Arc::clone(&harness.calls),
        };

        let err = resume_team(
            &harness.manager,
            harness.sessions.as_ref(),
            &credentials,
            &executor,
            "tm_missing",
            None,
        )
        .await
        .expect_err("未知团队");
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");

        let err = harness.resume(Some("w9@tm_1")).await.expect_err("未知成员");
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
        assert!(harness.spawns().is_empty());
    }

    /// 线上键名是跨栈契约（前端读 `report.skippedAlreadyLive` / `cold[].reason`）。
    #[tokio::test]
    async fn the_report_uses_camel_case_wire_keys() {
        let report = TeamResumeReport {
            team_id: TEAM.to_owned(),
            resumed: vec![W1.to_owned()],
            skipped_already_live: vec![W2.to_owned()],
            cold: vec![ColdMember {
                member_id: LEAD.to_owned(),
                reason: ColdReason::UnsupportedCli,
            }],
            failed: vec![MemberFailure {
                member_id: "w3@tm_1".to_owned(),
                error: "boom".to_owned(),
            }],
        };
        let json = serde_json::to_value(&report).expect("serialize");
        let mut keys: Vec<&str> = json
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec!["cold", "failed", "resumed", "skippedAlreadyLive", "teamId"]
        );
        let cold = &json["cold"][0];
        assert_eq!(cold["memberId"], LEAD);
        assert_eq!(cold["reason"], "unsupported_cli");
        let failed = &json["failed"][0];
        assert_eq!(failed["memberId"], "w3@tm_1");
        assert_eq!(failed["error"], "boom");

        // 另一个变体的线上名也是 snake_case（前端按字符串分支）。
        let no_native = serde_json::to_value(ColdReason::NoNativeSession).expect("serialize");
        assert_eq!(no_native, "no_native_session");
    }
}
