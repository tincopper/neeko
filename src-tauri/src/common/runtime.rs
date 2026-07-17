//! Business-side async executor abstraction (Scheme C).
//!
//! # Design
//!
//! - **Logic**: application business code (LSP, terminal workers, …) only
//!   schedules work through [`AppRuntime`], never via bare `tokio::spawn`.
//! - **Implementation**: a single [`tokio::runtime::Handle`]. Today that handle
//!   comes from Tauri's process-wide async runtime; tomorrow it can be a
//!   dedicated `Runtime` without changing call sites.
//!
//! This avoids panics like `there is no reactor running` when business code is
//! invoked from sync Tauri commands (no current-thread Handle).

use std::future::Future;
use std::sync::Arc;

use tokio::runtime::Handle;
use tokio::task::JoinHandle;

/// Process-wide business async executor.
///
/// Clone is cheap (`Arc` inside). Prefer injecting `Arc<AppRuntime>` into
/// managers rather than reaching for `tokio::` / `tauri::async_runtime` APIs.
#[derive(Clone, Debug)]
pub struct AppRuntime {
    handle: Handle,
}

impl AppRuntime {
    /// Wrap an existing Tokio handle (e.g. from a dedicated test runtime).
    pub fn from_handle(handle: Handle) -> Self {
        Self { handle }
    }

    /// Bind to Tauri's global async runtime (creates it on first use if needed).
    ///
    /// Safe to call from sync contexts — does not require `Handle::current()`.
    pub fn from_tauri() -> Self {
        Self {
            handle: tauri::async_runtime::handle().inner().clone(),
        }
    }

    /// Prefer the current Tokio handle when already inside a runtime;
    /// otherwise fall back to Tauri's global runtime.
    pub fn try_current_or_tauri() -> Self {
        match Handle::try_current() {
            Ok(handle) => Self::from_handle(handle),
            Err(_) => Self::from_tauri(),
        }
    }

    /// Shared default for app startup: always the Tauri-backed handle.
    pub fn shared_default() -> Arc<Self> {
        Arc::new(Self::from_tauri())
    }

    /// Borrow the underlying Tokio handle (escape hatch for advanced use).
    pub fn handle(&self) -> &Handle {
        &self.handle
    }

    /// Spawn an async task onto the business runtime.
    pub fn spawn<F>(&self, future: F) -> JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        self.handle.spawn(future)
    }

    /// Run a blocking closure on the runtime's blocking thread pool.
    pub fn spawn_blocking<F, R>(&self, func: F) -> JoinHandle<R>
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        self.handle.spawn_blocking(func)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn should_spawn_blocking_without_current_handle() {
        // Must not panic even when this test thread is not inside a runtime.
        let rt = AppRuntime::from_tauri();
        let flag = Arc::new(Mutex::new(false));
        let flag2 = Arc::clone(&flag);
        let join = rt.spawn_blocking(move || {
            *flag2.lock().unwrap() = true;
            42
        });
        let value = tauri::async_runtime::block_on(join).expect("join");
        assert_eq!(value, 42);
        assert!(*flag.lock().unwrap());
    }

    #[test]
    fn should_spawn_async_task() {
        let rt = AppRuntime::from_tauri();
        let join = rt.spawn(async { 7 + 8 });
        let value = tauri::async_runtime::block_on(join).expect("join");
        assert_eq!(value, 15);
    }
}
