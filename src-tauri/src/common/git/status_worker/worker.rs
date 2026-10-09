#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::common::executor::factory::ExecTarget;
use crate::common::git::WorkspaceRef;
use crate::core::exec::collect_blocking;

use super::collapsed_probe::{collapsed_dirs_digest, Digest};
use super::writer::{parse_porcelain, GitStatusSnapshot, MAX_STATUS_ENTRIES};

const fn exit_diagnostics(code: i32) -> (Option<i32>, Option<i32>) {
    (Some(code), None)
}

/// `check_and_wait` 等待重算落地的默认上限。
///
/// 常规一轮 `git status` 毫秒级；上限只兜住病态场景（超大仓库的折叠目录探测、
/// 系统负载尖峰）。超时后放弃等待，由快照事件推送最终收敛（最终一致性不变）。
pub const RECALC_WAIT_TIMEOUT: Duration = Duration::from_millis(1500);

/// worker 迭代进度（started/completed 对）。
///
/// 成对存在的原因：worker 可能有**早于调用方写入启动**的迭代在跑，只看
/// `completed` 前进可能被那一轮提前满足 —— 读到的仍是写前状态。只有
/// 「采样时刻 started == completed（空闲）之后启动的新迭代」才保证晚于写入。
#[derive(Default)]
struct Progress {
    /// 已开始的迭代数（recv 信号并清空队列后）。
    started: u64,
    /// 已完成的迭代数（git status 跑完、emit 决策做完后）。
    completed: u64,
}

/// 重算落地同步原语：worker 线程推进进度，`check_and_wait` 在其上有界等待。
#[derive(Default)]
struct RecalcSync {
    progress: Mutex<Progress>,
    completed_cv: Condvar,
}

/// Persistent git status worker that runs `git status --porcelain` on demand.
#[derive(Clone)]
pub struct GitStatusWorker {
    /// Channel to signal a status check request.
    signal_tx: mpsc::Sender<()>,
    /// 迭代进度共享状态（`check_and_wait` 的等待依据）。
    sync: Arc<RecalcSync>,
}

impl GitStatusWorker {
    /// Start the worker for the given repository **workspace** (main repo or one linked worktree).
    pub fn start(
        repo: WorkspaceRef,
        on_change: impl Fn(GitStatusSnapshot) + Send + 'static,
    ) -> Self {
        let (signal_tx, signal_rx) = mpsc::channel::<()>();
        let sync = Arc::new(RecalcSync::default());

        thread::Builder::new()
            .name(format!(
                "git-worker-{}",
                repo.root_pathbuf()
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "unknown".to_string())
            ))
            .spawn({
                let sync = Arc::clone(&sync);
                move || worker_loop(repo, signal_rx, on_change, sync)
            })
            .expect("Failed to spawn git worker thread");

        Self { signal_tx, sync }
    }

    /// Request a status check (non-blocking).
    pub fn check(&self) {
        let _ = self.signal_tx.send(());
    }

    /// 请求一次 status 重算并**有界等待其落地**（worker 跑完一轮 git status）。
    ///
    /// 返回 `true` = 一轮**晚于本调用启动**的重算已完成（emit 已在该调用返回前
    /// 冲刷，此刻的快照反映调用之前的全部写入）；`false` = 超时（调用方退回
    /// 快照事件推送收敛）。非阻塞版见 [`check`](Self::check)。
    ///
    /// **阻塞方法**：Condvar 等待原语 —— async 上下文必须经 `run_blocking` /
    /// `spawn_blocking` 调用。
    #[must_use]
    pub fn check_and_wait(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            let (started, completed) = {
                let p = self.sync.progress.lock().expect("recalc progress mutex");
                (p.started, p.completed)
            };
            let remaining = deadline.saturating_duration_since(Instant::now());
            let p = self.sync.progress.lock().expect("recalc progress mutex");
            if started == completed {
                // 空闲：采样之后启动的迭代必然晚于调用方写入，发信号并等它完成。
                drop(p);
                self.check();
                let p = self.sync.progress.lock().expect("recalc progress mutex");
                let (done, _) = self
                    .sync
                    .completed_cv
                    .wait_timeout_while(p, remaining, |pr: &mut Progress| pr.completed <= completed)
                    .expect("recalc progress mutex");
                return done.completed > completed;
            }
            // 忙碌：先等在飞迭代落地（它可能早于写入启动，不可信），落地后重采样。
            let (done, _) = self
                .sync
                .completed_cv
                .wait_timeout_while(p, remaining, |pr: &mut Progress| pr.completed <= completed)
                .expect("recalc progress mutex");
            if done.completed <= completed {
                return false;
            }
        }
    }
}

