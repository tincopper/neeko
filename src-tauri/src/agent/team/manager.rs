//! `TeamManager` —— 团队域的**唯一写入口**（design §1.1）。
//!
//! 状态迁移一律经 [`crate::agent::team::completion::advance`]，租约判定一律经
//! [`crate::agent::team::lease`]。这两个约束让「谁能把任务改成 done」这类问题只有一个答案。
//!
//! # 为什么是同步的（红线 3）
//!
//! 本文件**没有** `async fn`，也**不**调用 `spawn_blocking`：它唯一的阻塞调用是 SQLite
//! （`rusqlite`，同步 API），而把它包成 `async` 只会让「锁被跨 await 持有」变成可能。
//! 调用方（命令层、MCP dispatch、hooks 观察者）负责把整次调用放进 `spawn_blocking`
//! —— 那里才知道自己在哪个 runtime 上。**本层一旦自己 spawn，调用方就无法成组地
//! 等待一次事务**，而这正是「先 close PTY 再归档成员」需要的语义。
//!
//! # 并发形状
//!
//! 内存镜像（`HashMap`）与库在同一把 `Mutex` 内一起改：库写成功而内存没改，或反之，
//! 都会立刻造出第二个真相源。锁的粒度是「一次迁移」，**不跨方法**。
//!
//! # 唤醒契约（`team_wait` 的依赖，design §4.3）
//!
//! 本层是本域**唯一**的写入口，所以「什么时候该叫醒等待者」也只有这一个答案：
//!
//! 1. 任何会改动 member / task 状态的方法，都必须走 `self.lock_writing()` 而不是
//!    `self.inner.lock()` —— 前者的守卫在**释放锁之后**置代数 + `notify_waiters()`；
//! 2. 顺序固定为「**先置位、后 notify**」。倒过来会让被唤醒者读到旧代数而重回 await，
//!    唤醒被吞（同一个坑：`agent/chat/adapter/pi_rpc/process.rs::annotate`）；
//! 3. 纯读方法用 `self.inner.lock()`，**不得**唤醒 —— 否则什么都没变也会惊动所有等待者。
//!
//! 守卫的意义在于「遗漏是静默的」：漏写一行 `bump()` 不会让任何现有测试变红，只会让
//! 队长白等满 timeout（而那恰好是 design 最不愿看到的退化：改提示词级等待）。

use parking_lot::{Mutex, MutexGuard};
use std::collections::HashMap;
use std::ops::{Deref, DerefMut};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Notify;

use crate::agent::team::completion::advance;
use crate::agent::team::lease::{lease_expired, next_reclaim_count, should_auto_release};
use crate::agent::team::store::{clamp_task_summary, TeamEventRecord, TeamStore};
use crate::agent::team::types::{
    DoneVerification, MemberRole, MemberSignal, MemberState, Team, TeamMember, TeamTask,
    TeamTaskState, Workspace,
};
use crate::common::error::AppError;

/// 审计事件类别：任务被认领。
pub const EVENT_CLAIM: &str = "claim";
/// 审计事件类别：任务状态被显式更新。
pub const EVENT_UPDATE: &str = "update";
/// 审计事件类别：队长越过 owner 判 done。
pub const EVENT_FORCE_DONE: &str = "force_done";
/// 审计事件类别：租约到期，任务回到 `pending`。
pub const EVENT_RECLAIM: &str = "reclaim";
/// 审计事件类别：回收次数超限，任务被冻结。
pub const EVENT_BLOCKED: &str = "blocked";
/// 审计事件类别：成员信号引起的迁移。
pub const EVENT_SIGNAL: &str = "signal";

/// 成员凭证签发（审计只记"何时签的"，**不记明文也不记 hash**）。
pub const EVENT_ISSUE_TOKEN: &str = "issue_token";

/// 成员 PTY 绑定（审计记 `terminal_id`，它是进程句柄不是凭证）。
pub const EVENT_BIND_TERMINAL: &str = "bind_terminal";

/// 属于「有 owner 在干活」的任务态集合 —— 租约与审批只对这些态有意义。
/// **活性即续期**：把起租时间前移到 `now`。
///
/// # 为什么租约必须能续
///
/// `claimed_at + lease_ttl` 单独用是**时长上限**，而它想表达的是**活性**（"这个成员还在
/// 干"）。没有续期，回收器一上线就会去抢健康成员手里的活：一个跑 40 分钟的任务在
/// `lease_ttl = 1800s` 处被回收，成员还在写代码、而 `reclaim_count` 已经往上加 —— 四轮
/// 之后任务进 `blocked`，可它从来没失败过。
///
/// 续期的判据只有一条：**owner 自己的活动**（`task_update` / hook 上报）。
/// 队长改别人的任务不算那个人的活性。
const fn renew_lease(task: &mut TeamTask, now: i64) {
    // 终态不续期：`done` / `failed` 的任务已经离开 active 集，`reclaim_expired` 不会再看它。
    if is_active(task.state) {
        task.claimed_at = Some(now);
    }
}

const fn is_active(state: TeamTaskState) -> bool {
    matches!(
        state,
        TeamTaskState::Claimed | TeamTaskState::InProgress | TeamTaskState::AwaitingApproval
    )
}

const fn is_terminal_task(state: TeamTaskState) -> bool {
    matches!(
        state,
        TeamTaskState::Done | TeamTaskState::Failed | TeamTaskState::Blocked
    )
}

const fn is_terminal_member(state: MemberState) -> bool {
    matches!(
        state,
        MemberState::Done | MemberState::Failed | MemberState::Dead
    )
}

/// 内存镜像 + 共享库。
pub struct TeamManager {
    store: TeamStore,
    inner: Mutex<Inner>,
    /// 变更唤醒句柄（`team_wait` 的等待者挂在它上面，design §4.3）。
    wake: TeamWake,
}

/// 变更唤醒句柄 —— `team_wait` 的等待者**只**依赖它（design §4.3）。
///
/// # 为什么是「代数 + Notify」两个字段而不是一个 channel
///
/// `Notify` 的 `notify_waiters()` **只唤醒已经注册的等待者**，它没有记忆：在
/// 「检查快照」与「进入 await」之间发生的唤醒会被丢弃，等待者于是白等满 timeout。
/// 代数（epoch）补上这块记忆 —— 等待者先注册、后读代数，再比对一次：代数变了就
/// 说明检查之后发生过变更，立刻重查而不是傻等（见 [`crate::agent::team::wait`]）。
///
/// # 顺序契约：**先置位、后 notify**
///
/// [`TeamWake::bump`] 先 `fetch_add` 再 `notify_waiters()`。倒过来会让被唤醒者读到
/// 旧代数、于是认为「没变过」而重回 await —— 唤醒被吞掉（同一个坑在
/// `agent/chat/adapter/pi_rpc/process.rs::annotate` 的注释里已经写透过一遍）。
///
/// # 内存序选择
///
/// 写用 `Release`、读用 `Acquire`（不用 `SeqCst`）：代数只需要保证「观察到新代数」
/// ⇒「看到该变更之前写入的团队状态」。真实状态的可见性由 `inner` 锁本身保证，
/// 这里只是不让编译器/CPU 把代数读提到快照读之后。`SeqCst` 会给每个计数器加全局
/// 栅栏，而这里没有任何跨变量的全序需求。
#[derive(Clone)]
pub struct TeamWake {
    epoch: Arc<AtomicU64>,
    notify: Arc<Notify>,
}

impl Default for TeamWake {
    fn default() -> Self {
        Self {
            epoch: Arc::new(AtomicU64::new(0)),
            notify: Arc::new(Notify::new()),
        }
    }
}

impl TeamWake {
    /// 当前变更代数。等待者用它判定「上次检查之后有没有变过」。
    #[must_use]
    pub fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::Acquire)
    }

    /// 唤醒注册点（`Notify::notified()` 的入口）。
    ///
    /// 暴露 `&Notify` 而不是包一层 `async fn`：调用方必须能在**同一个表达式**里
    /// `notified()` → `pin!` → `enable()`，包成 async fn 就丢掉了「同步注册」这个
    /// 关键性质。
    #[must_use]
    pub fn notifier(&self) -> &Notify {
        &self.notify
    }

    /// 置位 + 唤醒。**必须先 `fetch_add` 再 `notify_waiters`**（见类型文档）。
    fn bump(&self) {
        self.epoch.fetch_add(1, Ordering::Release);
        self.notify.notify_waiters();
    }
}

