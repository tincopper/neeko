//! 仓库单元（[`RepoRef`]）git status 的**读取与挂载编排**。
//!
//! 命令层（`git/commands/query.rs`）只做参数校验 + 委派（红线 6），本模块承担编排：
//! 快照优先、冷启动有界等待、未挂载单元退化为一次 pull 计算并登记同一张表。
//!
//! **单一形态**：无论生产者是 push（挂载中的 watcher worker）还是 pull（本文件的
//! `compute_and_record`），读出来的都是同一个 `GitStatusSnapshot` —— 同一个 `version`
//! 语义、同一个 `repo_key` 寻址。旧实现里 worktree / WSL / SSH 返回 `version: 0`
//! 让前端「恒放行」，等于开了第二条身份不明的数据通道，任何一次 pull 都能覆盖任何
//! 时刻的 push 快照（= 串数据）。

use std::sync::Arc;

use crate::common::executor::factory::ExecTarget;
use crate::common::file::watcher::AppHandleSink;
use crate::common::git::status_worker::{GitStatusSnapshot, RECALC_WAIT_TIMEOUT};
use crate::common::git::transport::GitTransport;
use crate::common::git::RepoRef;
use crate::common::runtime::run_blocking;
use crate::AppError;
use crate::AppStateWrapper;

/// 写操作成功后请求该单元重算并**有界等待落地**。
///
/// 见 `.trellis/spec/backend/git-domain.md` §10：任何经 IPC 的 git 写命令成功后都必须
/// 戳**被写入的那个单元**，否则读接口拿写前快照当权威数据返回（「操作成功但列表要手动
/// 刷新才更新」的根因）。契约主键本次随身份一起从 project 升为 `RepoRef`。
pub async fn wait_status_fresh(state: &AppStateWrapper, repo: &RepoRef) {
    let manager = state.watcher_manager.clone();
    let repo = repo.clone();
    // Condvar 等待是阻塞原语 → run_blocking 隔离（红线 3）。join 失败仅发生于运行时关停，
    // 超时与否都不影响命令成败：由 `git-status-snapshot` 事件推送最终收敛。
    let _ =
        run_blocking(move || manager.poke_status_worker_and_wait(&repo, RECALC_WAIT_TIMEOUT)).await;
}

/// 主仓单元的写后收口：命令**只接受 `project_id`** 时，被写入的单元必然是主仓单元。
///
/// 存在理由不是省两行字，而是让「命令作用域 = 主仓」这件事在收口处显式说出来：这类命令
/// 在 worktree 视图下同样只操作主仓（命令作用域问题，另见任务 PRD「已知缺口」），因此戳
/// 主仓是唯一正确的做法；等命令哪天补上 `worktree_path` 参数，就必须换成 [`wait_status_fresh`]
/// —— 编译器不会提醒，所以把这条写在名字里。
pub async fn wait_main_status_fresh(state: &AppStateWrapper, project_id: &str) {
    match state.resolve_repo(project_id, None).await {
        Ok((_target, main)) => wait_status_fresh(state, &main).await,
        // 解析失败不影响命令成败：数据最终由 `git-status-snapshot` 推送收敛。
        Err(e) => log::warn!("[GitStatus] cannot resolve main unit for {project_id}: {e}"),
    }
}

/// 释放某单元的挂载资源（该 worktree 被删除或改名之后必须调用）。
///
/// 挂载（worker + 文件 watcher + git-meta watcher 一套线程/句柄）的存在前提是「该单元的
/// 工作树存在」。目录没了还留着挂载：① 线程与句柄白占（AC11 的资源规模契约）；② 该单元
/// 槽位里最后一份快照继续被当成权威数据渲染（I1-b 明令禁止的「旧数据伪装成事实」）。
///
/// 前端把激活态切走后 `activate()` 也会顺带释放本项目其它单元，但**资源生命周期的归属在
/// 后端** —— 不能把不变量寄托在调用方记得改状态上。`unwatch` 同时做掉释放与作废。
///
/// **阻塞语义**：drop notify watcher（递归反注册 inotify/FSEvents 句柄）可能短暂阻塞 →
/// 经 `run_blocking` 隔离（红线 3），与挂载侧 `mount_only` 对称。
pub async fn release_unit(state: &AppStateWrapper, repo: &RepoRef) {
    let manager = state.watcher_manager.clone();
    let repo = repo.clone();
    let _ = run_blocking(move || manager.unwatch(&repo)).await;
}