/// Main worker loop: wait for signal → run git status → compare → emit full snapshot.
///
/// G2 单一权威化：worker 是 status 的唯一计算路径（D1）。任何实质变化（porcelain
/// 输出、分支、ahead/behind 或折叠目录内容摘要）都产出**完整**快照并整体通知 —— 事件
/// 携带全量数据而非增量 patch（D3），前端以 version 门控替换，乱序/回退从结构上消除（P1）。
///
/// **change gate 是类型驱动的**：闸门比较「即将 emit 的候选快照」整体
/// （`GitStatusSnapshot` 派生 `PartialEq`），而不是一组平行维护的 `last_*` 变量 ——
/// 新增派生子字段会自动进入闸门，「有人忘了把新字段加进布尔合取」这类静默漏发从结构上消失。
fn worker_loop(
    repo: WorkspaceRef,
    signal_rx: mpsc::Receiver<()>,
    on_change: impl Fn(GitStatusSnapshot),
    sync: Arc<RecalcSync>,
) {
    // 上一次 emit 的快照（整体比较；含 entries / branch / ahead / behind）。
    // 候选快照的 `version` 传 0 占位：注册表 `store_snapshot` 会重新盖章（见 `manager/core.rs`），
    // 故 version 不参与比较、也不作数 —— 号源只有注册表一个。
    //
    // **有意的代价**：相比旧的一组标量局部变量，这里多持有一份 entries（≤ `MAX_STATUS_ENTRIES`）。
    // 换来的是「新增快照字段自动入闸」（`GitStatusSnapshot: PartialEq`），不再需要人工维护
    // 布尔合取 —— 后者正是 ahead/behind 漏进闸门、徽标无界陈旧的根因（见 git-domain §14）。
    let mut last_snapshot: Option<GitStatusSnapshot> = None;
    // 折叠 untracked 目录的内容摘要（见 `collapsed_probe`）。**只喂闸门、不进快照载荷**，
    // 因此不属于快照，需要独立记一份。`None` = 尚未探测 → 放行 emit。
    let mut last_collapsed_digest: Option<Digest> = None;
    let path_str = repo.root().to_string();

    log::debug!("[GitWorker] Worker started for {}", path_str);

    loop {
        match signal_rx.recv() {
            Ok(()) => {}
            Err(_) => {
                log::debug!(
                    "[GitWorker] Channel closed, worker exiting for {}",
                    path_str
                );
                break;
            }
        }

        while signal_rx.try_recv().is_ok() {}

        // 迭代起点：此后执行的 git status 晚于任何在本轮信号发出前完成的写入。
        sync.progress.lock().expect("recalc progress mutex").started += 1;

        log::debug!("[GitWorker] Running git status for {}", path_str);

        let current = git_status_porcelain(&repo);
        let current_branch = get_current_branch(&repo);
        // 第三类输入（refs）：ahead/behind 依赖本地分支 ref 与 remote-tracking ref，
        // 与 HEAD / index / workdir 完全正交 —— 必须与它们同一轮次计算、同一份快照投递。
        let (ahead, behind) = ahead_behind(&repo);

        let current_files = parse_porcelain(&current);

        // G4（P7）：numstat/行数不再进 status 主链路 —— 行数由 CommitPanel 独立的
        // get_changed_files_diff_stats 按需提供（stats 优先、快照行数仅 fallback），
        // status 重算从「status + 2×diff --numstat」降为单次 porcelain。

        // 候选快照必须在闸门**之前**组装：闸门要回答的是「即将 emit 的那个值
        // 有没有变」，所以比较对象就是它本身，而不是一组与之平行的本地变量。
        let mut candidate = GitStatusSnapshot::for_unit(&repo, 0);
        candidate.branch = current_branch;
        candidate.entries = current_files;
        candidate.ahead = ahead;
        candidate.behind = behind;

        // 全链路封顶（公理：随输入规模增长的结构必须有界；对齐 orca 1000 条超限截断）。
        // 上限的单一实现是 `enforce_entry_cap`（worker 与 pull 生产者共用，禁止各写一份）。
        let raw_entry_count = candidate.entries.len();
        if candidate.enforce_entry_cap() {
            log::warn!(
                "[GitWorker] status entries exceeded cap for {}: {} truncated to {}",
                path_str,
                raw_entry_count,
                MAX_STATUS_ENTRIES
            );
        }

        // 折叠 untracked 目录的**内容**摘要：porcelain 折叠语义下目录内部增删不会改变
        // `current` 字符串，只看字符串的闸门会判定「无变化」→ 不 emit → 前端拿到陈旧
        // 快照且没有任何失效信号（本任务要修的盲区）。摘要只喂闸门，不进快照载荷，
        // 因此 IPC 条目数、折叠语义都不变。
        // 取截断后的集合：超出上限的条目本就不进快照，也就无需为其探测。
        let collapsed_digest = collapsed_dirs_digest(repo.root_path(), &candidate.entries);

        // 与上一次 emit 的候选快照整体比较（含 entries / branch / ahead / behind）。
        // 纯 ref 变化（外部 push/fetch/commit）不改 workdir/HEAD/index，但只要 ahead/behind
        // 变了这里就不等 → emit（ahead/behind 纳入比较正是本任务的回归钉子）。
        let observable_unchanged = last_snapshot.as_ref() == Some(&candidate);
        // 未知摘要一律放行（宁可多发一次快照，不可漏发）；已知且与上次相等才算「真无变化」
        let digest_unchanged = !collapsed_digest.is_unknown()
            && Some(&collapsed_digest) == last_collapsed_digest.as_ref();
        if observable_unchanged && digest_unchanged {
            // 无变化不 emit，但迭代照常落地：started/completed 必须成对推进，
            // 否则 `check_and_wait` 会把「无变化重算」永远等成超时。
            {
                let mut p = sync.progress.lock().expect("recalc progress mutex");
                p.completed += 1;
            }
            sync.completed_cv.notify_all();
            continue;
        }

        log::debug!(
            "[GitWorker] git status result for {}: {} bytes, entries={}, digest={:?}",
            path_str,
            current.len(),
            candidate.entries.len(),
            collapsed_digest
        );

        last_snapshot = Some(candidate.clone());
        last_collapsed_digest = Some(collapsed_digest);

        log::debug!(
            "[GitWorker] Emitting snapshot for {} (branch {}): {} entries",
            path_str,
            candidate.branch,
            candidate.entries.len()
        );

        on_change(candidate);

        // 迭代终点：emit 已冲刷后才算落地（`check_and_wait` 依赖此顺序 ——
        // 等待返回时快照写入与事件推送均已完成）。
        {
            let mut p = sync.progress.lock().expect("recalc progress mutex");
            p.completed += 1;
        }
        sync.completed_cv.notify_all();
    }
}

