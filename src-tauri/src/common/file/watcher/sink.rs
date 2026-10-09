//! watcher 的**唯一事件出口**（依赖倒置点）。
//!
//! 为什么需要它：
//! - **可测性**：事件出口原本直接是 `AppHandle::emit`，散布在 notify 回调闭包、debounce 线程、
//!   worker 回调、git-meta 回调里 ⇒ 生命周期契约（「unwatch 后不再投递」）无法在无 GUI 的
//!   `cargo test` 中断言，只能靠人肉看日志 —— 这类契约没有 CI 守护必然回归（2026-09-24
//!   实测：单次文件变更被 emit 3 次，见任务 `09-24-watcher-lifecycle-and-git-lock`）。
//! - **低耦合**：watcher 内部不再依赖 Tauri `AppHandle`；只有本文件的 [`AppHandleSink`]
//!   接触 `AppHandle::emit` ⇒ 换传输层（例如未来走 IPC 直连）只改一个适配器。
//! - **高内聚**：事件名常量（`types.rs`，红线 5）与出口在同一处收口 —— 变体→事件名的映射
//!   由 [`WatcherEvent::name`] **单点承载**（纯数据，可无 GUI 断言），两个 sink 都只消费它，
//!   不会出现「同名映射写两份、常量错配却编译通过」。
//!
//! 形态选择：**枚举 + 单方法**而非「每个事件一个方法」。本仓约定「策略集已知且固定时用
//! `Enum + match`」（AGENTS.md 开闭原则）—— 新增事件时编译器会强制所有 match 分支处理，
//! 而 trait 多方法只是各加一个方法，容易漏接。

use tauri::{AppHandle, Emitter};