/// 写路径的锁守卫：**释放 `inner` 锁之后**才置位并唤醒等待者。
///
/// # 为什么是守卫而不是在每个方法末尾手写 `drop(inner); wake.bump();`
///
/// 漏写 = 等待者白等满 timeout，而这类缺陷在 code review 里几乎看不见（缺的是
/// **不存在**的那一行）。守卫把「先释放、后置位+notify」变成结构事实：任何拿到写锁的
/// 方法，离开作用域时一定唤醒 —— 包括 `?` 提前返回的路径（错误路径上的多余唤醒是
/// 无害的：等待者重查一次快照而已，而漏唤醒是不可恢复的）。
///
/// 顺序不可颠倒：持锁 `notify_waiters()` 会让被唤醒者立刻去抢同一把锁（惊群 + 无谓
/// 竞争），而 [`TeamWake::bump`] 的契约本来就要求锁已释放。
struct WriteGuard<'a> {
    inner: Option<MutexGuard<'a, Inner>>,
    wake: &'a TeamWake,
}

impl Deref for WriteGuard<'_> {
    type Target = Inner;

    fn deref(&self) -> &Inner {
        // `Drop` 之前永远 `Some`：`Drop` 是最后一步，之后不再解引用。
        match &self.inner {
            Some(inner) => inner,
            None => unreachable!("WriteGuard 的锁只在 Drop 里被取走"),
        }
    }
}

impl DerefMut for WriteGuard<'_> {
    fn deref_mut(&mut self) -> &mut Inner {
        match &mut self.inner {
            Some(inner) => inner,
            None => unreachable!("WriteGuard 的锁只在 Drop 里被取走"),
        }
    }
}

impl Drop for WriteGuard<'_> {
    fn drop(&mut self) {
        // 顺序即契约：先放锁，再置位 + 唤醒。
        drop(self.inner.take());
        self.wake.bump();
    }
}

#[derive(Default)]
struct Inner {
    teams: HashMap<String, Team>,
    members: HashMap<String, TeamMember>,
    tasks: HashMap<String, TeamTask>,
    /// 每个成员的取证水位线（`verified` 只能由显式 `task_update(done)` / `force_done` 抬高）。
    ///
    /// 不进库：design §6 硬规则 3 说 done 的权威是任务板，所以重启后由
    /// 「该成员是否有 `done` 任务」重新推导（[`TeamManager::derive_verification`]），
    /// 不需要第二份会漂移的持久化状态。
    verification: HashMap<String, DoneVerification>,
}

impl TeamManager {
    /// 用给定的库建一个空的内存镜像。
    #[must_use]
    pub fn new(store: TeamStore) -> Self {
        Self {
            store,
            inner: Mutex::new(Inner::default()),
            wake: TeamWake::default(),
        }
    }

    /// 取一个唤醒句柄（廉价克隆：只复制两个 `Arc`）。
    ///
    /// 等待者拿到它之后**不持锁**等待，只在「快照没满足」时注册唤醒。
    #[must_use]
    pub fn wake_handle(&self) -> TeamWake {
        self.wake.clone()
    }

    /// 当前变更代数（= [`TeamWake::epoch`]，方便等待者只依赖 manager）。
    #[must_use]
    pub fn epoch(&self) -> u64 {
        self.wake.epoch()
    }

