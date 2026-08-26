//! Per-session bounded output queue with credit-style wake protocol.
//!
//! 任务背景（08-25-terminal-memory-governance）：终端输出旧链路逐条 JSON emit，
//! 前端 writeBuffer 无界积压。本模块是"信用制拉取"协议的 Rust 半场：
//!
//! - 生产端（PTY/SSH reader）`push`：写入有界缓冲；饱和时拒收（泵暂停读 =
//!   OS 层背压）；每次成功 push 确保"至多一个唤醒在飞"；
//! - 消费端（`terminal_drain` 命令）`take_and_rearm`：取走全部积压并复位
//!   唤醒标志；若取走期间生产者又插入了数据（竞态窗口），立即补发唤醒，
//!   保证唤醒永不丢失。
//!
//! 唤醒事件本身零载荷，仅是 "可能有数据" 的 hint；正确性以 drain-to-empty
//! 为准（design.md §6 权衡 4）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// 默认缓冲容量：大于泵 `max_buffer`(256KB)，数学上排除"单批即超限"死锁
/// （design.md §2.2 / §3）。
pub(crate) const DRAIN_BUFFER_CAPACITY: usize = 512 * 1024;

#[derive(Default)]
pub(crate) struct DrainBuffer {
    data: Vec<u8>,
    max_capacity: usize,
}

impl DrainBuffer {
    #[cfg(test)]
    fn new(max_capacity: usize) -> Self {
        Self {
            data: Vec::new(),
            max_capacity,
        }
    }

    /// Append bytes. Returns `false` when the buffer is non-empty and the
    /// batch would exceed capacity — caller retries later (backpressure).
    /// An empty buffer always accepts, bounding worst-case residency by the
    /// pump's own `max_buffer`.
    fn push(&mut self, bytes: &[u8]) -> bool {
        if !self.data.is_empty() && self.data.len() + bytes.len() > self.max_capacity {
            return false;
        }
        self.data.extend_from_slice(bytes);
        true
    }

    /// Swap out all buffered bytes, leaving the buffer empty.
    fn take_all(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.data)
    }

    const fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
}

/// Shared per-session drain endpoint. Cheap to clone via [`Arc`].
pub(crate) struct SessionDrain {
    buffer: Mutex<DrainBuffer>,
    /// At most one wake notification in flight at any time.
    wake_in_flight: AtomicBool,
    /// Closed flag: session teardown sets this before removing the map entry.
    /// Orphan producers (reader threads still holding an `Arc`) then have
    /// their pushes absorbed — the pump reads through to EOF and exits
    /// instead of parking in a backpressure loop forever (design.md §8.2).
    closed: AtomicBool,
}

impl Default for SessionDrain {
    fn default() -> Self {
        Self::with_capacity(DRAIN_BUFFER_CAPACITY)
    }
}

impl SessionDrain {
    #[must_use]
    pub(crate) const fn with_capacity(max_capacity: usize) -> Self {
        Self {
            buffer: Mutex::new(DrainBuffer {
                data: Vec::new(),
                max_capacity,
            }),
            wake_in_flight: AtomicBool::new(false),
            closed: AtomicBool::new(false),
        }
    }

    /// Marks the drain as closed. Idempotent.
    pub(crate) fn close(&self) {
        self.closed.store(true, Ordering::Release);
    }

    #[must_use]
    pub(crate) fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    /// Producer side: append bytes, then guarantee a wake will be observed.
    ///
    /// Returns `false` when saturated — the pump parks and retries the same
    /// batch; nothing is ever dropped. On a closed drain, bytes are absorbed
    /// (returns `true`, buffers nothing, wakes nobody): the session is gone,
    /// and absorbing lets orphan pumps run to EOF instead of parking forever.
    pub(crate) fn push(&self, bytes: &[u8], wake: impl FnOnce()) -> bool {
        if self.is_closed() {
            return true;
        }
        let accepted = {
            let mut buf = lock(&self.buffer);
            buf.push(bytes)
        };
        // Accepted or not, bytes may now be pending; ensure one wake in flight.
        if !self.wake_in_flight.swap(true, Ordering::AcqRel) {
            wake();
        }
        accepted
    }