use super::types::{
    FileChangedEvent, FileTreeChangedEvent, GitChangedEvent, GitPerfSuggestionEvent,
    FILE_CHANGED_EVENT, FILE_TREE_CHANGED_EVENT, GIT_CHANGED_EVENT, GIT_PERF_SUGGESTION_EVENT,
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
    /// `git-changed`：某单元的 git 元数据变化提示（载荷含 workspace_key + project_id）
    GitChanged(&'a GitChangedEvent),
    /// `git-status-snapshot`：versioned 全量 status 快照
    StatusSnapshot(&'a GitStatusSnapshot),
    /// `git-perf-suggestion`：一次性性能建议
    PerfSuggestion(&'a GitPerfSuggestionEvent),
}

impl WatcherEvent<'_> {
    /// 变体 → 事件名（**唯一映射源**；红线 5 的常量在此收口）。
    ///
    /// 生产适配器 [`AppHandleSink`] 需要真实 `AppHandle`、无法在 `cargo test` 中投递，
    /// 故「变体→事件名」必须是一段可独立断言的纯数据（本方法），而非散落在适配器分支里
    /// 各自硬编码的字面量。
    #[must_use]
    pub(crate) const fn name(&self) -> &'static str {
        match self {
            Self::FileChanged(_) => FILE_CHANGED_EVENT,
            Self::TreeChanged(_) => FILE_TREE_CHANGED_EVENT,
            Self::GitChanged(_) => GIT_CHANGED_EVENT,
            Self::StatusSnapshot(_) => GIT_STATUS_SNAPSHOT_EVENT,
            Self::PerfSuggestion(_) => GIT_PERF_SUGGESTION_EVENT,
        }
    }
}

/// watcher 事件出口。生产实现见 [`AppHandleSink`]；测试注入收集器。
pub trait WatcherEventSink: Send + Sync + 'static {
    /// 投递一个事件（实现不应对失败 panic —— 事件是尽力而为的副作用）。
    fn emit(&self, event: WatcherEvent<'_>);
}

/// 生产适配器：把 watcher 事件转发到 Tauri 前端。
///
/// **本文件是 watcher 域唯一接触 `AppHandle::emit` 的地方**。事件名映射由
/// [`WatcherEvent::name`] 单点提供；本适配器只做**载荷路由**（不含任何事件名字面量）。
/// 载荷类型异构且 `serde::Serialize` 非 dyn-compatible，故路由无法进一步擦除。
pub struct AppHandleSink {
    app: AppHandle,
}

impl AppHandleSink {
    /// 以给定 `AppHandle` 构造出口（组合根调用，见 `project/commands.rs`）。
    #[must_use]
    pub const fn new(app: AppHandle) -> Self {
        Self { app }
    }

    /// 投递单个载荷。失败（窗口已关闭等）不构成错误 —— 与改造前的 `let _ = ...emit(...)` 一致。
    fn emit_payload<S: serde::Serialize + Clone>(&self, name: &str, payload: S) {
        let _ = self.app.emit(name, payload);
    }
}

impl WatcherEventSink for AppHandleSink {
    fn emit(&self, event: WatcherEvent<'_>) {
        // 事件名先取（单一源）；下面的 match 只负责用各自的静态类型拆出载荷。
        let name = event.name();
        match event {
            WatcherEvent::FileChanged(payload) => self.emit_payload(name, payload),
            WatcherEvent::TreeChanged(payload) => self.emit_payload(name, payload),
            WatcherEvent::GitChanged(payload) => self.emit_payload(name, payload),
            WatcherEvent::StatusSnapshot(payload) => self.emit_payload(name, payload),
            WatcherEvent::PerfSuggestion(payload) => self.emit_payload(name, payload),
        }
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    //! 测试用事件出口：生命周期契约测试（`manager/lifecycle_tests.rs`）的观测口。

    use super::{WatcherEvent, WatcherEventSink};
    use crate::common::file::watcher::types::{
        FILE_CHANGED_EVENT, GIT_CHANGED_EVENT, GIT_STATUS_SNAPSHOT_EVENT,
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
            // 复用 `WatcherEvent::name()`（单一映射源），替身不再持有第二份映射。
            if let Ok(mut events) = self.events.lock() {
                events.push(event.name().to_string());
            }
        }
    }

    #[test]
    fn collecting_sink_records_event_names() {
        use super::super::types::FileChangedEvent;

        // 夹具也不手拼 key：身份一律由 WorkspaceRef 产出（护栏判据 6 对测试支撑代码同样生效）
        let repo = crate::common::git::WorkspaceRef::main("p1", "/repo");
        let sink = CollectingSink::new();
        let payload = FileChangedEvent {
            workspace_key: repo.key(),
            project_id: "p1".into(),
            paths: vec!["a.txt".into()],
        };
        sink.emit(WatcherEvent::FileChanged(&payload));
        sink.emit(WatcherEvent::GitChanged(
            &crate::common::file::watcher::types::GitChangedEvent::new(&repo),
        ));

        assert_eq!(sink.count(FILE_CHANGED_EVENT), 1);
        assert_eq!(sink.count(GIT_CHANGED_EVENT), 1);
        assert_eq!(sink.count(GIT_STATUS_SNAPSHOT_EVENT), 0);
    }
}

#[cfg(test)]
mod tests {
    //! 变体→事件名的**单一事实源**测试 —— 无需 `AppHandle`，也无需测试替身。

    use super::*;

    /// 五个变体的夹具（身份一律由 `WorkspaceRef` 产出，不手拼 key）。
    struct Fixtures {
        file_changed: FileChangedEvent,
        tree_changed: FileTreeChangedEvent,
        git_changed: GitChangedEvent,
        snapshot: GitStatusSnapshot,
        perf: GitPerfSuggestionEvent,
    }

    impl Fixtures {
        fn new() -> Self {
            let repo = crate::common::git::WorkspaceRef::main("p1", "/repo");
            Self {
                file_changed: FileChangedEvent {
                    workspace_key: repo.key(),
                    project_id: "p1".into(),
                    paths: vec!["a.txt".into()],
                },
                tree_changed: FileTreeChangedEvent {
                    workspace_key: repo.key(),
                    project_id: "p1".into(),
                    dirs: vec!["src".into()],
                },
                git_changed: GitChangedEvent::new(&repo),
                snapshot: GitStatusSnapshot::for_unit(&repo, 1),
                perf: GitPerfSuggestionEvent {
                    workspace_key: repo.key(),
                    project_id: "p1".into(),
                    suggestions: Vec::new(),
                },
            }
        }
    }

    /// 每个变体必须映射到前端 `shared/events.ts` 声明的 **wire 字符串**。
    ///
    /// 断言用字面量而非常量：同时钉死「变体→常量」与「常量→wire 字符串」两段链路。
    /// 生产适配器 `AppHandleSink` 需要真实 `AppHandle`、无法在 `cargo test` 中投递，
    /// 其映射正确性只由本测试经 `name()` 单点保证。
    #[test]
    fn every_variant_maps_to_its_wire_event_name() {
        let f = Fixtures::new();
        assert_eq!(
            WatcherEvent::FileChanged(&f.file_changed).name(),
            "file-changed"
        );
        assert_eq!(
            WatcherEvent::TreeChanged(&f.tree_changed).name(),
            "file-tree-changed"
        );
        assert_eq!(
            WatcherEvent::GitChanged(&f.git_changed).name(),
            "git-changed"
        );
        assert_eq!(
            WatcherEvent::StatusSnapshot(&f.snapshot).name(),
            "git-status-snapshot"
        );
        assert_eq!(
            WatcherEvent::PerfSuggestion(&f.perf).name(),
            "git-perf-suggestion"
        );
    }
}