    /// 写路径的锁入口：与 `self.inner.lock()` 唯一的区别是**离开作用域时会唤醒等待者**。
    ///
    /// 只有会改动 member / task 状态的方法才允许用它；纯读一律继续用 `self.inner.lock()`
    /// —— 读操作唤醒等待者会造成「什么都没变却把所有人叫醒」的空转。
    fn lock_writing(&self) -> WriteGuard<'_> {
        WriteGuard {
            inner: Some(self.inner.lock()),
            wake: &self.wake,
        }
    }

    /// 从库恢复（启动路径）：团队 / 成员 / 任务全部读进内存，取证按任务板推导。
    pub fn load(store: TeamStore) -> Result<Self, AppError> {
        let manager = Self::new(store);
        let teams = manager.store.list_teams()?;
        let mut members = Vec::new();
        let mut tasks = Vec::new();
        for team in &teams {
            members.extend(manager.store.list_members(&team.id)?);
            tasks.extend(manager.store.list_tasks(&team.id)?);
        }
        {
            let mut inner = manager.inner.lock();
            for team in teams {
                inner.teams.insert(team.id.clone(), team);
            }
            for member in members {
                inner.members.insert(member.id.clone(), member);
            }
            for task in tasks {
                inner.tasks.insert(task.id.clone(), task);
            }
        }
        manager.recompute_all_verification();
        Ok(manager)
    }

    /// 共享库（供测试与组合根）。
    #[must_use]
    pub const fn store(&self) -> &TeamStore {
        &self.store
    }

    // ═══════════════════════════════════════════════════════════════════
    // 读（不迁移状态）
    // ═══════════════════════════════════════════════════════════════════

    /// 读一个团队。
    #[must_use]
    pub fn team(&self, team_id: &str) -> Option<Team> {
        self.inner.lock().teams.get(team_id).cloned()
    }

    /// 读一名成员。
    #[must_use]
    pub fn member(&self, member_id: &str) -> Option<TeamMember> {
        self.inner.lock().members.get(member_id).cloned()
    }

    /// 读一个任务。
    #[must_use]
    pub fn task(&self, task_id: &str) -> Option<TeamTask> {
        self.inner.lock().tasks.get(task_id).cloned()
    }

    /// 读团队全部任务（板视图），按 id 排序。
    #[must_use]
    pub fn tasks(&self, team_id: &str) -> Vec<TeamTask> {
        let inner = self.inner.lock();
        let mut out: Vec<TeamTask> = inner
            .tasks
            .values()
            .filter(|t| t.team_id == team_id)
            .cloned()
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    /// 读一名成员 **+ 它的取证水位线**，两者在**同一把锁内**取出。
    ///
    /// 分成两次读（[`Self::member`] + [`Self::verification`]）会让快照里出现自相矛盾的
    /// 组合：`claim_task` 会把取证重置为 `Unverified`，两次读之间插进一次认领就会得到
    /// 「刚认领了 t2 但取证已验证」的行 —— 而 `team_wait` 的判据正是读这两列。
    #[must_use]
    pub fn member_with_verification(
        &self,
        member_id: &str,
    ) -> Option<(TeamMember, DoneVerification)> {
        let inner = self.inner.lock();
        let member = inner.members.get(member_id)?.clone();
        let verification = inner
            .verification
            .get(member_id)
            .copied()
            .unwrap_or(DoneVerification::Unverified);
        Some((member, verification))
    }

    /// 成员的取证水位线；未知成员返回 `None`。
    #[must_use]
    pub fn verification(&self, member_id: &str) -> Option<DoneVerification> {
        let inner = self.inner.lock();
        if !inner.members.contains_key(member_id) {
            return None;
        }
        Some(
            inner
                .verification
                .get(member_id)
                .copied()
                .unwrap_or(DoneVerification::Unverified),
        )
    }

    /// 团队的审计记录（按写入顺序）。
    pub fn events(&self, team_id: &str) -> Result<Vec<TeamEventRecord>, AppError> {
        Ok(self.store.list_events(team_id)?)
    }

    // ═══════════════════════════════════════════════════════════════════
    // 建（团队 / 成员 / 任务）
    // ═══════════════════════════════════════════════════════════════════

    /// 建队。id 冲突一律拒绝（覆盖写会静默丢掉整队状态）。
    pub fn create_team(&self, team: Team) -> Result<(), AppError> {
        let mut inner = self.lock_writing();
        self.insert_team(&mut inner, team)
    }

    /// 建队 + 队长成员，**一次写入**（「以队长身份开会话」的落库点）。
    ///
    /// # 为什么不是 `create_team` + `add_member`
    ///
    /// 两步之间失败会留下一个**没有队长**的团队：授权矩阵里所有 Lead 操作从此无人可做，
    /// 而它看起来和正常团队一样（`team_status` 里只有成员列表短一截）。一次锁内写完，
    /// 这个中间态就不存在。
    ///
    /// 拒绝条件与两个单步方法相同（id 冲突 / 队长唯一），且都由**同一组**私有 helper
    /// 裁决 —— 两处各写一遍的话，「第二个队长」这条规则的例外会出现在写入路径不同的那一侧。
    pub fn create_team_with_lead(&self, team: Team, lead: TeamMember) -> Result<(), AppError> {
        if lead.team_id != team.id {
            return Err(AppError::InvalidInput(format!(
                "lead {} belongs to team {}, not {}",
                lead.id, lead.team_id, team.id
            )));
        }
        if lead.role != MemberRole::Lead {
            return Err(AppError::InvalidInput(format!(
                "member {} must have the lead role to be created together with its team",
                lead.id
            )));
        }
        let mut inner = self.lock_writing();
        self.insert_team(&mut inner, team)?;
        self.insert_member(&mut inner, lead)
    }

    /// 加入一名成员。
    ///
    /// 一个团队**只有一个队长**（design §2 的「一名队长 + N 名成员」）：
    /// 第二个 `Lead` 被拒，否则授权矩阵会出现两个都能 `close` 的主体。
    pub fn add_member(&self, member: TeamMember) -> Result<(), AppError> {
        let mut inner = self.lock_writing();
        self.insert_member(&mut inner, member)
    }

    /// 写入一条团队行（**调用方已持锁**）。
    fn insert_team(&self, inner: &mut Inner, team: Team) -> Result<(), AppError> {
        if inner.teams.contains_key(&team.id) {
            return Err(conflict(format!("team {} already exists", team.id)));
        }
        self.store.upsert_team(&team)?;
        inner.teams.insert(team.id.clone(), team);
        Ok(())
    }

    /// 写入一条成员行（**调用方已持锁**）：团队必须存在、id 唯一、一队只有一个队长。
    fn insert_member(&self, inner: &mut Inner, member: TeamMember) -> Result<(), AppError> {
        if !inner.teams.contains_key(&member.team_id) {
            return Err(not_found(format!("team {}", member.team_id)));
        }
        if inner.members.contains_key(&member.id) {
            return Err(conflict(format!("member {} already exists", member.id)));
        }
        if member.role == MemberRole::Lead
            && inner
                .members
                .values()
                .any(|m| m.team_id == member.team_id && m.role == MemberRole::Lead)
        {
            return Err(conflict(format!(
                "team {} already has a lead",
                member.team_id
            )));
        }
        self.store.upsert_member(&member)?;
        inner.members.insert(member.id.clone(), member);
        Ok(())
    }

    /// 把成员的 `terminal_id` 绑定到刚起来的 PTY（执行层的回填点）。
    ///
    /// # 为什么是 manager 的方法而不是执行层直接写库
    ///
    /// `terminal_id` 是**成员行的一部分**，而成员行只有 manager 能写（内存镜像与库必须
    /// 在同一把锁内一起改，否则下一帧读到的是旧镜像）。执行层（组合根）只能通过这里回填。
    ///
    /// # 重复绑定
    ///
    /// 允许覆盖：PTY 起失败后重试会得到新 session id，而旧 id 早已失效 —— 拒绝覆盖只会
    /// 让成员卡在一个永远连不上的句柄上。审计记录两次 id，便于排查「绑过几个」。
    pub fn set_member_terminal(
        &self,
        member_id: &str,
        terminal_id: &str,
        now: i64,
    ) -> Result<(), AppError> {
        if terminal_id.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "terminal id must not be empty".to_string(),
            ));
        }
        let mut inner = self.lock_writing();
        let mut member = inner
            .members
            .get(member_id)
            .cloned()
            .ok_or_else(|| not_found(format!("member {member_id}")))?;
        let previous = member
            .terminal_id
            .clone()
            .unwrap_or_else(|| "<none>".to_string());
        member.terminal_id = Some(terminal_id.to_owned());
        self.store.upsert_member(&member)?;
        inner.members.insert(member.id.clone(), member.clone());
        // 队长的会话就是团队的 `lead_session_id`：两处各写一遍会漂移，而它正是
        // 「这个团队由哪个会话开创」的唯一线索。
        if member.role == MemberRole::Lead {
            if let Some(mut team) = inner.teams.get(&member.team_id).cloned() {
                team.lead_session_id = terminal_id.to_owned();
                self.store.upsert_team(&team)?;
                inner.teams.insert(team.id.clone(), team);
            }
        }
        self.audit(
            &mut inner,
            &member.team_id,
            member_id,
            EVENT_BIND_TERMINAL,
            Some(member_id.to_owned()),
            Some(format!("{previous} -> {terminal_id} at={now}")),
        )?;
        Ok(())
    }

    /// 派活。只接受 `pending` / `proposed` 作为初态（其它状态必须由迁移到达）。
    pub fn create_task(&self, task: TeamTask) -> Result<TeamTask, AppError> {
        let mut inner = self.lock_writing();
        if !inner.teams.contains_key(&task.team_id) {
            return Err(not_found(format!("team {}", task.team_id)));
        }
        if inner.tasks.contains_key(&task.id) {
            return Err(conflict(format!("task {} already exists", task.id)));
        }
        if !matches!(task.state, TeamTaskState::Pending | TeamTaskState::Proposed) {
            return Err(invalid(format!(
                "task {} must start pending or proposed, got {:?}",
                task.id, task.state
            )));
        }
        // `lease_ttl <= 0` 会让任务一被认领就到期，看起来像「成员永远在丢失任务」。
        if task.lease_ttl <= 0 {
            return Err(invalid(format!(
                "task {} lease_ttl must be positive, got {}",
                task.id, task.lease_ttl
            )));
        }
        let task = clamp_task_summary(&task);
        self.store.upsert_task(&task)?;
        inner.tasks.insert(task.id.clone(), task.clone());
        Ok(task)
    }

    // ═══════════════════════════════════════════════════════════════════
    // 迁移（唯一写入口）
    // ═══════════════════════════════════════════════════════════════════

    /// 认领任务（不变量 1 / 3）。
    pub fn claim_task(
        &self,
        task_id: &str,
        member_id: &str,
        now: i64,
    ) -> Result<TeamTask, AppError> {
        let mut inner = self.lock_writing();
        let mut task = inner
            .tasks
            .get(task_id)
            .cloned()
            .ok_or_else(|| not_found(format!("task {task_id}")))?;
        let member = inner
            .members
            .get(member_id)
            .cloned()
            .ok_or_else(|| not_found(format!("member {member_id}")))?;

        // 不变量 1：只有 `pending` 可被认领。`claimed`/`in_progress` 已有 owner，
        // `blocked` 是冻结态，`proposed` 还必须先被队长 accept。
        if task.state != TeamTaskState::Pending {
            return Err(conflict(format!(
                "task {task_id} is {:?}, only pending can be claimed",
                task.state
            )));
        }
        // 跨队认领：owner 关系跨队毫无意义，且会让授权矩阵算错队伍。
        if member.team_id != task.team_id {
            return Err(conflict(format!(
                "member {member_id} belongs to {}, task {task_id} to {}",
                member.team_id, task.team_id
            )));
        }
        // 不变量 3：依赖必须存在、同队、且已 done。
        // 「依赖不存在」抛 NotFound 而不是 Conflict：那是数据缺陷，不是瞬时冲突。
        for dependency in &task.depends_on {
            let dep = inner
                .tasks
                .get(dependency)
                .ok_or_else(|| not_found(format!("dependency {dependency}")))?;
            if dep.team_id != task.team_id {
                return Err(conflict(format!(
                    "dependency {dependency} belongs to another team"
                )));
            }
            if dep.state != TeamTaskState::Done {
                return Err(conflict(format!(
                    "dependency {dependency} is {:?}, not done",
                    dep.state
                )));
            }
        }

        task.state = TeamTaskState::Claimed;
        task.owner = Some(member.id.clone());
        task.claimed_at = Some(now);

        // 取证按任务重置：上一件任务的 `Verified` 不得延续到新任务。
        // 否则「成员完成过 t1」会让 t2 在还没声明前就显示「已验证」——
        // 那正是「完成的唯一权威是任务板」要禁止的事。
        inner
            .verification
            .insert(member.id.clone(), DoneVerification::Unverified);

        self.store.upsert_task(&task)?;
        inner.tasks.insert(task.id.clone(), task.clone());
        self.audit(
            &mut inner,
            &task.team_id,
            member_id,
            EVENT_CLAIM,
            Some(task.id.clone()),
            None,
        )?;
        Ok(task)
    }

    /// 改任务的 `workspace`（不变量 5：`state != pending` 后不可变）。
    pub fn set_task_workspace(
        &self,
        task_id: &str,
        workspace: Workspace,
        actor: &str,
    ) -> Result<TeamTask, AppError> {
        let mut inner = self.lock_writing();
        let mut task = inner
            .tasks
            .get(task_id)
            .cloned()
            .ok_or_else(|| not_found(format!("task {task_id}")))?;

        // 不变量 5：一旦被认领，workspace 就是成员的 cwd —— 改它等于让产物落在
        // 一个没人看过的地方。只允许在 `pending` 时指定。
        if task.state != TeamTaskState::Pending {
            return Err(conflict(format!(
                "task {task_id} is {:?}, workspace is immutable after claim",
                task.state
            )));
        }

        task.workspace = workspace;
        self.store.upsert_task(&task)?;
        inner.tasks.insert(task.id.clone(), task.clone());
        self.audit(
            &mut inner,
            &task.team_id,
            actor,
            EVENT_UPDATE,
            Some(task.id.clone()),
            Some("workspace".to_owned()),
        )?;
        Ok(task)
    }

    /// 显式更新任务状态（L2）。**只有 owner 能改自己的任务**。
    ///
    /// `summary` 为 `Some` 时更新摘要，`None` 时保持原值（不提供「清空」语义：
    /// 摘要被清掉会让板上那一行失去唯一上下文）。
    pub fn update_task(
        &self,
        task_id: &str,
        actor: &str,
        new_state: TeamTaskState,
        summary: Option<&str>,
        now: i64,
    ) -> Result<TeamTask, AppError> {
        let mut inner = self.lock_writing();
        let mut task = inner
            .tasks
            .get(task_id)
            .cloned()
            .ok_or_else(|| not_found(format!("task {task_id}")))?;
        let actor_member = inner
            .members
            .get(actor)
            .cloned()
            .ok_or_else(|| not_found(format!("member {actor}")))?;

        // 不变量 2：`done`（以及 failed 等一切显式声明）只能由 owner 触达。
        // 队长越过 owner 的唯一路径是 [`Self::force_done`]，那条路径会记审计。
        if task.owner.as_deref() != Some(actor) {
            return Err(conflict(format!(
                "task {task_id} is owned by {:?}, not {actor}",
                task.owner
            )));
        }
        // 吸收态：已完成的判死不可撤销（否则「done」可以被悄悄改回进行中）。
        if is_terminal_task(task.state) {
            return Err(conflict(format!(
                "task {task_id} is already {:?}",
                task.state
            )));
        }
        // 合法目标态：owner 能做的只有「继续/等审批/完成/失败」。
        // `pending`/`claimed`/`blocked` 由系统或队长路径负责，`proposed` 是另一种起点。
        if !matches!(
            new_state,
            TeamTaskState::InProgress
                | TeamTaskState::AwaitingApproval
                | TeamTaskState::Done
                | TeamTaskState::Failed
        ) {
            return Err(invalid(format!(
                "owner cannot move task {task_id} to {new_state:?}"
            )));
        }
        // 任务必须真的在 owner 手里（`pending` 先 claim，`proposed` 先 accept）。
        if !is_active(task.state) {
            return Err(conflict(format!(
                "task {task_id} is {:?}, claim it first",
                task.state
            )));
        }

        task.state = new_state;
        if let Some(summary) = summary {
            task.summary = Some(summary.to_owned());
        }
        let mut task = clamp_task_summary(&task);
        // 显式更新本身就是活性证据（见 `renew_lease`）。
        renew_lease(&mut task, now);

        if new_state == TeamTaskState::Done {
            inner
                .verification
                .insert(actor_member.id.clone(), DoneVerification::Verified);
        }
        self.store.upsert_task(&task)?;
        inner.tasks.insert(task.id.clone(), task.clone());
        self.audit(
            &mut inner,
            &task.team_id,
            actor,
            EVENT_UPDATE,
            Some(task.id.clone()),
            Some(format!("state={new_state:?} at={now}")),
        )?;
        Ok(task)
    }

    /// 队长越过 owner 判 `done`，**必须记审计**（不变量 2）。
    pub fn force_done(
        &self,
        task_id: &str,
        actor: &str,
        reason: &str,
        now: i64,
    ) -> Result<TeamTask, AppError> {
        let mut inner = self.lock_writing();
        let mut task = inner
            .tasks
            .get(task_id)
            .cloned()
            .ok_or_else(|| not_found(format!("task {task_id}")))?;
        let lead = inner
            .members
            .get(actor)
            .cloned()
            .ok_or_else(|| not_found(format!("member {actor}")))?;

        // 授权矩阵（design §3.2）：只有本队队长能 force_done。
        if lead.role != MemberRole::Lead || lead.team_id != task.team_id {
            return Err(conflict(format!(
                "member {actor} is not the lead of {}",
                task.team_id
            )));
        }
        // 只有「在干活」的任务能被判死：`pending` 没人做过，终态不该被改写。
        if !is_active(task.state) {
            return Err(conflict(format!(
                "task {task_id} is {:?}, cannot force_done",
                task.state
            )));
        }

        let previous = format!("{:?} owner={:?}", task.state, task.owner);
        task.state = TeamTaskState::Done;
        if let Some(owner) = &task.owner {
            inner
                .verification
                .insert(owner.clone(), DoneVerification::Verified);
        }
        self.store.upsert_task(&task)?;
        inner.tasks.insert(task.id.clone(), task.clone());
        self.audit(
            &mut inner,
            &task.team_id,
            &lead.id,
            EVENT_FORCE_DONE,
            Some(task.id.clone()),
            Some(format!("{previous} reason={reason} at={now}")),
        )?;
        Ok(task)
    }

    /// 为成员签发一个新凭证：**明文只返回给调用方一次**，库里只留 `sha256`。
    ///
    /// # 为什么签发不在 `mcp::dispatch` 里
    ///
    /// 工具的返回值会进模型上下文（`tools/call` 的 `content[0].text`），进而进会话
    /// transcript 与导出。明文 token 一旦出现在那里，就等于把成员凭证写进了对话历史 ——
    /// 与 design §3.1「明文只在下发的 MCP 配置里出现一次」直接冲突。
    ///
    /// 所以 `team_spawn` 只建成员（`token_hash` 为空 ⇒ **不可认证**），凭证由执行层
    /// （真正写 MCP 配置、真正起 PTY 的那一层）在这里取一次并用掉。
    ///
    /// # 重复调用
    ///
    /// 会**轮换**：旧凭证立即失效（旧 hash 被覆盖）。执行层重试时因此不会留下两把能用的钥匙。
    pub fn issue_token(&self, member_id: &str, now: i64) -> Result<String, AppError> {
        let mut inner = self.lock_writing();
        let mut member = inner
            .members
            .get(member_id)
            .cloned()
            .ok_or_else(|| not_found(format!("member {member_id}")))?;

        let token = crate::agent::team::identity::new_token();
        member.token_hash = crate::agent::team::identity::hash_token(&token);
        self.store.upsert_member(&member)?;
        inner.members.insert(member.id.clone(), member.clone());

        // 审计只记事实，不记明文也不记 hash：`team_event` 会被导出做排查。
        self.audit(
            &mut inner,
            &member.team_id,
            member_id,
            EVENT_ISSUE_TOKEN,
            Some(member_id.to_owned()),
            Some(format!("rotated at={now}")),
        )?;
        Ok(token)
    }

    /// 抬高成员的上报单调水位线（`seq` 去重，design §7.2 / AC12）。返回 `true` = 已接受。
    ///
    /// # 为什么比较在 manager 而不在观察者
    ///
    /// 水位线是 `TeamMember.last_seq` —— 它同时存在内存镜像与库里，二者必须在**同一把锁内**
    /// 一起改（否则下一帧读到旧水位线，去重失效）。所以判定 + 写库 + 写镜像只能在这里。
    ///
    /// 单调性在本方法内兜底（`seq <= last_seq` 一律不变），即便调用方算错了也不会让水位线倒退。
    /// 陈旧上报连此落一条 audit：否则「为什么收到信号却没反应」在审计上无从解释。
    pub fn note_signal_seq(&self, member_id: &str, seq: u64) -> Result<bool, AppError> {
        let mut inner = self.lock_writing();
        let mut member = inner
            .members
            .get(member_id)
            .cloned()
            .ok_or_else(|| not_found(format!("member {member_id}")))?;
        if seq <= member.last_seq {
            let (team_id, watermark) = (member.team_id.clone(), member.last_seq);
            self.audit(
                &mut inner,
                &team_id,
                member_id,
                EVENT_SIGNAL,
                Some(member_id.to_owned()),
                Some(format!("stale seq={seq} watermark={watermark}")),
            )?;
            return Ok(false);
        }
        member.last_seq = seq;
        self.store.upsert_member(&member)?;
        inner.members.insert(member.id.clone(), member);
        Ok(true)
    }

    /// 应用一条成员信号（观察者的唯一入口；P1.5 只负责 `HookEvent → MemberSignal`）。
    ///
    /// 迁移一律走 [`advance`]：本方法不含任何状态判据，所以「Idle 不升级为 Done」这类
    /// 硬规则只有一处实现。
    pub fn observe_signal(
        &self,
        member_id: &str,
        signal: MemberSignal,
        now: i64,
    ) -> Result<MemberState, AppError> {
        let mut inner = self.lock_writing();
        let mut member = inner
            .members
            .get(member_id)
            .cloned()
            .ok_or_else(|| not_found(format!("member {member_id}")))?;

        // 该成员名下所有「在干活」的任务；没有任务时用惰性态 `Pending` 作为替身
        // （`advance` 对 Pending 的任何信号都是不动的，任务侧因此不会有副作用）。
        let mut owned: Vec<TeamTask> = inner
            .tasks
            .values()
            .filter(|t| t.owner.as_deref() == Some(member_id) && is_active(t.state))
            .cloned()
            .collect();
        owned.sort_by(|a, b| a.id.cmp(&b.id));

        let targets: Vec<Option<TeamTask>> = if owned.is_empty() {
            vec![None]
        } else {
            owned.into_iter().map(Some).collect()
        };

        let mut verification = inner
            .verification
            .get(member_id)
            .copied()
            .unwrap_or(DoneVerification::Unverified);

        for target in targets {
            let task_state = target.as_ref().map_or(TeamTaskState::Pending, |t| t.state);
            let (next_member, next_task, next_verification) =
                advance(member.state, task_state, verification, signal);
            member.state = next_member;

            // 取证只由**在飞任务**驱动。
            //
            // 没有在飞任务时（典型：任务已 `done`，这是迟到/重复的 `turn_completed`），
            // `Pending` 只是占位 —— 若也让它改写取证，L1（回合结束）就能撤回
            // L2（显式声明）的裁决，直接把 `Verified` 抹成 `Unverified`。
            // 方向恰好反了：一个人已经声明过做完，不能因为又说了句「我说完了」就变成未声明。
            if target.is_some() {
                verification = next_verification;
            }

            if let Some(mut task) = target {
                let before = task.claimed_at;
                task.state = next_task;
                // 活性信号即使不改状态（`InProgress → InProgress`）也要续期，否则一个
                // 持续干活但一直不声明状态的成员会被回收器当成死人；而 `Exited` / `Failed`
                // **不能**续期 —— 那会让「已经死了」再拖满一个 `lease_ttl`（AC3 的反方向）。
                if signal.is_liveness() {
                    renew_lease(&mut task, now);
                }
                if task.state != task_state || task.claimed_at != before {
                    self.store.upsert_task(&task)?;
                    inner.tasks.insert(task.id.clone(), task);
                }
            }
        }

        inner.verification.insert(member.id.clone(), verification);
        self.store.upsert_member(&member)?;
        let team_id = member.team_id.clone();
        inner.members.insert(member.id.clone(), member.clone());
        self.audit(
            &mut inner,
            &team_id,
            &member.id,
            EVENT_SIGNAL,
            Some(member.id.clone()),
            Some(format!("{signal:?} → {:?} at={now}", member.state)),
        )?;
        Ok(member.state)
    }

    /// 回收过期租约（不变量 4 / AC3）。
    ///
    /// 返回被回收（含被冻结）的任务 id。过期任务的 owner 若不是终态，成员落 `Stalled`
    /// —— design §2.1 的「任意 ──lease 到期──▶ Stalled」。
    pub fn reclaim_expired(&self, now: i64) -> Result<Vec<String>, AppError> {
        let mut inner = self.lock_writing();
        let mut expired: Vec<TeamTask> = inner
            .tasks
            .values()
            .filter(|t| is_active(t.state))
            .filter(|t| match t.claimed_at {
                Some(claimed_at) => lease_expired(claimed_at, t.lease_ttl, now),
                // 活跃态却没有起租时间 = 写坏了。当作已到期回收，而不是永久卡住。
                None => true,
            })
            .cloned()
            .collect();
        expired.sort_by(|a, b| a.id.cmp(&b.id));

        let mut reclaimed = Vec::new();
        for mut task in expired {
            let previous_owner = task.owner.clone();
            let count = next_reclaim_count(task.reclaim_count);
            let release = should_auto_release(count);

            // 不变量 4：超过上限就冻结，而不是继续回到 `pending` 等人再抢一次。
            // 「冻结」= 离开 active 态 ⇒ 后续任何 `reclaim_expired` 都不会再碰它。
            task.state = if release {
                TeamTaskState::Pending
            } else {
                TeamTaskState::Blocked
            };
            task.owner = None;
            task.claimed_at = None;
            task.reclaim_count = count;

            self.store.upsert_task(&task)?;
            inner.tasks.insert(task.id.clone(), task.clone());
            reclaimed.push(task.id.clone());

            let kind = if release {
                EVENT_RECLAIM
            } else {
                EVENT_BLOCKED
            };
            self.audit(
                &mut inner,
                &task.team_id,
                "system",
                kind,
                Some(task.id.clone()),
                Some(format!("reclaim_count={count} at={now}")),
            )?;

            if let Some(owner_id) = previous_owner {
                self.stall_member(&mut inner, &owner_id)?;
            }
        }
        Ok(reclaimed)
    }

    // ═══════════════════════════════════════════════════════════════════
    // 内部
    // ═══════════════════════════════════════════════════════════════════

    /// 租约过期的 owner 落 `Stalled`；终态成员不动（`Dead` 不该被洗成 `Stalled`）。
    fn stall_member(&self, inner: &mut Inner, member_id: &str) -> Result<(), AppError> {
        let Some(mut member) = inner.members.get(member_id).cloned() else {
            return Ok(());
        };
        if is_terminal_member(member.state) || member.state == MemberState::Stalled {
            return Ok(());
        }
        member.state = MemberState::Stalled;
        self.store.upsert_member(&member)?;
        inner.members.insert(member.id.clone(), member);
        Ok(())
    }

    /// 追加一条审计记录，并刷新内存镜像里对应团队的 id 上限（无状态，仅写库）。
    ///
    /// 审计失败**必须**让整个迁移失败：一条没有审计的 `force_done` 等于一次不可追责的
    /// 判死，不如直接报错让调用方重试。
    fn audit(
        &self,
        _inner: &mut Inner,
        team_id: &str,
        actor: &str,
        kind: &str,
        subject: Option<String>,
        detail: Option<String>,
    ) -> Result<(), AppError> {
        self.store.append_event(&TeamEventRecord {
            id: None,
            team_id: team_id.to_owned(),
            at: now_millis(),
            actor: actor.to_owned(),
            kind: kind.to_owned(),
            subject,
            detail,
        })?;
        Ok(())
    }

    /// 重启后按任务板推导每个成员的取证（硬规则 3：板是 done 的唯一权威）。
    ///
    /// 判据与内存态一致：**有 done 任务且手上没有在干活的任务** → `Verified`。
    /// 只看「曾经有 done 任务」会把「完成 t1 后领了 t2 还没声明」误判为已验证。
    fn recompute_all_verification(&self) {
        let mut inner = self.inner.lock();
        for member_id in inner.members.keys().cloned().collect::<Vec<_>>() {
            let owned: Vec<&TeamTask> = inner
                .tasks
                .values()
                .filter(|t| t.owner.as_deref() == Some(member_id.as_str()))
                .collect();
            let has_active = owned.iter().any(|t| is_active(t.state));
            let has_done = owned.iter().any(|t| t.state == TeamTaskState::Done);
            let value = if has_done && !has_active {
                DoneVerification::Verified
            } else {
                DoneVerification::Unverified
            };
            inner.verification.insert(member_id, value);
        }
    }
}

