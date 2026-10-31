//! 团队域的测试夹具 —— **单一源**（`#[cfg(test)]` 域内的 `mod`，生产不编译）。
//!
//! # 为什么集中
//!
//! `Team` / `TeamMember` 是 17~18 个字段的全量结构体。曾经 8 个测试文件各写一份全量
//! 字面量，代价不是"重复几行"，而是**每加一个字段要改 8 处，且漏一处就编译不过**（好情况）
//! 或让某处的夹具悄悄落后于真实契约（坏情况：例如漏填新加的 `tier`，那个测试就再也
//! 证明不了"档位来自准入表"）。架构基本原则要求「重复 3 次以上必须抽象」，这里是 8。
//!
//! # 唯一的例外：`store.rs` 的 round-trip 夹具
//!
//! 仓库层要证明“每一列都能原样往返”，那里的 `sample_member` 刻意让每列都偏离默认值 ——
//! 用默认值打底会让“某列根本没写进库”这类 bug 变绿。除此之外的测试文件一律走本模块
//! （它们关心的是行为，不是列）。
//!
//! # 用法：默认值 + 覆盖
//!
//! 夹具给**能跑通的最小合法值**，测试只写它真正关心的字段：
//!
//! ```ignore
//! let m = TeamMember { role: MemberRole::Lead, ..fixture_member("w9@tm_1", TEAM) };
//! ```
//!
//! 覆盖写法让"这个测试关心什么"在 diff 里一眼可见 —— 全量字面量会让无关字段淹没意图。
//!
//! # 路径（红线 13）
//!
//! `project_path` 由 `CARGO_MANIFEST_DIR` 推导：**平台相关的绝对路径不许手写**
//! （无盘符的 `/tmp/x` 在 Windows 上 `is_absolute()` 恒 false）。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::agent::team::events::TeamNotifier;
use crate::agent::team::types::{
    AdmissionTier, ApprovalPolicy, McpInjection, MemberRole, MemberState, ResultChannel, Team,
    TeamConfig, TeamMember, TeamState, WorkerChannel, Workspace,
};

/// 夹具团队的 id（多数测试共用一个团队）。
pub(crate) const TEAM: &str = "tm_1";
/// 夹具成员 id。
pub(crate) const W1: &str = "w1@tm_1";

/// 一个 `Active` 团队；`project_path` 由 manifest 目录推导（红线 13）。
///
/// 配置五列一律取**缺省值**（空池 / `None` / `shared` / `queue` / 4）：需要非缺省配置的
/// 用例用 [`fixture_team_configured`]，那里的覆盖值在 diff 里一眼可见。
pub(crate) fn fixture_team(id: &str) -> Team {
    Team {
        id: id.into(),
        name: "T".into(),
        lead_session_id: "sess".into(),
        // 真实内置 id（`agent/builtin/providers.rs`），与 `fixture_member` 同口径。
        lead_agent_id: "claude-code".into(),
        project_path: PathBuf::from(env!("CARGO_MANIFEST_DIR")),
        created_at: 1_700_000_000_000,
        closed_at: None,
        state: TeamState::Active,
        allowed_agent_ids: Vec::new(),
        default_model: None,
        default_workspace: Workspace::default(),
        default_approval_policy: ApprovalPolicy::default(),
        max_members: crate::agent::team::types::DEFAULT_MAX_MEMBERS,
    }
}

/// 同一个团队，但用**给定配置**（池 / 上限 / 默认值）。
///
/// 五列的接线只写在这里：池子、上限、默认值这三处的判据各测试文件都要用，各写一份
/// 全量字面量会让「某个字段没接到 `Team` 上」这类缺陷在每个测试里看起来都像另一个问题。
pub(crate) fn fixture_team_configured(id: &str, config: &TeamConfig) -> Team {
    Team {
        allowed_agent_ids: config.allowed_agent_ids.clone(),
        default_model: config.default_model.clone(),
        default_workspace: config.default_workspace.clone(),
        default_approval_policy: config.default_approval_policy,
        max_members: config.max_members,
        ..fixture_team(id)
    }
}

/// 一名 `Spawned` 的 A 档 worker（能力列全填，红线 14 的诚实面）。
///
/// 默认值的三个约定：
///
/// - `agent_id` 用**真实内置 id**（`claude-code`），不是随手写的 `claude`：夹具一旦用了
///   不存在的 id，`admission_for(member.agent_id)` 那类断言就会以一个与测试无关的理由失败；
/// - `terminal_id` 形如 `term-{name}`（同批 PTY 夹具的命名），需要"没有终端"的测试覆盖成 `None`；
/// - `token_hash` 是**非空占位**：生产里空 hash 表示"尚未签发"，而夹具要表达的是"已落库的
///   普通成员"。需要"未签发"形态的测试自己覆盖成 `String::new()`。
pub(crate) fn fixture_member(id: &str, team_id: &str) -> TeamMember {
    let name = id.split('@').next().unwrap_or(id);
    TeamMember {
        id: id.into(),
        team_id: team_id.into(),
        name: name.to_owned(),
        role: MemberRole::Worker,
        agent_id: "claude-code".into(),
        model: None,
        session_id: None,
        terminal_id: Some(format!("term-{name}")),
        workspace: Workspace::Shared,
        // 与 `team_spawn` 的生产取值一致：CLI 成员的入站通道是 PTY
        // （`WorkerChannel::CLI_MEMBER`）。夹具偏离生产会让「通道对不对」这类
        // 断言永远测不到真实值。
        channel: WorkerChannel::CLI_MEMBER,
        result_channel: ResultChannel::Mcp,
        tier: AdmissionTier::A,
        approval_policy: ApprovalPolicy::Queue,
        mcp_injection: McpInjection::Argv,
        last_seq: 0,
        state: MemberState::Spawned,
        token_hash: "sha256:x".into(),
        joined_at: 1,
    }
}

/// 记录型事件端口：把每次失效脉冲的 `rev` 按到达顺序收下来。
///
/// 用它而不是「有没有被调过」的布尔值：脉冲契约有两半 —— **次数**（一次写恰好一次）与
/// **单调性**（`rev` 严格递增）。只记布尔就只能验前一半。
pub(crate) struct RecordingNotifier {
    pulses: Arc<Mutex<Vec<u64>>>,
}

impl RecordingNotifier {
    /// 空记录器。测试用 [`Self::pulses`] 读回。
    pub(crate) fn new() -> Self {
        Self {
            pulses: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// 已收到的 `rev` 序列（按到达顺序）。
    ///
    /// 毒锁不 panic：记录器只在测试里用，断言失败信息比 `PoisonError` 有用得多。
    pub(crate) fn pulses(&self) -> Vec<u64> {
        self.pulses
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

impl TeamNotifier for RecordingNotifier {
    fn pulse(&self, rev: u64) {
        self.pulses
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(rev);
    }
}

/// 什么都不做的执行者：只关心「端口有没有被调用」以外的测试用它打底。
///
/// 需要断言调用顺序 / 载荷的用例自己写记录型假体（见 `execution` 的 `Recorder`）；
/// 而 handler 级用例关心的是 RPC / 鉴权 / 授权矩阵，进程副作用不在断言范围内。
pub struct NoopExecutor;

#[async_trait::async_trait]
impl crate::agent::team::execution::MemberExecutor for NoopExecutor {
    async fn spawn(
        &self,
        _member_id: &str,
        _token: &str,
    ) -> Result<(), crate::common::error::AppError> {
        Ok(())
    }

    async fn deliver(
        &self,
        _member_id: &str,
        _message: &str,
    ) -> Result<(), crate::common::error::AppError> {
        Ok(())
    }
}