/// Get current branch name (detached HEAD → "HEAD"), empty on error.
pub(crate) fn get_current_branch(repo: &WorkspaceRef) -> String {
    let path_str = repo.root();
    match collect_blocking(
        &ExecTarget::Local,
        "git",
        &["-C", path_str, "rev-parse", "--abbrev-ref", "HEAD"],
    ) {
        Ok(output) if output.exit_code == 0 => {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
        _ => String::new(),
    }
}

/// 计算相对 `@{upstream}` 的 `(ahead, behind)`。
///
/// `git rev-list --left-right --count @{upstream}...HEAD` 输出 `left\tright`：
/// - `left` = 上游独有 = `behind`；
/// - `right` = 本地独有 = `ahead`。
///
/// 无 upstream（未设置 tracking / detached HEAD）或命令失败一律 `(0, 0)` —— 那是合法
/// 状态，不是错误（对齐 `design.md` §4.2）。只读语义（不刷新 index）由 exec facade
/// 统一注入（见 `.trellis/spec/backend/git-domain.md` §9），此处不传任何 CLI 可选锁标志。
fn ahead_behind(repo: &WorkspaceRef) -> (u32, u32) {
    let path_str = repo.root();
    match collect_blocking(
        &ExecTarget::Local,
        "git",
        &[
            "-C",
            path_str,
            "rev-list",
            "--left-right",
            "--count",
            "@{upstream}...HEAD",
        ],
    ) {
        Ok(output) if output.exit_code == 0 => crate::common::git::parsers::parse_ahead_behind(
            &String::from_utf8_lossy(&output.stdout),
        ),
        _ => (0, 0),
    }
}

/// Execute `git status --porcelain` for one workspace.
///
/// 只读语义（不 refresh index、不取 optional lock）由 exec facade 统一注入只读 env
/// 承担（见 `common::executor::env_defaults`），因此这里**不再**传 CLI 可选锁标志，
/// 也就不需要"老 git 不支持该标志"的回退分支 —— 回退分支恰恰是当年漏掉锁语义的地方之一。
fn git_status_porcelain(repo: &WorkspaceRef) -> String {
    let path_str = repo.root();
    match collect_blocking(
        &ExecTarget::Local,
        "git",
        &["-C", path_str, "status", "--porcelain"],
    ) {
        Ok(output) => {
            if output.exit_code != 0 {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let (code, signal) = exit_diagnostics(output.exit_code);
                log::warn!(
                    "[GitWorker] git status failed at {}: exit={:?} signal={:?} stderr={}",
                    path_str,
                    code,
                    signal,
                    stderr.trim()
                );
            }
            String::from_utf8_lossy(&output.stdout).to_string()
        }
        Err(e) => {
            log::error!("[GitWorker] Failed to spawn git at {}: {}", path_str, e);
            String::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::executor::factory::ExecTarget;

    /// 主仓形态的 `WorkspaceRef`（测试夹具：`tempdir()` 派生路径，红线 13）。
    fn main_ref(path: &std::path::Path) -> WorkspaceRef {
        WorkspaceRef::main("p1", &path.to_string_lossy())
    }

    fn create_repo_with_commit() -> (tempfile::TempDir, git2::Repository) {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        std::fs::write(tmp.path().join("README.md"), "# Test\n").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("README.md")).unwrap();
            index.write().unwrap();
            let tree_id = index.write_tree().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
                .unwrap();
        }
        (tmp, repo)
    }

    #[test]
    fn get_current_branch_returns_initial_branch() {
        let (tmp, repo) = create_repo_with_commit();
        let expected = repo.head().unwrap().shorthand().unwrap().to_string();
        assert_eq!(get_current_branch(&main_ref(tmp.path())), expected);
    }

    #[test]
    fn get_current_branch_detects_branch_switch() {
        let (tmp, repo) = create_repo_with_commit();
        let head = repo.head().unwrap();
        let commit = head.peel_to_commit().unwrap();
        repo.branch("feature-commands", &commit, false).unwrap();
        repo.set_head("refs/heads/feature-commands").unwrap();
        repo.checkout_head(None).unwrap();
        assert_eq!(
            get_current_branch(&main_ref(tmp.path())),
            "feature-commands"
        );
    }

    #[test]
    fn get_current_branch_returns_empty_for_non_repo() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(get_current_branch(&main_ref(tmp.path())), "");
    }

    /// Nit 4 核心契约：写入 → `check_and_wait` 返回 true 时，emit（快照推送 +
    /// 注册表写入）**已在该调用返回前冲刷** —— 命令层随后发起的读接口必然看到
    /// 写后快照，首刷旧值窗口被消除。
    #[test]
    fn check_and_wait_confirms_recalc_landed_after_write() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (tmp, _repo) = create_repo_with_commit();
        let (emit_tx, emit_rx) = mpsc::channel::<GitStatusSnapshot>();
        let worker = GitStatusWorker::start(main_ref(tmp.path()), move |snap| {
            let _ = emit_tx.send(snap);
        });

        // 写入发生在 check_and_wait 之前（对齐命令层「写成功后才 poke」的契约）
        std::fs::write(tmp.path().join("README.md"), "# changed\n").unwrap();
        assert!(
            worker.check_and_wait(Duration::from_secs(5)),
            "recalc must land within the bound after a write"
        );
        let snap = emit_rx
            .try_recv()
            .expect("emit must have flushed before check_and_wait returned");
        assert_eq!(
            snap.entries.len(),
            1,
            "snapshot must reflect the post-write worktree"
        );
    }

    /// 对照：空闲 + 无实质变化 → 迭代照常落地（completed 推进）→ true；
    /// 不得把「无变化重算」误判为超时，也不得 emit。
    #[test]
    fn check_and_wait_returns_true_without_emit_when_unchanged() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (tmp, _repo) = create_repo_with_commit();
        let (emit_tx, emit_rx) = mpsc::channel::<GitStatusSnapshot>();
        let worker = GitStatusWorker::start(main_ref(tmp.path()), move |snap| {
            let _ = emit_tx.send(snap);
        });

        assert!(
            worker.check_and_wait(Duration::from_secs(5)),
            "first recalc should land"
        );
        let first = emit_rx
            .try_recv()
            .expect("first recalc emits the baseline snapshot");
        // version 由注册表（store_snapshot）统一盖章，worker 侧恒为占位 0：
        // 本用例只关心「首轮 emit、次轮不 emit」，故断言快照内容而非 version。
        assert!(first.entries.is_empty(), "clean repo has no changes");

        assert!(
            worker.check_and_wait(Duration::from_secs(5)),
            "unchanged recalc still completes"
        );
        assert!(
            emit_rx.try_recv().is_err(),
            "unchanged worktree must not emit"
        );
    }

    /// 超时路径：deadline 为 0 → 等待立即失败返回 false，不挂死、不误报成功
    /// （worker 不可能在 0 时间内 fork+exec 完一次 git status）。
    #[test]
    fn check_and_wait_zero_deadline_times_out() {
        use std::time::Duration;

        let (tmp, _repo) = create_repo_with_commit();
        let worker = GitStatusWorker::start(main_ref(tmp.path()), |_| {});
        assert!(
            !worker.check_and_wait(Duration::ZERO),
            "zero deadline must time out, not report success"
        );
    }

    #[test]
    fn worker_does_not_emit_when_status_unchanged() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (tmp, _repo) = create_repo_with_commit();
        std::fs::write(tmp.path().join("README.md"), "# Changed\n").unwrap();

        let (emit_tx, emit_rx) = mpsc::channel::<GitStatusSnapshot>();
        let worker = GitStatusWorker::start(main_ref(tmp.path()), move |diff| {
            let _ = emit_tx.send(diff);
        });

        worker.check();
        emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("initial check should emit the first diff");

        worker.check();
        match emit_rx.recv_timeout(Duration::from_millis(800)) {
            Ok(_) => panic!("unchanged status must not emit another diff"),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(e) => panic!("unexpected recv error: {e}"),
        }
    }

    /// 对照（防矫枉过正）：折叠目录**内容不变**时不得因为新增了摘要探测就反复 emit
    /// —— 否则每次 FS 事件批次都会让前端整体替换快照（churn）。
    #[test]
    fn untracked_dir_unchanged_does_not_emit() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (tmp, _repo) = create_repo_with_commit();
        let (emit_tx, emit_rx) = mpsc::channel::<GitStatusSnapshot>();
        let worker = GitStatusWorker::start(main_ref(tmp.path()), move |snap| {
            let _ = emit_tx.send(snap);
        });

        let dir = tmp.path().join("stable");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), "x\n").unwrap();

        worker.check();
        emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("initial check should emit");

        worker.check();
        match emit_rx.recv_timeout(Duration::from_millis(800)) {
            Ok(snap) => panic!(
                "折叠目录内容未变时不得 emit（摘要相等应继续闸门），got unexpected emit v{}",
                snap.version
            ),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(e) => panic!("unexpected recv error: {e}"),
        }
    }

    /// AC7（后端侧）/ AC5：同一个折叠 untracked 目录**已进入上一次快照**后，在其内部
    /// 连续创建 10 个文件 → 恰好产出 1 个新快照（不是 10 个，也不是 0 个）。
    /// 判据是「emit 次数」；version 由注册表盖章，不在 worker 层断言。
    ///
    /// 关键前置：目录必须先以折叠条目形态存在于上一次快照里 —— 否则 porcelain 字符串
    /// （`""` → `?? burst/`）本身就会变化，闸门放行，用例通过但什么都没验证到。
    ///
    /// 当前实现为 Red：第二阶段 porcelain 全程是 `?? burst/`（折叠语义），闸门判定
    /// 「无变化」→ 不 emit。前端调用次数上界见
    /// `src/features/git/hooks/__tests__/useUntrackedDirExpansion.test.ts`。
    #[test]
    fn untracked_dir_burst_creates_emit_exactly_one_snapshot() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (tmp, _repo) = create_repo_with_commit();
        let (emit_tx, emit_rx) = mpsc::channel::<GitStatusSnapshot>();
        let worker = GitStatusWorker::start(main_ref(tmp.path()), move |snap| {
            let _ = emit_tx.send(snap);
        });

        // 阶段 1：干净工作区
        worker.check();
        let first = emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("initial check should emit");
        assert_eq!(first.entries.len(), 0);

        // 阶段 2：折叠目录入场（此阶段 porcelain 字符串确实变化，闸门放行属正常路径）
        let burst = tmp.path().join("burst");
        std::fs::create_dir_all(&burst).unwrap();
        std::fs::write(burst.join("f0.txt"), "x\n").unwrap();
        worker.check();
        let with_dir = emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("collapsed dir should emit");
        assert_eq!(with_dir.entries.len(), 1, "折叠语义：1 条目录条目");
        assert!(with_dir.entries[0].is_dir);
        assert_eq!(with_dir.entries[0].path, std::path::PathBuf::from("burst"));

        // 阶段 3：同一批次内在**已折叠**的目录里再建 10 个文件（其间不发 check）——
        // porcelain 字符串始终是 `?? burst/`，只有目录内容变了
        for i in 1..=10 {
            std::fs::write(burst.join(format!("f{i}.txt")), "x\n").unwrap();
        }
        worker.check();
        let snap = emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("折叠目录内部的风暴必须产出快照（当前实现：porcelain 不变 → 被闸门吞掉）");
        assert_eq!(
            snap.entries.len(),
            1,
            "折叠语义：11 个文件仍是 1 条目录条目"
        );
        assert!(snap.entries[0].is_dir, "折叠目录条目必须携带 is_dir");

        // 同一批次不得二次 emit（风暴不放大为多次快照）
        match emit_rx.recv_timeout(Duration::from_millis(300)) {
            Ok(extra) => panic!(
                "同一批次不得二次 emit，got unexpected emit v{}",
                extra.version
            ),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(e) => panic!("unexpected recv error: {e}"),
        }
    }

    /// G2 验收标准的自动化替身（redesign-plan §3.7「压测：高频 touch + 心跳并发 +
    /// 切分支 → 零丢失、零回退」）。确定性化：并发信号风暴打在未变更工作区上
    /// （不得产生任何 emit），随后单次实质变更与切分支各产生恰好一份新快照；
    /// 最终快照与 `git status --porcelain` 真值逐条一致。
    #[test]
    fn worker_stress_concurrent_signals_churn_and_branch_switch() {
        use std::sync::Arc;
        use std::time::Duration;

        let (tmp, repo) = create_repo_with_commit();
        let (emit_tx, emit_rx) = mpsc::channel::<GitStatusSnapshot>();
        let worker = GitStatusWorker::start(main_ref(tmp.path()), move |snap| {
            let _ = emit_tx.send(snap);
        });

        // 初始快照（干净工作区）
        worker.check();
        let first = emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("initial check should emit");
        assert_eq!(first.branch, repo.head().unwrap().shorthand().unwrap());

        // 并发信号风暴（4 线程 × 50 次 check，模拟 watcher/index/心跳同时触发）：
        // 内容未变 → 不得产生任何新 emit（查询-比较闸门在并发下同样生效）
        let worker_arc = Arc::new(worker.clone());
        let handles: Vec<_> = (0..4)
            .map(|_| {
                let w = Arc::clone(&worker_arc);
                std::thread::spawn(move || {
                    for _ in 0..50 {
                        w.check();
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().expect("storm thread should not panic");
        }
        match emit_rx.recv_timeout(Duration::from_millis(500)) {
            Ok(snap) => panic!(
                "unchanged-content storm must not emit, got unexpected emit v{}",
                snap.version
            ),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(e) => panic!("unexpected recv error: {e}"),
        }

        // 实质变更（modify tracked + add untracked）→ 恰好一份新快照
        std::fs::write(tmp.path().join("README.md"), "# changed\n").unwrap();
        std::fs::write(tmp.path().join("extra.txt"), "untracked\n").unwrap();
        worker.check();
        let after_churn = emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("churn should emit");
        assert_eq!(after_churn.entries.len(), 2);

        // 切分支 → 分支变化触发一份新快照
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature-stress", &head, false).unwrap();
        repo.set_head("refs/heads/feature-stress").unwrap();
        worker.check();
        let after_switch = emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("branch switch should emit");
        assert_eq!(after_switch.branch, "feature-stress");

        // 最终一致：快照 entries 与 porcelain 真值逐条一致（同一解析入口）
        let output = std::process::Command::new("git")
            .args(["-C", tmp.path().to_str().unwrap(), "status", "--porcelain"])
            .output()
            .expect("git should be available (worker itself shells out to git)");
        let truth = parse_porcelain(&String::from_utf8_lossy(&output.stdout));
        assert_eq!(after_switch.entries.len(), truth.len());
        for (entry, truth_entry) in after_switch.entries.iter().zip(truth.iter()) {
            assert_eq!(entry.path, truth_entry.path);
            assert_eq!(entry.status, truth_entry.status);
        }
    }

    // ── ahead/behind 并入权威快照（第三类输入：refs）────────────────────

    /// 运行 git CLI 并从 `-C <dir>` 起。（测试专用：生产路径一律走 exec facade / transport。）
    fn git_run(dir: &std::path::Path, args: &[&str]) -> String {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("git should be available (worker itself shells out to git)");
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    /// 建一个带 `@{upstream}` 的本地仓库（bare origin + 首个提交已 push）。
    /// 返回 `(TempDir, work_dir)`；`TempDir` 必须随返回保持存活。
    fn create_repo_with_upstream() -> (tempfile::TempDir, std::path::PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let remote = tmp.path().join("origin.git");
        std::fs::create_dir_all(&remote).unwrap();
        git_run(&remote, &["init", "--bare"]);

        let work = tmp.path().join("work");
        let repo = git2::Repository::init(&work).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        std::fs::write(work.join("README.md"), "# Test\n").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("README.md")).unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
                .unwrap();
        }
        git_run(
            &work,
            &["remote", "add", "origin", &remote.to_string_lossy()],
        );
        git_run(&work, &["push", "--set-upstream", "origin", "HEAD"]);
        (tmp, work)
    }

    fn commit_a_file(dir: &std::path::Path, name: &str) {
        std::fs::write(dir.join(name), "x\n").unwrap();
        git_run(dir, &["add", name]);
        git_run(
            dir,
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

    fn upstream_ref(dir: &std::path::Path) -> String {
        let short = git_run(
            dir,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
        );
        format!("refs/remotes/{short}")
    }

    /// R3.1：无 upstream（普通本地仓库）→ `(0, 0)`，不是错误。
    #[test]
    fn ahead_behind_is_zero_without_upstream() {
        let (tmp, _repo) = create_repo_with_commit();
        assert_eq!(ahead_behind(&main_ref(tmp.path())), (0, 0));
    }

    /// R1.2 / R3.1：本地领先 upstream 一个提交 → `(1, 0)`。
    #[test]
    fn ahead_behind_counts_local_commits_ahead() {
        let (_tmp, work) = create_repo_with_upstream();
        commit_a_file(&work, "ahead.txt");
        assert_eq!(ahead_behind(&main_ref(&work)), (1, 0));
    }

    /// R1.2 / R3.1：upstream 领先 HEAD → `(0, 1)`。
    #[test]
    fn ahead_behind_counts_upstream_commits_behind() {
        let (_tmp, work) = create_repo_with_upstream();
        commit_a_file(&work, "ahead.txt");
        let c2 = git_run(&work, &["rev-parse", "HEAD"]);
        // remote-tracking 前进到 c2，再把 HEAD（与本地分支）退回 c1
        git_run(&work, &["update-ref", &upstream_ref(&work), &c2]);
        git_run(&work, &["reset", "--hard", "HEAD~1"]);
        assert_eq!(ahead_behind(&main_ref(&work)), (0, 1));
    }

    /// **回归钉子（R4.1）**：外部 push 只改写 remote-tracking ref，workdir / HEAD / index
    /// 一字未动。change gate 不纳入 ahead/behind 时这份快照永不 emit —— 这正是「↑N 徽标
    /// 无界陈旧」的根因。用 `commit-tree`+`update-ref` 构造纯 ref 变化（不触碰工作区）。
    #[test]
    fn worker_emits_new_snapshot_on_pure_ref_change() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (_tmp, work) = create_repo_with_upstream();
        let (emit_tx, emit_rx) = mpsc::channel::<GitStatusSnapshot>();
        let worker = GitStatusWorker::start(main_ref(&work), move |snap| {
            let _ = emit_tx.send(snap);
        });

        worker.check();
        let first = emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("baseline snapshot");
        assert_eq!((first.ahead, first.behind), (0, 0));

        // 纯 ref 变化：只前进 remote-tracking，HEAD / index / workdir 全不动
        let tree = git_run(&work, &["rev-parse", "HEAD^{tree}"]);
        let parent = git_run(&work, &["rev-parse", "HEAD"]);
        let upstream_only = git_run(
            &work,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@test.com",
                "commit-tree",
                &tree,
                "-p",
                &parent,
                "-m",
                "upstream only",
            ],
        );
        git_run(&work, &["update-ref", &upstream_ref(&work), &upstream_only]);

        worker.check();
        let second = emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("纯 ref 变化必须 emit（change gate 必须纳入 ahead/behind）");
        // version 由注册表（store_snapshot）统一盖章，worker 侧快照恒为占位 0：
        // 本用例的判据是「纯 ref 变化确实产出了一份新快照」+ ahead/behind 正确。
        assert_eq!((second.ahead, second.behind), (0, 1));
    }
}
