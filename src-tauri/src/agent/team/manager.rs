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
//!
//! # 失效脉冲（前端面板的依赖，P3）
//!
//! 同一个守卫还负责给前端发 [`crate::agent::team::events::TeamPulse`]：**任何写路径都恰好
//! 一次脉冲**（含 `?` 早退路径），读路径零次。脉冲与 `notify_waiters` 共用发射点不是巧合 ——
//! 它们观察的是同一件事实（「状态变过了」），分两处写就一定会有一处先被遗忘。
//! 正因挂在守卫里，上述「漏写是静默的」在这里不再成立：
//! `a_write_emits_exactly_one_pulse_with_a_strictly_increasing_revision` 与
//! `read_paths_emit_no_pulses_and_leave_the_revision_alone` 直接钉住这个结构事实。

use parking_lot::{Mutex, MutexGuard, RwLock};
use std::collections::HashMap;
use std::ops::{Deref, DerefMut};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Notify;

use crate::agent::team::completion::advance;
use crate::agent::team::events::TeamNotifier;
use crate::agent::team::lease::{lease_expired, next_reclaim_count, should_auto_release};
use crate::agent::team::store::{clamp_task_summary, TeamEventRecord, TeamStore};
use crate::agent::team::types::{
    DoneVerification, MemberRole, MemberSignal, MemberState, TaskRef, Team, TeamMember, TeamState,
    TeamTask, TeamTaskState, Workspace,
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

/// 审计事件类别：一名成员被归档（进程已关 → `Dead` + 凭证作废 + 在飞任务回 `pending`）。
pub const EVENT_CLOSE_MEMBER: &str = "close_member";

/// 审计事件类别：团队进入 `Closing`（整队关闭开始）。
pub const EVENT_CLOSE_BEGIN: &str = "close_begin";

/// 审计事件类别：团队落终态 `Closed`（`closed_at` 写入的那一次）。
pub const EVENT_CLOSE_TEAM: &str = "close_team";

/// 审计事件类别：收到一次关闭**请求**（`graceful` 是否被要求）。
///
/// `graceful` 本期不兑现（没有 shutdown 协议），所以这里记的是「收到过这个意图」而不是
/// 「做过优雅收尾」—— 红线 14：审计不得声明没发生的能力。
pub const EVENT_CLOSE_REQUEST: &str = "close_request";

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

/// 一个队任务板的三个计数（[`TeamManager::task_counts`]）。
///
/// 单独成类型而不是三个 `usize` 返回值：调用点看到 `counts.open` 就知道它是「未终结」，
/// 而不是「open 是第几个参数」—— 三个同型参数是最容易传反的一种签名。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TaskCounts {
    /// 板上任务总数。
    pub total: usize,
    /// 未终结的任务数（非 `done` / `failed` / `blocked`）。
    pub open: usize,
    /// 已完成的任务数。
    pub done: usize,
}

/// 内存镜像 + 共享库。
pub struct TeamManager {
    store: TeamStore,
    inner: Mutex<Inner>,
    /// 变更唤醒句柄（`team_wait` 的等待者挂在它上面，design §4.3）。
    wake: TeamWake,
    /// 前端事件端口（**晚绑定**：启动期 hydrate 时还没有窗口，见
    /// [`TeamManager::set_notifier`]）。`None` = 还没有前端在听，静默不发。
    notifier: RwLock<Option<Arc<dyn TeamNotifier>>>,
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
    ///
    /// 返回**置位之后**的代数：失效脉冲的 `rev` 取的就是它，而调高与读回必须来自同一个
    /// 原子动作 —— 分成 `fetch_add` 再 `epoch()` 两步读，中间插进一次写就会把两次写报成
    /// 同一个 `rev`（前端去重于是吞掉一次真变化）。
    fn bump(&self) -> u64 {
        let rev = self.epoch.fetch_add(1, Ordering::Release) + 1;
        self.notify.notify_waiters();
        rev
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
/// # 前端失效脉冲挂在这里，与唤醒同一个落点
///
/// 事件载荷是 `TeamPulse { rev }`（见 [`crate::agent::team::events`]）。它和 `notify_waiters`
/// 是同一件事实的**两个消费者**（等待者 / 面板），所以必须共用一个发射点：分成两处写，
/// 「某个写路径忘了发事件」就会变成一个只能靠肉眼发现的静默缺陷 —— 而这里漏发一次，前端
/// 面板就永久停在一个错的状态上（没有任何机制会让它自愈）。
///
/// 顺序：先放锁 → 抬代数 → 发脉冲。发脉冲时**不持任何锁**（`emit` 会走 Tauri 的 IPC 路径）。
///
/// 顺序不可颠倒：持锁 `notify_waiters()` 会让被唤醒者立刻去抢同一把锁（惊群 + 无谓
/// 竞争），而 [`TeamWake::bump`] 的契约本来就要求锁已释放。
struct WriteGuard<'a> {
    inner: Option<MutexGuard<'a, Inner>>,
    wake: &'a TeamWake,
    notifier: &'a RwLock<Option<Arc<dyn TeamNotifier>>>,
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
        // 顺序即契约：先放锁，再置位 + 唤醒，最后发失效脉冲。
        drop(self.inner.take());
        let rev = self.wake.bump();
        // 端口先克隆出 `Arc` 再发：发脉冲时不持 `notifier` 的读锁（emit 是外部调用，
        // 持锁期间拿锁的实现方会直接死锁）。
        let listener = self.notifier.read().clone();
        if let Some(notifier) = listener {
            notifier.pulse(rev);
        }
    }
}

