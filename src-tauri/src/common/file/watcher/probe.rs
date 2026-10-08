//! 非确定性域（真实异步事件源）的**受祝福观察原语**：闭包回调形态。
//!
//! 为什么需要它（第一性原理）：真实源（OS 文件事件 / 进程 / 时钟 / 调度）只承诺「至少一次」
//! 可达，**不承诺事件集合精确**。但裸 `Arc<AtomicUsize>` 把「命中计数」暴露给测试，于是
//! 「写 index 不得触发 refs 回调 → `assert_eq!(refs.load(..), 0)`」这类**绝对零断言**随手
//! 就能写出来，并在 Windows `ReadDirectoryChangesW` 的目录级事件下必挂（2026-10-08 事故）。
//!
//! 本原语只回答一个问题：「回调**到达过**吗」——正向只有这一种写法；计数被封在内部，
//! 没有 `count()` / `hits()` 访问器 ⇒ 绝对零 / 精确集合断言在该原语上**没有对应 API**。
//! 负向分类断言下沉纯函数层，生命周期负向改差分式，见
//! `.trellis/spec/unit-test/real-source-determinism.md`。
//!
//! 形态边界：probe 服务于「闭包回调」；sink 形态（[`super::sink`] 的 `CollectingSink`）
//! 保持既有原语，本模块不触碰它。

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// 观察一个闭包回调是否被调用过：只暴露「到达」语义，不暴露命中计数。
pub(crate) struct CallbackProbe {
    hits: Arc<AtomicUsize>,
}

impl CallbackProbe {
    pub(crate) fn new() -> Self {
        Self {
            hits: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// 产出一个可传给 watcher 构造器（如 `create_git_meta_watcher`）的回调。
    ///
    /// 每次调用都是一个独立闭包，共享同一份内部计数。
    pub(crate) fn callback(&self) -> impl FnMut() + Send + 'static {
        let hits = Arc::clone(&self.hits);
        move || {
            hits.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// 有界轮询：反复 `poke`（可重试写入，覆盖 notify 未就绪时首事件丢失的自愈语义），
    /// 直到回调至少命中一次。
    ///
    /// 只回答「到达过」——没有 `count()` / `hits()`，绝对零写法在此无从表达。
    /// 返回 `true` 表示在 `timeout` 内到达过；`false` 表示超时仍未到达。
    pub(crate) fn wait_reached(&self, timeout: Duration, mut poke: impl FnMut()) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            poke();
            if self.hits.load(Ordering::SeqCst) > 0 {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }
}
