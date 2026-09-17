//! 断点仓储：**单一锁**下的 per-project 断点状态。
//!
//! ## 为什么是一把锁（此前是 `breakpoints` / `muted` / `bp_loaded` 三把）
//!
//! 三份字段必须互相一致（`muted` 决定 `breakpoints` 的下发载荷，`loaded` 决定
//! 磁盘值是否已并入），却分别加锁 —— 于是产生两个真实问题：
//!
//! 1. **check-then-act 丢更新**：旧实现在 `bp_loaded` 锁外读盘、再加锁写入。
//!    并发的 `set_breakpoints` 与 `get_breakpoints` 交错时，后完成的那个用**旧磁盘
//!    快照整表覆盖**内存，用户刚设的断点被吞。现在"判定 + 认领"在**同一临界区**
//!    完成（[`BreakpointStore::ensure_loaded`] 的 `NotLoaded → Loading` 单飞），
//!    且合并阶段跳过认领后被改动过的文件。
//! 2. **隐性锁序契约**：旧实现的 mute 同步持 `breakpoints` 锁再取 `muted` 锁，
//!    反向取锁即死锁，而没有任何机制强制顺序。单锁后该契约不再存在。
//!
//! 磁盘 IO 在锁外执行（读盘不得串行化整个项目的断点访问）。

use std::collections::{BTreeMap, HashMap, HashSet};

use tokio::sync::Mutex;

use super::super::config::LoadedBreakpoints;
use super::super::types::{BreakpointLine, BreakpointSpec};
use super::effective::{specs_for_file, LineSet};
use crate::AppError;

/// 装载状态（单飞）：`Loading` = 已有调用认领了这次读盘。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum LoadState {
    /// 尚未从磁盘装载。
    #[default]
    NotLoaded,
    /// 已被某次调用认领（读盘进行中）。
    Loading,
    /// 已装载（磁盘值已并入）。
    Loaded,
}

/// 单个项目的断点状态。
#[derive(Debug, Default)]
struct ProjectBreakpoints {
    /// file → line → enabled
    files: BTreeMap<String, LineSet>,
    /// 全局静音（与 `breakpoints.json` 的 `muted` 同态）。
    muted: bool,
    /// 装载状态机。
    state: LoadState,
    /// 认领读盘之后被显式改写的文件 —— 合并时跳过（内存是更新的真相）。
    dirty_files: HashSet<String>,
    /// 认领读盘之后 muted 被显式设置过。
    muted_dirty: bool,
}

/// per-project 断点仓储（单锁）。
#[derive(Debug, Default)]
pub struct BreakpointStore {
    projects: Mutex<HashMap<String, ProjectBreakpoints>>,
}

impl BreakpointStore {
    /// Create an empty store with no projects loaded.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 确保该项目的磁盘断点已并入内存（每个项目、每个进程一次）。
    ///
    /// `load` 在**锁外**调用，只有真正认领成功的那次会执行 —— 单飞。
    /// 形参是**异步**加载器（而非同步闭包）：磁盘 IO 必须能在阻塞线程池里跑，
    /// 不能因为"仓储提供了同步钩子"就把 `std::fs` 拉回 tokio worker（Gate #3）。
    ///
    /// 读盘失败时状态回退为 `NotLoaded`（下次访问可重试），错误上抛而不是当成
    /// "没有断点"：坏掉的 `breakpoints.json` 必须可见，否则用户看到的是
    /// "断点全没了"却无从排查。
    pub async fn ensure_loaded<F>(&self, project_id: &str, load: F) -> Result<(), AppError>
    where
        F: std::ops::AsyncFnOnce() -> Result<LoadedBreakpoints, AppError>,
    {
        // 1) 认领：判定与标记同一临界区 —— check-then-act 的窗口在此关闭。
        {
            let mut projects = self.projects.lock().await;
            let project = projects.entry(project_id.to_string()).or_default();
            match project.state {
                LoadState::Loading | LoadState::Loaded => return Ok(()),
                LoadState::NotLoaded => project.state = LoadState::Loading,
            }
        }

        // 2) 读盘在锁外。
        let loaded = match load().await {
            Ok(loaded) => loaded,
            Err(e) => {
                let mut projects = self.projects.lock().await;
                if let Some(project) = projects.get_mut(project_id) {
                    project.state = LoadState::NotLoaded;
                }
                log::warn!("[DAP] failed to load breakpoints for {project_id}: {e}");
                return Err(e);
            }
        };

        // 3) 合并：磁盘值只填补"认领之后没被动过"的部分。
        let mut projects = self.projects.lock().await;
        let project = projects.entry(project_id.to_string()).or_default();
        for bp in loaded.breakpoints {
            if project.dirty_files.contains(&bp.file_path) {
                continue;
            }
            project
                .files
                .entry(bp.file_path)
                .or_default()
                .entry(bp.line)
                .or_insert(bp.enabled);
        }
        if !project.muted_dirty {
            project.muted = loaded.muted;
        }
        project.dirty_files.clear();
        project.muted_dirty = false;
        project.state = LoadState::Loaded;
        Ok(())
    }

