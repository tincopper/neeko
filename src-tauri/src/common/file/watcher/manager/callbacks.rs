//! notify 事件回调构建：事件分类、gitignore 规则热重载、debounce / 维护消息投递。
//!
//! 闭包体从 `WatcherManager::watch` 抽离为独立构建函数，使组装编排保持精简；
//! 全部依赖经参数显式注入（move 捕获语义与原实现一致）。

use super::super::debounce::TreeChangeMsg;
use super::super::git_meta::{dispatch_git_meta_event, GitMetaPaths};
use super::super::gitignore::GitIgnoreFilter;
use super::super::registration::WatchMaintenance;
use super::super::sink::{WatcherEvent, WatcherEventSink};
use super::super::types::FileTreeChangedEvent;
use super::classify::{relevant_event_paths, structure_event_paths};
use crate::common::git::WorkspaceRef;
use notify::event::ModifyKind;
use notify::{Event, EventKind};
use std::path::PathBuf;
use std::sync::{mpsc, Arc};

/// 构建 notify 事件回调（`RecommendedWatcher::new` 的事件处理闭包）。
///
/// - 错误事件（overflow 等）：无法保证目录缓存一致 → 发送空 `dirs` 的
///   tree-changed，前端退回全树刷新（orca 同款 overflow→full refresh 语义）；
/// - `.gitignore` / `.git/info/exclude` 变更：热重载过滤规则 + 失效远程
///   ignored 缓存 + 失效读层现场构建的过滤器缓存 + 注册层全量重算 +
///   请求全量树刷新（`TreeChangeMsg::FullRefresh` 经 tree-debounce 合并——
///   ignored 标注只活在读层快照里，规则可命中任意深度的已有节点，且纯内容
///   编辑不是结构事件、不会自发触发树刷新）；
/// - 内容事件：gitignore 过滤后投递 file-changed debounce、驱动 git worker；
/// - 结构事件（Create/Remove/Rename）：ignored 根自身的边界事件保留（灰节点更新），
///   子树**内部**路径一律丢弃（监听层不订阅 ignored 内部），投递 tree-debounce
///   （父目录集合聚合后定向刷新）与注册维护。
///
/// `git_meta` 为 `Some` 时，回调会**在 hard-noise 丢弃之前**先做一次 git 元数据
/// 分类（见 [`GitMetaCallbacks`]）。
///
/// git 元数据回调三元组：把「事件 → 三条出口」的语义作为**数据**注入主回调。
///
/// **为什么要合并**：每个 workspace 原本有两条 FSEvents 流 —— 主 watcher 与
/// git_meta watcher。macOS 的 `SubtreeExclusion` 后端递归订阅整个 root，而
/// `WatchManifest::compute` 跳过 `.git` 且**不放入 `ignored_roots`** ⇒ `.git`
/// 事件**已经送达**主 watcher，只是在回调层被 `is_hard_noise_path` 丢弃。
/// 因此合并 = 在丢弃前加一个分类分支，流数从 2N 降到 N。
///
/// 三条回调由 `manager/core.rs` 构造一次，语义与独立流的
/// `create_git_meta_watcher` 保持一致（index/refs 只发调度信号、head 才 emit 事实）。
/// 合并与否共用同一份构造代码，避免两处各写一遍。
pub(super) struct GitMetaCallbacks {
    /// 该单元的 git 元数据路径（HEAD / index / refs / packed-refs）。
    pub(super) paths: GitMetaPaths,
    /// index 变更 → 只发查询调度信号（公理 1：信号≠事实）。
    pub(super) on_index_changed: Box<dyn FnMut() + Send>,
    /// HEAD 变更 → 调度信号 + emit `GitChanged`（分支切换是事实本身）。
    pub(super) on_head_changed: Box<dyn FnMut() + Send>,
    /// refs 变更 → 只发查询调度信号。
    pub(super) on_refs_changed: Box<dyn FnMut() + Send>,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn build_notify_callback(
    repo: WorkspaceRef,
    sink: Arc<dyn WatcherEventSink>,
    gitignore_filter_for_notify: Option<Arc<GitIgnoreFilter>>,
    maintenance_tx_for_closure: mpsc::Sender<WatchMaintenance>,
    debounce_tx_for_notify: mpsc::Sender<PathBuf>,
    tree_debounce_tx: mpsc::Sender<TreeChangeMsg>,
    scheduler_tx: Option<mpsc::Sender<()>>,
    git_repo: bool,
    git_meta: Option<GitMetaCallbacks>,
) -> impl FnMut(Result<Event, notify::Error>) + Send + 'static {
    let pid_log = repo.key();
    let project_id = repo.project_id().to_string();
    let mut git_meta = git_meta;
    move |result: Result<Event, notify::Error>| {
        let event = match result {
            Ok(ev) => ev,
            Err(e) => {
                log::warn!("[Watcher:{}] notify error: {}", pid_log, e);
                // S2-2 正确性兜底：watcher 异常（overflow 等）意味着可能丢失事件，
                // 无法保证目录缓存一致 —— 发送空 dirs 的 tree-changed，
                // 通知前端退回全树刷新（orca 同款 overflow→full refresh 语义）。
                sink.emit(WatcherEvent::TreeChanged(&FileTreeChangedEvent {
                    workspace_key: pid_log.clone(),
                    project_id: project_id.clone(),
                    dirs: Vec::new(),
                }));
                return;
            }
        };

        // git 元数据分类（合并路径，仅 macOS 的递归后端会走到这里）。
        //
        // 位置关键：**必须在 hard-noise 过滤之前** —— 下面的 `is_hard_noise_path`
        // 会丢弃所有 `.git` 路径，而 git 元数据事件正是 `.git` 下的。
        //
        // 短路：主 watcher 的事件量远大于原 git_meta 流（后者只订阅 `.git` 三处），
        // 故先做一次廉价的路径前缀判定，再调分类函数（后者对每个事件做 3 次
        // Path 比较）。
        //
        // **判据必须是「路径落在该单元 git_dir 之下」，不能用「含 `.git` 组件」**：
        // 后者会把「别的单元的 gitdir」（如 `<root>/.git/worktrees/other/HEAD`）
        // 也放进分类，且无法表达 linked worktree 的真实布局。前缀判定同时是
        // 合并可行性的运行期自检 —— 若事件根本不在 git_dir 下，分类必然 Nothing。
        if let Some(ctx) = git_meta.as_mut() {
            if ctx.paths.touches(&event.paths) {
                // 分类 + 三出口复用 `dispatch_git_meta_event`（spec 登记的**唯一**
                // 分发实现）—— 合并路径与独立流不得各写一份 match，那是两条会
                // 漂移的语义。此处仅额外要求：**不 return**，`.git` 路径仍需
                // 落到下面被 hard-noise 过滤丢弃（I2：不得漏进前端事件）。
                dispatch_git_meta_event(
                    &event.paths,
                    &ctx.paths,
                    &mut ctx.on_index_changed,
                    &mut ctx.on_head_changed,
                    &mut ctx.on_refs_changed,
                );
            }
            // 注意：**不 return** —— 见上。
        }

        // .gitignore / .git/info/exclude 自身变更时重载规则
        if let Some(filter) = gitignore_filter_for_notify.as_deref() {
            let rules_changed = event.paths.iter().any(|p| {
                let name = p.file_name().map(|n| n.to_string_lossy().to_string());
                matches!(name.as_deref(), Some(".gitignore") | Some("exclude"))
            });
            if rules_changed {
                filter.reload();
                crate::common::file::services::invalidate_remote_ignored_cache(&project_id);
                // 读层现场构建的过滤器缓存（服务单元未挂载窗口的读）一并失效：
                // rules_changed 分支是规则变化的唯一权威观测点 —— 旧驱动者
                // （worktree 区域回调）已随 per-unit 重构退役，该缓存曾长期无人
                // 失效（断线史与已知边界登记：.trellis/spec/backend/git-domain.md W2）。
                crate::common::file::services::invalidate_local_gitignore_cache();
                // S2：规则变化 → 注册层全量重算（独立线程执行，回调不 watch）
                let _ = maintenance_tx_for_closure.send(WatchMaintenance::ReloadAll);
                // ignored 灰显只活在读层快照里（FileNode.ignored 在读树时计算一次），
                // 规则变化可能让任意深度的已有节点失效，且纯内容编辑不是结构事件、
                // 不会自发触发树刷新 → 主动请求全量刷新（经 tree-debounce 合并风暴，
                // 与 overflow 同一条「空 dirs = 前端全树兜底」语义）。
                let _ = tree_debounce_tx.send(TreeChangeMsg::FullRefresh);
            }
        }

        // 内容/普通事件：git 项目走 gitignore 规则，非 git 项目仅硬过滤噪声。
        let relevant_paths =
            relevant_event_paths(&event.paths, gitignore_filter_for_notify.as_deref());
        // 文件树结构事件：ignored 根自身的边界事件保留（灰节点更新），子树**内部**
        // 路径一律丢弃（监听层不订阅 ignored 内部），避免 ignored churn 放大刷新面。
        let is_structure_change = matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
        );
        let tree_paths = structure_event_paths(
            &event.paths,
            is_structure_change,
            gitignore_filter_for_notify.as_deref(),
        );

