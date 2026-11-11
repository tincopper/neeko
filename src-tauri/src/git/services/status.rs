//! Workspace（[`WorkspaceRef`]）git status 的**读取与挂载编排**。
//!
//! 命令层（`git/commands/query.rs`）只做参数校验 + 委派（红线 6），本模块承担编排：
//! 快照优先、冷启动有界等待、未挂载单元退化为一次 pull 计算并登记同一张表。
//! 激活是**声明式 reconcile**（C4）：一次调用把挂载集合收敛到可见集合 —— 挂载集合内的单元、
//! 释放集合外的单元（两个动作在同一次调用、同一临界区内完成，不是「挂一个踢一个」）。
//!
//! **单一形态**：无论生产者是 push（挂载中的 watcher worker）还是 pull（本文件的
//! `compute_and_record`），读出来的都是同一个 `GitStatusSnapshot` —— 同一个 `version`
//! 语义、同一个 `workspace_key` 寻址。旧实现里 worktree / WSL / SSH 返回 `version: 0`
//! 让前端「恒放行」，等于开了第二条身份不明的数据通道，任何一次 pull 都能覆盖任何
//! 时刻的 push 快照（= 串数据）。

use std::sync::Arc;
use std::time::Instant;

use serde::Serialize;

use crate::common::executor::factory::ExecTarget;
use crate::common::file::watcher::{DirtyMask, WatcherEventSink, WatcherManager};
use crate::common::git::status_worker::{GitStatusSnapshot, RECALC_WAIT_TIMEOUT};
use crate::common::git::transport::GitTransport;
use crate::common::git::WorkspaceRef;
use crate::common::git::WorkspaceSession;
use crate::common::runtime::run_blocking;
use crate::AppError;
use crate::AppStateWrapper;

/// 写操作成功后请求该单元重算并**有界等待落地**。
///
/// 见 `.trellis/spec/backend/git-domain.md` §10：任何经 IPC 的 git 写命令成功后都必须
/// 戳**被写入的那个单元**，否则读接口拿写前快照当权威数据返回（「操作成功但列表要手动
/// 刷新才更新」的根因）。契约主键本次随身份一起从 project 升为 `WorkspaceRef`。
pub async fn wait_status_fresh(state: &AppStateWrapper, repo: &WorkspaceRef) {
    let manager = state.watcher_manager.clone();
    let poke_manager = manager.clone();
    let poke_repo = repo.clone();
    // Condvar 等待是阻塞原语 → run_blocking 隔离（红线 3）。join 失败仅发生于运行时关停，
    // 超时与否都不影响命令成败：由 `git-status-snapshot` 事件推送最终收敛。
    let poked = run_blocking(move || {
        poke_manager.poke_status_worker_and_wait(&poke_repo, RECALC_WAIT_TIMEOUT)
    })
    .await
    .unwrap_or(false);

    // **写后打脏**（C1）：poke 只对**挂载中**的单元有效（它有 push 生产者）；未挂载单元
    // 没有 worker 可戳，写入后登记表里的那份数据就停留在写前 —— 只靠 `STALE_AFTER` 兜底
    // 会让「刚写完就去看」读到旧值。标记为失效后，读路径立刻重算。
    //
    // 对挂载单元同样安全：worker 的下一轮推送会清掉脏位（`upsert_push`），而在这之间的读
    // 至多多算一轮 —— 那是「写后立刻读」的罕见窗口，用一次 git status 换正确性划算。
    if !poked {
        manager.mark_status_dirty(repo, DirtyMask::all());
    }
}

/// 主仓单元的写后收口：命令**只接受 `project_id`** 时，被写入的单元必然是主仓单元。
///
/// 存在理由不是省两行字，而是让「命令作用域 = 主仓」这件事在收口处显式说出来：这类命令
/// 在 worktree 视图下同样只操作主仓（命令作用域问题，另见任务 PRD「已知缺口」），因此戳
/// 主仓是唯一正确的做法；等命令哪天补上 `worktree_path` 参数，就必须换成 [`wait_status_fresh`]
/// —— 编译器不会提醒，所以把这条写在名字里。
pub async fn wait_main_status_fresh(state: &AppStateWrapper, project_id: &str) {
    match state.resolve_workspace(project_id, None).await {
        Ok((_target, main)) => wait_status_fresh(state, &main).await,
        // 解析失败不影响命令成败：数据最终由 `git-status-snapshot` 推送收敛。
        Err(e) => log::warn!("[GitStatus] cannot resolve main checkout for {project_id}: {e}"),
    }
}

/// 释放某单元的挂载资源（该 worktree 被删除或改名之后必须调用）。
///
/// 挂载（worker + 文件 watcher + git-meta watcher 一套线程/句柄）的存在前提是「该单元的
/// 工作树存在」。目录没了还留着挂载：① 线程与句柄白占（AC11 的资源规模契约）；② 该单元
/// 槽位里最后一份快照继续被当成权威数据渲染（I1-b 明令禁止的「旧数据伪装成事实」）。
///
/// 前端把激活态切走后 `reconcile_mounted` 的差集**也会**释放该单元（离热即释放，C4），但
/// **资源生命周期的归属在后端** —— 不能把不变量寄托在调用方记得改状态上。`unwatch` 用于
/// 「单元真的消失」（worktree 被删 / 项目移除）：它与离热释放同一语义（只拆资源、保留登记
/// 数据），区别只在于触发者。
///
/// **阻塞语义**：drop notify watcher（递归反注册 inotify/FSEvents 句柄）可能短暂阻塞 →
/// 经 `run_blocking` 隔离（红线 3），与挂载侧 `reconcile_mounted` 对称。
pub async fn release_workspace(state: &AppStateWrapper, repo: &WorkspaceRef) {
    let manager = state.watcher_manager.clone();
    let repo = repo.clone();
    let _ = run_blocking(move || manager.unwatch(&repo)).await;
}