    /// 项目全量断点（file, line 升序）。
    pub async fn snapshot(&self, project_id: &str) -> Vec<BreakpointSpec> {
        let projects = self.projects.lock().await;
        let Some(project) = projects.get(project_id) else {
            return Vec::new();
        };
        project
            .files
            .iter()
            .flat_map(|(file, lines)| specs_for_file(file, lines))
            .collect()
    }

    /// 单文件全量断点（行号升序）。
    pub async fn file_snapshot(&self, project_id: &str, file_path: &str) -> Vec<BreakpointSpec> {
        let projects = self.projects.lock().await;
        projects
            .get(project_id)
            .and_then(|project| project.files.get(file_path))
            .map_or_else(Vec::new, |lines| specs_for_file(file_path, lines))
    }

    /// 项目全量断点 **+ 静音位**（同一临界区取，供 mute 同步使用）。
    ///
    /// 分两次调用会各取一次锁，中间可能插入一次 `set_breakpoints` 而产生
    /// "断点是新的、静音位是旧的"这类不一致快照。
    pub async fn snapshot_with_mute(
        &self,
        project_id: &str,
    ) -> (Vec<(String, Vec<BreakpointSpec>)>, bool) {
        let projects = self.projects.lock().await;
        let Some(project) = projects.get(project_id) else {
            return (Vec::new(), false);
        };
        let files = project
            .files
            .iter()
            .map(|(file, lines)| (file.clone(), specs_for_file(file, lines)))
            .collect();
        (files, project.muted)
    }

    /// 单文件**全量替换**（含 disabled 位）；空列表 = 删除该文件的断点。
    pub async fn set_file(&self, project_id: &str, file_path: &str, lines: Vec<BreakpointLine>) {
        let mut projects = self.projects.lock().await;
        let project = projects.entry(project_id.to_string()).or_default();
        project.dirty_files.insert(file_path.to_string());
        if lines.is_empty() {
            project.files.remove(file_path);
            return;
        }
        project.files.insert(
            file_path.to_string(),
            lines.into_iter().map(|b| (b.line, b.enabled)).collect(),
        );
    }

    /// 全局静音位（缺省 = false）。
    pub async fn muted(&self, project_id: &str) -> bool {
        let projects = self.projects.lock().await;
        projects.get(project_id).is_some_and(|p| p.muted)
    }