/// 当前 epoch 毫秒。审计行的时间戳不由调用方传（否则两条相邻事件可能倒序）。
///
/// `pub(crate)`：团队观察者（`agent::team::observe`）也要给它观察到的信号盖时间戳，
/// 而**全仓只允许一个时钟实现**（多一套时钟 = 两条相邻事件可能倒序，且测试无法同时钉住）。
pub(crate) fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

const fn conflict(message: String) -> AppError {
    AppError::Conflict(message)
}

const fn not_found(message: String) -> AppError {
    AppError::NotFound(message)
}

const fn invalid(message: String) -> AppError {
    AppError::InvalidInput(message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::fixtures::{fixture_member, fixture_team};
    use std::path::PathBuf;
    use std::sync::{Arc, Barrier};

    const TEAM: &str = "tm_1";
    const LEAD: &str = "lead@tm_1";
    const W1: &str = "w1@tm_1";
    const W2: &str = "w2@tm_1";

    /// 夹具路径一律由 `CARGO_MANIFEST_DIR` 推导（红线 13）。
    fn root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    fn team(id: &str) -> Team {
        fixture_team(id)
    }

    fn member(id: &str, name: &str, role: MemberRole, team_id: &str) -> TeamMember {
        TeamMember {
            name: name.into(),
            role,
            ..fixture_member(id, team_id)
        }
    }

    fn task(id: &str) -> TeamTask {
        TeamTask {
            id: id.into(),
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

    fn seeded() -> TeamManager {
        let manager = TeamManager::new(TeamStore::open_in_memory().unwrap());
        manager.create_team(team(TEAM)).unwrap();
        manager
            .add_member(member(LEAD, "lead", MemberRole::Lead, TEAM))
            .unwrap();
        manager
            .add_member(member(W1, "w1", MemberRole::Worker, TEAM))
            .unwrap();
        manager
            .add_member(member(W2, "w2", MemberRole::Worker, TEAM))
            .unwrap();
        manager
    }

    /// 不变量 1（AC）：两个线程同时抢同一个任务，**恰好一个**成功。
    ///
    /// 用真实线程 + `Barrier` 而不是顺序调用：顺序调用只能证明「第二次被拒」，
    /// 证明不了「读-判-写」不是两段（真正的竞态窗口在中间）。
    #[test]
    fn exactly_one_of_two_concurrent_claims_wins() {
        let manager = Arc::new(seeded());
        manager.create_task(task("t1")).unwrap();

        let barrier = Arc::new(Barrier::new(2));
        let handles: Vec<_> = [W1, W2]
            .into_iter()
            .map(|member_id| {
                let manager = Arc::clone(&manager);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    manager
                        .claim_task("t1", member_id, 1_000)
                        .map(|task| task.owner.unwrap_or_default())
                })
            })
            .collect();

        let outcomes: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        let winners: Vec<&String> = outcomes.iter().filter_map(|o| o.as_ref().ok()).collect();

        assert_eq!(winners.len(), 1, "exactly one claim must win: {outcomes:?}");
        assert_eq!(outcomes.iter().filter(|o| o.is_err()).count(), 1);

        // 库里那一行的 owner 必须就是赢家（不变量 1：有且只有一个 owner）。
        let persisted = manager.task("t1").unwrap();
        assert_eq!(persisted.owner.as_deref(), Some(winners[0].as_str()));
        assert_eq!(persisted.state, TeamTaskState::Claimed);
    }

    /// 唤醒契约：**写路径**抬代数并唤醒等待者，**读路径**什么都不动。
    ///
    /// 保护的不变量（`team_wait` 的正确性全押在这三条上）：
    ///
    /// 1. 读路径不置位 —— 否则什么都没变也会惊动所有等待者（长轮次等待里的空转）；
    /// 2. 写路径在**释放锁之后**才唤醒 —— 持锁 notify 会让被唤醒者立刻去抢同一把锁；
    /// 3. 顺序是「先置位、后 notify」—— 唤醒者读到的代数因此保证是**新**的，不会被
    ///    `wait::wait` 的二次比对误判成「没变过」而重新进入 await（唤醒被吞）。
    ///
    /// `enable()` 是同步注册：只创建 `notified()` 而不 poll 不算注册，那一刻的
    /// `notify_waiters()` 会被丢弃（同 `pi_rpc::annotate` 的坑）。
    #[tokio::test]
    async fn write_paths_bump_the_epoch_and_read_paths_do_not() {
        let manager = Arc::new(seeded());
        let wake = manager.wake_handle();
        let before = manager.epoch();

        let notified = wake.notifier().notified();
        tokio::pin!(notified);
        let _ = notified.as_mut().enable();

        // 读路径：代数必须纹丝不动。
        assert_eq!(manager.team(TEAM).unwrap().id, TEAM);
        let _ = manager.tasks(TEAM);
        let _ = manager.member(W1);
        assert_eq!(manager.epoch(), before, "读路径不得改动代数");

        // 写路径：另一个线程改状态，等待者必须被叫醒。
        let writer = {
            let manager = Arc::clone(&manager);
            std::thread::spawn(move || manager.create_task(task("t1")).unwrap())
        };
        tokio::time::timeout(std::time::Duration::from_secs(2), notified.as_mut())
            .await
            .expect("写路径必须唤醒等待者");
        writer.join().unwrap();

        assert!(
            manager.epoch() > before,
            "写路径必须抬高代数（否则 wait 的二次比对会误判「没变过」）"
        );
        // 又一次写：认领也要抬。
        let after_create = manager.epoch();
        manager.claim_task("t1", W1, 1_000).unwrap();
        assert!(manager.epoch() > after_create, "认领也是写路径");
    }

    /// 不变量 1：顺序第二次认领必须被拒（任务已有 owner）。
    #[test]
    fn second_sequential_claim_is_rejected() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();

        let err = manager.claim_task("t1", W2, 1_001).unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(manager.task("t1").unwrap().owner.as_deref(), Some(W1));
    }

    /// 不变量 3：依赖未 `done` 时不可认领。
    #[test]
    fn claim_rejected_when_dependency_is_not_done() {
        let manager = seeded();
        let mut blocked = task("t2");
        blocked.depends_on = vec!["t1".into()];
        manager.create_task(task("t1")).unwrap();
        manager.create_task(blocked).unwrap();

        let err = manager.claim_task("t2", W1, 1_000).unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(manager.task("t2").unwrap().state, TeamTaskState::Pending);
    }

    /// 不变量 3（正例）：依赖 `done` 之后可以认领。
    #[test]
    fn claim_allowed_once_dependency_is_done() {
        let manager = seeded();
        let mut blocked = task("t2");
        blocked.depends_on = vec!["t1".into()];
        manager.create_task(task("t1")).unwrap();
        manager.create_task(blocked).unwrap();

        manager.claim_task("t1", W1, 1_000).unwrap();
        manager
            .update_task("t1", W1, TeamTaskState::Done, None, 1_100)
            .unwrap();
        manager.claim_task("t2", W2, 1_200).unwrap();

        assert_eq!(manager.task("t2").unwrap().owner.as_deref(), Some(W2));
    }

    /// 不变量 3：依赖指向不存在的任务时必须拒绝，而不是「当作已完成」。
    #[test]
    fn claim_rejected_when_dependency_is_missing() {
        let manager = seeded();
        let mut blocked = task("t2");
        blocked.depends_on = vec!["nope".into()];
        manager.create_task(blocked).unwrap();

        let err = manager.claim_task("t2", W1, 1_000).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
    }

    /// 跨队认领必须被拒：任务与成员不同队时 owner 关系毫无意义。
    #[test]
    fn cross_team_claim_is_rejected() {
        let manager = seeded();
        manager.create_team(team("tm_2")).unwrap();
        manager
            .add_member(member("w9@tm_2", "w9", MemberRole::Worker, "tm_2"))
            .unwrap();
        manager.create_task(task("t1")).unwrap();

        let err = manager.claim_task("t1", "w9@tm_2", 1_000).unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
    }

    /// 不变量 2：`done` 只能由 owner 触达 —— 别人（哪怕同队的另一个成员）不行。
    #[test]
    fn done_is_reachable_only_by_the_owner() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();

        let err = manager
            .update_task("t1", W2, TeamTaskState::Done, None, 1_100)
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_ne!(manager.task("t1").unwrap().state, TeamTaskState::Done);

        manager
            .update_task("t1", W1, TeamTaskState::Done, Some("ok"), 1_200)
            .unwrap();
        assert_eq!(manager.task("t1").unwrap().state, TeamTaskState::Done);
    }

    /// 不变量 2：队长 `force_done` 是**唯一**的越权路径，且必须留审计。
    #[test]
    fn force_done_by_lead_records_an_audit_row() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();

        let done = manager.force_done("t1", LEAD, "stuck", 1_100).unwrap();
        assert_eq!(done.state, TeamTaskState::Done);

        let events = manager.events(TEAM).unwrap();
        let audit = events
            .iter()
            .find(|e| e.kind == EVENT_FORCE_DONE)
            .expect("force_done must leave an audit row");
        assert_eq!(audit.actor, LEAD);
        assert_eq!(audit.subject.as_deref(), Some("t1"));
        assert!(audit
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("reason=stuck"));
    }

    /// 不变量 2 / 授权矩阵（design §3.2）：成员不得冒用队长的 `force_done`。
    #[test]
    fn force_done_by_a_worker_is_rejected() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();

        let err = manager.force_done("t1", W2, "mine now", 1_100).unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(manager.task("t1").unwrap().state, TeamTaskState::Claimed);
    }

    /// `done` / `failed` / `blocked` 是吸收态：不能被重新打开（否则「完成」可被撤销）。
    #[test]
    fn terminal_tasks_cannot_be_reopened() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();
        manager
            .update_task("t1", W1, TeamTaskState::Done, None, 1_100)
            .unwrap();

        let err = manager
            .update_task("t1", W1, TeamTaskState::InProgress, None, 1_200)
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(manager.task("t1").unwrap().state, TeamTaskState::Done);
    }

    /// 不变量 5：`state != pending` 后 `workspace` 不可变（改指向会让产物落在错的地方）。
    #[test]
    fn workspace_is_immutable_once_claimed() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();

        let err = manager
            .set_task_workspace(
                "t1",
                Workspace::Worktree {
                    path: root().join("wt"),
                },
                W1,
            )
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(manager.task("t1").unwrap().workspace, Workspace::Shared);
    }

    /// 不变量 5（正例）：`pending` 时可以指定工作区。
    #[test]
    fn workspace_is_mutable_while_pending() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        let target = Workspace::Worktree {
            path: root().join("wt"),
        };
        manager
            .set_task_workspace("t1", target.clone(), LEAD)
            .unwrap();
        assert_eq!(manager.task("t1").unwrap().workspace, target);
    }

    /// 不变量 4：回收 3 次之后第 4 次过期必须冻结成 `blocked`，
    /// 且**不再**被任何后续回收触碰（防无限重试）。
    #[test]
    fn reclaim_over_limit_blocks_the_task_for_good() {
        let manager = seeded();
        let mut t = task("t1");
        t.reclaim_count = 3;
        manager.create_task(t).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();

        let reclaimed = manager.reclaim_expired(1_000 + 1_800_000).unwrap();
        assert_eq!(reclaimed, vec!["t1".to_owned()]);

        let frozen = manager.task("t1").unwrap();
        assert_eq!(frozen.state, TeamTaskState::Blocked);
        assert_eq!(frozen.owner, None);
        assert_eq!(frozen.reclaim_count, 4);

        // 再等一万年也不回收（不是 active 态）。
        assert!(manager
            .reclaim_expired(1_000 + 10_000_000_000)
            .unwrap()
            .is_empty());
        assert_eq!(manager.task("t1").unwrap().state, TeamTaskState::Blocked);
        assert!(manager
            .events(TEAM)
            .unwrap()
            .iter()
            .any(|e| e.kind == EVENT_BLOCKED));
    }

    /// AC3：成员被杀 → 租约到期 → 任务回 `pending`、owner 清空、成员落 `Stalled`，
    /// 依赖它的任务因此不会被永久堵死。
    #[test]
    fn expired_lease_returns_task_to_pending_and_stalls_owner() {
        let manager = seeded();
        let mut dependent = task("t2");
        dependent.depends_on = vec!["t1".into()];
        manager.create_task(task("t1")).unwrap();
        manager.create_task(dependent).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();

        // 未到期：什么都不发生。
        assert!(manager
            .reclaim_expired(1_000 + 1_799_999)
            .unwrap()
            .is_empty());
        assert_eq!(manager.task("t1").unwrap().state, TeamTaskState::Claimed);

        let reclaimed = manager.reclaim_expired(1_000 + 1_800_000).unwrap();
        assert_eq!(reclaimed, vec!["t1".to_owned()]);

        let task = manager.task("t1").unwrap();
        assert_eq!(task.state, TeamTaskState::Pending);
        assert_eq!(task.owner, None);
        assert_eq!(task.claimed_at, None);
        assert_eq!(task.reclaim_count, 1);
        assert_eq!(manager.member(W1).unwrap().state, MemberState::Stalled);

        // 回收后任务可被重新认领（依赖链不会永久堵死）。
        manager.claim_task("t1", W2, 1_000 + 1_800_001).unwrap();
    }

    /// AC2：`turn_completed` 后成员落 `Idle` + `Unverified`，**任务仍在进行中**。
    #[test]
    fn turn_completed_leaves_the_task_in_progress_and_the_member_unverified() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();
        manager
            .update_task("t1", W1, TeamTaskState::InProgress, None, 1_050)
            .unwrap();

        let state = manager
            .observe_signal(W1, MemberSignal::TurnCompleted, 1_100)
            .unwrap();
        assert_eq!(state, MemberState::Idle);
        assert_eq!(manager.task("t1").unwrap().state, TeamTaskState::InProgress);
        assert_eq!(
            manager.verification(W1),
            Some(DoneVerification::Unverified),
            "无 L2 必须标记为未声明"
        );
    }

    /// design §6 硬规则 2/3：显式 `task_update(done)` 之后取证为 `verified`，
    /// 且随后迟到的 `TurnCompleted` 不得把它降级。
    #[test]
    fn explicit_done_is_verified_and_survives_late_signals() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();
        manager
            .update_task("t1", W1, TeamTaskState::Done, None, 1_100)
            .unwrap();
        assert_eq!(manager.verification(W1), Some(DoneVerification::Verified));

        manager
            .observe_signal(W1, MemberSignal::TurnCompleted, 1_200)
            .unwrap();
        assert_eq!(manager.verification(W1), Some(DoneVerification::Verified));
        assert_eq!(manager.task("t1").unwrap().state, TeamTaskState::Done);
    }

    /// 回填 `terminal_id`：内存镜像与库一起改，且**允许覆盖**（重试会拿到新 session id）。
    #[test]
    fn binding_a_terminal_updates_mirror_and_store() {
        let manager = seeded();
        // 夹具成员已带 `term-w1` —— 回填是**覆盖**语义，不是"从无到有"。
        assert_eq!(
            manager.member(W1).expect("member").terminal_id.as_deref(),
            Some("term-w1")
        );

        manager
            .set_member_terminal(W1, "term-1", 1_000)
            .expect("bind");
        assert_eq!(
            manager.member(W1).expect("member").terminal_id.as_deref(),
            Some("term-1")
        );
        // 库与镜像同源：读库也必须看到同一个 id（否则第二次启动读到旧的）。
        let stored = manager
            .store()
            .list_members(TEAM)
            .expect("members")
            .into_iter()
            .find(|row| row.id == W1)
            .expect("row");
        assert_eq!(stored.terminal_id.as_deref(), Some("term-1"));

        // 重复绑定（PTY 重试）必须覆盖，否则成员卡在一个失效句柄上。
        manager
            .set_member_terminal(W1, "term-2", 2_000)
            .expect("rebind");
        assert_eq!(
            manager.member(W1).expect("member").terminal_id.as_deref(),
            Some("term-2")
        );
    }

    /// 建队 + 队长**一次写入**：两步之间没有「没有队长」的中间态。
    #[test]
    fn a_team_and_its_lead_are_created_in_one_step() {
        let manager = TeamManager::new(TeamStore::open_in_memory().unwrap());
        let new_team = team("tm_2");
        let lead = TeamMember {
            team_id: "tm_2".into(),
            role: MemberRole::Lead,
            ..fixture_member("lead@tm_2", "tm_2")
        };
        manager
            .create_team_with_lead(new_team, lead)
            .expect("一次写入");

        assert!(manager.team("tm_2").is_some());
        assert_eq!(
            manager.member("lead@tm_2").map(|m| m.role),
            Some(MemberRole::Lead)
        );
        // 库与镜像同源（第二次启动靠库重建）。
        assert_eq!(manager.store().list_teams().expect("teams").len(), 1);
        assert_eq!(
            manager.store().list_members("tm_2").expect("members").len(),
            1
        );
    }

    /// 拒绝条件与两个单步方法同源：跨队的队长、非队长角色、已存在的团队 id。
    #[test]
    fn creating_a_team_with_a_mismatched_lead_is_refused() {
        let manager = TeamManager::new(TeamStore::open_in_memory().unwrap());

        // ① 队长的 team_id 与团队不符 —— 否则会写出一个孤儿成员。
        let err = manager
            .create_team_with_lead(
                team("tm_2"),
                TeamMember {
                    team_id: "tm_other".into(),
                    role: MemberRole::Lead,
                    ..fixture_member("lead@tm_other", "tm_other")
                },
            )
            .expect_err("跨队");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");

        // ② 角色不是 Lead：这个方法存在的理由就是「同时建队长」。
        let err = manager
            .create_team_with_lead(
                team("tm_2"),
                TeamMember {
                    role: MemberRole::Worker,
                    ..fixture_member("w@tm_2", "tm_2")
                },
            )
            .expect_err("非队长");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");

        // ③ 团队 id 已存在（覆盖写会静默丢掉整队状态）。
        manager.create_team(team("tm_2")).unwrap();
        let err = manager
            .create_team_with_lead(
                team("tm_2"),
                TeamMember {
                    role: MemberRole::Lead,
                    ..fixture_member("lead@tm_2", "tm_2")
                },
            )
            .expect_err("重名");
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        // 拒绝时**没有**留下成员行。
        assert!(manager.member("lead@tm_2").is_none());
    }

    /// 绑定队长的终端会同时写 `Team.lead_session_id`：两处各写一遍会漂移。
    #[test]
    fn binding_the_leads_terminal_records_the_team_session() {
        let manager = seeded();
        assert_eq!(manager.team(TEAM).expect("team").lead_session_id, "sess");

        manager
            .set_member_terminal(LEAD, "term-lead", 1_000)
            .expect("bind");
        assert_eq!(
            manager.team(TEAM).expect("team").lead_session_id,
            "term-lead"
        );
        let stored = manager
            .store()
            .list_teams()
            .expect("teams")
            .into_iter()
            .find(|row| row.id == TEAM)
            .expect("row");
        assert_eq!(stored.lead_session_id, "term-lead", "库与镜像同源");

        // 工人的绑定**不**碰团队行。
        manager.set_member_terminal(W1, "term-w1b", 2_000).unwrap();
        assert_eq!(
            manager.team(TEAM).expect("team").lead_session_id,
            "term-lead"
        );
    }

    /// 空 terminal id → `InvalidInput`；未知成员 → `NotFound`（两种错都不写库）。
    #[test]
    fn binding_rejects_an_empty_id_and_an_unknown_member() {
        let manager = seeded();
        let err = manager
            .set_member_terminal(W1, "   ", 1_000)
            .expect_err("empty");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
        assert_eq!(
            manager.member(W1).expect("member").terminal_id.as_deref(),
            Some("term-w1"),
            "拒绝时不得改动已有绑定"
        );

        let err = manager
            .set_member_terminal("ghost@tm_1", "term-1", 1_000)
            .expect_err("unknown");
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
    }

    /// 签发会**轮换**：旧凭证立即失效。
    ///
    /// 保护的不变量：执行层重试 `issue_token` 时不会留下两把能用的钥匙
    /// （旧 hash 被覆盖，旧明文立刻解析不到主体）。
    #[test]
    fn issuing_twice_rotates_the_credential() {
        let manager = seeded();
        let first = manager.issue_token(W1, 1_000).expect("first");
        let second = manager.issue_token(W1, 2_000).expect("second");
        assert_ne!(first, second, "两次签发必须得到不同明文");

        let stored = manager.member(W1).expect("member").token_hash;
        assert_eq!(
            stored,
            crate::agent::team::identity::hash_token(&second),
            "库里必须是最近一次的 hash"
        );
        assert_ne!(
            stored,
            crate::agent::team::identity::hash_token(&first),
            "旧明文必须失效"
        );
    }

    /// 硬规则：取证按任务重置 —— 上一件任务的 `Verified` 不得延续到新任务。
    ///
    /// 这条是 `recompute_all_verification` 与 `claim_task` 的共同判据：
    /// 「成员完成过 t1」不等于「t2 也已被声明完成」。
    #[test]
    fn claim_resets_verification_for_the_new_task() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.create_task(task("t2")).unwrap();

        manager.claim_task("t1", W1, 1_000).unwrap();
        manager
            .update_task("t1", W1, TeamTaskState::Done, None, 1_100)
            .unwrap();
        assert_eq!(manager.verification(W1), Some(DoneVerification::Verified));

        manager.claim_task("t2", W1, 1_200).unwrap();
        assert_eq!(
            manager.verification(W1),
            Some(DoneVerification::Unverified),
            "领新任务即回到未声明"
        );

        // 新任务回合结束但未声明：仍为 Unverified，不得借用上一件的 Verified。
        manager
            .observe_signal(W1, MemberSignal::TurnCompleted, 1_300)
            .unwrap();
        assert_eq!(manager.verification(W1), Some(DoneVerification::Unverified));
    }

    /// design §6.1：审批请求把成员摆到 `Awaiting`、任务摆到 `awaiting_approval`。
    #[test]
    fn approval_request_moves_both_member_and_task() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();

        manager
            .observe_signal(W1, MemberSignal::ApprovalRequested, 1_100)
            .unwrap();
        assert_eq!(manager.member(W1).unwrap().state, MemberState::Awaiting);
        assert_eq!(
            manager.task("t1").unwrap().state,
            TeamTaskState::AwaitingApproval
        );
    }

    /// 杀进程（`Exited`）→ 成员 `Dead`，任务仍 `InProgress` 等租约回收
    /// （`advance` 不替成员判死任务，design §2.1）。
    #[test]
    fn exited_marks_member_dead_and_leaves_reclaim_to_the_lease() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();

        manager
            .observe_signal(W1, MemberSignal::Exited, 1_100)
            .unwrap();
        assert_eq!(manager.member(W1).unwrap().state, MemberState::Dead);
        assert_eq!(manager.task("t1").unwrap().state, TeamTaskState::Claimed);

        manager.reclaim_expired(1_000 + 1_800_000).unwrap();
        assert_eq!(manager.task("t1").unwrap().state, TeamTaskState::Pending);
        // 终态成员不得被洗成 Stalled。
        assert_eq!(manager.member(W1).unwrap().state, MemberState::Dead);
    }

    /// 重启恢复：板从库里读回，取证按任务板推导（硬规则 3），不需要第二份持久化状态。
    #[test]
    fn reload_restores_the_board_and_derives_verification() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("neeko.db");

        {
            let manager = TeamManager::new(TeamStore::open(&db).unwrap());
            manager.create_team(team(TEAM)).unwrap();
            manager
                .add_member(member(W1, "w1", MemberRole::Worker, TEAM))
                .unwrap();
            manager
                .add_member(member(W2, "w2", MemberRole::Worker, TEAM))
                .unwrap();
            manager.create_task(task("t1")).unwrap();
            manager.claim_task("t1", W1, 1_000).unwrap();
            manager
                .update_task("t1", W1, TeamTaskState::Done, Some("done"), 1_100)
                .unwrap();
        }

        let reloaded = TeamManager::load(TeamStore::open(&db).unwrap()).unwrap();
        assert_eq!(reloaded.task("t1").unwrap().state, TeamTaskState::Done);
        assert_eq!(reloaded.team(TEAM).unwrap().name, "T");
        assert_eq!(reloaded.verification(W1), Some(DoneVerification::Verified));
        assert_eq!(
            reloaded.verification(W2),
            Some(DoneVerification::Unverified)
        );
        assert!(
            !reloaded.events(TEAM).unwrap().is_empty(),
            "audit survives reload"
        );
    }

    /// 一个团队只能有一个队长：第二个 `Lead` 被拒（否则两个主体都能 `team_close`）。
    #[test]
    fn second_lead_in_the_same_team_is_rejected() {
        let manager = seeded();
        let err = manager
            .add_member(member("lead2@tm_1", "lead2", MemberRole::Lead, TEAM))
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
    }

    /// 非正租约是配置错误：一认领就到期会让任务在板上「反复消失」。
    #[test]
    fn non_positive_lease_ttl_is_rejected_at_creation() {
        let manager = seeded();
        let mut t = task("t1");
        t.lease_ttl = 0;
        let err = manager.create_task(t).unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
    }

    /// **租约是活性信号，不是时长上限**：owner 一有动静就续期。
    ///
    /// 没有这条，回收器一上线就会去抢健康成员手里的活（一个跑 40 分钟的任务在
    /// `lease_ttl=1800s` 处被回收，成员还在写代码，而 `reclaim_count` 却往上加）。
    #[test]
    fn an_owner_update_renews_the_lease() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();
        assert_eq!(manager.task("t1").unwrap().claimed_at, Some(1_000));

        // 1_700s 后报进度：起租时间前移。
        manager
            .update_task(
                "t1",
                W1,
                TeamTaskState::InProgress,
                Some("half"),
                1_000 + 1_700_000,
            )
            .unwrap();
        assert_eq!(
            manager.task("t1").unwrap().claimed_at,
            Some(1_000 + 1_700_000),
            "owner 的活动必须续期"
        );

        // 于是按**最初**的起租时间判也不到期了。
        assert!(
            manager
                .reclaim_expired(1_000 + 1_800_000 + 1)
                .unwrap()
                .is_empty(),
            "续期后的任务不该被回收"
        );
    }

    /// hook 上报同样是活性证据（`turn_completed` 说明这个成员刚刚干完一轮）。
    #[test]
    fn a_hook_signal_from_the_owner_renews_the_lease() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();

        manager
            .observe_signal(W1, MemberSignal::TurnCompleted, 1_000 + 1_700_000)
            .unwrap();
        assert_eq!(
            manager.task("t1").unwrap().claimed_at,
            Some(1_000 + 1_700_000)
        );
        assert!(manager
            .reclaim_expired(1_000 + 1_800_000 + 1)
            .unwrap()
            .is_empty());
    }

    /// 死亡信号**不**续期：`Exited` 之后按原起租时间就该回收，不能因为「它说它退出了」
    /// 又宽限一个 ttl（AC3 要的是尽快放手）。
    #[test]
    fn a_death_signal_does_not_renew_the_lease() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();

        manager
            .observe_signal(W1, MemberSignal::Exited, 1_000 + 1_700_000)
            .unwrap();
        assert_eq!(
            manager.task("t1").unwrap().claimed_at,
            Some(1_000),
            "死亡信号不是活性证据"
        );
        assert_eq!(
            manager.reclaim_expired(1_000 + 1_800_000 + 1).unwrap(),
            vec!["t1".to_owned()]
        );
    }

    /// 没有活动的任务**仍然会**过期 —— 续期不能把 AC3 一起续掉。
    #[test]
    fn a_silent_task_still_expires() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", W1, 1_000).unwrap();

        assert_eq!(
            manager.reclaim_expired(1_000 + 1_800_000 + 1).unwrap(),
            vec!["t1".to_owned()]
        );
        assert_eq!(manager.task("t1").unwrap().state, TeamTaskState::Pending);
    }
}