/// 读取某Workspace的权威 status。
///
/// **单一语义（C1 起）**：`needs_recompute` 为真（无条目 / 有脏位 / 超陈旧窗口）⇒ 现算一次
/// 并登记；否则直接返回登记表里的快照。**不再按「是否挂载」分支** —— 那是把资源状态当成
/// 数据新鲜度的代理（旧实现的三分支及其注释自白见任务 `11-04-status-freshness-model` 的 PRD），
/// 后果是未挂载单元的 pull 结果永不可信（每次读都现算）而挂载单元在冷窗口里只能报错。
///
/// 并发：同一单元的重算经 [`RecomputeGate`] 单飞 —— 后到者**排队**（不拒绝），拿到许可后
/// 重新判 `needs_recompute`（等到的这一轮可能已把数据算新）。
///
/// 失败语义：**不清空也不覆盖**已有登记，脏位并回去（失败 ≠ 数据新鲜）；错误只留给调用方
/// 需要知道的那一层（解析失败 / 非 git 库 / 命令失败）。
pub async fn read_workspace_status(
    state: &AppStateWrapper,
    repo: &WorkspaceRef,
) -> Result<GitStatusSnapshot, AppError> {
    let manager = state.watcher_manager.clone();

    // 快路径：登记表里已是新鲜数据（无脏位且未过陈旧窗口）
    if !manager.status_needs_recompute(repo) {
        if let Some(snap) = manager.snapshot(repo) {
            return Ok(Arc::unwrap_or_clone(snap));
        }
    }

    // 单飞：同一单元只允许一轮重算在飞
    let gate = manager.recompute_gate();
    let _permit = gate.acquire(&repo.key()).await;

    // 双检：等锁期间别人可能已经把数据算新了
    if !manager.status_needs_recompute(repo) {
        if let Some(snap) = manager.snapshot(repo) {
            return Ok(Arc::unwrap_or_clone(snap));
        }
    }

    let (target, _) = state.resolve_project(repo.project_id())?;
    let mask = manager.begin_status_recompute(repo);
    let computed_from = Instant::now();
    match compute_and_record(state, repo, &target, mask, computed_from).await {
        Ok(snapshot) => Ok(snapshot),
        Err(error) => {
            // 脏位并回去：失败不是「数据已新鲜」的证据，下一读会再试。
            manager.abort_status_recompute(repo, mask);
            Err(error)
        }
    }
}

/// 读取**挂载中**单元的权威快照：冷窗口内有界等待一轮重算落地后重读。
///
/// 有界等待是**延迟优化**（多数情况毫秒级就绪，避免首屏闪加载态），不是正确性判据 ——
/// 等待本身是事件驱动的（`poke` 主动触发一轮重算 + Condvar 谓词命中即返，预算只防死锁）。
/// 返回 `None` = 预算内未就绪，**语义由调用方定义**（读命令视为「暂不可用」，激活命令
/// 视为 [`WorkspaceActivation::Pending`]）—— 本函数不判错：错误空间只留调用方自己的前置
/// 校验，环境延迟不得升级成错误（2026-10 CI 事故的根因）。
async fn read_mounted_snapshot(
    manager: &WatcherManager,
    repo: &WorkspaceRef,
) -> Option<Arc<GitStatusSnapshot>> {
    if let Some(snap) = manager.snapshot(repo) {
        return Some(snap);
    }
    // Condvar 等待是阻塞原语 → 经 run_blocking 隔离（红线 3）
    let waiter = manager.clone();
    let wait_repo = repo.clone();
    let _ =
        run_blocking(move || waiter.poke_status_worker_and_wait(&wait_repo, RECALC_WAIT_TIMEOUT))
            .await;
    manager.snapshot(repo)
}

/// 现算一次并登记（pull 生产者）。
///
/// `mask` 描述本轮要重算的**维度**（见 `DirtyMask`）：`workdir` 未失效时复用旧条目的
/// entries/branch（不跑 porcelain），`refs` 未失效时复用旧 ahead/behind（不跑 rev-list）。
/// 两个维度都未失效（只因陈旧或首次读而重算）且已有条目时，用旧值即可 —— 产物仍是**完整
/// 快照**（`git-domain.md §14` 的单快照/单 version/单通道契约不变），只是不白跑命令。
///
/// `computed_from` = 本轮计算的**开始**时刻，交给登记表做「晚到旧结果不得覆盖更新登记」的
/// 栅栏。若被取代，返回登记表里那份更新的快照（而不是自己的旧结果）。
async fn compute_and_record(
    state: &AppStateWrapper,
    repo: &WorkspaceRef,
    transport: &dyn GitTransport,
    mask: DirtyMask,
    computed_from: Instant,
) -> Result<GitStatusSnapshot, AppError> {
    let manager = state.watcher_manager.clone();
    let previous = manager.snapshot(repo);
    // 两个维度都不需要重算且已有数据 ⇒ 等锁期间别的一轮已经把它算新了：直接复用它。
    // 不设这一条的话，这次「空重算」会白白推进一次 version，让前端做一次无意义的重渲染。
    if mask.is_clean() {
        if let Some(prev) = previous {
            return Ok(Arc::unwrap_or_clone(prev));
        }
    }
    // 没有旧条目时两个维度都必须算（没有可复用的输入）。
    let need_workdir = previous.is_none() || mask.workdir;
    let need_refs = previous.is_none() || mask.refs;

    let mut snapshot = GitStatusSnapshot::for_unit(repo, 0);
    if let Some(prev) = previous.as_deref() {
        snapshot.entries.clone_from(&prev.entries);
        snapshot.truncated = prev.truncated;
        snapshot.branch.clone_from(&prev.branch);
        snapshot.ahead = prev.ahead;
        snapshot.behind = prev.behind;
    }

    if need_workdir {
        let (entries, branch) =
            crate::common::git::operations::status_porcelain(transport, repo.root())
                .await
                .map_err(AppError::from)?;
        snapshot.entries = entries;
        snapshot.branch = branch;
    }

    // ahead/behind 是 status 的第四类输入（refs），与 entries/branch 由**同一个生产者**
    // 在同一份快照里产出（git-domain §12）。无 upstream / detached / 命令失败 → (0,0)，
    // 不是错误（R3.1）—— 不得因此把已有徽标打回 0 之外的东西（它本就是 0）。
    if need_refs {
        (snapshot.ahead, snapshot.behind) =
            match crate::common::git::operations::get_ahead_behind(transport, repo.root()).await {
                Ok(ab) => (ab.ahead, ab.behind),
                Err(e) => {
                    log::debug!(
                        "[GitStatus] ahead/behind unavailable for {}: {e}",
                        repo.root()
                    );
                    (0, 0)
                }
            };
    }

    // 生产者交出的是一份**完整快照**（与 push 生产者同形）：条目上限由
    // `record_pull` 内部的 `enforce_entry_cap` 单点施加（GitStatusSnapshot 拥有该不变量）。
    match manager.record_pull(snapshot, computed_from) {
        Some(snap) => Ok(Arc::unwrap_or_clone(snap)),
        // 本轮结果被更新的登记取代：读接口应当返回那份更新的（它是权威）。
        None => match manager.snapshot(repo) {
            Some(snap) => Ok(Arc::unwrap_or_clone(snap)),
            None => Err(AppError::NotFound(format!(
                "status for workspace {} was superseded and is unavailable",
                repo.key()
            ))),
        },
    }
}