/// 读取某仓库单元的权威 status。**先看有没有生产者，再看缓存**：
///
/// 1. 挂载中且已有快照 → 直接返回（与 `git-status-snapshot` 事件同源同版本，新鲜度由
///    worker 负责）；
/// 2. 挂载中但首个快照未到（冷启动）→ 有界等待一轮重算后重读；仍拿不到就报错，让前端
///    渲染「未知」；
/// 3. **未挂载 ⇒ 一律现算**（WSL / SSH 单元，以及侧栏要为每个 worktree 取计数的那些）。
///
/// 顺序不能反过来（先查缓存再看挂载）：未挂载的单元没有任何生产者会让槽位变新，
/// 那份 pull 结果一旦被当成权威返回，`refreshRepoStatus` 就成了空操作 —— 第一次 pull
/// 的数据会永远显示成"最新"，正是 I1-b 禁止的「旧数据伪装成事实」。
pub async fn read_unit_status(
    state: &AppStateWrapper,
    repo: &RepoRef,
) -> Result<GitStatusSnapshot, AppError> {
    let manager = state.watcher_manager.clone();
    if manager.is_watched(repo) {
        if let Some(snap) = manager.snapshot(repo) {
            return Ok((*snap).clone());
        }
        // 情形 2：Condvar 等待是阻塞原语 → 经 run_blocking 隔离（红线 3）
        let waiter = state.watcher_manager.clone();
        let wait_repo = repo.clone();
        let _ = run_blocking(move || {
            waiter.poke_status_worker_and_wait(&wait_repo, RECALC_WAIT_TIMEOUT)
        })
        .await;
        if let Some(snap) = manager.snapshot(repo) {
            return Ok((*snap).clone());
        }
        return Err(AppError::NotFound(format!(
            "status for unit {} is not available yet",
            repo.key()
        )));
    }
    // 情形 3：没有 push 生产者，缓存不可信 ⇒ 每次读都经 transport 现算
    compute_and_record(state, repo).await
}

/// 现算一次并登记（pull 生产者）。WSL / SSH / 未挂载单元专用。
async fn compute_and_record(
    state: &AppStateWrapper,
    repo: &RepoRef,
) -> Result<GitStatusSnapshot, AppError> {
    let (target, _) = state.resolve_project(repo.project_id())?;
    let (entries, branch) =
        crate::common::git::operations::status_porcelain(&target, repo.work_dir())
            .await
            .map_err(AppError::from)?;
    let snap = state.watcher_manager.record_computed(repo, entries, branch);
    Ok(Arc::unwrap_or_clone(snap))
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

/// 激活一个仓库单元：释放其它单元的挂载 → 挂载本单元 → 有界等待首个快照。
///
/// **为什么由前端显式驱动**：决策 D-B 是「只挂当前视图所在的那个单元」，每项目常驻
/// 至多一套资源。挂载/释放因此必须有一个唯一入口 —— 否则「谁在看」又会散落到各处，
/// 与本次要删除的那些「读全局镜像猜身份」的路径同构。
///
/// 副作用说明：挂载后立刻作废该单元此前可能残留的快照（见 `WatcherManager::watch`），
/// 因此本命令返回的必然是**挂载后重算**的结果，不是切走前的旧数据。
///
/// 远端（WSL / SSH）不挂载，但仍然收口（释放上一个本地项目的挂载）后立刻 pull 一次。
pub async fn activate(
    state: &AppStateWrapper,
    app: &tauri::AppHandle,
    repo: &RepoRef,
) -> Result<GitStatusSnapshot, AppError> {
    let (target, _) = state.resolve_project(repo.project_id())?;
    // 仓库存在性由 transport 判定（本地 fs 判定会误杀 WSL / SSH 单元）
    if !target.is_git_repo(repo.work_dir()).await {
        return Err(AppError::NotFound(format!(
            "unit {} is not a git repository",
            repo.key()
        )));
    }
    if !supports_push_producer(&target) {
        // WSL / SSH：工作树在别的机器上，本地 notify 监听不到、git 子进程也拿不到 ⇒
        // 这类单元没有 push 生产者，激活 = 立刻 pull 一次（HEAD 之前也是这么工作的：
        // 远端 status 由 transport 现算）。
        // 仍然要收口：切到远端项目时，上一个本地项目的挂载必须被释放（D-B 全局一套）。
        let manager = state.watcher_manager.clone();
        let keep = repo.key();
        let _ = run_blocking(move || manager.release_except(&keep)).await;
        return compute_and_record(state, repo).await;
    }
    let manager = state.watcher_manager.clone();
    let sink = Arc::new(AppHandleSink::new(app.clone()));
    let watch_repo = repo.clone();
    // notify 的递归 watch 在 Linux 上会同步遍历整树 → 必须离开 IPC/async 线程（红线 3）。
    // `mount_only` 而非「release_except + watch」两连调：D-B 的不变量（至多一套挂载）必须
    // 由资源所有者在**同一个临界区**内保证 —— 两步分开时，并发的 activate 会交错出两套挂载。
    let released: Vec<String> = run_blocking(move || manager.mount_only(watch_repo, sink))
        .await
        .map_err(|e| AppError::Unknown(format!("activate task join error: {e}")))?;
    if !released.is_empty() {
        log::debug!(
            "[GitStatus] activating {} released {released:?}",
            repo.key()
        );
    }

    read_unit_status(state, repo).await
}

#[cfg(test)]
mod tests {
    use super::supports_push_producer;
    use crate::common::executor::factory::ExecTarget;

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
}
