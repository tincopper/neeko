//! watcher 的**唯一事件出口**（依赖倒置点）。
//!
//! 为什么需要它：
//! - **可测性**：事件出口原本直接是 `AppHandle::emit`，散布在 notify 回调闭包、debounce 线程、
//!   worker 回调、git-meta 回调里 ⇒ 生命周期契约（「unwatch 后不再投递」）无法在无 GUI 的
//!   `cargo test` 中断言，只能靠人肉看日志 —— 这类契约没有 CI 守护必然回归（2026-09-24
//!   实测：单次文件变更被 emit 3 次，见任务 `09-24-watcher-lifecycle-and-git-lock`）。
//! - **低耦合**：watcher 内部不再依赖 Tauri `AppHandle`；只有本文件的 [`AppHandleSink`]
//!   接触 `AppHandle::emit` ⇒ 换传输层（例如未来走 IPC 直连）只改一个适配器。
//! - **高内聚**：事件名常量（`types.rs`，红线 5）与出口在同一处收口，新增事件必须同时
//!   实现枚举分支与常量映射，不会出现「事件名漏配」。
//!
//! 形态选择：**枚举 + 单方法**而非「每个事件一个方法」。本仓约定「策略集已知且固定时用
//! `Enum + match`」（AGENTS.md 开闭原则）—— 新增事件时编译器会强制所有 match 分支处理，
//! 而 trait 多方法只是各加一个方法，容易漏接。

use tauri::{AppHandle, Emitter};

use super::types::{
    FileChangedEvent, FileTreeChangedEvent, GitPerfSuggestionEvent, FILE_CHANGED_EVENT,
    FILE_TREE_CHANGED_EVENT, GIT_CHANGED_EVENT, GIT_PERF_SUGGESTION_EVENT,
};
use crate::common::file::watcher::types::GIT_STATUS_SNAPSHOT_EVENT;
use crate::common::git::status_worker::GitStatusSnapshot;

/// watcher 可能投递的事件集合。
///
/// 借用形式避免每处 emit 都克隆 payload（事件量大时降低分配压力）。
pub enum WatcherEvent<'a> {
    /// `file-changed`：内容事件批次（路径列表）
    FileChanged(&'a FileChangedEvent),
    /// `file-tree-changed`：结构事件（受影响目录集合）
    TreeChanged(&'a FileTreeChangedEvent),
    /// `git-changed`：worktree / 外部 git 状态变化（载荷为 project_id）
    GitChanged(&'a str),
    /// `git-status-snapshot`：versioned 全量 status 快照
    StatusSnapshot(&'a GitStatusSnapshot),
    /// `git-perf-suggestion`：一次性性能建议
    PerfSuggestion(&'a GitPerfSuggestionEvent),
}

/// watcher 事件出口。生产实现见 [`AppHandleSink`]；测试注入收集器。
pub trait WatcherEventSink: Send + Sync + 'static {
    /// 投递一个事件（实现不应对失败 panic —— 事件是尽力而为的副作用）。
    fn emit(&self, event: WatcherEvent<'_>);
}

/// 生产适配器：把 watcher 事件转发到 Tauri 前端。
///
/// **本文件是 watcher 域唯一接触 `AppHandle::emit` 的地方** —— 新增事件只需在此补一个分支。
pub struct AppHandleSink {
    app: AppHandle,
}

impl AppHandleSink {
    /// 以给定 `AppHandle` 构造出口（组合根调用，见 `project/commands.rs`）。
    #[must_use]
    pub const fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl WatcherEventSink for AppHandleSink {
    fn emit(&self, event: WatcherEvent<'_>) {
        // 事件投递失败（窗口已关闭等）不构成错误：与改造前的 `let _ = ...emit(...)` 语义一致
        match event {
            WatcherEvent::FileChanged(payload) => {
                let _ = self.app.emit(FILE_CHANGED_EVENT, payload);
            }
            WatcherEvent::TreeChanged(payload) => {
                let _ = self.app.emit(FILE_TREE_CHANGED_EVENT, payload);
            }
            WatcherEvent::GitChanged(project_id) => {
                let _ = self.app.emit(GIT_CHANGED_EVENT, project_id);
            }
            WatcherEvent::StatusSnapshot(payload) => {
                let _ = self.app.emit(GIT_STATUS_SNAPSHOT_EVENT, payload);
            }
            WatcherEvent::PerfSuggestion(payload) => {
                let _ = self.app.emit(GIT_PERF_SUGGESTION_EVENT, payload);
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    //! 测试用事件出口：生命周期契约测试（`manager/lifecycle_tests.rs`）的观测口。

    use super::{WatcherEvent, WatcherEventSink};
    use crate::common::file::watcher::types::{
        FILE_CHANGED_EVENT, FILE_TREE_CHANGED_EVENT, GIT_CHANGED_EVENT, GIT_PERF_SUGGESTION_EVENT,
        GIT_STATUS_SNAPSHOT_EVENT,
    };
    use std::sync::{Arc, Mutex};

    /// 收集事件名的 sink（只记事件名：契约断言关心"有没有、几次"，不关心载荷）。
    #[derive(Default)]
    pub(crate) struct CollectingSink {
        events: Mutex<Vec<String>>,
    }

    impl CollectingSink {
        pub(crate) fn new() -> Arc<Self> {
            Arc::new(Self::default())
        }

        /// 已收到的事件名序列。
        pub(crate) fn event_names(&self) -> Vec<String> {
            self.events.lock().map(|e| e.clone()).unwrap_or_default()
        }

        /// 某一事件名的累计次数（契约测试按时间窗比较前后差值）。
        pub(crate) fn count(&self, name: &str) -> usize {
            self.event_names().iter().filter(|n| *n == name).count()
        }
    }

    impl WatcherEventSink for CollectingSink {
        fn emit(&self, event: WatcherEvent<'_>) {
            let name = match event {
                WatcherEvent::FileChanged(_) => FILE_CHANGED_EVENT,
                WatcherEvent::TreeChanged(_) => FILE_TREE_CHANGED_EVENT,
                WatcherEvent::GitChanged(_) => GIT_CHANGED_EVENT,
                WatcherEvent::StatusSnapshot(_) => GIT_STATUS_SNAPSHOT_EVENT,
                WatcherEvent::PerfSuggestion(_) => GIT_PERF_SUGGESTION_EVENT,
            };
            if let Ok(mut events) = self.events.lock() {
                events.push(name.to_string());
            }
        }
    }

    #[test]
    fn collecting_sink_records_event_names() {
        use super::super::types::FileChangedEvent;

        let sink = CollectingSink::new();
        let payload = FileChangedEvent {
            project_id: "p1".into(),
            paths: vec!["a.txt".into()],
        };
        sink.emit(WatcherEvent::FileChanged(&payload));
        sink.emit(WatcherEvent::GitChanged("p1"));

        assert_eq!(sink.count(FILE_CHANGED_EVENT), 1);
        assert_eq!(sink.count(GIT_CHANGED_EVENT), 1);
        assert_eq!(sink.count(GIT_STATUS_SNAPSHOT_EVENT), 0);
    }
}
