//! 租约回收的**时间驱动**部分：谁让 [`TeamManager::reclaim_expired`] 真的被周期调用。
//!
//! # 为什么必须有驱动器（AC3）
//!
//! 纯函数 `lease_expired` 与状态迁移 `reclaim_expired` 早已实现并测过，但**没有任何生产
//! 调用方** —— 于是成员被 `kill -9` 之后，任务永远停在 `in_progress`，依赖它的任务永远
//! 无法 `claim`（「防死锁」的租约只在纸上成立）。
//!
//! # 为什么不是「读写时惰性 sweep」
//!
//! 惰性 sweep（每次 `team_status` / `team_wait` / `task_*` 前扫一遍）看起来零成本，但它
//! 恰好漏掉本设计最在意的那个场景：**队长阻塞在 `team_wait` 里，没有人在调任何命令**。
//! 那一刻没有任何入口去 sweep，队长要为一个已经死掉的成员白等满 `timeout`（1800s）——
//! 而「等待必须被强制」正是整个设计的立身之本。
//!
//! ⇒ 由组合根起一个周期性任务：**时间推移本身**就是它的输入，与调用方的行为无关。
//!
//! # 这里也是所有「时间驱动迁移」的家
//!
//! 目前只有租约回收。将来 L3 的「静默超阈值 ⇒ `Stalled`」是同一类东西（判据是时间，不
//! 是事件），应该长在这个循环里，而不是再加一个任务。
//!
//! # 为什么 `stop` 是 `abort`
//!
//! 每一拍只做**一次原子操作**（`reclaim_expired` 在 manager 的写锁里一次做完，中途不可
//! 观察）。所以中止在任何一个 `await` 点上都不会留下半个状态：要么这一拍没开始，要么它
//! 已经在阻塞池里跑完。反过来，等它自己看到停止信号会给退出路径增加「最多一个 interval」
//! 的尾巴，而没有人在关闭时愿意等 30s。

use std::sync::Arc;
use std::time::Duration;

use tokio::task::JoinHandle;

use crate::agent::team::manager::{now_millis, TeamManager};
use crate::common::error::AppError;
use crate::common::runtime::AppRuntime;

/// 检查间隔：**到期判定误差 ≤ 本值**。
///
/// 默认 `lease_ttl` 是 1800s，30s 的误差是 1.7% —— 比「成员死后多占 30s」便宜得多；
/// 再调小只是让空闲时多几次空扫描。
pub const REAP_INTERVAL: Duration = Duration::from_secs(30);

/// 租约回收器：持有循环的句柄，`stop()` 消费自身。
///
/// 与 [`crate::agent::team::TeamServer`] 同形（域内 `start`/`boot` → 组合根持句柄 →
/// 关闭协议调 `stop`）：两者都是「团队域里有个活在后台跑的东西」。
pub struct TeamReaper {
    handle: JoinHandle<()>,
}

impl TeamReaper {
    /// 起循环。`interval` 是参数而不是常量，只为测试能用毫秒级间隔。
    pub fn start(runtime: Arc<AppRuntime>, manager: Arc<TeamManager>, interval: Duration) -> Self {
        // 循环自己需要 runtime 来把回收挪进阻塞池；`spawn` 会借用 `runtime` 作接收者，
        // 所以先克隆一份给它（两个 `Arc` 计数，无状态复制）。
        let loop_runtime = Arc::clone(&runtime);
        let handle = runtime.spawn(async move {
            loop {
                tokio::time::sleep(interval).await;
                match reap_once(&loop_runtime, &manager).await {
                    Ok(reclaimed) if !reclaimed.is_empty() => {
                        log::info!(
                            "[agent-team] reclaimed {} expired lease(s): {reclaimed:?}",
                            reclaimed.len()
                        );
                    }
                    // 空扫描是常态（每 30s 一次），不记日志。
                    Ok(_) => {}
                    // 读库失败不该杀掉循环：下一拍还可能成功，而退出循环等于永久失去租约
                    // 回收（那个症状是「任务永远卡住」，比一条 warn 难查得多）。
                    Err(err) => log::warn!("[agent-team] lease reaping failed: {err}"),
                }
            }
        });
        Self { handle }
    }

    /// 停机（见模块文档「为什么 `stop` 是 `abort`」）。
    pub fn stop(self) {
        self.handle.abort();
    }
}

