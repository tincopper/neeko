//! 长 git 操作（push / fetch / pull / commit）的取消句柄与单飞槽注册表。
//!
//! `GitSyncHandle` 与 `project::clone::CloneHandle` 同构：watch 通道 + keep-alive 接收端，
//! `cancel` 可从同步上下文安全调用；`cancelled()` 在「取消先于等待」时也立即返回。
//!
//! `GitSyncSlots` 是**单飞不变量的所有者**：互斥粒度 = 仓库单元（`RepoRef::key()`），
//! 同一单元串行、不同单元并行。调用方只能经 `begin` / `cancel_matching` 操作，无从绕过。

use std::collections::HashMap;
use std::sync::Mutex;

use crate::AppError;

/// 同一仓库单元已有长 git 操作在跑时的错误文案。
///
/// 前端 `features/git/api/gitConsoleRun.ts` 的 `GIT_BUSY_MESSAGE` 与之对齐（双端各一份，
/// 但两边的值都有 pin 测试，改动会在任一端被测试抓住）。
pub const BUSY_MESSAGE: &str = "Another git operation is already in progress for this repository";

/// Handle for an in-flight git sync operation (stored in the app's single-flight slot).
#[derive(Clone, Debug)]
pub struct GitSyncHandle {
    cancel_tx: tokio::sync::watch::Sender<bool>,
    /// Keeps at least one receiver alive so `cancel` before the runner subscribes
    /// still latches the value (pre-start cancellation).
    _cancel_rx: tokio::sync::watch::Receiver<bool>,
}

/// 单飞槽条目：取消句柄 + 本次运行的关联标识。
///
/// 槽按**仓库单元**分（[`GitSyncSlots`]），前端 tab 按**仓库级**（project path）分 ——
/// `correlation_id` 把这两个身份面钉在一起：`cancel_git_sync(console_run_id)` 只命中同一
/// 关联标识，不会被一个陈旧的 run id 误取消。同一标识可命中同 project 的多个单元（它们
/// 共享同一个仓库级 tab，取消即整仓取消）。`None` = 无 Console 上下文，取消时只要求
/// 请求方也声明「取消全部/当前」。
///
/// 当前该标识携带的就是前端 Console run id；命名刻意保持中立（不叫 `run_id`），
/// 以免把 Console 语义下沉到 `common/git/transport`。
#[derive(Clone, Debug)]
pub struct GitSyncEntry {
    /// 取消句柄。
    pub handle: GitSyncHandle,
    /// 关联标识（当前 = Console run id 原样）。
    pub correlation_id: Option<String>,
}

impl GitSyncEntry {
    /// 本次运行是否属于 `requested` 请求的关联标识：`None` 请求视为「取消全部/当前」。
    #[must_use]
    pub fn matches(&self, requested: Option<&str>) -> bool {
        match requested {
            Some(id) => self.correlation_id.as_deref() == Some(id),
            None => true,
        }
    }
}

impl Default for GitSyncHandle {
    fn default() -> Self {
        Self::new()
    }
}

impl GitSyncHandle {
    /// Create a handle with a fresh (non-cancelled) watch channel.
    #[must_use]
    pub fn new() -> Self {
        let (cancel_tx, _cancel_rx) = tokio::sync::watch::channel(false);
        Self {
            cancel_tx,
            _cancel_rx,
        }
    }

    /// Signal cancellation to the running operation.
    pub fn cancel(&self) -> Result<(), tokio::sync::watch::error::SendError<bool>> {
        self.cancel_tx.send(true)
    }

    /// Whether cancellation was already signalled.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        *self._cancel_rx.borrow()
    }

    /// Resolves when cancellation is signalled (immediately if already cancelled).
    pub async fn cancelled(&self) {
        let mut rx = self.cancel_tx.subscribe();
        if *rx.borrow() {
            return;
        }
        let _ = rx.changed().await;
    }
}

/// 仓库单元（`RepoRef::key()`）→ 在跑的长 git 操作。
///
/// 互斥粒度与 `git-domain.md §12` 的身份模型一致：`git status` 的写入单位是仓库单元，
/// 因此同一单元（同 HEAD/index/workdir）串行，主仓与各 linked worktree 可并行。
#[derive(Default)]
pub struct GitSyncSlots {
    slots: Mutex<HashMap<String, GitSyncEntry>>,
}

impl GitSyncSlots {
    /// 占用 `key` 对应的仓库单元：返回取消句柄 + RAII 释放守卫。
    ///
    /// 同一单元已有操作在跑 ⇒ `AppError::Conflict`（显式拒绝，而不是排队）。
    pub fn begin(
        &self,
        key: String,
        correlation_id: Option<String>,
    ) -> Result<(GitSyncHandle, GitSyncGuard<'_>), AppError> {
        let mut slots = self
            .slots
            .lock()
            .map_err(|_| AppError::LockPoisoned("git sync slot poisoned".to_string()))?;
        if slots.contains_key(&key) {
            return Err(AppError::Conflict(BUSY_MESSAGE.to_string()));
        }
        let handle = GitSyncHandle::new();
        slots.insert(
            key.clone(),
            GitSyncEntry {
                handle: handle.clone(),
                correlation_id,
            },
        );
        Ok((handle, GitSyncGuard { slots: self, key }))
    }