    /// Consumer side: take everything buffered, clear the in-flight flag, and
    /// re-wake immediately if a producer slipped bytes in during the race
    /// window between taking and clearing — this closes the lost-wakeup hole.
    ///
    /// A closed drain reports empty and never re-arms.
    pub(crate) fn take_and_rearm(&self, wake: impl FnOnce()) -> Vec<u8> {
        if self.is_closed() {
            lock(&self.buffer).take_all();
            return Vec::new();
        }
        let data = lock(&self.buffer).take_all();
        self.wake_in_flight.store(false, Ordering::Release);
        if !lock(&self.buffer).is_empty() && !self.wake_in_flight.swap(true, Ordering::AcqRel) {
            wake();
        }
        data
    }

    #[cfg(test)]
    fn is_empty(&self) -> bool {
        lock(&self.buffer).is_empty()
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Registry of live session drains, keyed by session id.
pub(crate) type SessionDrainMap = Arc<Mutex<HashMap<String, Arc<SessionDrain>>>>;

#[must_use]
pub(crate) fn new_drain_map() -> SessionDrainMap {
    Arc::new(Mutex::new(HashMap::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::thread;

    fn counter_wake(count: &AtomicUsize) -> impl FnOnce() + '_ {
        move || {
            count.fetch_add(1, Ordering::SeqCst);
        }
    }

    // ── DrainBuffer ───────────────────────────────────────────────────────

    #[test]
    fn buffer_roundtrip_and_clear() {
        let mut b = DrainBuffer::new(16);
        assert!(b.push(b"abc"));
        assert!(b.push(b"def"));
        assert_eq!(b.take_all(), b"abcdef");
        assert!(b.is_empty());
    }

    #[test]
    fn buffer_saturates_when_non_empty_over_limit() {
        let mut b = DrainBuffer::new(8);
        assert!(b.push(b"12345678")); // exactly full
        assert!(!b.push(b"x"), "non-empty over-limit push must be rejected");
        assert_eq!(b.take_all(), b"12345678");
        assert!(b.push(b"y"), "emptied buffer accepts again");
    }

    #[test]
    fn buffer_accepts_oversized_batch_when_empty() {
        let mut b = DrainBuffer::new(8);
        assert!(
            b.push(&[0u8; 64]),
            "empty buffer unconditionally accepts (deadlock guard)"
        );
    }

    // ── SessionDrain wake protocol ────────────────────────────────────────

    #[test]
    fn wake_fires_once_per_consumption_cycle() {
        let drain = SessionDrain::default();
        let n = AtomicUsize::new(0);

        assert!(drain.push(b"a", counter_wake(&n)));
        assert!(drain.push(b"b", counter_wake(&n)), "second push coalesced");
        assert_eq!(n.load(Ordering::SeqCst), 1, "at most one wake in flight");

        let got = drain.take_and_rearm(counter_wake(&n));
        assert_eq!(got, b"ab");
        assert!(drain.is_empty());

        assert!(drain.push(b"c", counter_wake(&n)));
        assert_eq!(n.load(Ordering::SeqCst), 2, "new cycle must re-wake");
    }

    #[test]
    fn rejected_push_still_guarantees_a_wake() {
        // Saturated sink: producer gets `false` but an in-flight wake from the
        // last accepted push is what brings the consumer to free space.
        let drain = SessionDrain::with_capacity(4);
        let n = AtomicUsize::new(0);

        assert!(drain.push(b"abcd", counter_wake(&n)));
        assert!(
            !drain.push(b"x", || {}),
            "non-empty over-limit push must be rejected"
        );
        assert_eq!(drain.take_and_rearm(counter_wake(&n)), b"abcd");
        // Space freed: retry succeeds and starts a fresh wake cycle.
        assert!(drain.push(b"x", counter_wake(&n)));
        assert_eq!(n.load(Ordering::SeqCst), 2);
    }

    // ── Closed semantics (orphan-reader shutdown) ────────────────────────

    #[test]
    fn closed_drain_absorbs_pushes_without_buffering_or_waking() {
        // 会话关闭后残留的孤儿 reader 泵继续 push：必须被黑洞吸收（返回 true
        // 让泵读到 EOF 自然退出，而非永久停泊背压循环），且不得缓冲、不得唤醒。
        let drain = SessionDrain::default();
        let n = AtomicUsize::new(0);
        drain.close();

        assert!(drain.is_closed());
        assert!(drain.push(b"orphan bytes", counter_wake(&n)));
        assert!(drain.is_empty(), "closed drain must not buffer");
        assert_eq!(n.load(Ordering::SeqCst), 0, "closed drain must not wake");

        // 二次 close 幂等。
        drain.close();
        assert!(drain.push(b"more", counter_wake(&n)));
        assert!(drain.is_empty());
    }

    #[test]
    fn closed_drain_take_returns_empty_and_never_rearms() {
        let drain = SessionDrain::default();
        let n = AtomicUsize::new(0);
        // close 前的 push 不计数（wake 计数只用于度量 close 之后的行为）。
        drain.push(b"stale", || {});

        drain.close();

        assert_eq!(
            drain.take_and_rearm(counter_wake(&n)),
            Vec::<u8>::new(),
            "closed drain reports empty to the consumer"
        );
        assert_eq!(
            n.load(Ordering::SeqCst),
            0,
            "closed drain must never re-arm wakes"
        );
    }

    #[test]
    fn open_drain_unaffected_by_closed_semantics() {
        // 未 close 的正常路径行为不变（防回归守卫）。
        let drain = SessionDrain::default();
        let n = AtomicUsize::new(0);
        assert!(!drain.is_closed());
        assert!(drain.push(b"data", counter_wake(&n)));
        assert_eq!(n.load(Ordering::SeqCst), 1);
        assert_eq!(drain.take_and_rearm(counter_wake(&n)), b"data");
    }

    #[test]
    fn take_rearms_when_producer_slipped_in_during_race_window() {
        // Deterministic simulation of the race:
        //   take() empties buffer → producer pushes → re-arm check sees it.
        // We cannot interleave inside take_and_rearm single-threaded, so we
        // verify the observable contract instead: after take, any subsequent
        // push triggers exactly one fresh wake even though old data existed.
        let drain = SessionDrain::default();
        let n = AtomicUsize::new(0);

        drain.push(b"old", || {});
        assert_eq!(drain.take_and_rearm(|| {}), b"old");
        // Race window: producer writes between take and frontend loop stop.
        drain.push(b"late", counter_wake(&n));
        assert_eq!(n.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn concurrent_push_take_conserves_bytes_and_never_hangs() {
        use std::sync::atomic::AtomicUsize as AU;
        use std::time::{Duration, Instant};

        const TOTAL: usize = 50_000;
        const CHUNK: usize = 97;
        let drain = Arc::new(SessionDrain::with_capacity(1024));
        let wakes = Arc::new(AU::new(0));

        let producer = {
            let drain = drain.clone();
            let wakes = wakes.clone();
            thread::spawn(move || {
                let mut sent = 0usize;
                while sent < TOTAL {
                    let end = (sent + CHUNK).min(TOTAL);
                    let bytes: Vec<u8> = (sent..end).map(|i| (i % 251) as u8).collect();
                    // Retry on saturation — same contract as OutputPump.
                    while !drain.push(&bytes, {
                        let wakes = wakes.clone();
                        move || {
                            wakes.fetch_add(1, Ordering::Relaxed);
                        }
                    }) {
                        std::thread::sleep(Duration::from_micros(50));
                    }
                    sent = end;
                }
            })
        };

        let consumer = {
            let drain = drain.clone();
            thread::spawn(move || {
                let mut received: Vec<u8> = Vec::new();
                let deadline = Instant::now() + Duration::from_secs(10);
                while received.len() < TOTAL {
                    if Instant::now() > deadline {
                        panic!("consumer starved — lost wakeup?");
                    }
                    let chunk = drain.take_and_rearm(|| {});
                    received.extend_from_slice(&chunk);
                    if chunk.is_empty() {
                        std::thread::sleep(Duration::from_micros(50));
                    }
                }
                received
            })
        };

        let sent_handle = producer.join().expect("producer panicked");
        let received = consumer.join().expect("consumer panicked");
        assert_eq!(sent_handle, ());
        assert_eq!(received.len(), TOTAL);
        for (i, b) in received.iter().enumerate() {
            assert_eq!(*b, (i % 251) as u8, "byte order preserved at {i}");
        }
        assert!(wakes.load(Ordering::Relaxed) >= 1);
    }
}
