//! 团队观察者：`HookEvent` → 成员状态（design §5.2 / §5.6）。
//!
//! ```text
//! POST /hook/{source} → validation → HookEvent
//!                                    ├─ notify::project → NotificationCenter（既有，逐字不变）
//!                                    └─ team::observe     ← 本文件（新增第三路消费者）
//! ```
//!
//! 本模块只做四件事，且**每条失败路径都必须 fail-open**（不能拖累 204 与通知链路）：
//!
//! 1. `event_key → MemberSignal`（纯映射；未知键不是错误）
//! 2. 身份裁决（[`attribution_verdict`]：残缺身份直接拒，**不回退 cwd**，design §5.4）
//! 3. `seq` 单调去重（design §7.2 / AC12）
//! 4. 交给 [`TeamManager::observe_signal`] —— 状态迁移只有那一处实现
//!
//! # 为什么输入是 [`MemberSignal`] 而不是 `StreamEvent`
//!
//! design §5.6：Chat 成员本期不做，但观察点的**输入形状**必须现在就定下来，
//! 否则将来接线 Chat 侧时要把整个观察点重写。CLI 侧由 `HookEvent.event` 映射，
//! 将来 Chat 侧由 `StreamEvent` 映射 —— 两边共用同一条状态机。
//!
//! # `seq` 的两个坑
//!
//! - **`None` 不能丢**：旧版上报模板（以及任何尚未升级的 `neeko-report.mjs`）没有 `seq`，
//!   把「缺字段」当成「序号 0」会让升级期的成员**永久静默**。
//! - **水位线初值是 0**：因此 `seq` 必须从 **1** 起算。`seq=0` 的上报按陈旧丢弃
//!   （它不可能比「什么都没收到」更新）。这是一条上报侧契约，模板属于 P2 改动范围。
//!
//! # 未知事件为什么不算错误
//!
//! 上报模板比服务端新是**常态**（两端独立发版）。未知键只意味着「本域不消费它」，
//! 与 `ingest::event::HookEvent.event` 用字符串而非枚举的理由相同：枚举会把前向兼容
//! 变成反序列化失败。故 [`ObserveOutcome::SkippedUnknownAgent`] 同时承担
//! 「未知事件」「未知成员」「非团队上下文」「身份残缺」四种跳过 —— 对外只需要
//! 一个「本域没有动作」的结论（区别只在日志）。

use crate::agent::hooks::ingest::event::HookEvent;
use crate::agent::team::identity::attribution_verdict;
use crate::agent::team::identity::AttributionVerdict;
use crate::agent::team::manager::{now_millis, TeamManager};
use crate::agent::team::types::MemberSignal;
use crate::common::error::AppError;

/// 观察结果（调用方只关心「有没有动作」，细节进日志与审计）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ObserveOutcome {
    /// 已应用到成员（状态迁移 + 审计由 [`TeamManager::observe_signal`] 完成）。
    Applied {
        /// 被应用的成员 id。
        member_id: String,
    },
    /// 跳过：未知事件键 / 非团队上下文 / 身份残缺 / 成员不在本库。
    ///
    /// 名字沿用 design（AC12 的用例名），语义见模块文档「未知事件为什么不算错误」。
    SkippedUnknownAgent,
    /// `seq` 不大于水位线：重复或乱序的上报，**未调用** manager。
    StaleSeq,
}

/// hook 的语义键 → 成员信号；未知键 → `None`（fail-open，不报错）。
///
/// 键名与上报模板的 `argv[2]` 是**同一契约**（模板侧把各 CLI 原生事件名归一后传入），
/// 与源 A `agent::chat::notify::event_keys` 同命名空间。
#[must_use]
pub fn signal_for(event_key: &str) -> Option<MemberSignal> {
    match event_key {
        // L1：一轮结束（≠ 任务完成，硬规则 1）。
        "turn_completed" => Some(MemberSignal::TurnCompleted),
        // 审批门：成员在等人（design §6.1 的家）。
        "approval_requested" => Some(MemberSignal::ApprovalRequested),
        "input_requested" => Some(MemberSignal::InputRequested),
        // 本回合失败（≠ 进程死亡）。
        "session_failed" => Some(MemberSignal::Failed),
        // 未知键：模板比服务端新是常态，不是错误。
        _ => None,
    }
}

