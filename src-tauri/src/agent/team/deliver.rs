//! **团队侧投递入口**：把一条 hook 事件喂给团队观察者（design §5.2 的第三路消费者）。
//!
//! ```text
//! POST /hook/{source} → validation → HookEvent
//!                          ├─ notify::project  → NotificationCenter（既有，逐字不变）
//!                          └─ team::deliver    → team::observe  ← 本文件
//! ```
//!
//! # 为什么团队观察者放在**消费方域**，而入口也在这里
//!
//! 依赖边是 `team → hooks`，不是 `hooks → team`。`ingest` 是 fail-open 的**常开路径**
//! （承载 8 个 CLI 的上报，与用户终端里 agent 的生死相关）：一旦让它认识团队域，团队域的
//! 任何编译错误或语义变更都会波及上报链路。放在本域，团队域整体可删而不影响上报。
//! 判据与例外说明记在 `.trellis/spec/backend/agent-hooks-domain.md`
//! 「消费者投影文件的位置（例外：团队观察者）」。
//!
//! 同一理由决定了**谁认识谁**的接线方向：`handlers::route_group`（hooks 侧）只知道
//! 自己有两个投递闭包，不认识团队域的词汇；两个消费者的知识汇聚在组合点，而团队侧的
//! 全部知识（拿 state → 调 observe → 吞错误）收在本文件。
//!
//! # fail-open（与 hooks 同源）
//!
//! 本文件**没有任何**向上传播错误的路径：入口返回 `()`，错误只进日志。理由与
//! `deliver_notification` 一致 —— handler 的契约是恒定 204，任何消费者都不许反压它
//! （B1/F10）。团队域收到一条坏数据的最坏后果必须只是「这块面板少一次刷新」。
//!
//! # 线程
//!
//! 本文件**不负责线程切换**：调用方（[`crate::agent::hooks::ingest::handlers::route_group`]）
//! 已经在 `AppRuntime::spawn_blocking` 里，且与通知消费者**共用同一次**阻塞任务
//! （红线 3：每条 hook 只占一个阻塞 worker）。这里的 SQLite 调用因此是安全的。

use tauri::Manager;

use crate::agent::hooks::ingest::event::HookEvent;
use crate::AppStateWrapper;

/// 生产投递：把这条 hook 事件喂给团队观察者。
///
/// 失败只记日志（fail-open，与 hooks 同源）：本函数不返回 `Result`，调用方**无法**
/// 把团队侧的问题变成通知侧的问题。
pub fn observe(app: &tauri::AppHandle, source: &str, event: &HookEvent) {
    // `try_state` 而非 `state`：后者在 state 未托管时 panic —— 一条团队事件不值得让
    // 阻塞 worker 带着 panic 退出（`spawn_blocking` 里 panic 只进 JoinError，但日志里
    // 会留下一段没人能解释的 backtrace）。启动顺序变了也不该变成崩溃。
    let Some(state) = app.try_state::<AppStateWrapper>() else {
        log::warn!("team::deliver skip: AppStateWrapper not managed (source={source})");
        return;
    };
    observe_in(&state, source, event);
}