    /// 取消所有关联标识匹配的运行（`None` = 全部），返回实际触发成功的数量。
    /// 幂等：没有在跑的操作时返回 0。
    pub fn cancel_matching(&self, correlation_id: Option<&str>) -> Result<usize, AppError> {
        let handles: Vec<GitSyncHandle> = {
            let slots = self
                .slots
                .lock()
                .map_err(|_| AppError::LockPoisoned("git sync slot poisoned".to_string()))?;
            slots
                .values()
                .filter(|entry| entry.matches(correlation_id))
                .map(|entry| entry.handle.clone())
                .collect()
        };
        Ok(handles.iter().filter(|h| h.cancel().is_ok()).count())
    }
}

/// [`GitSyncSlots::begin`] 的 RAII 守卫：析构时释放本仓库单元（任何返回路径都不泄漏）。
pub struct GitSyncGuard<'a> {
    slots: &'a GitSyncSlots,
    key: String,
}

impl Drop for GitSyncGuard<'_> {
    fn drop(&mut self) {
        // 故意容忍中毒：Drop 里无法更好处理；锁只保护一张小表，数据仍可用。
        if let Ok(mut slots) = self.slots.slots.lock() {
            slots.remove(&self.key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancelled_resolves_immediately_when_signalled_before_waiting() {
        let handle = GitSyncHandle::new();
        handle.cancel().expect("receiver alive");
        tokio::time::timeout(std::time::Duration::from_millis(200), handle.cancelled())
            .await
            .expect("pre-start cancellation must resolve immediately");
        assert!(handle.is_cancelled());
    }

    #[tokio::test]
    async fn cancelled_waits_until_signalled() {
        let handle = GitSyncHandle::new();
        assert!(!handle.is_cancelled());
        let waiter = handle.clone();
        let join = tokio::spawn(async move {
            waiter.cancelled().await;
            true
        });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!join.is_finished(), "must still be waiting before cancel");
        handle.cancel().expect("receiver alive");
        let done = tokio::time::timeout(std::time::Duration::from_millis(500), join)
            .await
            .expect("cancel must wake the waiter")
            .expect("join");
        assert!(done);
    }

    #[test]
    fn entry_matches_only_its_correlation_id() {
        let entry = GitSyncEntry {
            handle: GitSyncHandle::new(),
            correlation_id: Some("git:/repo/a".to_string()),
        };
        assert!(entry.matches(Some("git:/repo/a")));
        assert!(!entry.matches(Some("git:/repo/b")), "不得误取消其它仓库");
        assert!(entry.matches(None), "无关联标识的请求 = 取消全部/当前");

        let bare = GitSyncEntry {
            handle: GitSyncHandle::new(),
            correlation_id: None,
        };
        assert!(!bare.matches(Some("git:/repo/a")));
        assert!(bare.matches(None));
    }

    #[test]
    fn busy_unit_is_reported_as_conflict() {
        let slots = GitSyncSlots::default();
        let (_, guard) = slots.begin("unit-a".to_string(), None).expect("free unit");
        let err = match slots.begin("unit-a".to_string(), None) {
            Ok(_) => panic!("occupied unit must be rejected"),
            Err(e) => e,
        };
        assert!(
            matches!(err, AppError::Conflict(_)),
            "并发占用应是 Conflict，不是 InvalidInput: {err:?}"
        );
        assert!(
            err.to_string().contains(BUSY_MESSAGE),
            "错误文案必须携带 BUSY_MESSAGE（前端 GIT_BUSY_MESSAGE 与之对齐）"
        );
        drop(guard);
    }

    #[test]
    fn slots_are_per_repo_unit_and_release_on_guard_drop() {
        let slots = GitSyncSlots::default();
        let (_, guard_a) = slots
            .begin("unit-a".to_string(), Some("run-a".to_string()))
            .expect("free unit");
        assert!(
            slots.begin("unit-a".to_string(), None).is_err(),
            "同一仓库单元必须互斥"
        );
        let (_, guard_b) = slots
            .begin("unit-b".to_string(), None)
            .expect("不同单元可并行");
        drop(guard_a);
        assert!(
            slots.begin("unit-a".to_string(), None).is_ok(),
            "守卫释放后该单元可重新占用"
        );
        drop(guard_b);
    }

    #[test]
    fn cancel_matching_targets_only_matching_runs() {
        let slots = GitSyncSlots::default();
        let (handle_a, _guard_a) = slots
            .begin("unit-a".to_string(), Some("run-a".to_string()))
            .expect("free unit");
        let (handle_b, _guard_b) = slots
            .begin("unit-b".to_string(), Some("run-b".to_string()))
            .expect("free unit");

        assert_eq!(slots.cancel_matching(Some("run-a")).expect("no poison"), 1);
        assert!(handle_a.is_cancelled(), "匹配的 run 必须被取消");
        assert!(!handle_b.is_cancelled(), "不匹配的 run 不得被误取消");
    }
}
