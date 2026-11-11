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

    /// 该事件**归属的单元**（载荷身份的唯一映射源，与 [`Self::name`] 对称）。
    ///
    /// 为什么归属必须由事件类型自己给出：批量入口（`activate_many` / `reconcile_mounted`）
    /// 一次只注入**一个**端口给整批单元 —— 端口观察到的事实永远是「这批里某个单元发生了
    /// 某事」。归属一旦由观测口猜（或干脆不记），「B 的首份快照」就会被当成「A 已就绪」的
    /// 证据：2026-11 Windows CI `declaring_two_units_mounts_both` 的假失败就是该形态
    /// （A 的冷窗口超时是**合法** `Pending`，B 的推送先到）。
    ///
    /// 五个变体的载荷都带 `workspace_key`，因此这里是无分支的单点映射 —— 新增变体时
    /// 编译器会强制补上归属，不会出现「新事件忘了带身份」。
    ///
    /// `#[cfg(test)]`：唯一消费方是测试观测口（`test_support::CollectingSink`）。
    /// 生产适配器直接路由载荷，不需要它；放进生产面只会得到一个 `dead_code`。
    #[cfg(test)]
    #[must_use]
    pub(crate) fn workspace_key(&self) -> &str {
        match self {
            Self::FileChanged(payload) => &payload.workspace_key,
            Self::TreeChanged(payload) => &payload.workspace_key,
            Self::GitChanged(payload) => &payload.workspace_key,
            Self::StatusSnapshot(payload) => &payload.workspace_key,
            Self::PerfSuggestion(payload) => &payload.workspace_key,
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
    //!
    //! **归属是观测口的一等字段**（两条结构性约束，不是约定）：
    //! 1. 每次投递记录 `(事件名, 归属单元)` —— 归属唯一来源是 [`WatcherEvent::workspace_key`]；
    //! 2. 查询与等待**只能按单元**（[`CollectingSink::count_for`] / [`CollectingSink::names_for`]
    //!    / [`wait_for_unit_event`]）。刻意**不提供**「有没有任意事件」这种无归属判据：
    //!    批量入口给整批单元注入同一个端口，无归属判据会把别单元的事件当成自己的收敛
    //!    证据（2026-11 Windows CI 假失败的形态）。护栏 `check_event_wait_attribution`
    //!    钉住这两条 —— 想加回一个 `count(name)` 便捷方法，门禁会红。

    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use super::{WatcherEvent, WatcherEventSink};
    use crate::common::file::watcher::types::{
        FILE_CHANGED_EVENT, GIT_CHANGED_EVENT, GIT_STATUS_SNAPSHOT_EVENT,
    };

    /// 一次被记录的投递：事件名 + 归属单元（缺一不可）。
    #[derive(Clone)]
    struct Recorded {
        name: &'static str,
        workspace_key: String,
    }

    /// 收集事件（**带归属**）的 sink：契约断言关心「哪个单元、什么事件、几次」。
    #[derive(Default)]
    pub(crate) struct CollectingSink {
        events: Mutex<Vec<Recorded>>,
    }

    impl CollectingSink {
        pub(crate) fn new() -> Arc<Self> {
            Arc::new(Self::default())
        }

        /// 指定单元收到的事件名序列（保序；用于诊断输出与「一条都不许有」的负断言）。
        pub(crate) fn names_for(&self, workspace_key: &str) -> Vec<String> {
            self.recorded()
                .iter()
                .filter(|event| event.workspace_key == workspace_key)
                .map(|event| event.name.to_string())
                .collect()
        }

        /// 指定单元某事件名的累计次数（差分式断言：与运行时基线比较）。
        pub(crate) fn count_for(&self, workspace_key: &str, name: &str) -> usize {
            self.recorded()
                .iter()
                .filter(|event| event.workspace_key == workspace_key && event.name == name)
                .count()
        }

        fn recorded(&self) -> Vec<Recorded> {
            self.events.lock().map(|e| e.clone()).unwrap_or_default()
        }
    }

    impl WatcherEventSink for CollectingSink {
        fn emit(&self, event: WatcherEvent<'_>) {
            // 名字与归属都来自 `WatcherEvent` 自己的单点映射，替身不持有第二份映射。
            let recorded = Recorded {
                name: event.name(),
                workspace_key: event.workspace_key().to_string(),
            };
            if let Ok(mut events) = self.events.lock() {
                events.push(recorded);
            }
        }
    }

    /// 有界等待**指定单元**的某事件累计到 `at_least` 次。
    ///
    /// 唯一等待入口（`at_least = 1` 即「该单元至少投递过一次」，`baseline + 1` 即
    /// 「该单元又推送了一次」）。**不提供**不带 `workspace_key` 的重载：那正是把
    /// 「这批里有人发过事件」误当成「这个单元已收敛」的入口，而且它在同批多单元时
    /// 几乎总会先被别人的事件满足（慢机上就是假失败）。
    ///
    /// 阻塞轮询（25ms）：驱动方是 worker / watcher 的**OS 线程**，与此处是否 async 无关；
    /// async 用例里调用它不会卡住被测链路（`#[tokio::test]` 默认单线程运行时，被等待的
    /// 事件由独立线程产出）。
    pub(crate) fn wait_for_unit_event(
        sink: &CollectingSink,
        workspace_key: &str,
        name: &str,
        at_least: usize,
        timeout: Duration,
    ) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if sink.count_for(workspace_key, name) >= at_least {
                return true;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        false
    }

    /// 等**指定单元**的首份 `git-status-snapshot`（冷窗口语义下唯一的收敛证据）。
    ///
    /// 单列一个入口而不是让调用方自带事件名常量：`git-status-snapshot` 的语义
    /// （「该单元已有权威快照」）是跨域单测（git 服务层编排）最常用的一条，
    /// 名字写错就是一条永不满足的等待。
    pub(crate) fn wait_for_unit_snapshot(
        sink: &CollectingSink,
        workspace_key: &str,
        at_least: usize,
        timeout: Duration,
    ) -> bool {
        wait_for_unit_event(
            sink,
            workspace_key,
            GIT_STATUS_SNAPSHOT_EVENT,
            at_least,
            timeout,
        )
    }

    #[test]
    fn collecting_sink_attributes_events_to_their_unit() {
        use super::super::types::{FileChangedEvent, GitChangedEvent};

        // 夹具也不手拼 key：身份一律由 WorkspaceRef 产出（护栏判据 6 对测试支撑代码同样生效）
        let repo_a = crate::common::git::WorkspaceRef::main("p1", "/repo-a");
        let repo_b = crate::common::git::WorkspaceRef::main("p2", "/repo-b");
        let sink = CollectingSink::new();
        sink.emit(WatcherEvent::FileChanged(&FileChangedEvent {
            workspace_key: repo_a.key(),
            project_id: "p1".into(),
            paths: vec!["a.txt".into()],
        }));
        sink.emit(WatcherEvent::GitChanged(&GitChangedEvent::new(&repo_b)));

        assert_eq!(sink.count_for(&repo_a.key(), FILE_CHANGED_EVENT), 1);
        assert_eq!(sink.count_for(&repo_b.key(), GIT_CHANGED_EVENT), 1);
        // 交叉为零：A 的投递不记在 B 名下，反之亦然（本观测口存在的全部理由）
        assert_eq!(sink.count_for(&repo_a.key(), GIT_CHANGED_EVENT), 0);
        assert_eq!(sink.count_for(&repo_b.key(), FILE_CHANGED_EVENT), 0);
    }

    /// **本任务的回归钉子**：等 A 的等待**不得**被 B 的投递满足。
    ///
    /// 事故形态（2026-11 Windows CI）：等「A 的首份快照」的谓词是「收到任意事件」，
    /// 于是同批 B 的 `git-status-snapshot` 让等待立刻返回，而 A 的冷窗口（合法 `Pending`）
    /// 还在算 ⇒ `snapshot(&A)` 为 None ⇒ 假失败。
    #[test]
    fn waiting_for_one_unit_is_not_satisfied_by_another_units_event() {
        let repo_a = crate::common::git::WorkspaceRef::main("p1", "/repo-a");
        let repo_b = crate::common::git::WorkspaceRef::main("p2", "/repo-b");
        let sink = CollectingSink::new();
        sink.emit(WatcherEvent::StatusSnapshot(
            &crate::common::git::status_worker::GitStatusSnapshot::for_unit(&repo_b, 1),
        ));

        assert!(
            !wait_for_unit_event(
                &sink,
                &repo_a.key(),
                GIT_STATUS_SNAPSHOT_EVENT,
                1,
                Duration::from_millis(60)
            ),
            "B 的快照不得满足「等 A」——否则用例证明的不是它声称的事"
        );
        assert!(
            wait_for_unit_event(
                &sink,
                &repo_b.key(),
                GIT_STATUS_SNAPSHOT_EVENT,
                1,
                Duration::from_millis(60)
            ),
            "本单元的投递必须立即满足等待"
        );
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

    /// 每个变体必须能给出自己的**归属单元**（观测口归因的唯一来源，与 `name()` 对称）。
    ///
    /// 断言用 `repo.key()` 而不是字面量：归属的身份形态由 `WorkspaceRef` 单点定义
    /// （护栏判据 6），事件侧不得自带第二套拼接。
    #[test]
    fn every_variant_yields_its_unit_key() {
        let f = Fixtures::new();
        let key = crate::common::git::WorkspaceRef::main("p1", "/repo").key();
        for event in [
            WatcherEvent::FileChanged(&f.file_changed),
            WatcherEvent::TreeChanged(&f.tree_changed),
            WatcherEvent::GitChanged(&f.git_changed),
            WatcherEvent::StatusSnapshot(&f.snapshot),
            WatcherEvent::PerfSuggestion(&f.perf),
        ] {
            assert_eq!(
                event.workspace_key(),
                key,
                "{} 的归属必须来自载荷",
                event.name()
            );
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
