//! notify 事件回调构建：事件分类、gitignore 规则热重载、debounce / 维护消息投递。
//!
//! 闭包体从 `WatcherManager::watch` 抽离为独立构建函数，使组装编排保持精简；
//! 全部依赖经参数显式注入（move 捕获语义与原实现一致）。

use super::super::gitignore::GitIgnoreFilter;
use super::super::registration::WatchMaintenance;
use super::super::sink::{WatcherEvent, WatcherEventSink};
use super::super::types::FileTreeChangedEvent;
use super::classify::{relevant_event_paths, structure_event_paths};
use notify::event::ModifyKind;
use notify::{Event, EventKind};
use std::path::PathBuf;
use std::sync::{mpsc, Arc};

/// 构建 notify 事件回调（`RecommendedWatcher::new` 的事件处理闭包）。
///
/// - 错误事件（overflow 等）：无法保证目录缓存一致 → 发送空 `dirs` 的
///   tree-changed，前端退回全树刷新（orca 同款 overflow→full refresh 语义）；
/// - `.gitignore` / `.git/info/exclude` 变更：热重载过滤规则 + 失效远程
///   ignored 缓存 + 注册层全量重算；
/// - 内容事件：gitignore 过滤后投递 file-changed debounce、驱动 git worker；
/// - 结构事件（Create/Remove/Rename）：ignored 节点仍在文件树展示，不过滤，
///   投递 tree-debounce（父目录集合聚合后定向刷新）+ 注册维护。
#[allow(clippy::too_many_arguments)]
pub(super) fn build_notify_callback(
    pid_log: String,
    sink: Arc<dyn WatcherEventSink>,
    gitignore_filter_for_notify: Option<Arc<GitIgnoreFilter>>,
    maintenance_tx_for_closure: mpsc::Sender<WatchMaintenance>,
    debounce_tx_for_notify: mpsc::Sender<PathBuf>,
    tree_debounce_tx: mpsc::Sender<PathBuf>,
    scheduler_tx: Option<mpsc::Sender<()>>,
    git_repo: bool,
) -> impl FnMut(Result<Event, notify::Error>) + Send + 'static {
    move |result: Result<Event, notify::Error>| {
        let event = match result {
            Ok(ev) => ev,
            Err(e) => {
                log::warn!("[Watcher:{}] notify error: {}", pid_log, e);
                // S2-2 正确性兜底：watcher 异常（overflow 等）意味着可能丢失事件，
                // 无法保证目录缓存一致 —— 发送空 dirs 的 tree-changed，
                // 通知前端退回全树刷新（orca 同款 overflow→full refresh 语义）。
                sink.emit(WatcherEvent::TreeChanged(&FileTreeChangedEvent {
                    project_id: pid_log.clone(),
                    dirs: Vec::new(),
                }));
                return;
            }
        };

        // .gitignore / .git/info/exclude 自身变更时重载规则
        if let Some(filter) = gitignore_filter_for_notify.as_deref() {
            let rules_changed = event.paths.iter().any(|p| {
                let name = p.file_name().map(|n| n.to_string_lossy().to_string());
                matches!(name.as_deref(), Some(".gitignore") | Some("exclude"))
            });
            if rules_changed {
                filter.reload();
                crate::common::file::services::invalidate_remote_ignored_cache(&pid_log);
                // S2：规则变化 → 注册层全量重算（独立线程执行，回调不 watch）
                let _ = maintenance_tx_for_closure.send(WatchMaintenance::ReloadAll);
            }
        }

        // 内容/普通事件：git 项目走 gitignore 规则，非 git 项目仅硬过滤噪声。
        let relevant_paths =
            relevant_event_paths(&event.paths, gitignore_filter_for_notify.as_deref());
        // 文件树结构事件：ignored 文件/目录也展示为灰色节点，必须刷新。
        let is_structure_change = matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
        );
        let tree_paths = structure_event_paths(&event.paths, is_structure_change);

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
                let _ = tree_debounce_tx.send(p.clone());
            }
            // S2：目录级结构变化 → 注册维护（回调只投递消息，不做 fs 探测——
            // is_dir 判定由维护线程的 compute_watch_dirs/read_dir 自然过滤）。
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
