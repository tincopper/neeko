//! Search service: dispatch to the local or remote engine based on the
//! execution target, with per-request cancellation.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};

use tokio::sync::Notify;

use crate::common::error::AppError;
use crate::common::executor::factory::ExecTarget;
use crate::search::engine_local::search_local;
use crate::search::engine_remote::search_remote;
use crate::search::types::{SearchOptions, SearchPage};

/// Process-wide cancellation registry for content searches.
static SEARCH_CANCELLATIONS: LazyLock<SearchCancellations> =
    LazyLock::new(SearchCancellations::default);

/// Access the process-wide cancellation registry.
pub(crate) fn cancellations() -> &'static SearchCancellations {
    &SEARCH_CANCELLATIONS
}

/// Cancellation registry keyed by request id.
///
/// A new request with the same id cancels the previous in-flight one. The
/// frontend increments `request_id` per query change so stale searches are
/// aborted server-side even if the client already dropped its AbortController.
#[derive(Default, Clone)]
pub struct SearchCancellations {
    inner: Arc<Mutex<HashMap<String, Arc<Notify>>>>,
}

impl SearchCancellations {
    /// Register (and cancel any prior) request `id`, returning a stop handle.
    #[must_use]
    pub fn begin(&self, id: &str) -> Arc<Notify> {
        let token = Arc::new(Notify::new());
        if let Ok(mut map) = self.inner.lock() {
            if let Some(prev) = map.insert(id.to_string(), token.clone()) {
                prev.notify_waiters();
            }
        }
        token
    }

    /// Drop the request entry so a completed search no longer tracks state.
    pub fn end(&self, id: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.remove(id);
        }
    }

    /// Cancel a tracked request by id (explicit stop from frontend).
    pub fn cancel(&self, id: &str) {
        if let Ok(mut map) = self.inner.lock() {
            if let Some(token) = map.remove(id) {
                token.notify_waiters();
            }
        }
    }

    /// Test-only: how many requests are currently tracked.
    #[cfg(test)]
    fn tracked(&self) -> usize {
        self.inner.lock().map(|m| m.len()).unwrap_or(0)
    }
}

/// Run a content search, dispatching on the execution target.
#[allow(clippy::too_many_arguments)]
pub async fn search(
    target: &ExecTarget,
    root: &str,
    query: &str,
    opts: &SearchOptions,
    offset: u32,
    limit: Option<u32>,
    request_id: &str,
    project_id: &str,
) -> Result<SearchPage, AppError> {
    let page = match target {
        ExecTarget::Local => {
            let root = root.to_string();
            let query = query.to_string();
            let opts = opts.clone();
            let page = tokio::task::spawn_blocking(move || {
                search_local(Path::new(&root), &query, &opts, offset, limit)
            })
            .await
            .map_err(|e| AppError::Unknown(format!("Search task failed: {e}")))?;
            page?
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            search_remote(target, root, query, opts, offset, limit).await?
        }
    };

    // Wrap the engine output with request metadata.
    Ok(SearchPage {
        request_id: request_id.to_string(),
        query: query.to_string(),
        project_id: project_id.to_string(),
        matches: page.matches,
        cursor: page.cursor,
        truncated: page.truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::types::SearchOptions;

    #[tokio::test]
    async fn search_local_dispatch_runs_blocking_scan() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "needle here").unwrap();
        let page = search(
            &ExecTarget::Local,
            dir.path().to_str().unwrap(),
            "needle",
            &SearchOptions::default(),
            0,
            None,
            "req-1",
            "p-1",
        )
        .await
        .unwrap();
        assert_eq!(page.matches.len(), 1);
        assert_eq!(page.matches[0].path, "a.txt");
        assert_eq!(page.request_id, "req-1");
        assert_eq!(page.project_id, "p-1");
    }

    #[tokio::test]
    async fn cancellation_begin_cancels_previous_same_id() {
        let reg = SearchCancellations::default();
        let t1 = reg.begin("req-1");
        let waiter = t1.notified();
        let _t2 = reg.begin("req-1");
        // t1 should be notified by the second begin.
        tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
            .await
            .expect("previous request should be cancelled");
        assert_eq!(reg.tracked(), 1);
        reg.end("req-1");
        assert_eq!(reg.tracked(), 0);
    }

    #[tokio::test]
    async fn cancellation_end_removes_only_requested_id() {
        let reg = SearchCancellations::default();
        let _a = reg.begin("a");
        let _b = reg.begin("b");
        reg.end("a");
        assert_eq!(reg.tracked(), 1);
        reg.end("b");
        assert_eq!(reg.tracked(), 0);
    }

    #[tokio::test]
    async fn cancellation_cancel_notifies_waiters() {
        let reg = SearchCancellations::default();
        let token = reg.begin("req-x");
        let waiter = token.notified();
        reg.cancel("req-x");
        tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
            .await
            .expect("cancel should notify waiters");
        assert_eq!(reg.tracked(), 0);
    }
}