/// 投递本体（与 `AppHandle` 解耦，供单元测试用 `isolated_state` 直测）。
///
/// 分工：[`observe`] 负责“从 `AppHandle` 找到 state”，本函数负责“拿 state 里的
/// `team_manager` 跑观察者并把错误翻成日志”。两件事分开的唯一理由是测试 ——
/// 集成测试是独立 crate，`tauri` 未开 `test` feature，造不出 `AppHandle`
/// （同 `handlers` 的既有取舍）。
/// **仅测试用**：不依赖 `tauri::AppHandle`（`tauri` 未开 `test` feature，测试造不出来）。
///
/// 生产路径请用 [`observe`]；这里的 `pub(crate)` 只是为了让同 crate 的测试能注入
/// 隔离的 `AppStateWrapper`，**不是**第二个生产入口。
pub(crate) fn observe_in(state: &AppStateWrapper, source: &str, event: &HookEvent) {
    match crate::agent::team::observe::observe(&state.team_manager, source, event) {
        // 跳过也是常态（非团队上下文 / 未知事件 / 陈旧 seq），故 debug 而非 info。
        Ok(outcome) => {
            log::debug!(
                "team::deliver source={source} event={} → {outcome:?}",
                event.event
            );
        }
        // 真实失败（库写不进去 / 审计失败）：只记日志，绝不 panic、绝不向上传播。
        Err(err) => {
            log::warn!(
                "team::deliver fail-open source={source} event={}: {err}",
                event.event
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::hooks::ingest::attribution::EnvHints;
    use crate::agent::team::fixtures::{fixture_member, fixture_team, TEAM, W1};
    use crate::agent::team::types::MemberState;
    use crate::common::testing::isolated_state;

    const SOURCE: &str = "claude";

    /// 一条带完整成员身份的上报。
    fn event(agent_session_id: &str, event_key: &str, seq: Option<u64>) -> HookEvent {
        HookEvent {
            agent_session_id: agent_session_id.into(),
            event: event_key.into(),
            cwd: None,
            detail: None,
            title: None,
            seq,
            hints: EnvHints {
                team_id: Some(TEAM.into()),
                team_member_id: Some(W1.into()),
                ..EnvHints::default()
            },
        }
    }

    /// **接线不变量**：经 `AppStateWrapper.team_manager`（而不是另建的管理器）就能推进
    /// 成员状态 —— 这正是本子任务要证明的一句话：团队域已经接进了组合根。
    ///
    /// 反证钉子：把 `app_state` 的 `team_manager` 换成第二个（未迁移的）池，
    /// 本用例会以 `no such table: team` 失败。
    #[test]
    fn observing_through_app_state_advances_the_member() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);
        state
            .team_manager
            .create_team(fixture_team(TEAM))
            .expect("create_team");
        state
            .team_manager
            .add_member(fixture_member(W1, TEAM))
            .expect("add_member");

        observe_in(&state, SOURCE, &event("agent-1", "turn_completed", Some(1)));

        assert_eq!(
            state.team_manager.member(W1).map(|m| m.state),
            Some(MemberState::Idle),
            "带完整身份的 turn_completed 必须经组合根把成员推到 Idle"
        );
    }

    /// **fail-open 不变量**：`agent_session_id` 不属于任何成员时，投递不 panic、不改状态。
    ///
    /// 观察者不读 `agent_session_id`（身份只认 env，design §5.4），所以“不属于任何成员”
    /// 有两条真实形态：① env 声明了一个库里没有的成员；② 库里成员所报团队不一致。
    /// 两条都必须在**同一个出口**安静跳过 —— 否则一条脏上报就能让阻塞 worker panic。
    #[test]
    fn unknown_member_is_skipped_without_touching_state() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);
        state
            .team_manager
            .create_team(fixture_team(TEAM))
            .expect("create_team");
        state
            .team_manager
            .add_member(fixture_member(W1, TEAM))
            .expect("add_member");

        // ① env 声明的成员不在库里。
        let mut ghost = event("ghost-session", "turn_completed", Some(1));
        ghost.hints.team_member_id = Some("ghost@tm_1".into());
        observe_in(&state, SOURCE, &ghost);

        // ② 成员在库里，但 env 声明的团队不一致（env 串队 / 伪造的第一道闸）。
        let mut crossed = event("agent-1", "turn_completed", Some(2));
        crossed.hints.team_id = Some("tm_other".into());
        observe_in(&state, SOURCE, &crossed);

        // 序列推进也不该发生：两条上报都没被本域消费。
        assert_eq!(
            state.team_manager.member(W1).map(|m| (m.state, m.last_seq)),
            Some((MemberState::Spawned, 0)),
            "跳过的上报不得改动成员状态，也不得推进 seq 水位线"
        );
    }

    /// **fail-open 不变量（真失败路径）**：store 写失败只进日志，不 panic、不留半截镜像。
    ///
    /// 制造方式：走 library 侧的同一个池把 `team` 父行删掉（`ON DELETE CASCADE` 连带删掉
    /// 成员行），内存镜像仍在 —— 于是 `store.upsert_member` 撞 `FOREIGN KEY constraint
    /// failed`。`TeamStore` 不接 trait、没有注入式假 store，这是唯一能拿到**真** `Err`
    /// 的可复现形态；也顺带证明 `observe_in` 的错误分支确实存在且被吞掉。
    #[test]
    fn store_failures_are_swallowed() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);
        state
            .team_manager
            .create_team(fixture_team(TEAM))
            .expect("create_team");
        state
            .team_manager
            .add_member(fixture_member(W1, TEAM))
            .expect("add_member");
        {
            let conn = state.library_store.pool().get().expect("pool conn");
            conn.execute("DELETE FROM team WHERE id = ?1", [TEAM])
                .expect("delete parent row (cascade removes the member row)");
        }

        observe_in(&state, SOURCE, &event("agent-1", "turn_completed", Some(1)));

        // 没有 panic 即通过；再断言失败不产生第三个真相源（库失败但内存被改写 = 分叉）。
        assert_eq!(
            state.team_manager.member(W1).map(|m| m.state),
            Some(MemberState::Spawned),
            "库写失败时内存镜像不得被半途改写"
        );
    }
}
