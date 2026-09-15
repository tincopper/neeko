//! 进程退出前的后台清理编排（**机制**，与领域无关）。
//!
//! 为什么在 `common`：组合根只负责声明"要清理哪些域"（任务表），而"怎么并行清理、怎么打点、
//! 何时退出进程"是纯机制。此前这段机制与任务表混在 `app_state.rs` 里，使组合根同时承担
//! 编排与线程控制两件事。
//!
//! 退出路径的原则：**任何失败都只记日志，绝不阻断退出** —— 清理卡住比不清理更糟。

use std::time::Instant;

/// 待清理的后端：名称（用于日志与线程名）+ 一次性清理闭包。
pub type CleanupTask = (&'static str, Box<dyn FnOnce() + Send>);

/// 并行执行各域清理任务，全部结束后 `std::process::exit(0)`。
///
/// 机制要点（原 `app_state.rs` 中的实现原样搬入，行为不变）：
/// - 外层使用具名线程（`neeko-shutdown`），便于崩溃栈定位；
/// - 每个任务独立线程（`shutdown-<name>`），逐个 join 并打点耗时；
/// - 单路 spawn 失败 / 任务 panic 都只记日志，不阻断其余清理与退出。
pub fn run_cleanup_and_exit(tasks: Vec<CleanupTask>) {
    // 外层清理线程：命名便于崩溃栈定位；spawn 失败仅记日志
    if std::thread::Builder::new()
        .name("neeko-shutdown".into())
        .spawn(move || {
            log::info!("shutdown_all_background start");
            let start = Instant::now();

            let mut handles = Vec::with_capacity(tasks.len());
            for (name, task) in tasks {
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

            // 逐个 join、逐个打点；panic 也只记日志不阻断退出
            for (name, task_start, handle) in handles {
                match handle.join() {
                    Ok(()) => {
                        log::info!("{} cleanup finished in {:?}", name, task_start.elapsed());
                    }
                    Err(e) => log::error!("{} cleanup failed: {:?}", name, e),
                }
            }

            log::info!(
                "shutdown_all_background finished in {:?}, exiting",
                start.elapsed()
            );
            std::process::exit(0);
        })
        .is_err()
    {
        log::error!("Shutdown thread spawn failed");
    }
}