/// 该连接形态能否拥有 push 生产者（worker + 文件 watcher + git-meta watcher 一套）。
///
/// 只有 Local 能：工作树在别的机器上时，本地 notify 监听不到、`git` 子进程也拿不到，
/// 所以 WSL / SSH 单元一律走 pull 生产者（[`compute_and_record`]）。判据写成纯函数，
/// 是因为它是「远端项目的 Changes 面板为什么永远在 Loading」的唯一分叉点。
#[must_use]
pub const fn supports_push_producer(target: &ExecTarget) -> bool {
    matches!(target, ExecTarget::Local)
}

/// 单个单元激活的结局（[`WorkspaceActivationEntry`] 的内部形态）：**「未就绪」是一等状态，
/// 不是错误**。
///
/// 冷启动窗口（挂载已成立、worker 首轮重算尚未落地）在慢环境（CI 冷 FS / Windows
/// Defender）上必然超过任何固定预算 —— 把超时当错误，正确性就依赖环境延迟
/// （2026-10 CI 事故：`activate_*` 在 windows-latest 上超时 panic）。
/// `Pending` 的收敛通道是 `git-status-snapshot` 推送事件 + 读路径（C1 起读永远给得出答案）——
/// 前端**不再**维护重试环（C4：重试环是「挂载可能不收敛」的影子记账，红线 17）。
/// 错误空间只留：单元解析失败、非 git 库、pull 失败。
#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum WorkspaceActivation {
    /// 权威快照已就绪（push 冷窗口内就绪，或 pull 分支现算完成 —— pull 恒 `Ready`）。
    Ready {
        /// 权威快照（与 `git-status-snapshot` 事件同源同版本）。
        snapshot: GitStatusSnapshot,
    },
    /// 挂载已成立，首个快照尚未算出（仅 push 生产者的冷窗口）。
    Pending {
        /// 被激活单元的 key（供调用方核对迟到的 Pending 属于哪次激活）。
        workspace_key: String,
    },
}

/// 可见集合命令的**逐单元**结局（`set_visible_workspaces` 的载荷）——**唯一** wire 形态。
///
/// 与 [`WorkspaceActivation`] **刻意分开**：wire 上把「单元级失败」也表达成数据（`failed`），
/// 因为整批 `Err` 会让一个坏项目拖死全部单元（前端只能整体渲染一次错误）。单元素命令
/// （`set_active_workspace`）已在 C4 删除 —— 前端只发可见集合。
///
/// `workspace_key` 在三态里都带上：调用方按单元匹配结局（`ready` 的 `snapshot` 里也有同一个
/// key，但让「哪个单元」成为**条目**的字段，匹配规则就不依赖载荷形状）。
#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum WorkspaceActivationEntry {
    /// 权威快照已就绪。
    Ready {
        /// 被激活单元的 key（与 `snapshot.workspace_key` 同值，便于按条目匹配）。
        workspace_key: String,
        /// 权威快照（与 `git-status-snapshot` 事件同源同版本）。
        snapshot: GitStatusSnapshot,
    },
    /// 挂载已成立，首个快照尚未算出（冷窗口）。
    Pending {
        /// 被激活单元的 key。
        workspace_key: String,
    },
    /// 该单元**自己**失败（解析失败 / 非 git 库 / pull 出错）—— 不影响同批其它单元。
    Failed {
        /// 失败单元的 key。
        workspace_key: String,
        /// 人类可读的失败原因（整体渲染该单元的未知态 + 诊断）。
        error: String,
    },
}

impl WorkspaceActivationEntry {
    /// `(key, 单元级结局)` → wire 载荷。
    ///
    /// **失败落数据、不落整批 `Err`**：批量入口的契约是「逐单元给结局」，一个坏项目拖死全部
    /// 会让其余单元的 UI 停在未知态。
    #[must_use]
    pub fn of(key: &str, outcome: Result<WorkspaceActivation, AppError>) -> Self {
        match outcome {
            Ok(WorkspaceActivation::Ready { snapshot }) => Self::Ready {
                workspace_key: key.to_string(),
                snapshot,
            },
            Ok(WorkspaceActivation::Pending { workspace_key }) => Self::Pending { workspace_key },
            Err(error) => Self::Failed {
                workspace_key: key.to_string(),
                error: error.to_string(),
            },
        }
    }
}

/// 冷窗口裁决（纯映射，便于直测）：预算内等不到首份快照是**合法结局** —— 挂载已成立、
/// 数据在途（worker 首轮重算），由推送事件与重试环收敛，**绝不进入错误空间**。
fn first_snapshot_outcome(
    snapshot: Option<Arc<GitStatusSnapshot>>,
    workspace_key: &str,
) -> WorkspaceActivation {
    match snapshot {
        Some(snap) => WorkspaceActivation::Ready {
            snapshot: Arc::unwrap_or_clone(snap),
        },
        None => WorkspaceActivation::Pending {
            workspace_key: workspace_key.to_string(),
        },
    }
}