/// 一拍：把过期的租约收回。
///
/// 阻塞（SQLite 写 + 内存镜像）⇒ 必须走阻塞池（红线 3）。抽成函数是为了让它可被直接
/// 调用断言，而不用等 30s。
async fn reap_once(
    runtime: &AppRuntime,
    manager: &Arc<TeamManager>,
) -> Result<Vec<String>, AppError> {
    let manager = Arc::clone(manager);
    let now = now_millis();
    let joined = runtime
        .spawn_blocking(move || manager.reclaim_expired(now))
        .await
        .map_err(|err| AppError::Unknown(format!("lease reaping task failed: {err}")))?;
    joined
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::fixtures::{fixture_member, fixture_team, TEAM, W1};
    use crate::agent::team::store::TeamStore;
    use crate::agent::team::types::{TeamTask, TeamTaskState, Workspace};
    use std::time::Instant;

    const TASK: &str = "t1";
    /// 生产间隔的一个缩短版：测试只看「有人周期性调它」，不看具体节拍。
    const TICK: Duration = Duration::from_millis(5);

    fn task() -> TeamTask {
        TeamTask {
            id: TASK.into(),
            team_id: TEAM.into(),
            title: "do it".into(),
            body: "body".into(),
            state: TeamTaskState::Pending,
            owner: None,
            workspace: Workspace::Shared,
            depends_on: vec![],
            claimed_at: None,
            lease_ttl: 1800,
            summary: None,
            summary_truncated: false,
            artifacts: vec![],
            reclaim_count: 0,
        }
    }

    fn runtime() -> Arc<AppRuntime> {
        Arc::new(AppRuntime::from_handle(tokio::runtime::Handle::current()))
    }

    /// 建一个只有一张**已过期**在飞任务的团队（`claimed_at` 早于 ttl）。
    fn expired_claim() -> Arc<TeamManager> {
        let manager = Arc::new(TeamManager::new(
            TeamStore::open_in_memory().expect("in-memory store"),
        ));
        manager.create_team(fixture_team(TEAM)).expect("team");
        manager
            .add_member(fixture_member(W1, TEAM))
            .expect("member");
        manager.create_task(task()).expect("task");
        // 起租时间 = 现在 - (ttl + 1s)：已经到期。
        let claimed_at = now_millis() - (1800 + 1) * 1_000;
        manager.claim_task(TASK, W1, claimed_at).expect("claim");
        assert_eq!(
            manager.task(TASK).expect("task").state,
            TeamTaskState::Claimed,
            "前置条件：先真的在飞"
        );
        manager
    }

    /// **AC3 的机器形式**：没有任何调用方，过期租约也会被收回。
    ///
    /// 变异验证：把 `interval` 传给 `start` 后不进入循环（或删掉循环体）⇒ 本测试超时失败。
    #[tokio::test]
    async fn expired_leases_are_reclaimed_without_any_caller() {
        let manager = expired_claim();
        let reaper = TeamReaper::start(Arc::clone(&runtime()), Arc::clone(&manager), TICK);

        // 有界等待：5ms 一拍，2s 上限足够宽；不能无限等（那是挂死而不是失败）。
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if manager.task(TASK).expect("task").state == TeamTaskState::Pending {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }

        let task = manager.task(TASK).expect("task");
        assert_eq!(task.state, TeamTaskState::Pending, "过期租约必须回 pending");
        assert_eq!(task.reclaim_count, 1, "回收次数用于 UI 标「反复失败」");
        assert_eq!(task.owner, None, "回收后不再属于任何人");

        reaper.stop();
    }

    /// 停机之后**不再回收** —— 否则关闭协议里的 `stop()` 只是个装饰。
    ///
    /// 反向断言（睡 150ms 后仍未被回收）不会假失败：间隔是 5ms，若循环还在跑，
    /// 它一定已经扫过几十次。
    #[tokio::test]
    async fn stopping_the_reaper_stops_the_loop() {
        let manager = Arc::new(TeamManager::new(
            TeamStore::open_in_memory().expect("in-memory store"),
        ));
        manager.create_team(fixture_team(TEAM)).expect("team");
        manager
            .add_member(fixture_member(W1, TEAM))
            .expect("member");

        let reaper = TeamReaper::start(Arc::clone(&runtime()), Arc::clone(&manager), TICK);
        reaper.stop();

        manager.create_task(task()).expect("task");
        let claimed_at = now_millis() - (1800 + 1) * 1_000;
        manager.claim_task(TASK, W1, claimed_at).expect("claim");

        tokio::time::sleep(Duration::from_millis(150)).await;
        assert_eq!(
            manager.task(TASK).expect("task").state,
            TeamTaskState::Claimed,
            "stop 之后不允许再回收"
        );
    }
}