#[derive(Default)]
struct Inner {
    teams: HashMap<String, Team>,
    members: HashMap<String, TeamMember>,
    /// 任务镜像，键是 [`TaskRef`]（`team_id` + `id`），**不是** `id`。
    ///
    /// `t1` 在每个队都存在，所以 `HashMap<String, TeamTask>` 会让两个队的 `t1` 互相覆盖
    /// —— 症状是「改 A 队的任务，B 队的同名任务跟着变了」，而任何单队测试都发现不了。
    tasks: HashMap<TaskRef, TeamTask>,
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
            notifier: RwLock::new(None),
        }
    }

    /// 绑定前端事件端口（**晚绑定**，组合根在端点启动前调一次）。
    ///
    /// # 为什么不是构造参数
    ///
    /// `TeamManager` 在 `AppStateWrapper` 构造期就要存在（其他域的状态都依赖它），
    /// 而 `AppHandle` 要等 `setup` 才可用 —— 构造期绑定会逼出一层 `Option<AppHandle>`
    /// 在域里的泄漏（与 `app_state.set_team_reaper` 同构：先建对象，再注入句柄）。
    ///
    /// # 为什么 `None` 是合法的静默态
    ///
    /// 启动期 hydrate（[`Self::load`]）不该发事件：那一刻没有前端窗口在听，发出去的
    /// 脉冲只会被丢弃，而「丢弃」和「没发」在日志里长得一样。所以未绑定 = 静默不发，
    /// 不是错误。
    pub fn set_notifier(&self, notifier: Arc<dyn TeamNotifier>) {
        *self.notifier.write() = Some(notifier);
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
            notifier: &self.notifier,
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
                inner.tasks.insert(task.key(), task);
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

    /// 读一个任务（**必须同时给队与 id**，见 [`TaskRef`]）。
    ///
    /// 签名里没有「只给 id」的形态是刻意的：`t1` 在每个队都存在，只给 id 的查询要么
    /// 需要猜一个队、要么需要遍历全部队再挑一条 —— 两种都会把「读到别队的同名任务」
    /// 变成一个随时可能发生的事故（判据：`a_task_id_is_only_unique_inside_its_team`）。
    #[must_use]
    pub fn task(&self, key: &TaskRef) -> Option<TeamTask> {
        self.inner.lock().tasks.get(key).cloned()
    }

    /// 读**全部**团队行（按 id 排序），供 `view::list_teams` 这类跨队读路径用。
    ///
    /// 只读内存镜像：团队行是 `load` 时期 hydrate 的，与库同一把锁内一起改。排序在这里做是
    /// 为了让调用方看到的是一个**稳定集合**（`HashMap` 的遍历顺序不稳定，而排序口径 ——
    /// 「最近的在前」—— 属于展示层，见 `view::list_teams`）。
    #[must_use]
    pub fn teams(&self) -> Vec<Team> {
        let inner = self.inner.lock();
        let mut teams: Vec<Team> = inner.teams.values().cloned().collect();
        teams.sort_by(|a, b| a.id.cmp(&b.id));
        teams
    }

    /// 团队的**成员数（不含队长）**。
    ///
    /// 用途只有两处，且必须同源：`team_spawn` 的上限判据与 `team_options` 的
    /// `memberCount`（队长据此算「还能加几个」）。写两份计数必然有一份把队长也算进去 ——
    /// 而那种偏差只在“刚好卡在上限”时显形。
    ///
    /// 只读内存镜像（锁内无 I/O）：花名册是 `load` 时期建的，与库同一把锁内一起改。
    /// 已 `Dead` 的成员仍计入 —— 它在花名册上占着名字与 `max_members` 的名额，
    /// 直到被 `team_close` 归档（否则一个反复起不来的 CLI 可以无限重试）。
    #[must_use]
    pub fn member_count(&self, team_id: &str) -> u32 {
        let inner = self.inner.lock();
        let count = inner
            .members
            .values()
            .filter(|member| member.team_id == team_id && member.role == MemberRole::Worker)
            .count();
        u32::try_from(count).unwrap_or(u32::MAX)
    }

    /// 任务板的三个计数（`team_list` 这类**只需要数字**的读路径用它）。
    ///
    /// # 为什么不是 `tasks(team_id).len()`
    ///
    /// [`Self::tasks`] 会在锁内把整段任务行 clone 出来。对「要板视图」的调用方那是必需的，
    /// 对「要三个数字」的调用方则是把红线 4 的时间维度破了：`team_list` 每次面板脉冲都会走，
    /// 而它要的只是 `total` / `open` / `done`。
    ///
    /// 判据的口径与 `view::team_status_view` **一致**（未终结 = 非 `done` / `failed` /
    /// `blocked`），因为两处用的是同一个判据函数（[`is_terminal_task`]）。
    #[must_use]
    pub fn task_counts(&self, team_id: &str) -> TaskCounts {
        let inner = self.inner.lock();
        let mut counts = TaskCounts::default();
        for task in inner.tasks.values().filter(|task| task.team_id == team_id) {
            counts.total += 1;
            if !is_terminal_task(task.state) {
                counts.open += 1;
            }
            if task.state == TeamTaskState::Done {
                counts.done += 1;
            }
        }
        counts
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
        // 唯一性判据是 `(team_id, id)`：别的队的同名任务不是冲突（每个队的板都从 t1 开始）。
        if inner.tasks.contains_key(&task.key()) {
            return Err(conflict(format!("task {} already exists", task.key())));
        }
        if !matches!(task.state, TeamTaskState::Pending | TeamTaskState::Proposed) {
            return Err(invalid(format!(
                "task {} must start pending or proposed, got {:?}",
                task.key(),
                task.state
            )));
        }
        // `lease_ttl <= 0` 会让任务一被认领就到期，看起来像「成员永远在丢失任务」。
        if task.lease_ttl <= 0 {
            return Err(invalid(format!(
                "task {} lease_ttl must be positive, got {}",
                task.key(),
                task.lease_ttl
            )));
        }
        let task = clamp_task_summary(&task);
        self.store.upsert_task(&task)?;
        inner.tasks.insert(task.key(), task.clone());
        Ok(task)
    }

    // ═══════════════════════════════════════════════════════════════════
    // 迁移（唯一写入口）
    // ═══════════════════════════════════════════════════════════════════

    /// 认领任务（不变量 1 / 3）。
    pub fn claim_task(
        &self,
        key: &TaskRef,
        member_id: &str,
        now: i64,
    ) -> Result<TeamTask, AppError> {
        let mut inner = self.lock_writing();
        let mut task = inner
            .tasks
            .get(key)
            .cloned()
            .ok_or_else(|| not_found(format!("task {key}")))?;
        let member = inner
            .members
            .get(member_id)
            .cloned()
            .ok_or_else(|| not_found(format!("member {member_id}")))?;

        // 不变量 1：只有 `pending` 可被认领。`claimed`/`in_progress` 已有 owner，
        // `blocked` 是冻结态，`proposed` 还必须先被队长 accept。
        if task.state != TeamTaskState::Pending {
            return Err(conflict(format!(
                "task {key} is {:?}, only pending can be claimed",
                task.state
            )));
        }
        // 跨队认领：owner 关系跨队毫无意义，且会让授权矩阵算错队伍。
        if member.team_id != task.team_id {
            return Err(conflict(format!(
                "member {member_id} belongs to {}, task {key} to {}",
                member.team_id, task.team_id
            )));
        }
        // 不变量 3：依赖必须在本队板上存在、且已 done。
        //
        // **跨队 id 不被当成依赖满足**：`depends_on` 里只有一个队内 id，所以解析时
        // 必须补上本队 —— 只按 id 找会让 A 队任务的 `t1` 被 B 队的 `t1` 满足
        // （判据：`depends_on_resolves_inside_the_team`）。
        // 「依赖不存在」抛 NotFound 而不是 Conflict：那是数据缺陷，不是瞬时冲突。
        for dependency in &task.depends_on {
            let dep_key = TaskRef::new(task.team_id.clone(), dependency.as_str());
            let dep = inner
                .tasks
                .get(&dep_key)
                .ok_or_else(|| not_found(format!("dependency {dep_key}")))?;
            if dep.state != TeamTaskState::Done {
                return Err(conflict(format!(
                    "dependency {dep_key} is {:?}, not done",
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
        inner.tasks.insert(task.key(), task.clone());
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
        key: &TaskRef,
        workspace: Workspace,
        actor: &str,
    ) -> Result<TeamTask, AppError> {
        let mut inner = self.lock_writing();
        let mut task = inner
            .tasks
            .get(key)
            .cloned()
            .ok_or_else(|| not_found(format!("task {key}")))?;

        // 不变量 5：一旦被认领，workspace 就是成员的 cwd —— 改它等于让产物落在
        // 一个没人看过的地方。只允许在 `pending` 时指定。
        if task.state != TeamTaskState::Pending {
            return Err(conflict(format!(
                "task {key} is {:?}, workspace is immutable after claim",
                task.state
            )));
        }

        task.workspace = workspace;
        self.store.upsert_task(&task)?;
        inner.tasks.insert(task.key(), task.clone());
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
        key: &TaskRef,
        actor: &str,
        new_state: TeamTaskState,
        summary: Option<&str>,
        now: i64,
    ) -> Result<TeamTask, AppError> {
        let mut inner = self.lock_writing();
        let mut task = inner
            .tasks
            .get(key)
            .cloned()
            .ok_or_else(|| not_found(format!("task {key}")))?;
        let actor_member = inner
            .members
            .get(actor)
            .cloned()
            .ok_or_else(|| not_found(format!("member {actor}")))?;

        // 不变量 2：`done`（以及 failed 等一切显式声明）只能由 owner 触达。
        // 队长越过 owner 的唯一路径是 [`Self::force_done`]，那条路径会记审计。
        if task.owner.as_deref() != Some(actor) {
            return Err(conflict(format!(
                "task {key} is owned by {:?}, not {actor}",
                task.owner
            )));
        }
        // 吸收态：已完成的判死不可撤销（否则「done」可以被悄悄改回进行中）。
        if is_terminal_task(task.state) {
            return Err(conflict(format!("task {key} is already {:?}", task.state)));
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
                "owner cannot move task {key} to {new_state:?}"
            )));
        }
        // 任务必须真的在 owner 手里（`pending` 先 claim，`proposed` 先 accept）。
        if !is_active(task.state) {
            return Err(conflict(format!(
                "task {key} is {:?}, claim it first",
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
        inner.tasks.insert(task.key(), task.clone());
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
        key: &TaskRef,
        actor: &str,
        reason: &str,
        now: i64,
    ) -> Result<TeamTask, AppError> {
        let mut inner = self.lock_writing();
        let mut task = inner
            .tasks
            .get(key)
            .cloned()
            .ok_or_else(|| not_found(format!("task {key}")))?;
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
                "task {key} is {:?}, cannot force_done",
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
        inner.tasks.insert(task.key(), task.clone());
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
                    inner.tasks.insert(task.key(), task);
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
    /// 返回被回收（含被冻结）的任务的 [`TaskRef`]（不是裸 id —— `t1` 在别的队也存在）。
    /// 过期任务的 owner 若不是终态，成员落 `Stalled`
    /// —— design §2.1 的「任意 ──lease 到期──▶ Stalled」。
    pub fn reclaim_expired(&self, now: i64) -> Result<Vec<TaskRef>, AppError> {
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
        // 回收是**跨队**的一拍：排序必须带上 `team_id`，否则两个队的 `t1` 谁先谁后取决于
        // `HashMap` 的遍历顺序，而审计行的次序就不再稳定。
        expired.sort_by(|a, b| (&a.team_id, &a.id).cmp(&(&b.team_id, &b.id)));

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
            inner.tasks.insert(task.key(), task.clone());
            reclaimed.push(task.key());

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
    // 关闭（单成员 / 整队）—— 两相位的「归档」那一半
    // ═══════════════════════════════════════════════════════════════════

    /// 记录一次关闭**请求**（决定层已经校验完目标之后调）。
    ///
    /// # 为什么单独一条审计
    ///
    /// `graceful` 的值只对这个事实有意义：本期没有 shutdown 协议，能否优雅收尾**不是**
    /// 状态迁移。把它塞进 `close_member` 的 detail 会让人以为「那次关闭是优雅的」——
    /// 而它只是「被要求过」。审计行是唯一能区分这两者的地方。
    ///
    /// # 它是**写路径**（用 `lock_writing()`，不是 `inner.lock()`）
    ///
    /// 它确实不改内存镜像，但它要写库（审计行）—— 而「写库」这件事的观察面不是内存镜像，
    /// 是**面板与等待者**：审计是抽屉里的事件流，一条新事件出现却不发脉冲，抽屉就会停在
    /// 旧列表上（用户的观感是「我点了关闭，什么都没发生」）。先用读锁再写库则更糟：那把锁
    /// 没有守卫，`?` 早退时连一次脉冲都不会有，而这类遗漏在所有行为测试里都是静默的。
    ///
    /// 判据：`recording_a_close_request_emits_exactly_one_pulse`。
    pub fn record_close_request(
        &self,
        team_id: &str,
        member_id: Option<&str>,
        graceful: bool,
        now: i64,
    ) -> Result<(), AppError> {
        let mut inner = self.lock_writing();
        let actor = lead_of(&inner, team_id);
        self.audit(
            &mut inner,
            team_id,
            &actor,
            EVENT_CLOSE_REQUEST,
            member_id.map(str::to_owned),
            Some(format!("graceful={graceful} at={now}")),
        )
    }

    /// 成员关闭成功后的归档：`MemberState → Dead` + 清 `terminal_id` + 凭证立即作废，
    /// 在飞任务回 `pending`。
    ///
    /// 返回被释放（回到 `pending`）的任务的 [`TaskRef`]（不是裸 id —— `t1` 在别的队也有）。
    ///
    /// # 调用顺序是契约（design §7.1）
    ///
    /// 只允许在**进程已经关掉之后**调（`MemberExecutor::close` 成功之后）。反过来会留一个
    /// 悬空的 `terminal_id`：成员行已 `Dead`，而 terminal 域里那个会话还在跑，谁也不会去收。
    ///
    /// # 为什么不加 `reclaim_count`
    ///
    /// `reclaim_count` 是**失败**判据（`> MAX_RECLAIM_COUNT → blocked`），不是操作计数。
    /// 手动关队不是任务失败 —— 让它替人的决定背锅会让「这个任务反复失败」这个指标失去
    /// 意义。`reclaim_expired` 那条路仍然 +1，两者**不可合并**。
    ///
    /// # 凭证
    ///
    /// `token_hash` 被清空 ⇒ 身份表（从库组装、过滤空 hash）里不再有这个成员 ⇒
    /// 旧 token 下一次请求就是 401。清空与「让门重新组装」是两个动作：后者是端口的
    /// 责任（`CredentialLedger::refresh`），因为只有端点持有身份表与门。
    ///
    /// # 幂等
    ///
    /// 对已 `Dead` 且凭证已空的成员再调一次是**一次空操作**（不重复写行、不重复审计）。
    /// 这使「整队关闭失败后重试」不会在审计里制造噪音。
    ///
    /// # 队长
    ///
    /// 队长成员**不允许**走这条（关队长 = 关队）：返回 `InvalidInput` 并指向整队关闭。
    pub fn finish_member_close(&self, member_id: &str, now: i64) -> Result<Vec<TaskRef>, AppError> {
        let mut inner = self.lock_writing();
        let member = inner
            .members
            .get(member_id)
            .cloned()
            .ok_or_else(|| not_found(format!("member {member_id}")))?;
        if member.role == MemberRole::Lead {
            return Err(invalid(format!(
                "member `{member_id}` is the lead of team `{}`; closing the lead is closing the \
                 team — call `team_close` without `member_id` (that path archives the lead too)",
                member.team_id
            )));
        }
        let actor = lead_of(&inner, &member.team_id);
        self.archive_member(&mut inner, member_id, &actor, "member_close", now)
    }

    /// 整队进入关闭中：`Active → Closing`，返回**需要关进程**的成员 id（worker 全部）。
    ///
    /// # 为什么返回全部 worker（含已 `Dead` 的）
    ///
    /// `Dead` 只说明「上一次判定它死了」，不说明它的 `terminal_id` 指向的会话真的不在了
    /// —— 那是 terminal 域的事实，本域看不到。把它们一并交出去（`close` 是幂等的）
    /// 就得到一条**安全的重复路径**：整队关闭可以反复调，每次都把「没有进程」这个事实
    /// 重新确认一遍。
    ///
    /// 队长**不在**返回列表里：它的进程就是发起这次调用的那个会话，从内部关掉它等于在
    /// 应答途中杀掉调用方。队长行由 [`Self::finish_team_close`] 随团队一起归档。
    ///
    /// # 幂等
    ///
    /// 已 `Closed` 的团队返回空列表（没有进程可关，也不重复写 `closed_at`）；
    /// 已在 `Closing` 的团队返回同样的目标集，且**不重复写审计**。
    pub fn begin_team_close(&self, team_id: &str, now: i64) -> Result<Vec<String>, AppError> {
        let mut inner = self.lock_writing();
        let mut team = inner
            .teams
            .get(team_id)
            .cloned()
            .ok_or_else(|| not_found(format!("team {team_id}")))?;
        if team.state == TeamState::Closed {
            return Ok(Vec::new());
        }

        let mut targets: Vec<String> = inner
            .members
            .values()
            .filter(|member| member.team_id == team_id && member.role == MemberRole::Worker)
            .map(|member| member.id.clone())
            .collect();
        targets.sort();

        if team.state == TeamState::Active {
            team.state = TeamState::Closing;
            self.store.upsert_team(&team)?;
            inner.teams.insert(team.id.clone(), team.clone());
            let actor = lead_of(&inner, team_id);
            self.audit(
                &mut inner,
                team_id,
                &actor,
                EVENT_CLOSE_BEGIN,
                Some(team_id.to_owned()),
                Some(format!(
                    "active → closing targets=[{}] at={now}",
                    targets.join(",")
                )),
            )?;
        }
        Ok(targets)
    }

    /// 所有成员都关完之后落终态：`Closing → Closed` + `closed_at`，队长行一并归档。
    ///
    /// # 拒绝条件
    ///
    /// - 团队还 `Active` ⇒ `Conflict`（跳过 `begin_team_close` 会让「先关进程、再落终态」
    ///   这个顺序失去保障 —— 那正是会留下悬空 `terminal_id` 的路径）；
    /// - 还有 worker 不是 `Dead` ⇒ `Conflict` 并点名它们（否则会出现「团队已关闭、成员还活着」）。
    ///
    /// # 幂等
    ///
    /// 已 `Closed` ⇒ `Ok(())`，**不重写** `closed_at`（第一次关闭的时间是事实）。
    pub fn finish_team_close(&self, team_id: &str, now: i64) -> Result<(), AppError> {
        let mut inner = self.lock_writing();
        let mut team = inner
            .teams
            .get(team_id)
            .cloned()
            .ok_or_else(|| not_found(format!("team {team_id}")))?;
        match team.state {
            TeamState::Closed => return Ok(()),
            TeamState::Active => {
                return Err(conflict(format!(
                    "team `{team_id}` is active; it must enter `closing` before it can be sealed \
                     (call `team_close` — that path closes members first)"
                )))
            }
            TeamState::Closing => {}
        }

        let mut open: Vec<String> = inner
            .members
            .values()
            .filter(|member| {
                member.team_id == team_id
                    && member.role == MemberRole::Worker
                    && member.state != MemberState::Dead
            })
            .map(|member| member.id.clone())
            .collect();
        open.sort();
        if !open.is_empty() {
            return Err(conflict(format!(
                "team `{team_id}` still has members that are not closed: {}; it stays in \
                 `closing` until they are",
                open.join(", ")
            )));
        }

        let actor = lead_of(&inner, team_id);
        // 队长随团队归档：它的进程是**发起方**（关它等于在应答途中杀掉调用方），
        // 所以这里只做状态迁移与凭证作废 —— 进程的收尾归 app 的关闭协议 / 面板。
        let leads: Vec<String> = inner
            .members
            .values()
            .filter(|member| member.team_id == team_id && member.role == MemberRole::Lead)
            .map(|member| member.id.clone())
            .collect();
        for lead in leads {
            self.archive_member(&mut inner, &lead, &actor, "team_close", now)?;
        }

        team.state = TeamState::Closed;
        team.closed_at = Some(now);
        self.store.upsert_team(&team)?;
        inner.teams.insert(team.id.clone(), team.clone());
        self.audit(
            &mut inner,
            team_id,
            &actor,
            EVENT_CLOSE_TEAM,
            Some(team_id.to_owned()),
            Some(format!("closing → closed closed_at={now}")),
        )?;
        Ok(())
    }

    /// **永久删除**一个已关闭的团队（面板的「删除」入口）。
    ///
    /// # 为什么只允许 `closed`
    ///
    /// 删除是**不可逆**的：行没了，成员、任务、审计一起没了，`team_list` 再也看不到它。
    /// 而 `active` / `closing` 的队背后是**还在跑的进程**（`closing` 正是「还有成员关不掉」）
    /// —— 把那种队删掉，就是把「它还在跑」这件事从唯一能看见它的界面上抹掉，换成一个
    /// 更糟的结果：库里没有它了，可成员进程还活着，还能用旧 token 调工具（`principals_from`
    /// 从**库**组装身份表，行没了表就空了，门会把它们**全部**拒掉 —— 那不是一个可以撤销的
    /// 状态）。
    ///
    /// 所以判据只有一条，且与 `team_close` 同向：**先关闭，再删除**。拒绝信息要指出下一步
    /// （「先关闭」），而不是只说「不行」。
    ///
    /// # 幂等性
    ///
    /// 不幂等：已不存在 ⇒ `NotFound`。理由同上 —— 「删一个本来就没有的东西」和「它还在」
    /// 是两件不同的事实，合成 `Ok` 会让面板在竞态下（另一窗口已经删了）报一个假成功。
    ///
    /// # 锁与库的次序
    ///
    /// 库写成功才动内存镜像（与 `insert_team` / `archive_member` 同一纪律）：反过来的话，
    /// 库写失败时镜像里已经没有那一行，而库里还在 —— 那是第二个真相源。
    ///
    /// # 镜像清的理由是「无主键不可留」，不是「读不到了」
    ///
    /// 四个内存容器都以**队内 id**（`{name}@{team}` / `TaskRef`）为键，所以只清三个就会
    /// 留下不变量里没有的第四个（`verification`）：它当前不可达（读入口都先查 `members`），
    /// 但它是只增不减的。而 `Inner` 的契约是「与库在同一把锁内一起改」—— 留下无法回收的
    /// 残留键就是那条约定的反例，且下一个人加字段时会照着这个不完整的形状再漏一次。
    pub fn delete_team(&self, team_id: &str) -> Result<(), AppError> {
        let mut inner = self.lock_writing();
        let team = inner
            .teams
            .get(team_id)
            .ok_or_else(|| not_found(format!("team {team_id}")))?;
        if team.state != TeamState::Closed {
            // 状态用 `{:?}`：本文件里「把枚举写进错误句」一律是这个口径（`task {key} is {:?}`）。
            // 另起一个 enum→文本投影就等于造第二份口径，而它只在「恰好这一句」上生效。
            let state = team.state;
            return Err(conflict(format!(
                "team `{team_id}` is {state:?} and still owns member processes; close it before \
                 deleting — removing the row while members are running hides those processes from \
                 the only surface that can still show them"
            )));
        }
        self.store.delete_team(team_id)?;
        // 级联在库里完成；镜像必须跟着同一步走，否则下一帧 `teams()` 还看得见一行
        // 库里已经没有的队（那正是 `team_list` 的数据源）。
        //
        // 四个容器各清一次，用同一形状写出来才看得出「漏了哪个」：键的类型不同
        // （`String` / `TaskRef`），判据是同一个（「行属于这个队」）。`verification` 的
        // 键是成员 id（没有 `team_id` 列），所以先把该队的成员 id 收下来。
        let member_ids: Vec<String> = inner
            .members
            .values()
            .filter(|member| member.team_id == team_id)
            .map(|member| member.id.clone())
            .collect();
        inner.teams.remove(team_id);
        inner.members.retain(|_, member| member.team_id != team_id);
        inner.tasks.retain(|key, _| key.team_id != team_id);
        inner.verification.retain(|id, _| !member_ids.contains(id));
        Ok(())
    }

    /// 归档一名成员（**调用方已持锁**）：`Dead` + 清 `terminal_id` + 凭证作废 + 在飞任务回
    /// `pending`。
    ///
    /// 单成员关闭与整队关闭共用一个实现：两处各写一遍的话，「凭证到底清没清」这类问题的
    /// 答案会随入口而变（而它的症状只在成员用旧 token 调工具时才出现）。
    fn archive_member(
        &self,
        inner: &mut Inner,
        member_id: &str,
        actor: &str,
        reason: &str,
        now: i64,
    ) -> Result<Vec<TaskRef>, AppError> {
        let mut member = inner
            .members
            .get(member_id)
            .cloned()
            .ok_or_else(|| not_found(format!("member {member_id}")))?;
        let already_dead = member.state == MemberState::Dead;
        let had_credential = !member.token_hash.is_empty();
        let had_terminal = member.terminal_id.is_some();
        let terminal = member
            .terminal_id
            .clone()
            .unwrap_or_else(|| "<none>".to_owned());

        let released = self.release_in_flight_tasks(inner, member_id, actor, now)?;

        member.state = MemberState::Dead;
        // 凭证作废：`principals_from` 过滤空 hash ⇒ 旧 token 再也进不了门。
        // 端点要**重新组装**身份表才会看到这件事（`CredentialLedger::refresh`）。
        member.token_hash = String::new();
        // 进程句柄一并清掉：`terminal_id` 是「点开它的唯一凭据」（`view::MemberStatusView`），
        // 前端唯一的判据是 `terminalId == null` ⇒ 已关闭。留着它等于给一个已归档的成员
        // 一个「打开终端」的死按钮，点了只会得到终端的可读错误。
        //
        // 与另外两列在**同一把锁的同一次写**里落地：三件事共同定义「这个成员不存在了」，
        // 分成两次写就会有一个「已 Dead 但还能点开」的窗口。
        member.terminal_id = None;
        if !already_dead || had_credential || had_terminal {
            self.store.upsert_member(&member)?;
            inner.members.insert(member.id.clone(), member.clone());
        }

        if !already_dead || had_credential || had_terminal || !released.is_empty() {
            self.audit(
                inner,
                &member.team_id,
                actor,
                EVENT_CLOSE_MEMBER,
                Some(member.id.clone()),
                Some(format!(
                    "{reason} terminal={terminal} released=[{}] at={now}",
                    released
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join(",")
                )),
            )?;
        }
        Ok(released)
    }

    /// 把成员的**在飞任务**放回 `pending`（**调用方已持锁**）。
    ///
    /// `reclaim_count` **不变**：见 [`Self::finish_member_close`] 的「为什么不加」那一节。
    /// 每个被释放的任务各记一条审计（`subject = task_id`）—— 「t3 为什么回到 pending」
    /// 必须能按任务 id 查到，只写在成员行上就查不到。
    ///
    /// 审计行的 `subject` 只放队内 id 是安全的：同一行的 `team_id` 列就是另一半键，
    /// 所以「id 必须与 team_id 一起出现」在这张表上是**行级**满足的（不需要拼成 `tm/x`）。
    fn release_in_flight_tasks(
        &self,
        inner: &mut Inner,
        member_id: &str,
        actor: &str,
        now: i64,
    ) -> Result<Vec<TaskRef>, AppError> {
        let mut owned: Vec<TeamTask> = inner
            .tasks
            .values()
            .filter(|task| task.owner.as_deref() == Some(member_id) && is_active(task.state))
            .cloned()
            .collect();
        owned.sort_by(|a, b| a.id.cmp(&b.id));

        let mut released = Vec::with_capacity(owned.len());
        for mut task in owned {
            let previous = format!("{:?}", task.state);
            task.state = TeamTaskState::Pending;
            task.owner = None;
            task.claimed_at = None;
            self.store.upsert_task(&task)?;
            inner.tasks.insert(task.key(), task.clone());
            self.audit(
                inner,
                &task.team_id,
                actor,
                EVENT_CLOSE_MEMBER,
                Some(task.id.clone()),
                Some(format!(
                    "{previous} → pending (owner {member_id} closed) at={now}"
                )),
            )?;
            released.push(task.key());
        }
        Ok(released)
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

/// 团队的队长 id（审计的 `actor`）。
///
/// 只有队长能触发关闭（授权矩阵），所以「谁关的」在关闭路径上恒等于队长；队长行缺失时
/// 退化为 `system`（数据缺陷，不 panic —— 审计失败不该让一次关闭卡住）。
fn lead_of(inner: &Inner, team_id: &str) -> String {
    inner
        .members
        .values()
        .find(|member| member.team_id == team_id && member.role == MemberRole::Lead)
        .map_or_else(|| "system".to_owned(), |member| member.id.clone())
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
                        .claim_task(&TaskRef::new(TEAM, "t1"), member_id, 1_000)
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
        let persisted = manager.task(&TaskRef::new(TEAM, "t1")).unwrap();
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
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();
        assert!(manager.epoch() > after_create, "认领也是写路径");
    }

    /// 失效脉冲：**一次写 → 恰好一次脉冲**，且 `rev` 严格递增。
    ///
    /// 「恰好一次」与「递增」是两个独立的失败模式：
    /// - 少了 → 前端面板停在旧快照上（用户看到的是没有变化的旧数据，比崩溃更难发现）；
    /// - 多了 → 每次写都白拉一次全量快照（脉冲退化成轮询）；
    /// - 不递增 → 去重逻辑把新变化当旧事件丢掉。
    ///
    /// 这条测试保护的是**守卫挂钩的结构事实**（`WriteGuard::drop`）：任何写路径都发脉冲，
    /// 包括 `?` 早退的失败路径。
    #[test]
    fn a_write_emits_exactly_one_pulse_with_a_strictly_increasing_revision() {
        use crate::agent::team::fixtures::RecordingNotifier;

        let manager = seeded();
        let recorder = Arc::new(RecordingNotifier::new());
        manager.set_notifier(recorder.clone());
        assert!(recorder.pulses().is_empty(), "设置端口本身不是写路径");

        manager.create_task(task("t1")).unwrap();
        assert_eq!(recorder.pulses().len(), 1, "一次写恰好一次脉冲");
        let after_create = manager.epoch();
        assert_eq!(recorder.pulses()[0], after_create, "rev = 写之后的代数");

        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();
        assert_eq!(recorder.pulses().len(), 2, "认领也是一次写");
        assert!(
            recorder.pulses()[1] > recorder.pulses()[0],
            "rev 必须严格递增（否则前端去重会把新变化当旧事件丢掉）: {:?}",
            recorder.pulses()
        );
        assert_eq!(recorder.pulses()[1], manager.epoch());
    }

    /// 读路径**零脉冲**：`team_snapshot` / `team_status` 会被前端反复调用，任何一次多余的
    /// 脉冲都会立刻引发下一轮全量拉取 —— 自我维持的拉取风暴。
    #[test]
    fn read_paths_emit_no_pulses_and_leave_the_revision_alone() {
        use crate::agent::team::fixtures::RecordingNotifier;

        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        let recorder = Arc::new(RecordingNotifier::new());
        manager.set_notifier(recorder.clone());
        let before = manager.epoch();

        assert_eq!(manager.team(TEAM).unwrap().id, TEAM);
        let _ = manager.tasks(TEAM);
        let _ = manager.task(&TaskRef::new(TEAM, "t1"));
        let _ = manager.member(W1);
        let _ = manager.member_with_verification(W1);
        let _ = manager.verification(W1);

        assert!(recorder.pulses().is_empty(), "读路径不得发脉冲");
        assert_eq!(manager.epoch(), before, "读路径不得改动代数");
    }

    /// 未设置端口时写路径照常工作（静默不发）：启动期 hydrate 与无前端的测试态都走这条路。
    ///
    /// 反向断言同样重要：**设置端口之后**同一条写路径必须开始发脉冲 —— 否则「晚绑定」
    /// 会退化成「永不绑定」（`RwLock<Option<..>>` 写进去了却没人读）。
    #[test]
    fn writes_without_a_notifier_are_silent_and_never_panic() {
        use crate::agent::team::fixtures::RecordingNotifier;

        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        let recorder = Arc::new(RecordingNotifier::new());
        manager.set_notifier(recorder.clone());
        manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::InProgress,
                None,
                2_000,
            )
            .unwrap();
        assert_eq!(recorder.pulses().len(), 1, "晚绑定必须立刻生效");
    }

    /// 不变量 1：顺序第二次认领必须被拒（任务已有 owner）。
    #[test]
    fn second_sequential_claim_is_rejected() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        let err = manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W2, 1_001)
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(
            manager
                .task(&TaskRef::new(TEAM, "t1"))
                .unwrap()
                .owner
                .as_deref(),
            Some(W1)
        );
    }

    /// 不变量 3：依赖未 `done` 时不可认领。
    #[test]
    fn claim_rejected_when_dependency_is_not_done() {
        let manager = seeded();
        let mut blocked = task("t2");
        blocked.depends_on = vec!["t1".into()];
        manager.create_task(task("t1")).unwrap();
        manager.create_task(blocked).unwrap();

        let err = manager
            .claim_task(&TaskRef::new(TEAM, "t2"), W1, 1_000)
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t2")).unwrap().state,
            TeamTaskState::Pending
        );
    }

    /// 不变量 3（正例）：依赖 `done` 之后可以认领。
    #[test]
    fn claim_allowed_once_dependency_is_done() {
        let manager = seeded();
        let mut blocked = task("t2");
        blocked.depends_on = vec!["t1".into()];
        manager.create_task(task("t1")).unwrap();
        manager.create_task(blocked).unwrap();

        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();
        manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::Done,
                None,
                1_100,
            )
            .unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t2"), W2, 1_200)
            .unwrap();

        assert_eq!(
            manager
                .task(&TaskRef::new(TEAM, "t2"))
                .unwrap()
                .owner
                .as_deref(),
            Some(W2)
        );
    }

    /// 不变量 3：依赖指向不存在的任务时必须拒绝，而不是「当作已完成」。
    #[test]
    fn claim_rejected_when_dependency_is_missing() {
        let manager = seeded();
        let mut blocked = task("t2");
        blocked.depends_on = vec!["nope".into()];
        manager.create_task(blocked).unwrap();

        let err = manager
            .claim_task(&TaskRef::new(TEAM, "t2"), W1, 1_000)
            .unwrap_err();
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

        let err = manager
            .claim_task(&TaskRef::new(TEAM, "t1"), "w9@tm_2", 1_000)
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
    }

    /// 不变量 2：`done` 只能由 owner 触达 —— 别人（哪怕同队的另一个成员）不行。
    #[test]
    fn done_is_reachable_only_by_the_owner() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        let err = manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W2,
                TeamTaskState::Done,
                None,
                1_100,
            )
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_ne!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Done
        );

        manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::Done,
                Some("ok"),
                1_200,
            )
            .unwrap();
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Done
        );
    }

    /// 不变量 2：队长 `force_done` 是**唯一**的越权路径，且必须留审计。
    #[test]
    fn force_done_by_lead_records_an_audit_row() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        let done = manager
            .force_done(&TaskRef::new(TEAM, "t1"), LEAD, "stuck", 1_100)
            .unwrap();
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
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        let err = manager
            .force_done(&TaskRef::new(TEAM, "t1"), W2, "mine now", 1_100)
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Claimed
        );
    }

    /// `done` / `failed` / `blocked` 是吸收态：不能被重新打开（否则「完成」可被撤销）。
    #[test]
    fn terminal_tasks_cannot_be_reopened() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();
        manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::Done,
                None,
                1_100,
            )
            .unwrap();

        let err = manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::InProgress,
                None,
                1_200,
            )
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Done
        );
    }

    /// 不变量 5：`state != pending` 后 `workspace` 不可变（改指向会让产物落在错的地方）。
    #[test]
    fn workspace_is_immutable_once_claimed() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        let err = manager
            .set_task_workspace(
                &TaskRef::new(TEAM, "t1"),
                Workspace::Worktree {
                    path: root().join("wt"),
                },
                W1,
            )
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().workspace,
            Workspace::Shared
        );
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
            .set_task_workspace(&TaskRef::new(TEAM, "t1"), target.clone(), LEAD)
            .unwrap();
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().workspace,
            target
        );
    }

    /// 不变量 4：回收 3 次之后第 4 次过期必须冻结成 `blocked`，
    /// 且**不再**被任何后续回收触碰（防无限重试）。
    #[test]
    fn reclaim_over_limit_blocks_the_task_for_good() {
        let manager = seeded();
        let mut t = task("t1");
        t.reclaim_count = 3;
        manager.create_task(t).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        let reclaimed = manager.reclaim_expired(1_000 + 1_800_000).unwrap();
        assert_eq!(reclaimed, vec![TaskRef::new(TEAM, "t1")]);

        let frozen = manager.task(&TaskRef::new(TEAM, "t1")).unwrap();
        assert_eq!(frozen.state, TeamTaskState::Blocked);
        assert_eq!(frozen.owner, None);
        assert_eq!(frozen.reclaim_count, 4);

        // 再等一万年也不回收（不是 active 态）。
        assert!(manager
            .reclaim_expired(1_000 + 10_000_000_000)
            .unwrap()
            .is_empty());
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Blocked
        );
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
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        // 未到期：什么都不发生。
        assert!(manager
            .reclaim_expired(1_000 + 1_799_999)
            .unwrap()
            .is_empty());
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Claimed
        );

        let reclaimed = manager.reclaim_expired(1_000 + 1_800_000).unwrap();
        assert_eq!(reclaimed, vec![TaskRef::new(TEAM, "t1")]);

        let task = manager.task(&TaskRef::new(TEAM, "t1")).unwrap();
        assert_eq!(task.state, TeamTaskState::Pending);
        assert_eq!(task.owner, None);
        assert_eq!(task.claimed_at, None);
        assert_eq!(task.reclaim_count, 1);
        assert_eq!(manager.member(W1).unwrap().state, MemberState::Stalled);

        // 回收后任务可被重新认领（依赖链不会永久堵死）。
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W2, 1_000 + 1_800_001)
            .unwrap();
    }

    /// AC2：`turn_completed` 后成员落 `Idle` + `Unverified`，**任务仍在进行中**。
    #[test]
    fn turn_completed_leaves_the_task_in_progress_and_the_member_unverified() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();
        manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::InProgress,
                None,
                1_050,
            )
            .unwrap();

        let state = manager
            .observe_signal(W1, MemberSignal::TurnCompleted, 1_100)
            .unwrap();
        assert_eq!(state, MemberState::Idle);
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::InProgress
        );
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
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();
        manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::Done,
                None,
                1_100,
            )
            .unwrap();
        assert_eq!(manager.verification(W1), Some(DoneVerification::Verified));

        manager
            .observe_signal(W1, MemberSignal::TurnCompleted, 1_200)
            .unwrap();
        assert_eq!(manager.verification(W1), Some(DoneVerification::Verified));
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Done
        );
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

        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();
        manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::Done,
                None,
                1_100,
            )
            .unwrap();
        assert_eq!(manager.verification(W1), Some(DoneVerification::Verified));

        manager
            .claim_task(&TaskRef::new(TEAM, "t2"), W1, 1_200)
            .unwrap();
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
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        manager
            .observe_signal(W1, MemberSignal::ApprovalRequested, 1_100)
            .unwrap();
        assert_eq!(manager.member(W1).unwrap().state, MemberState::Awaiting);
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::AwaitingApproval
        );
    }

    /// 杀进程（`Exited`）→ 成员 `Dead`，任务仍 `InProgress` 等租约回收
    /// （`advance` 不替成员判死任务，design §2.1）。
    #[test]
    fn exited_marks_member_dead_and_leaves_reclaim_to_the_lease() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        manager
            .observe_signal(W1, MemberSignal::Exited, 1_100)
            .unwrap();
        assert_eq!(manager.member(W1).unwrap().state, MemberState::Dead);
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Claimed
        );

        manager.reclaim_expired(1_000 + 1_800_000).unwrap();
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Pending
        );
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
            manager
                .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
                .unwrap();
            manager
                .update_task(
                    &TaskRef::new(TEAM, "t1"),
                    W1,
                    TeamTaskState::Done,
                    Some("done"),
                    1_100,
                )
                .unwrap();
        }

        let reloaded = TeamManager::load(TeamStore::open(&db).unwrap()).unwrap();
        assert_eq!(
            reloaded.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Done
        );
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
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().claimed_at,
            Some(1_000)
        );

        // 1_700s 后报进度：起租时间前移。
        manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::InProgress,
                Some("half"),
                1_000 + 1_700_000,
            )
            .unwrap();
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().claimed_at,
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
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        manager
            .observe_signal(W1, MemberSignal::TurnCompleted, 1_000 + 1_700_000)
            .unwrap();
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().claimed_at,
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
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        manager
            .observe_signal(W1, MemberSignal::Exited, 1_000 + 1_700_000)
            .unwrap();
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().claimed_at,
            Some(1_000),
            "死亡信号不是活性证据"
        );
        assert_eq!(
            manager.reclaim_expired(1_000 + 1_800_000 + 1).unwrap(),
            vec![TaskRef::new(TEAM, "t1")]
        );
    }

    /// 没有活动的任务**仍然会**过期 —— 续期不能把 AC3 一起续掉。
    #[test]
    fn a_silent_task_still_expires() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        assert_eq!(
            manager.reclaim_expired(1_000 + 1_800_000 + 1).unwrap(),
            vec![TaskRef::new(TEAM, "t1")]
        );
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Pending
        );
    }

    // ───────────────────────────────────────────────────────────────
    // 关闭（两相位的「归档」那一半，design §7.1）
    // ───────────────────────────────────────────────────────────────

    /// 单成员归档：`Dead` + 凭证作废 + 在飞任务回 `pending`，且 `reclaim_count` **不变**。
    ///
    /// 变异验证：把 `reclaim_count + 1` 加回来时本用例变红 —— 手动关队不是任务失败，
    /// 让它背锅会让「反复失败」这个指标失去意义（四轮之后任务会被冻结成 `blocked`）。
    #[test]
    fn finish_member_close_archives_and_releases_without_touching_reclaim_count() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();
        manager.create_task(task("t2")).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t2"), W2, 1_000)
            .unwrap();

        let released = manager.finish_member_close(W1, 5_000).unwrap();
        assert_eq!(released, vec![TaskRef::new(TEAM, "t1")]);

        let member = manager.member(W1).unwrap();
        assert_eq!(member.state, MemberState::Dead);
        assert!(member.token_hash.is_empty(), "凭证必须立即作废");

        let task = manager.task(&TaskRef::new(TEAM, "t1")).unwrap();
        assert_eq!(task.state, TeamTaskState::Pending);
        assert_eq!(task.owner, None);
        assert_eq!(task.claimed_at, None);
        assert_eq!(task.reclaim_count, 0, "手动关队不是失败");

        // 别人的任务不受影响（释放是 per-member 的）。
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t2")).unwrap().state,
            TeamTaskState::Claimed
        );
        assert_eq!(
            manager.member(W2).unwrap().state,
            MemberState::Spawned,
            "关一个成员不得波及其它人"
        );
    }

    /// **一条断言钉住三个事实**：归档之后 `state == Dead`、`terminal_id` 为空、`token_hash` 为空。
    ///
    /// # 为什么三条必须在同一个用例里
    ///
    /// 它们共同定义「这个成员不存在了」，而且**任缺一条都会让面板撒谎**：
    ///
    /// | 缺哪条 | 症状 |
    /// | --- | --- |
    /// | `state` | 花名册上还显示"在跑" |
    /// | `terminal_id` | 已关闭的成员仍给一个「打开终端」按钮（`view` 的唯一判据是 `terminalId == null`）|
    /// | `token_hash` | 旧 token 还能调工具（直到门重建）|
    ///
    /// 变异验证：从 `archive_member` 里删掉 `member.terminal_id = None;` 时**只有**这里会红
    /// —— 其它关闭用例只看状态与凭证，终端列漏清是静默的。
    #[test]
    fn a_closed_member_has_no_terminal_and_no_credential() {
        let manager = seeded();
        // 反证：归档之前三项都不是终态（否则「已清空」不成判据）。
        let before = manager.member(W1).unwrap();
        assert!(before.terminal_id.is_some(), "夹具必须带一个进程句柄");
        assert!(!before.token_hash.is_empty(), "夹具必须带一个已签发的凭证");
        assert_ne!(before.state, MemberState::Dead);

        manager.finish_member_close(W1, 5_000).unwrap();

        let member = manager.member(W1).unwrap();
        assert_eq!(member.state, MemberState::Dead);
        assert!(
            member.terminal_id.is_none(),
            "归档必须清掉 terminal_id —— 否则面板给一个已关闭成员一个「打开终端」的死按钮"
        );
        assert!(member.token_hash.is_empty(), "凭证必须立即作废");
    }

    /// 整队关闭时队长的三列也要一起落地（队长行由 `finish_team_close` 归档）。
    #[test]
    fn sealing_a_team_also_clears_the_leads_terminal_and_credential() {
        let manager = seeded();
        manager
            .begin_team_close(TEAM, crate::agent::team::manager::now_millis())
            .unwrap();
        for id in [W1, W2] {
            manager.finish_member_close(id, 5_000).unwrap();
        }
        manager.finish_team_close(TEAM, 6_000).unwrap();

        let lead = manager.member(LEAD).unwrap();
        assert_eq!(lead.state, MemberState::Dead);
        assert!(lead.terminal_id.is_none(), "队长进程句柄同样要清");
        assert!(lead.token_hash.is_empty(), "队长的凭证同样要作废");
    }

    /// 记一次关闭请求**是一次写路径**：恰好一次脉冲。
    ///
    /// 反例（本用例挡的正是它）：用 `inner.lock()` 写审计 —— 库变了、面板却收不到任何信号，
    /// 抽屉里的事件流停在旧列表上（「我点了关闭，什么都没发生」）。而这类遗漏在所有行为
    /// 断言里都是静默的：审计行确实写进去了。
    #[test]
    fn recording_a_close_request_emits_exactly_one_pulse() {
        use crate::agent::team::fixtures::RecordingNotifier;

        let manager = seeded();
        let recorder = Arc::new(RecordingNotifier::new());
        manager.set_notifier(recorder.clone());
        let before = manager.epoch();

        manager
            .record_close_request(TEAM, Some(W1), true, 5_000)
            .unwrap();

        assert_eq!(recorder.pulses().len(), 1, "写路径恰好一次脉冲");
        assert!(manager.epoch() > before, "代数必须被推过");
        assert_eq!(recorder.pulses()[0], manager.epoch());
    }

    /// 三个计数与板上的行一致，且**不改**代数（读路径）。
    #[test]
    fn task_counts_reports_total_open_and_done() {
        let manager = seeded();
        for id in ["t1", "t2", "t3", "t4"] {
            manager.create_task(task(id)).unwrap();
        }
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();
        manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::Done,
                None,
                2_000,
            )
            .unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t2"), W1, 1_000)
            .unwrap();
        manager
            .update_task(
                &TaskRef::new(TEAM, "t2"),
                W1,
                TeamTaskState::Failed,
                None,
                2_000,
            )
            .unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t3"), W2, 1_000)
            .unwrap();

        let before = manager.epoch();
        let counts = manager.task_counts(TEAM);
        assert_eq!(
            counts,
            TaskCounts {
                total: 4,
                open: 2,
                done: 1
            }
        );
        assert_eq!(manager.epoch(), before, "读路径不得改代数");
        // 另一个队互不影响（键是 `TaskRef`，不是裸 id）。
        assert_eq!(manager.task_counts("tm_other"), TaskCounts::default());
    }

    /// 队长不能走「单成员关闭」：关队长 = 关队。
    #[test]
    fn the_lead_cannot_be_closed_as_a_member() {
        let manager = seeded();
        let err = manager.finish_member_close(LEAD, 5_000).unwrap_err();
        let AppError::InvalidInput(message) = err else {
            panic!("关队长必须是 InvalidInput，实际 {err:?}");
        };
        assert!(message.contains(LEAD), "{message}");
        assert!(message.contains("without `member_id`"), "{message}");
        assert_eq!(manager.member(LEAD).unwrap().state, MemberState::Spawned);
    }

    /// 幂等：对已归档的成员再关一次是**空操作**（不报错、不重复审计）。
    ///
    /// 这条是整队关闭可重试的前提：重试会把同样的目标集再走一遍。
    #[test]
    fn finishing_a_member_close_twice_is_a_no_op() {
        let manager = seeded();
        assert!(manager.finish_member_close(W1, 5_000).unwrap().is_empty());
        let before = manager.events(TEAM).unwrap().len();

        assert!(
            manager.finish_member_close(W1, 6_000).unwrap().is_empty(),
            "重复关闭不得再释放任务"
        );
        assert_eq!(
            manager.events(TEAM).unwrap().len(),
            before,
            "重复关闭不得重复记审计"
        );
    }

    /// 整队关闭：`active → closing → closed`，`closed_at` 写入，全员 `Dead`。
    #[test]
    fn a_team_close_walks_active_closing_closed() {
        let manager = seeded();
        let targets = manager.begin_team_close(TEAM, 1_000).unwrap();
        assert_eq!(targets, vec![W1.to_owned(), W2.to_owned()]);
        assert_eq!(manager.team(TEAM).unwrap().state, TeamState::Closing);

        for member_id in [W1, W2] {
            manager.finish_member_close(member_id, 1_000).unwrap();
        }
        manager.finish_team_close(TEAM, 2_000).unwrap();

        let team = manager.team(TEAM).unwrap();
        assert_eq!(team.state, TeamState::Closed);
        assert_eq!(team.closed_at, Some(2_000));
        for member_id in [LEAD, W1, W2] {
            let member = manager.member(member_id).unwrap();
            assert_eq!(member.state, MemberState::Dead, "{member_id} 必须归档");
            assert!(member.token_hash.is_empty(), "{member_id} 凭证必须作废");
        }
    }

    /// 幂等：已 `Closed` 的队再关一次 = `Ok`，且 `closed_at` **不被重写**。
    #[test]
    fn closing_a_closed_team_keeps_the_first_closed_at() {
        let manager = seeded();
        manager.begin_team_close(TEAM, 1_000).unwrap();
        for member_id in [W1, W2] {
            manager.finish_member_close(member_id, 1_000).unwrap();
        }
        manager.finish_team_close(TEAM, 2_000).unwrap();

        assert!(
            manager.begin_team_close(TEAM, 9_000).unwrap().is_empty(),
            "已关闭的队没有进程可关"
        );
        manager.finish_team_close(TEAM, 9_000).unwrap();
        assert_eq!(
            manager.team(TEAM).unwrap().closed_at,
            Some(2_000),
            "第一次关闭的时间是事实，不得被重试改写"
        );
    }

    /// 成员还没关完就落终态 → `Conflict` 并点名还活着的成员。
    #[test]
    fn sealing_a_team_with_open_members_is_refused() {
        let manager = seeded();
        manager.begin_team_close(TEAM, 1_000).unwrap();
        manager.finish_member_close(W1, 1_000).unwrap();

        let err = manager.finish_team_close(TEAM, 2_000).unwrap_err();
        let AppError::Conflict(message) = err else {
            panic!("还有成员没关必须 Conflict，实际 {err:?}");
        };
        assert!(message.contains(W2), "必须点名还活着的成员：{message}");
        assert!(!message.contains(W1), "已关掉的成员不该被点名：{message}");
        assert_eq!(manager.team(TEAM).unwrap().state, TeamState::Closing);
        assert_eq!(manager.team(TEAM).unwrap().closed_at, None);
    }

    /// 跳过 `begin_team_close` 直接落终态 → `Conflict`（先关进程、再落终态的顺序）。
    #[test]
    fn sealing_an_active_team_is_refused() {
        let manager = seeded();
        let err = manager.finish_team_close(TEAM, 2_000).unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(manager.team(TEAM).unwrap().state, TeamState::Active);
    }

    /// 已 `Dead` 的 worker **也**在待关列表里：那是「terminal 里可能还挂着一个会话」的
    /// 唯一可重试路径（`close` 幂等，重复确认无害）。
    #[test]
    fn dead_members_are_still_handed_to_the_executor_for_a_retry() {
        let manager = seeded();
        manager
            .observe_signal(W2, MemberSignal::Exited, 1_000)
            .unwrap();

        let targets = manager.begin_team_close(TEAM, 2_000).unwrap();
        assert_eq!(
            targets,
            vec![W1.to_owned(), W2.to_owned()],
            "已 Dead 的成员也要再确认一次（否则那条会话永远没人收）"
        );
    }

    /// 关闭是**写路径**：它会唤醒等待者并给面板发一次脉冲（且恰好一次）。
    #[test]
    fn closing_seals_emit_exactly_one_pulse_per_write() {
        let manager = seeded();
        let notifier = std::sync::Arc::new(crate::agent::team::fixtures::RecordingNotifier::new());
        manager.set_notifier(notifier.clone());

        manager.begin_team_close(TEAM, 1_000).unwrap();
        assert_eq!(notifier.pulses().len(), 1, "一次写恰好一次脉冲");
    }

    /// 删队是**破坏性**写路径：只允许删 `closed`。
    ///
    /// 三条判据（缺一条都会变成「进程还在跑但界面上看不见了」）：
    /// 1. `active` / `closing` 一律 `Conflict`，且错误里点名当前状态与下一步；
    /// 2. `closed` 删得掉，且**镜像与库同步**（`team()` / `member()` / `task()` 全部消失）；
    /// 3. 已不存在 ⇒ `NotFound`（不是静默 `Ok`：面板在竞态下不该报假成功）。
    #[test]
    fn only_a_closed_team_can_be_deleted() {
        let manager = seeded();
        // 板上放一张活任务并让它被认领：认领会往 `verification` 里写一条水位线，
        // 于是「删队有没有把它清掉」才有物可查（不建任务的话那条断言是空转的）。
        manager.create_task(task("t1")).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();
        assert!(
            manager.inner.lock().verification.contains_key(W1),
            "夹具前提：认领后应当有一条取证水位线"
        );

        // ① 还活着（`active`）：拒绝，并指出下一步。
        let err = manager.delete_team(TEAM).expect_err("active 不可删");
        let AppError::Conflict(message) = err else {
            panic!("active 删队必须 Conflict，实际 {err:?}");
        };
        // 状态用本文件既有的 Debug 口径（`Active` / `Closing`），不另造 enum→文本投影。
        assert!(message.contains("Active"), "必须点名当前状态：{message}");
        assert!(
            message.contains("close it before deleting"),
            "必须指出下一步：{message}"
        );
        assert!(manager.team(TEAM).is_some(), "拒绝时不得删任何东西");

        // ② 关到一半（`closing`）：同样拒绝 —— 那正是「还有成员关不掉」的状态。
        manager.begin_team_close(TEAM, 1_000).unwrap();
        let err = manager.delete_team(TEAM).expect_err("closing 不可删");
        let AppError::Conflict(message) = err else {
            panic!("closing 删队必须 Conflict，实际 {err:?}");
        };
        assert!(message.contains("Closing"), "必须点名当前状态：{message}");

        // ③ 关完之后才能删。
        for member_id in [W1, W2] {
            manager.finish_member_close(member_id, 1_000).unwrap();
        }
        manager.finish_team_close(TEAM, 2_000).unwrap();
        manager.delete_team(TEAM).expect("closed 可删");

        // 镜像与库必须同一步：只删库会让 `team_list`（读镜像）继续列出一个不存在的队。
        assert!(manager.team(TEAM).is_none());
        assert!(manager.member(LEAD).is_none(), "成员镜像必须一并清掉");
        assert!(
            manager.task(&TaskRef::new(TEAM, "t1")).is_none(),
            "任务镜像必须一并清掉"
        );
        assert!(
            manager.store().list_teams().expect("teams").is_empty(),
            "库里的行必须一并删掉（成员 / 任务 / 审计走级联）"
        );
        // 第四个内存容器：`verification` 以成员 id 为键，没有 team_id 可过滤。
        // 不清的话它**当前**读不到（四个读入口都先查 `members`），但它是只增不减的，
        // 而 `Inner` 的契约是与库在同一把锁内一起改。
        assert!(
            manager.inner.lock().verification.is_empty(),
            "取证水位线必须随成员一起清掉（否则残留键永不回收）"
        );

        // ④ 已经不存在了 ⇒ `NotFound`（不假装成功）。
        let err = manager.delete_team(TEAM).expect_err("再删一次");
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
    }

    /// 删队是写路径：恰好一次脉冲（面板据此重取清单，行才会真的消失）。
    #[test]
    fn deleting_a_team_emits_exactly_one_pulse() {
        let manager = seeded();
        manager.begin_team_close(TEAM, 1_000).unwrap();
        for member_id in [W1, W2] {
            manager.finish_member_close(member_id, 1_000).unwrap();
        }
        manager.finish_team_close(TEAM, 2_000).unwrap();

        let notifier = std::sync::Arc::new(crate::agent::team::fixtures::RecordingNotifier::new());
        manager.set_notifier(notifier.clone());

        manager.delete_team(TEAM).unwrap();
        assert_eq!(notifier.pulses().len(), 1, "一次删队恰好一次脉冲");

        // 反证：拒绝路径**不改数据**。这里刻意**不断言脉冲数** —— `lock_writing` 的守卫在
        // `?` 早退路径上也会置位 + notify，那是刻意的（漏唤醒不可恢复，多余唤醒只是让等待者
        // 重查一次）；把「拒绝也发脉冲」钉进测试等于把一个可优化掉的实现细节变成契约。
        // 要钉的是「拒绝不改数据」，那是本用例后半段在做的事。
        manager.create_team(team("tm_2")).unwrap();
        assert!(manager.delete_team("tm_2").is_err());
        assert!(manager.team("tm_2").is_some(), "拒绝时不得删任何东西");
        assert_eq!(
            manager.store().list_teams().expect("teams").len(),
            1,
            "库里仍然只有那一个未删除的队"
        );
    }
}