/// 逐单元的落点分类（「解析 + 前置校验」阶段的产物）。
enum UnitPlan {
    /// 本地单元：加入本轮的批量挂载。
    Mount {
        repo: WorkspaceRef,
        target: ExecTarget,
    },
    /// 无 push 生产者的单元（WSL / SSH）：不挂载，直接 pull。
    Pull {
        repo: WorkspaceRef,
        target: ExecTarget,
    },
    /// 单元级失败：不进入任何批量动作，只影响自己这一项。
    Failed { key: String, error: AppError },
}

/// 激活一批**可见**Workspace：把挂载集合收敛到本批集合，逐个单元给结局（声明式 reconcile）。
///
/// 三段式（`11-04-git-status-observability/design.md` §1 的 C4 落地）：
/// 1. **解析 + 校验**：逐单元解析 [`WorkspaceRef`] 与 transport；非 git 库直接记 `Failed`；
/// 2. **批量 reconcile**：本地单元汇总交 [`WatcherManager::reconcile_mounted`] —— 一次临界区、
///    一条日志：挂载集合内的单元（已挂载者不重建），**释放集合外已挂载的单元**（R1.3）。
///    声明集合 `keep` = 本批**解析成功且是 git 库**的全部单元（含远端 `Pull` 单元）—— 远端单元
///    无 push 生产者，从不挂载，也绝不因「不在 `mount_batch` 里」被释放；
/// 3. **逐单元落点**：本地取首快照（冷窗口 ⇒ `pending`），远端 pull 一次（恒 `ready`）。
///
/// **离热释放保留数据**（C1）：释放只拆资源（watcher / worker / 线程），登记表里的快照与
/// `computed_at` / `dirty` 留下 —— 切回该单元时读路径要么直接给旧值，要么因脏/陈旧现算，
/// 不会出现「空转」。
///
/// **单元级隔离**：解析失败 / 非 git 库 / pull 失败只影响**该项**，其余照常 —— 整批失败会让
/// 一个坏项目拖死全部（见 [`WorkspaceActivationEntry`]）。返回顺序与入参一致。
pub async fn activate_many(
    state: &AppStateWrapper,
    sink: Arc<dyn WatcherEventSink>,
    workspaces: &[WorkspaceSession],
) -> Vec<(String, Result<WorkspaceActivation, AppError>)> {
    let mut plan: Vec<UnitPlan> = Vec::with_capacity(workspaces.len());
    let mut mount_batch: Vec<(WorkspaceRef, Arc<dyn WatcherEventSink>)> = Vec::new();
    let mut visible_keys: Vec<String> = Vec::with_capacity(workspaces.len());

    for workspace in workspaces {
        let (target, repo) = match state.resolve_workspace_target(workspace).await {
            Ok(resolved) => resolved,
            // 地址解析失败也是**单元级**失败：key 由地址自身给出（前端算的是同一个 key）。
            Err(error) => {
                plan.push(UnitPlan::Failed {
                    key: workspace.key(),
                    error,
                });
                continue;
            }
        };
        // 仓库存在性由 transport 判定（本地 fs 判定会误杀 WSL / SSH 单元）。
        if !target.is_git_repo(repo.root()).await {
            plan.push(UnitPlan::Failed {
                key: repo.key(),
                error: AppError::NotFound(format!(
                    "workspace {} is not a git repository",
                    repo.key()
                )),
            });
            continue;
        }
        // 可见集合（reconcile 的声明）：解析成功且是 git 库的单元，**含远端** —— 见函数 docstring。
        visible_keys.push(repo.key());
        if supports_push_producer(&target) {
            mount_batch.push((repo.clone(), Arc::clone(&sink)));
            plan.push(UnitPlan::Mount { repo, target });
        } else {
            // 远端单元：在可见集合里（不得被差集误释放），但没有可挂载的资源。
            plan.push(UnitPlan::Pull { repo, target });
        }
    }

    // 声明式 reconcile：挂载集合内的单元 + 释放集合外已挂载的单元，一次临界区、一条日志。
    // notify 的递归注册在 Linux 上会同步遍历整树 ⇒ 必须离开 IPC/async 线程（红线 3）。
    {
        let manager = state.watcher_manager.clone();
        let reconciled =
            run_blocking(move || manager.reconcile_mounted(mount_batch, &visible_keys)).await;
        if let Err(error) = reconciled {
            // reconcile 整体没跑完（运行时关停 / 阻塞池 panic）：下面的 `is_watched` 判据会把这批
            // 单元退化为一次 pull —— 至少给出数据，错误只落在真正算不出来的单元上。
            log::warn!("[GitStatus] batch reconcile task failed: {error}");
        }
    }

    let mut outcomes = Vec::with_capacity(plan.len());
    for unit in plan {
        match unit {
            UnitPlan::Failed { key, error } => outcomes.push((key, Err(error))),
            UnitPlan::Pull { repo, target } => {
                let outcome = pull_outcome(state, &repo, &target).await;
                outcomes.push((repo.key(), outcome));
            }
            UnitPlan::Mount { repo, target } => {
                let outcome = mounted_outcome(state, &repo, &target).await;
                outcomes.push((repo.key(), outcome));
            }
        }
    }
    outcomes
}

/// 落点 A：挂载**已确保**的本地单元 —— 取首个快照，冷窗口 ⇒ [`WorkspaceActivation::Pending`]。
///
/// 挂载未成立（`reconcile_mounted` 内部的 setup 失败已记录告警、没有 push 生产者）⇒ 退化为
/// 一次性 pull：与旧读路径同语义 —— 至少给出数据，槽位有权威值可渲染。
async fn mounted_outcome(
    state: &AppStateWrapper,
    repo: &WorkspaceRef,
    transport: &dyn GitTransport,
) -> Result<WorkspaceActivation, AppError> {
    if !state.watcher_manager.is_watched(repo) {
        return pull_outcome(state, repo, transport).await;
    }
    // 预算内未就绪（冷窗口）⇒ `Pending`：挂载已成立、数据在途，由推送事件与读路径收敛
    // —— 这里**绝不返回 Err**（见 [`WorkspaceActivation`]）。
    Ok(first_snapshot_outcome(
        read_mounted_snapshot(&state.watcher_manager, repo).await,
        &repo.key(),
    ))
}