    /// 设置全局静音位。
    pub async fn set_muted(&self, project_id: &str, muted: bool) {
        let mut projects = self.projects.lock().await;
        let project = projects.entry(project_id.to_string()).or_default();
        project.muted_dirty = true;
        project.muted = muted;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn loaded(bps: &[(&str, u32, bool)], muted: bool) -> LoadedBreakpoints {
        LoadedBreakpoints {
            breakpoints: bps
                .iter()
                .map(|(file, line, enabled)| BreakpointSpec {
                    file_path: (*file).to_string(),
                    line: *line,
                    verified: false,
                    enabled: *enabled,
                })
                .collect(),
            muted,
        }
    }

    fn line(line: u32, enabled: bool) -> BreakpointLine {
        BreakpointLine { line, enabled }
    }

    #[tokio::test]
    async fn ensure_loaded_merges_disk_once_and_is_single_flight() {
        let store = BreakpointStore::new();
        let calls = std::sync::atomic::AtomicUsize::new(0);

        for _ in 0..2 {
            store
                .ensure_loaded("p1", async || {
                    calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(loaded(&[("/proj/a.go", 10, true)], true))
                })
                .await
                .expect("load");
        }

        assert_eq!(
            calls.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "读盘每个项目只允许发生一次（单飞）"
        );
        assert_eq!(store.snapshot("p1").await.len(), 1);
        assert!(store.muted("p1").await, "磁盘 muted 位必须并入");
    }

    /// **丢更新回归**：认领读盘期间用户已改过的文件，磁盘旧值不得覆盖内存。
    ///
    /// 旧实现（`bp_loaded` 锁外读盘 + 无差别 `insert`）在这里会把磁盘的
    /// `/proj/a.go:10` 重新写回内存，用户新设的 20 行被吞。
    ///
    /// 无需真并发即可覆盖：合并只发生在 `ensure_loaded` 返回**之前**，而认领
    /// （`NotLoaded → Loading`）在该函数入口就已完成 —— 因此"先 `set_file` 再
    /// `ensure_loaded`"与"读盘期间并发 `set_file`"对合并决策而言是同一状态。
    #[tokio::test]
    async fn disk_values_never_clobber_writes_made_while_loading() {
        let store = BreakpointStore::new();
        store
            .set_file("p1", "/proj/a.go", vec![line(20, true)])
            .await;
        store.set_muted("p1", false).await;

        store
            .ensure_loaded("p1", async || Ok(loaded(&[("/proj/a.go", 10, true)], true)))
            .await
            .expect("load");

        let specs = store.file_snapshot("p1", "/proj/a.go").await;
        assert_eq!(
            specs.iter().map(|s| s.line).collect::<Vec<_>>(),
            vec![20],
            "认领后被写过的文件不得被磁盘旧值污染: {specs:?}"
        );
        assert!(
            !store.muted("p1").await,
            "认领后被显式设置过的 muted 不得被磁盘值覆盖"
        );

        // 未被动过的**其他**文件仍正常并入（跳过只针对被改过的那个）。
        let store = BreakpointStore::new();
        store
            .set_file("p1", "/proj/a.go", vec![line(20, true)])
            .await;
        store
            .ensure_loaded("p1", async || {
                Ok(loaded(
                    &[("/proj/a.go", 10, true), ("/proj/b.go", 7, true)],
                    true,
                ))
            })
            .await
            .expect("load");
        assert_eq!(
            store.file_snapshot("p1", "/proj/a.go").await.len(),
            1,
            "被改过的文件保持内存值"
        );
        assert_eq!(
            store.file_snapshot("p1", "/proj/b.go").await.len(),
            1,
            "未改过的文件正常并入磁盘值"
        );
    }

    /// 读盘失败 → 错误上抛且状态回退（下次可重试），不伪装成"没有断点"。
    #[tokio::test]
    async fn load_failure_propagates_and_allows_retry() {
        let store = BreakpointStore::new();

        let err = store
            .ensure_loaded("p1", async || Err(AppError::Dap("corrupt".into())))
            .await
            .expect_err("load failure must propagate");
        assert!(err.to_string().contains("corrupt"));

        // 第二次仍会真正调用 load（状态已回退，不是"已装载"）。
        store
            .ensure_loaded("p1", async || {
                Ok(loaded(&[("/proj/a.go", 10, true)], false))
            })
            .await
            .expect("retry");
        assert_eq!(store.snapshot("p1").await.len(), 1);
    }

    #[tokio::test]
    async fn set_file_replaces_whole_file_and_empty_removes_it() {
        let store = BreakpointStore::new();
        store
            .set_file("p1", "/proj/a.go", vec![line(10, true), line(20, false)])
            .await;
        assert_eq!(store.file_snapshot("p1", "/proj/a.go").await.len(), 2);

        // 全量替换：旧行不残留。
        store
            .set_file("p1", "/proj/a.go", vec![line(30, true)])
            .await;
        let specs = store.file_snapshot("p1", "/proj/a.go").await;
        assert_eq!(specs.iter().map(|s| s.line).collect::<Vec<_>>(), vec![30]);

        // 空列表 = 删除该文件。
        store.set_file("p1", "/proj/a.go", Vec::new()).await;
        assert!(store.file_snapshot("p1", "/proj/a.go").await.is_empty());
        assert!(store.snapshot("p1").await.is_empty());
    }

    #[tokio::test]
    async fn unknown_project_reads_as_empty_and_unmuted() {
        let store = BreakpointStore::new();

        assert!(store.snapshot("nope").await.is_empty());
        assert!(store.file_snapshot("nope", "/x").await.is_empty());
        assert!(!store.muted("nope").await);
        let (files, muted) = store.snapshot_with_mute("nope").await;
        assert!(files.is_empty());
        assert!(!muted);
    }

    /// `snapshot_with_mute` 与 `snapshot` 同源同序（同一临界区取一份状态）。
    #[tokio::test]
    async fn snapshot_with_mute_agrees_with_snapshot() {
        let store = BreakpointStore::new();
        store
            .set_file("p1", "/proj/b.go", vec![line(5, true)])
            .await;
        store
            .set_file("p1", "/proj/a.go", vec![line(1, false)])
            .await;
        store.set_muted("p1", true).await;

        let flat = store.snapshot("p1").await;
        let (files, muted) = store.snapshot_with_mute("p1").await;
        assert!(muted);
        let grouped: Vec<BreakpointSpec> = files.into_iter().flat_map(|(_, s)| s).collect();
        assert_eq!(flat.len(), grouped.len());
        assert_eq!(
            flat.iter()
                .map(|s| (&s.file_path, s.line))
                .collect::<Vec<_>>(),
            grouped
                .iter()
                .map(|s| (&s.file_path, s.line))
                .collect::<Vec<_>>()
        );
        assert_eq!(store.snapshot("p1").await.len(), 2);
    }
}
