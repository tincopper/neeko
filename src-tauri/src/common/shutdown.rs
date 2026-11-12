//! 进程退出前的后台清理编排（**机制**，与领域无关）。
//!
//! 为什么在 `common`：组合根只负责声明"要清理哪些域"（任务表），而"怎么并行清理、怎么打点、
//! 何时退出进程"是纯机制。此前这段机制与任务表混在 `app_state.rs` 里，使组合根同时承担
//! 编排与线程控制两件事。
//!
//! 退出路径的原则：**任何失败都只记日志，绝不阻断退出** —— 清理卡住比不清理更糟。
//!
//! 两阶段：`tasks`（各域自己收尾，可并行）结束之后才跑 `finalizers`（对**所有**域生效的
//! 收割器，如整树 SIGKILL）。顺序必须是"先优雅、后收割"：收割器毫秒级到达，而优雅域
//! （LSP 的 Eclipse checkpoint）要秒级 —— 并行会让每次退出都截断在途写入。

use std::time::Instant;

/// 待清理的后端：名称（用于日志与线程名）+ 一次性清理闭包。
pub type CleanupTask = (&'static str, Box<dyn FnOnce() + Send>);

/// 两阶段清理，**不退出进程**（可被单测直接驱动）。
///
/// 阶段语义：
/// 1. `tasks`：各域并行收尾，逐个 join 并打点；
/// 2. `finalizers`：**全部** task 结束之后才启动，同样逐个 join 并打点。
///
/// 机制要点：
/// - 每个任务独立线程（`shutdown-<name>`），便于崩溃栈定位；
/// - 单路 spawn 失败 / 任务 panic 都只记日志，不阻断其余清理。
pub fn run_cleanup_phases(tasks: Vec<CleanupTask>, finalizers: Vec<CleanupTask>) {
    log::info!("shutdown_all_background start");
    let start = Instant::now();

    // 阶段 1：各域自己收尾（可并行 —— 它们互不依赖，且都不做整树收割）。
    run_batch(tasks);

    // 阶段 2：收割器。此处才允许 SIGKILL 整棵树。
    if !finalizers.is_empty() {
        log::info!(
            "shutdown_all_background: all tasks done in {:?}, running {} finalizer(s)",
            start.elapsed(),
            finalizers.len()
        );
        run_batch(finalizers);
    }

    log::info!("shutdown_all_background finished in {:?}", start.elapsed());
}

/// 并行跑一批清理任务：每个任务独立线程，逐个 join 并打点耗时。
///
/// 单路 spawn 失败 / 任务 panic 都只记日志，不阻断其余清理（退出不能被清理卡住）。
fn run_batch(batch: Vec<CleanupTask>) {
    let mut handles = Vec::with_capacity(batch.len());
    for (name, task) in batch {
        let task_start = Instant::now();
        match std::thread::Builder::new()
            .name(format!("shutdown-{name}"))
            .spawn(task)
        {
            Ok(handle) => handles.push((name, task_start, handle)),
            // 单路 spawn 失败仅记日志，不阻断其余清理
            Err(e) => log::error!("{} cleanup spawn failed: {:?}", name, e),
        }
    }

    for (name, task_start, handle) in handles {
        match handle.join() {
            Ok(()) => {
                log::info!("{} cleanup finished in {:?}", name, task_start.elapsed());
            }
            Err(e) => log::error!("{} cleanup failed: {:?}", name, e),
        }
    }
}

/// 两阶段清理，结束后 `std::process::exit(0)`。
///
/// 外层使用具名线程（`neeko-shutdown`），便于崩溃栈定位；spawn 失败仅记日志。
pub fn run_cleanup_and_exit(tasks: Vec<CleanupTask>, finalizers: Vec<CleanupTask>) {
    if std::thread::Builder::new()
        .name("neeko-shutdown".into())
        .spawn(move || {
            run_cleanup_phases(tasks, finalizers);
            log::info!("shutdown_all_background: exiting process");
            std::process::exit(0);
        })
        .is_err()
    {
        log::error!("Shutdown thread spawn failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    /// 顺序台账：记录每段清理的启动时刻（`Mutex` 而非日志，断言可读可控）。
    type Order = Arc<Mutex<Vec<&'static str>>>;

    fn push(order: &Order, name: &'static str) {
        order
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(name);
    }

    fn snapshot(order: &Order) -> Vec<&'static str> {
        order
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// T0-1（审计 lifecycle #1）：收割器（`git-children` 的整树 SIGKILL）必须等
    /// **所有**优雅域 task 收尾之后才启动。
    ///
    /// 事故形态：`kill_all_live` 与 `close_all_sessions` 并行跑 ⇒ SIGKILL 毫秒级到达，
    /// 而 LSP 的 Eclipse checkpoint 要秒级 ⇒ 每次退出都在 checkpoint 窗口内被截断，
    /// 把本任务刚修好的关闭协议原地作废。
    ///
    /// 判据：finalizer 启动那一刻，已完成任务数必须等于任务总数。用共享计数断言，
    /// 而不是在 finalizer 里 `assert!`（子线程 panic 会被 join 吞成一行日志）。
    #[test]
    fn finalizers_run_only_after_every_task_finished() {
        const TOTAL: usize = 3;
        let order: Order = Arc::new(Mutex::new(Vec::new()));
        let done = Arc::new(AtomicUsize::new(0));

        let mut tasks: Vec<CleanupTask> = Vec::new();
        for (i, name) in ["terminal", "watcher", "lsp"].into_iter().enumerate() {
            let order = Arc::clone(&order);
            let done = Arc::clone(&done);
            tasks.push((
                name,
                Box::new(move || {
                    push(&order, name);
                    // 制造一个明确的调度窗口（20ms，非秒级）：只要 finalizer 与 task
                    // 并行启动，它必然落在「慢任务尚未收尾」的时刻 —— 这正是被测缺陷。
                    if i == 0 {
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                    done.fetch_add(1, Ordering::SeqCst);
                }),
            ));
        }

        // finalizer 视角：启动那一刻已完成多少个 task（`MAX` = 从未运行）。
        let observed = Arc::new(AtomicUsize::new(usize::MAX));
        let finalizers: Vec<CleanupTask> = {
            let order = Arc::clone(&order);
            let done = Arc::clone(&done);
            let observed = Arc::clone(&observed);
            vec![(
                "git-children",
                Box::new(move || {
                    observed.store(done.load(Ordering::SeqCst), Ordering::SeqCst);
                    push(&order, "finalizer");
                }),
            )]
        };

        run_cleanup_phases(tasks, finalizers);

        assert_eq!(
            done.load(Ordering::SeqCst),
            TOTAL,
            "全部 task 都必须跑完: {:?}",
            snapshot(&order)
        );
        assert_eq!(
            observed.load(Ordering::SeqCst),
            TOTAL,
            "finalizer 只能在全部 task 完成后启动（否则整树 SIGKILL 会截断 LSP 的 \
             checkpoint，等价于回到「退出即硬杀」）: {:?}",
            snapshot(&order)
        );
        assert_eq!(
            snapshot(&order).last(),
            Some(&"finalizer"),
            "finalizer 必须是最后一段: {:?}",
            snapshot(&order)
        );
    }
}