/// 观察一条 hook 事件（第三路消费者）。
///
/// `source` 只进日志（`&str` 是白名单归一后的 hook source，如 `claude`）—— 它**不**参与
/// 身份判定：身份只认 env（design §5.4）。
///
/// # 顺序（每一步都必须 fail-open）
///
/// 1. 事件键不是本域词汇 → 跳过（**不**动水位线：没消费凭什么记账）
/// 2. 身份裁决：残缺身份 → 跳过（不回退 cwd，design §5.4）
/// 3. 成员在当前库里，且属于 env 声明的团队 → 否则跳过
/// 4. `seq` 不大于水位线 → [`ObserveOutcome::StaleSeq`]，**不调 manager**
/// 5. 交给 [`TeamManager::observe_signal`]
///
/// 第 3 步在第 4 步之前：`seq` 是**成员级**水位线，没有成员就无处比较。
pub fn observe(
    manager: &TeamManager,
    source: &str,
    event: &HookEvent,
) -> Result<ObserveOutcome, AppError> {
    let Some(signal) = signal_for(&event.event) else {
        log::debug!(
            "team::observe skip: unknown event_key={} source={source}",
            event.event
        );
        return Ok(ObserveOutcome::SkippedUnknownAgent);
    };

    let (team_id, member_id) = match attribution_verdict(&event.hints) {
        AttributionVerdict::Accept { team_id, member_id } => (team_id, member_id),
        AttributionVerdict::RefuseIncomplete => {
            // design §5.4：残缺身份一律拒，**不得**回退 cwd 前缀。
            // 这是本模块最重要的一个分支：同 cwd 下回退就会把 A 的结果记到 B 头上。
            log::warn!(
                "team::observe refuse: incomplete team identity (team={:?}) source={source}",
                event.hints.team_id
            );
            return Ok(ObserveOutcome::SkippedUnknownAgent);
        }
        AttributionVerdict::NotTeamContext => {
            // 普通用户终端里的 CLI：不属本域，通知链路照旧。
            return Ok(ObserveOutcome::SkippedUnknownAgent);
        }
    };

    // 成员必须在库里，且团队上下文自报与实际归属一致（env 串队 / 伪造的第一道闸）。
    let Some(member) = manager.member(&member_id) else {
        log::debug!("team::observe skip: unknown member {member_id} source={source}");
        return Ok(ObserveOutcome::SkippedUnknownAgent);
    };
    if member.team_id != team_id {
        log::warn!(
            "team::observe skip: member {member_id} belongs to {}, env says {team_id}",
            member.team_id
        );
        return Ok(ObserveOutcome::SkippedUnknownAgent);
    }

    // `seq` 单调去重：`None`（旧模板）照常处理 —— 「缺字段」不等于序号 0。
    if let Some(seq) = event.seq {
        if !manager.note_signal_seq(&member_id, seq)? {
            return Ok(ObserveOutcome::StaleSeq);
        }
    }

    // 原生会话 id：每条上报都带着它，第一次见到就记下来 —— 「已退出的成员」
    // 之后要按它打开历史 transcript（见 `TeamMember::agent_session_id`）。
    if let Err(err) = manager.note_agent_session_id(&member_id, &event.agent_session_id) {
        // fail-open：记 id 失败不能拖累状态迁移与上报链路（本模块的头号纪律）。
        log::warn!("team::observe could not record native session id for {member_id}: {err}");
    }

    manager.observe_signal(&member_id, signal, now_millis())?;
    Ok(ObserveOutcome::Applied { member_id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::hooks::ingest::attribution::EnvHints;
    use crate::agent::team::fixtures::{fixture_member, fixture_team};
    use crate::agent::team::store::TeamStore;
    use crate::agent::team::types::{MemberRole, MemberState, TeamMember};
    use std::path::PathBuf;

    const TEAM: &str = "tm_1";
    const W1: &str = "w1@tm_1";
    const SOURCE: &str = "claude";

    /// 夹具路径由 `CARGO_MANIFEST_DIR` 推导（红线 13）。
    fn root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    fn member(id: &str, name: &str, role: MemberRole) -> TeamMember {
        TeamMember {
            name: name.into(),
            role,
            ..fixture_member(id, TEAM)
        }
    }

    /// 内存库（无文件路径 ⇒ 无需 tempdir）；一个团队 + 一名成员。
    fn seeded() -> TeamManager {
        let manager = TeamManager::new(TeamStore::open_in_memory().expect("in-memory store"));
        manager.create_team(fixture_team(TEAM)).expect("team");
        manager
            .add_member(member(W1, "w1", MemberRole::Worker))
            .expect("member");
        manager
    }

    /// 一条带完整成员身份的上报。
    fn event(event_key: &str, seq: Option<u64>) -> HookEvent {
        HookEvent {
            agent_session_id: "agent-1".into(),
            event: event_key.into(),
            cwd: None,
            detail: None,
            title: None,
            // 主线的 `title_source` 只服务标题域（团队观察不读标题）。
            title_source: None,
            seq,
            hints: EnvHints {
                team_id: Some(TEAM.into()),
                team_member_id: Some(W1.into()),
                ..EnvHints::default()
            },
        }
    }

    /// 语义键映射：每个已知键 → 对应信号；未知键 → `None`（fail-open）。
    #[test]
    fn signal_for_maps_every_known_key_and_rejects_unknown() {
        assert_eq!(
            signal_for("turn_completed"),
            Some(MemberSignal::TurnCompleted)
        );
        assert_eq!(
            signal_for("approval_requested"),
            Some(MemberSignal::ApprovalRequested)
        );
        assert_eq!(
            signal_for("input_requested"),
            Some(MemberSignal::InputRequested)
        );
        assert_eq!(signal_for("session_failed"), Some(MemberSignal::Failed));
        // 未知键不是错误：模板可以比服务端新。
        assert_eq!(signal_for("turn_started"), None);
        assert_eq!(signal_for(""), None);
    }

    /// 正向路径：带完整身份的 `turn_completed` → 成员态迁移（Spawned → Idle）。
    #[test]
    fn turn_completed_is_applied_to_the_member() {
        let manager = seeded();
        let outcome =
            observe(&manager, SOURCE, &event("turn_completed", Some(1))).expect("applied");
        assert_eq!(
            outcome,
            ObserveOutcome::Applied {
                member_id: W1.into()
            }
        );
        assert_eq!(manager.member(W1).expect("member").state, MemberState::Idle);
    }

    /// AC12：先到 `approval_requested(seq=5)`，后到 `turn_completed(seq=3)` → 后者丢弃，
    /// 成员仍是 `Awaiting`（乱序上报不得回滚状态）。
    #[test]
    fn stale_seq_is_dropped_and_state_stays_put() {
        let manager = seeded();
        observe(&manager, SOURCE, &event("approval_requested", Some(5))).expect("first");
        assert_eq!(
            manager.member(W1).expect("member").state,
            MemberState::Awaiting
        );

        let outcome = observe(&manager, SOURCE, &event("turn_completed", Some(3))).expect("second");
        assert_eq!(outcome, ObserveOutcome::StaleSeq);
        assert_eq!(
            manager.member(W1).expect("member").state,
            MemberState::Awaiting,
            "乱序上报不得改动成员状态"
        );
        assert_eq!(
            manager.member(W1).expect("member").last_seq,
            5,
            "陈旧上报不得降低水位线"
        );

        // 丢弃必须留痕（audit），否则「为什么状态没动」无从解释。
        let events = manager.events(TEAM).expect("events");
        assert!(
            events
                .iter()
                .any(|e| e.detail.as_deref().is_some_and(|d| d.contains("stale"))),
            "{events:?}"
        );
    }

    /// `seq = None`（旧模板）在 `last_seq = 9` 时**仍须处理** —— 缺字段不等于序号 0。
    #[test]
    fn missing_seq_is_processed_even_when_watermark_is_high() {
        let manager = seeded();
        observe(&manager, SOURCE, &event("turn_completed", Some(9))).expect("first");
        assert_eq!(manager.member(W1).expect("member").last_seq, 9);
        // 回到 Running 才能观察第二迁移（否则终态吸收会让断言变弱）
        manager
            .observe_signal(W1, MemberSignal::ApprovalRequested, 1)
            .expect("docs");
        assert_eq!(
            manager.member(W1).expect("member").state,
            MemberState::Awaiting
        );

        let outcome = observe(&manager, SOURCE, &event("input_requested", None)).expect("second");
        assert_eq!(
            outcome,
            ObserveOutcome::Applied {
                member_id: W1.into()
            },
            "无 seq 的旧模板不得被去重逻辑误杀"
        );
        assert_eq!(
            manager.member(W1).expect("member").state,
            MemberState::Awaiting
        );
    }

    /// `seq` 从 1 起算：水位线初值 0 ⇒ `seq=0` 的上报按陈旧丢弃（契约有测试兜住）。
    #[test]
    fn seq_zero_is_stale_against_the_initial_watermark() {
        let manager = seeded();
        let outcome =
            observe(&manager, SOURCE, &event("turn_completed", Some(0))).expect("skipped");
        assert_eq!(outcome, ObserveOutcome::StaleSeq);
        assert_eq!(
            manager.member(W1).expect("member").state,
            MemberState::Spawned,
            "陈旧上报不得改动成员状态"
        );
    }

    /// 未知成员（env 指向一个本库没有的成员）→ 跳过，不 panic、不建成员。
    #[test]
    fn unknown_member_is_skipped_without_panic() {
        let manager = seeded();
        let mut e = event("turn_completed", Some(1));
        e.hints.team_member_id = Some("ghost@tm_1".into());
        let outcome = observe(&manager, SOURCE, &e).expect("skipped");
        assert_eq!(outcome, ObserveOutcome::SkippedUnknownAgent);
        assert!(manager.member("ghost@tm_1").is_none());
    }

    /// 非团队上下文（两个 env 都没有）→ 跳过，既有通知链路行为不变。
    #[test]
    fn non_team_context_is_skipped() {
        let manager = seeded();
        let mut e = event("turn_completed", Some(1));
        e.hints = EnvHints::default();
        assert_eq!(
            observe(&manager, SOURCE, &e).expect("skipped"),
            ObserveOutcome::SkippedUnknownAgent
        );
        assert_eq!(
            manager.member(W1).expect("member").state,
            MemberState::Spawned
        );
    }

    /// 身份残缺（有 team 无 member）→ 跳过。
    ///
    /// 这就是 design §5.4 的串台保护：同 cwd 下 `turn_completed` **不得**因为
    /// cwd 命中了团队根就被判给某个成员。
    #[test]
    fn incomplete_identity_is_skipped_not_attributed_by_cwd() {
        let manager = seeded();
        let mut e = event("turn_completed", Some(1));
        e.cwd = Some(root().to_string_lossy().into_owned());
        e.hints.team_id = Some(TEAM.into());
        e.hints.team_member_id = None;
        assert_eq!(
            observe(&manager, SOURCE, &e).expect("skipped"),
            ObserveOutcome::SkippedUnknownAgent
        );
        assert_eq!(
            manager.member(W1).expect("member").state,
            MemberState::Spawned
        );
    }

    /// 未知事件键 → 跳过（且**不**动水位线：本域没消费它，凭什么记账）。
    #[test]
    fn unknown_event_key_is_skipped_and_keeps_watermark() {
        let manager = seeded();
        assert_eq!(
            observe(&manager, SOURCE, &event("turn_started", Some(7))).expect("skipped"),
            ObserveOutcome::SkippedUnknownAgent
        );
        assert_eq!(manager.member(W1).expect("member").last_seq, 0);
    }

    /// env 里的 team 与成员实际所属团队不一致 → 跳过（env 串队 / 伪造）。
    #[test]
    fn cross_team_identity_is_skipped() {
        let manager = seeded();
        let mut e = event("turn_completed", Some(1));
        e.hints.team_id = Some("tm_other".into());
        assert_eq!(
            observe(&manager, SOURCE, &e).expect("skipped"),
            ObserveOutcome::SkippedUnknownAgent
        );
        assert_eq!(
            manager.member(W1).expect("member").state,
            MemberState::Spawned
        );
    }
}