        if relevant_paths.is_empty() && tree_paths.is_empty() {
            return;
        }

        // 每个 FS 事件都会触发，高频；降为 trace 避免刷爆日志
        log::trace!(
            "[Watcher:{}] FS event {:?}, paths={:?}, relevant={}",
            pid_log,
            event.kind,
            event.paths,
            !relevant_paths.is_empty()
        );

        if git_repo && !relevant_paths.is_empty() {
            // 驱动 git worker（仅 git 项目有 scheduler；ignored 结构变更
            // 不影响 git status，避免无意义查询）。
            if let Some(ref tx) = scheduler_tx {
                let _ = tx.send(());
            }
        }
        // 发送变更路径给 debounce sender（用于文件 tab 刷新）
        for p in &relevant_paths {
            let _ = debounce_tx_for_notify.send(p.clone());
        }
        // 文件树结构变更（新增/删除/重命名）时把变更路径发给 tree-debounce，
        // 由其聚合父目录集合后定向通知前端（S2-1/S2-2）
        if is_structure_change {
            let is_removal = matches!(event.kind, EventKind::Remove(_));
            let is_rename = matches!(event.kind, EventKind::Modify(ModifyKind::Name(_)));
            for p in &tree_paths {
                let _ = tree_debounce_tx.send(TreeChangeMsg::Path(p.clone()));
            }
            // S2：目录级结构变化 → 注册维护（回调只投递消息，不做 fs 探测——
            // is_dir 判定由维护线程的 WatchManifest::compute/read_dir 自然过滤）。
            // Remove 必须清理 stale 注册；rename 先清理旧路径，再按存在路径补注册。
            for p in &tree_paths {
                if is_removal {
                    let _ = maintenance_tx_for_closure.send(WatchMaintenance::RemoveDir(p.clone()));
                } else if is_rename {
                    let _ = maintenance_tx_for_closure.send(WatchMaintenance::RemoveDir(p.clone()));
                    let _ = maintenance_tx_for_closure.send(WatchMaintenance::AddDir(p.clone()));
                } else {
                    let _ = maintenance_tx_for_closure.send(WatchMaintenance::AddDir(p.clone()));
                }
            }
        }
    }
}