/// 落点 B：无 push 生产者的单元（WSL / SSH，或本地挂载 setup 失败的退化路径）—— 现算一次。
///
/// 恒 [`WorkspaceActivation::Ready`]：pull 是同步现算，不存在冷窗口（`Pending` 只属于 push
/// 生产者）。**不挂载、不释放**：远端单元的工作树在别的机器上，本地 notify 监听不到。
async fn pull_outcome(
    state: &AppStateWrapper,
    repo: &WorkspaceRef,
    transport: &dyn GitTransport,
) -> Result<WorkspaceActivation, AppError> {
    let snapshot =
        compute_and_record(state, repo, transport, DirtyMask::all(), Instant::now()).await?;
    Ok(WorkspaceActivation::Ready { snapshot })
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::time::Duration;

    use super::{
        activate_many, first_snapshot_outcome, pull_outcome, read_workspace_status,
        supports_push_producer, WorkspaceActivation,
    };
    use crate::common::executor::factory::ExecTarget;
    use crate::common::file::watcher::{wait_for_unit_snapshot, CollectingSink};
    use crate::common::git::WorkspaceSession;
    use crate::common::testing::{init_git_repo, plain_project_state_without_os_watch};

    /// 首份快照事件的宽容上限（git 项目要等 worker 起 git 子进程；慢机兜底）。
    const FIRST_EVENT_TIMEOUT: Duration = Duration::from_secs(8);

    /// 等**该单元**的首份 status 快照经注入端口投递（冷窗口语义下事件是唯一收敛保证）。
    ///
    /// 归属必须写在判据里：`activate_many` 一次只注入**一个**端口给整批单元，任何
    /// 「有没有事件」的等待都会被同批别的单元满足 —— 2026-11 Windows CI
    /// `declaring_two_units_mounts_both` 的假失败就是它（A 的冷窗口超时是合法 `Pending`，
    /// B 的推送先到）。等待原语在 `watcher::sink::test_support` 单点提供且强制带单元 key，
    /// 本文件不得再写轮询循环（护栏 `check_event_wait_attribution`）。
    fn first_snapshot_delivered(sink: &CollectingSink, key: &str) -> bool {
        wait_for_unit_snapshot(sink, key, 1, FIRST_EVENT_TIMEOUT)
    }

    /// **冷窗口裁决（本批核心语义）**：预算内等不到首份快照 ⇒ `Pending`（挂载成立、
    /// 数据在途），**不是错误**。
    ///
    /// 直测纯映射而非真实时序：超时是否发生由环境决定（不可控），但**归宿**必须恒为
    /// `Ready | Pending` 两态之一 —— 2026-10 CI 事故正是慢机上的超时被映射进了 `Err`。
    /// 入参 key 用占位串（不构造真 key 形态）：本函数只做透传，`WorkspaceRef::key()`
    /// 的单点约束见 `check_workspace_identity`。
    #[test]
    fn cold_window_maps_to_pending_never_to_error() {
        let outcome = first_snapshot_outcome(None, "cold-window-unit");
        match outcome {
            WorkspaceActivation::Pending { workspace_key } => {
                assert_eq!(workspace_key, "cold-window-unit");
            }
            WorkspaceActivation::Ready { .. } => {
                panic!("None 不得映射为 Ready（无数据可携带）")
            }
        }
    }

    /// **AC13 的分叉点**：远端单元没有 push 生产者，因此 `activate` 必须绕开挂载去 pull。
    /// 若这条判据写反（例如误把 WSL 也当 Local 挂上 watcher），远端项目的 Changes 面板
    /// 会永远停在「Loading changes…」—— 本次改造实测就是这样回归过一次。
    #[test]
    fn only_local_targets_get_a_push_producer() {
        assert!(supports_push_producer(&ExecTarget::Local));
        assert!(!supports_push_producer(&ExecTarget::Wsl {
            distro: "Ubuntu".into()
        }));
        assert!(!supports_push_producer(&ExecTarget::Remote {
            host: "example.com".into(),
            port: 22,
            username: "u".into(),
            auth: crate::common::connection::types::AuthMethod::KeyFile("/keys/id".into()),
        }));
    }

    /// 注册一个 Local git 项目（第二个及以上单元用）。
    fn add_git_project(state: &crate::AppStateWrapper, dir: &Path) -> String {
        std::fs::create_dir_all(dir).expect("create project dir");
        init_git_repo(dir);
        state
            .project_manager
            .lock()
            .expect("project_manager")
            .add_project(dir.to_path_buf(), None, None, None)
            .expect("add project")
            .id
    }

    /// 注册一个**非 git** 的 Local 项目（批量入口的「单元级失败」夹具）。
    fn add_plain_project(state: &crate::AppStateWrapper, dir: &Path) -> String {
        std::fs::create_dir_all(dir).expect("create project dir");
        state
            .project_manager
            .lock()
            .expect("project_manager")
            .add_project(dir.to_path_buf(), None, None, None)
            .expect("add project")
            .id
    }

    /// 服务层编排可被**注入端口**驱动（旧签名收 `&AppHandle` ⇒ 本用例根本无法编译）。
    /// 这条同时钉住：Local 单元走挂载、首份快照**最终**经注入的 sink 投递（`≥` 断言）、
    /// 冷窗口不进入错误空间（2026-10 CI 事故的回归契约）。
    #[tokio::test]
    async fn activate_mounts_the_unit_and_emits_to_the_injected_sink() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = plain_project_state_without_os_watch(&tmp);
        init_git_repo(&tmp.path().join("proj"));

        let (_target, repo) = state
            .resolve_workspace(&project_id, None)
            .await
            .expect("resolve repo");
        let sink = CollectingSink::new();
        let outcomes = activate_many(
            &state,
            sink.clone(),
            &[WorkspaceSession::of(project_id, None)],
        )
        .await;
        assert_eq!(outcomes.len(), 1, "逐单元一进一出");
        let outcome = outcomes
            .into_iter()
            .next()
            .expect("single outcome")
            .1
            .expect("冷窗口必须是合法结局（Ready/Pending），不得是错误");

        assert!(state.watcher_manager.is_watched(&repo));
        // 收敛走**事件通道**（冷窗口语义下事件是唯一保证）：
        // 无论结果就绪与否，首份快照都必须经注入的端口投递 —— 且必须是**本单元**的。
        assert!(
            first_snapshot_delivered(&sink, &repo.key()),
            "首份快照应经注入的端口投递（服务层不依赖交付机制）"
        );
        // 就绪分支的载荷身份必须是被激活单元（Pending 无数据可查，由上面的事件断言兜住）
        if let WorkspaceActivation::Ready { snapshot } = outcome {
            assert_eq!(snapshot.workspace_key, repo.key());
        }
    }

    /// **C2 能力仍在（不被 C4 的 reconcile 削弱）**：同一批声明两个单元 ⇒ 两个都在。
    ///
    /// 语义边界说清楚：reconcile 只释放**声明外**的单元；它**不是**互斥（「挂一个就踢一个」）。
    /// 旧用例 `activate_keeps_previous_unit_mounted`（依次声明 A、B ⇒ 两个都在）断言的是
    /// **互斥消失**，而 C4 之后「只声明 B」的正确结局恰好是释放 A —— 它已由
    /// `visible_set_releases_units_outside_it` 接管。本用例保留旧用例真正想钉的那条能力：
    /// 多单元可同时拥有 push 生产者。
    #[tokio::test]
    async fn declaring_two_units_mounts_both() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_a) = plain_project_state_without_os_watch(&tmp);
        init_git_repo(&tmp.path().join("proj"));
        let project_b = add_git_project(&state, &tmp.path().join("proj-b"));

        let (_ta, repo_a) = state
            .resolve_workspace(&project_a, None)
            .await
            .expect("repo a");
        let (_tb, repo_b) = state
            .resolve_workspace(&project_b, None)
            .await
            .expect("repo b");

        let sink_a = CollectingSink::new();
        let outcomes = activate_many(
            &state,
            sink_a.clone(),
            &[
                WorkspaceSession::of(project_a, None),
                WorkspaceSession::of(project_b, None),
            ],
        )
        .await;
        for (key, outcome) in &outcomes {
            assert!(outcome.is_ok(), "{key} 的冷窗口不得为错误：{outcome:?}");
        }
        assert!(state.watcher_manager.is_watched(&repo_a));
        assert!(state.watcher_manager.is_watched(&repo_b));
        // 夹具前提：A 的权威快照已落地（事件是冷窗口语义下唯一的收敛保证）。
        // 只认 A 自己的快照事件：B 同批挂载、共用同一个注入端口，`is_empty` 式判据会把
        // B 的推送当成 A 已就绪（本用例的失败形态）。
        assert!(
            first_snapshot_delivered(&sink_a, &repo_a.key()),
            "A 的首份快照必须经注入端口投递"
        );
        // 事件已到 ⇒ 登记表必然已有该单元：`deliver_push` 是「先写登记表、后 emit」，
        // 二者不可能分叉。本行钉的是那条顺序契约，不是「有没有事件」。
        assert!(state.watcher_manager.snapshot(&repo_a).is_some());
    }

    /// **R1.3 / AC1-AC2（后端侧闭合）**：声明集合收缩 ⇒ 差集内的单元被释放，**登记表数据保留**。
    ///
    /// 这是 C2 遗留缺口的收口点：C2 的挂载入口只「确保」、从不释放 ⇒ 会话内访问过的每个
    /// workspace 永久占一套 watcher + worker + FSEvents 流（无界累积）。
    #[tokio::test]
    async fn visible_set_releases_units_outside_it() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_a) = plain_project_state_without_os_watch(&tmp);
        init_git_repo(&tmp.path().join("proj"));
        let project_b = add_git_project(&state, &tmp.path().join("proj-b"));

        let (_ta, repo_a) = state
            .resolve_workspace(&project_a, None)
            .await
            .expect("repo a");
        let (_tb, repo_b) = state
            .resolve_workspace(&project_b, None)
            .await
            .expect("repo b");

        // 先声明 A + B（两个都挂上），并等 A 的快照落地（下面要断言释放后它仍在）。
        let sink_ab = CollectingSink::new();
        activate_many(
            &state,
            sink_ab.clone(),
            &[
                WorkspaceSession::of(&project_a, None),
                WorkspaceSession::of(&project_b, None),
            ],
        )
        .await;
        assert!(state.watcher_manager.is_watched(&repo_a));
        assert!(state.watcher_manager.is_watched(&repo_b));
        assert!(
            first_snapshot_delivered(&sink_ab, &repo_a.key()),
            "先决条件：A 的首份快照落地，后面的 retention 断言才有意义"
        );
        let before = state
            .watcher_manager
            .snapshot(&repo_a)
            .expect("A 的快照已落地");

        // 声明收缩到 [A] ⇒ B 离热释放，A 不受影响。
        activate_many(
            &state,
            CollectingSink::new(),
            &[WorkspaceSession::of(&project_a, None)],
        )
        .await;

        let watched = state.watcher_manager.watched_units();
        assert!(
            !state.watcher_manager.is_watched(&repo_b),
            "声明外的单元必须被释放（否则挂载集合随访问历史无界增长）：{watched:?}"
        );
        assert!(
            state.watcher_manager.is_watched(&repo_a),
            "声明内的单元不得被差集误杀：{watched:?}"
        );
        // 释放 ≠ 作废数据（C1）：切回该单元读得到旧值 + 脏位/陈旧窗口触发重算。
        let after = state
            .watcher_manager
            .snapshot(&repo_a)
            .expect("A 的登记数据不得因本轮 reconcile 消失");
        assert_eq!(after.workspace_key, before.workspace_key);
        assert!(
            after.version >= before.version,
            "A 的号段不得回退：{} < {}",
            after.version,
            before.version
        );
    }

    /// **R1.3 的幂等面**：同一集合重复声明 ⇒ 既无 created 也无 released。
    ///
    /// 前端去重（R1.4）只保证「集合不变时不发命令」，后端仍必须自己幂等 —— 两个幂等面
    /// 任何一侧缺失都会把重复声明放大成资源重建（互踢的另一种形状）。
    #[tokio::test]
    async fn reconcile_keeps_a_unit_that_is_still_in_the_set() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = plain_project_state_without_os_watch(&tmp);
        init_git_repo(&tmp.path().join("proj"));
        let (_t, repo) = state
            .resolve_workspace(&project_id, None)
            .await
            .expect("repo");

        let keep = vec![repo.key()];
        let (created, released) = state
            .watcher_manager
            .reconcile_mounted(vec![(repo.clone(), CollectingSink::new())], &keep);
        assert_eq!(created, keep, "首轮必须新建该单元的挂载");
        assert!(released.is_empty(), "首轮没有可释放的单元");

        let (created, released) = state
            .watcher_manager
            .reconcile_mounted(vec![(repo.clone(), CollectingSink::new())], &keep);
        assert!(created.is_empty(), "重申同一单元不得重建（幂等）");
        assert!(released.is_empty(), "集合内单元不得被释放");
        assert!(state.watcher_manager.is_watched(&repo));
        assert_eq!(state.watcher_manager.watched_units(), keep);
    }

    /// **远端单元不参与差集**：声明 `[远端单元]` 不得释放任何本地挂载。
    ///
    /// 机制：`keep` 是本批**解析成功且是 git 库**的全部单元（含 `Pull` 单元），因此远端单元在
    /// `keep` 里、不在 `mount_batch` 里 —— 若把 `keep` 缩成 `mount_batch`，切换到一个远端项目
    /// 会把本地单元的挂载全部拆掉（服务层回归）。用 `ExecTarget::Wsl` 声明一个远端单元
    /// 需要真机，故这里直接交给 manager：`reconcile_mounted([], &[A, remote])`。
    #[tokio::test]
    async fn reconcile_never_releases_a_unit_that_is_declared_but_not_mountable() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = plain_project_state_without_os_watch(&tmp);
        init_git_repo(&tmp.path().join("proj"));
        let (_t, repo) = state
            .resolve_workspace(&project_id, None)
            .await
            .expect("repo");

        let _ = state
            .watcher_manager
            .reconcile_mounted(vec![(repo.clone(), CollectingSink::new())], &[repo.key()]);
        assert!(state.watcher_manager.is_watched(&repo));

        // 本轮声明里带上一个「无 push 生产者、从不挂载」的单元（远端形态）—— 它没有任何资源
        // 可释放，也不得把别人带下水。key 用占位串（本用例只验差集，不验身份形态）。
        let unmountable = "remote-unit-without-local-resources".to_string();
        let (_created, released) = state
            .watcher_manager
            .reconcile_mounted(Vec::new(), &[repo.key(), unmountable]);
        assert!(
            released.is_empty(),
            "声明内（即使不可挂载）的单元不得被差集释放：{released:?}"
        );
        assert!(state.watcher_manager.is_watched(&repo));
    }

    /// **AC2（批量命令）**：一次 `activate_many([A, 坏项目, C])` ⇒ 三个单元各自给结局 ——
    /// 坏项目只让自己那项失败，其余两个照常挂载（不得整批失败，也不得互相串味）。
    ///
    /// 冷窗口的隔离由 `mounted_outcome` 的**逐单元**归宿保证（`Ready | Pending`，绝不 `Err`）；
    /// 本用例钉住的是同一批里的失败隔离与顺序契约。
    #[tokio::test]
    async fn batch_activation_mounts_every_unit_and_isolates_failures() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_a) = plain_project_state_without_os_watch(&tmp);
        init_git_repo(&tmp.path().join("proj"));
        let project_b = add_git_project(&state, &tmp.path().join("proj-b"));
        let project_bad = add_plain_project(&state, &tmp.path().join("not-a-repo"));

        let (_ta, repo_a) = state
            .resolve_workspace(&project_a, None)
            .await
            .expect("repo a");
        let (_tb, repo_b) = state
            .resolve_workspace(&project_b, None)
            .await
            .expect("repo b");
        let (_tbad, repo_bad) = state
            .resolve_workspace(&project_bad, None)
            .await
            .expect("repo bad");

        let sessions = [
            WorkspaceSession::of(project_a, None),
            WorkspaceSession::of(project_bad, None),
            WorkspaceSession::of(project_b, None),
        ];
        let sink = CollectingSink::new();
        let outcomes = activate_many(&state, sink.clone(), &sessions).await;

        assert_eq!(outcomes.len(), 3, "逐单元一进一出");
        // 顺序契约：返回顺序与入参一致（调用方按位置或 key 匹配都不会错位）。
        assert_eq!(outcomes[0].0, repo_a.key());
        assert_eq!(outcomes[1].0, repo_bad.key());
        assert_eq!(outcomes[2].0, repo_b.key());

        // 坏项目：只失败自己那一项，且**绝不挂载**（无 push 生产者可言）
        match &outcomes[1].1 {
            Err(error) => assert!(
                error.to_string().contains("not a git repository"),
                "非 git 库的错误必须说明原因，实际：{error}"
            ),
            Ok(activation) => panic!("非 git 库不得被当成可挂载单元：{activation:?}"),
        }
        assert!(
            !state.watcher_manager.is_watched(&repo_bad),
            "失败单元不得留下挂载资源"
        );

        // 其余两个：照常挂载，结局必须是 Ready | Pending（冷窗口合法），不得因同批的坏项目变 Err
        for (key, outcome) in [&outcomes[0], &outcomes[2]] {
            assert!(
                outcome.is_ok(),
                "{key} 的成功不得被同批的坏项目拖垮：{outcome:?}"
            );
        }
        assert!(state.watcher_manager.is_watched(&repo_a));
        assert!(state.watcher_manager.is_watched(&repo_b));
        assert_eq!(
            state.watcher_manager.watched_units().len(),
            2,
            "挂载集合必须恰好是两个 git 单元，实际 {:?}",
            state.watcher_manager.watched_units()
        );
    }

    /// **单元素声明同样是逐单元结局**：坏项目落 `failed` **数据**，不是整批 `Err`。
    ///
    /// C4 删除了单元素命令（`set_active_workspace`）—— 前端只发可见集合。因此这条
    /// 「单元级失败不拖死同批其它单元」的隔离契约唯一留在 `activate_many` 上。
    #[tokio::test]
    async fn missing_project_surfaces_as_a_failed_entry_not_a_batch_error() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, _project_id) = plain_project_state_without_os_watch(&tmp);
        let outcomes = activate_many(
            &state,
            CollectingSink::new(),
            &[WorkspaceSession::of("missing-project", None)],
        )
        .await;
        assert_eq!(outcomes.len(), 1, "逐单元一进一出");
        assert!(
            outcomes[0].1.is_err(),
            "未知项目必须是单元级失败（整批 Err 由命令边界判定，不得拖死其它项）"
        );
    }

    /// **AC13 的代码层闭合**：无 push 生产者的单元（WSL / SSH）= 现算一次、**绝不挂载**。
    ///
    /// 用 `&ExecTarget::Local`（本地真仓）驱动**同一条 pull 编排**（`pull_outcome`），无需真机
    /// 也无需假 transport；分类判据由 `only_local_targets_get_a_push_producer` 单独钉住 ——
    /// 两条合起来覆盖整条远端分支。拉取路径本身从不碰挂载（释放只发生在
    /// `reconcile_mounted` 的差集里，而远端单元在 `keep` 中，见
    /// `reconcile_never_releases_a_unit_that_is_declared_but_not_mountable`）。
    #[tokio::test]
    async fn pull_branch_computes_without_mounting_or_releasing_other_units() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_a) = plain_project_state_without_os_watch(&tmp);
        init_git_repo(&tmp.path().join("proj"));
        let project_b = add_git_project(&state, &tmp.path().join("proj-b"));

        let (_ta, repo_a) = state
            .resolve_workspace(&project_a, None)
            .await
            .expect("repo a");
        let (_tb, repo_b) = state
            .resolve_workspace(&project_b, None)
            .await
            .expect("repo b");

        // A 按 Local 正常挂载（有 push 生产者）
        activate_many(
            &state,
            CollectingSink::new(),
            &[WorkspaceSession::of(project_a, None)],
        )
        .await;
        assert!(state.watcher_manager.is_watched(&repo_a));

        // B 走「远端形态」：同一条 pull 编排（本地 transport + 无 push 生产者）
        let outcome = pull_outcome(&state, &repo_b, &ExecTarget::Local)
            .await
            .expect("pull b");
        // pull 分支是**同步现算**：不存在冷窗口，必返 Ready（Pending 只属于 push 生产者）。
        let snapshot = match outcome {
            WorkspaceActivation::Ready { snapshot } => snapshot,
            WorkspaceActivation::Pending { .. } => {
                panic!("pull 分支（现算）必返 Ready —— Pending 只属于 push 生产者的冷窗口")
            }
        };

        assert_eq!(snapshot.workspace_key, repo_b.key());
        assert!(
            !state.watcher_manager.is_watched(&repo_b),
            "远端单元绝不挂载（无 push 生产者）"
        );
        assert!(
            state.watcher_manager.is_watched(&repo_a),
            "pull 分支不得释放已有挂载（它从不碰挂载：释放只发生在 reconcile 的差集里）"
        );
        // 无端口即无投递：`pull_outcome` 根本收不到 `WatcherEventSink`（没有 worker，
        // 也就没有事件源）—— 这条是**结构**保证，不需要（也无法）在运行时断言：
        // 曾经写下的一条 `assert!(sink 无事件)` 因为 sink 从未交给任何被调方而恒真，
        // 属于「看起来在钉契约、实际钉不到任何东西」的假断言，已删除。
        assert!(
            state.watcher_manager.snapshot(&repo_b).is_some(),
            "pull 结果必须登记进同一张快照表"
        );
    }

    /// 未挂载单元的读路径：**每次读都现算并登记同一张表**（不信任任何缓存）。
    #[tokio::test]
    async fn read_workspace_status_of_an_unmounted_unit_computes_and_records() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = plain_project_state_without_os_watch(&tmp);
        init_git_repo(&tmp.path().join("proj"));
        let (_t, repo) = state
            .resolve_workspace(&project_id, None)
            .await
            .expect("repo");

        assert!(!state.watcher_manager.is_watched(&repo));
        let snapshot = read_workspace_status(&state, &repo).await.expect("compute");
        assert_eq!(snapshot.workspace_key, repo.key());
        assert!(
            state.watcher_manager.snapshot(&repo).is_some(),
            "pull 结果必须登记进同一张快照表（供侧栏 chip 等复用）"
        );
    }

    /// 测试专用：运行 git CLI（生产路径一律走 `GitTransport` / exec facade）。
    fn git_run(dir: &Path, args: &[&str]) -> String {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("git should be available");
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    /// 把 `<root>/proj` 接上 bare upstream 并推一次首提交，再在本地多一个提交 → ahead=1。
    fn setup_upstream_with_local_commit(root: &Path) {
        let work = root.join("proj");
        let remote = root.join("origin.git");
        std::fs::create_dir_all(&remote).expect("bare dir");
        git_run(&remote, &["init", "--bare"]);
        git_run(
            &work,
            &["remote", "add", "origin", &remote.to_string_lossy()],
        );
        git_run(&work, &["push", "--set-upstream", "origin", "HEAD"]);
        std::fs::write(work.join("ahead.txt"), "x\n").unwrap();
        git_run(&work, &["add", "ahead.txt"]);
        git_run(
            &work,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@test.com",
                "commit",
                "-m",
                "local commit",
            ],
        );
    }

    /// **R3.2 / P3**：pull 生产者（未挂载 / 远端）必须在同一份快照里填 ahead/behind，
    /// 不得把它们留 0。用本地 transport 驱动同一条 `compute_and_record` 分支。
    #[tokio::test]
    async fn pull_producer_fills_ahead_behind() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = plain_project_state_without_os_watch(&tmp);
        init_git_repo(&tmp.path().join("proj"));
        setup_upstream_with_local_commit(tmp.path());

        let (_t, repo) = state
            .resolve_workspace(&project_id, None)
            .await
            .expect("repo");
        assert!(!state.watcher_manager.is_watched(&repo), "夹具前提：未挂载");

        let snapshot = read_workspace_status(&state, &repo).await.expect("compute");
        assert_eq!(snapshot.ahead, 1, "本地领先 upstream 一个提交");
        assert_eq!(snapshot.behind, 0);
    }
}
