//! Poison-tolerant mutex guard for terminal maps.
//!
//! D1（tolerate-and-continue）：终端锁临界区都是短小的 HashMap 查表/插入，
//! poison 意味着"某个持锁线程 panic"，数据大概率仍可用；fail-loud 会把偶发
//! panic 放大为整条会话不可用。统一用 `into_inner` 容忍继续 + `log::warn`。

use std::sync::{Mutex, MutexGuard};

/// Locks `m`, tolerating poisoning by continuing with the inner value.
///
/// Poisoning is logged once per call via `log::warn!`; there is no hot-loop
/// cost (only poisoned calls log).
pub(crate) fn lock_warn<'a, T>(m: &'a Mutex<T>, what: &str) -> MutexGuard<'a, T> {
    match m.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::warn!("[terminal] {what} lock poisoned, continuing with inner");
            poisoned.into_inner()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;

    #[test]
    fn lock_warn_returns_inner_after_poison() {
        let m = Arc::new(Mutex::new(HashMap::<String, u32>::new()));
        m.lock().unwrap().insert("kept".into(), 7);
        let clone = Arc::clone(&m);
        let _ = std::thread::spawn(move || {
            let _guard = clone.lock().unwrap();
            panic!("poison-inject");
        })
        .join();
        assert!(m.is_poisoned());
        assert_eq!(lock_warn(&m, "test").get("kept"), Some(&7));
    }

    #[test]
    fn lock_warn_allows_insert_after_poison() {
        let m = Arc::new(Mutex::new(HashMap::<String, u32>::new()));
        let clone = Arc::clone(&m);
        let _ = std::thread::spawn(move || {
            let _guard = clone.lock().unwrap();
            panic!("poison-inject");
        })
        .join();
        lock_warn(&m, "test").insert("new".into(), 1);
        assert_eq!(lock_warn(&m, "test").get("new"), Some(&1));
    }
}
