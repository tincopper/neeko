//! Bounded coalescing output pump for PTY reader threads.
//!
//! 根因背景（dump 分析）：旧 reader 每次 4KB read 直接 emit，事件频率等于设备
//! 吞吐频率，JSON IPC 与前端 writeBuffer 全链路无界，WebContent 8 分钟膨胀至
//! 5.2GB。本泵实施两条公理：
//!
//! - **合流**：flush_interval 内的多段 read 合并为一次输出（默认 16ms ≈ 渲染帧距）；
//! - **背压**：缓冲达 `max_buffer` 或 sink 拒收（`flush_fn` 返回 false）时暂停
//!   读取，让内核 PTY 缓冲承接上游，绝不丢弃字节。
//!
//! 已知折衷（见任务 design.md §6）：sink 未满但 read 阻塞期间，已攒数据会推迟
//! 到下一次 read 唤醒或 EOF 才输出 —— 终端静默期无新帧可渲染，无感知影响；
//! EOF 恒定触发残余 flush，保证"最后一屏"即时可见。

use std::io::Read;
use std::time::{Duration, Instant};

/// Pump tuning knobs.
#[derive(Debug, Clone)]
pub(crate) struct PumpConfig {
    /// Pending buffer high-water mark; reaching it forces an immediate flush.
    pub(crate) max_buffer: usize,
    /// Minimum spacing between flushes (coalescing window).
    pub(crate) flush_interval: Duration,
    /// Sleep while backpressured before retrying the sink.
    pub(crate) pause_poll: Duration,
}

impl Default for PumpConfig {
    fn default() -> Self {
        Self {
            max_buffer: 256 * 1024,
            flush_interval: Duration::from_millis(16),
            pause_poll: Duration::from_millis(2),
        }
    }
}

/// Lifetime counters collected by the pump loop.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct PumpStats {
    /// Number of accepted flushes (batches handed to the sink).
    pub(crate) flushes: u64,
    /// Total bytes successfully handed to the sink.
    pub(crate) bytes: u64,
    /// Times a flush was rejected and had to be retried (backpressure depth).
    pub(crate) backpressure_pauses: u64,
}

/// Outcome of a finished pump loop.
#[derive(Debug)]
pub(crate) struct PumpOutcome {
    /// Lifetime counters for observability logging.
    pub(crate) stats: PumpStats,
    /// Terminal read error, if the loop ended abnormally. Residual bytes are
    /// always flushed before returning, regardless of this error.
    pub(crate) error: Option<std::io::Error>,
}

/// Drives the coalescing loop until EOF/read error.
///
/// Byte order is preserved across all flushes; no byte is ever dropped:
/// a rejecting sink (`flush_fn == false`) parks the loop in a sleep-retry
/// cycle, which is exactly the backpressure contract — reading resumes only
/// after the sink accepts.
pub(crate) fn run(
    mut reader: Box<dyn Read + Send>,
    cfg: &PumpConfig,
    mut flush_fn: impl FnMut(&[u8]) -> bool,
) -> PumpOutcome {
    let mut chunk = vec![0u8; 8192];
    let mut pending: Vec<u8> = Vec::with_capacity(64 * 1024);
    let mut last_flush = Instant::now();
    let mut stats = PumpStats::default();
    let mut read_error: Option<std::io::Error> = None;

    loop {
        // Coalescing policy: flush when the window elapsed (and there is
        // anything to send) or the buffer hit its high-water mark.
        if pending.len() >= cfg.max_buffer
            || (!pending.is_empty() && last_flush.elapsed() >= cfg.flush_interval)
        {
            while !pending.is_empty() {
                if flush_fn(&pending) {
                    stats.flushes += 1;
                    stats.bytes += pending.len() as u64;
                    pending.clear();
                    break;
                }
                // Sink saturated → park here instead of reading more; the
                // kernel PTY buffer absorbs upstream pressure.
                stats.backpressure_pauses += 1;
                std::thread::sleep(cfg.pause_poll);
            }
            last_flush = Instant::now();
        }

        match reader.read(&mut chunk) {
            Ok(0) => {
                break;
            }
            Ok(n) => {
                pending.extend_from_slice(&chunk[..n]);
            }
            Err(e) => {
                read_error = Some(e);
                break;
            }
        }
    }

    // EOF or error: deliver residual bytes ("last screen" guarantee).
    while !pending.is_empty() {
        if flush_fn(&pending) {
            stats.flushes += 1;
            stats.bytes += pending.len() as u64;
            pending.clear();
            break;
        }
        stats.backpressure_pauses += 1;
        std::thread::sleep(cfg.pause_poll);
    }

    PumpOutcome {
        stats,
        error: read_error,
    }
}

/// Unix 版及时 flush 泵（services.rs 用于 macOS/Linux 主平台）：
///
/// 与 [`run`] 的区别在于 read 不再阻塞 —— 用 `poll(2)` 带超时等待 fd 可读，
/// 超时返回也会回到循环顶部评估合流窗口。消除阻塞 read 的「静默期不 flush」
/// 折衷：对交互式 TUI（opencode 清屏+重绘后停顿等待下一帧）输出不会再滞留
/// pending 直到下一次 read/EOF，窗口内必达。
#[cfg(unix)]
pub(crate) fn run_polling(
    fd: std::os::fd::RawFd,
    mut reader: Box<dyn Read + Send>,
    cfg: &PumpConfig,
    mut flush_fn: impl FnMut(&[u8]) -> bool,
) -> PumpOutcome {
    let mut chunk = vec![0u8; 8192];
    let mut pending: Vec<u8> = Vec::with_capacity(64 * 1024);
    let mut last_flush = Instant::now();
    let mut stats = PumpStats::default();
    let mut read_error: Option<std::io::Error> = None;

    loop {
        // 合流策略同 run：窗口到期（即使此刻无新数据）或高水位即 flush。
        if !pending.is_empty()
            && (pending.len() >= cfg.max_buffer || last_flush.elapsed() >= cfg.flush_interval)
        {
            while !pending.is_empty() {
                if flush_fn(&pending) {
                    stats.flushes += 1;
                    stats.bytes += pending.len() as u64;
                    pending.clear();
                    break;
                }
                stats.backpressure_pauses += 1;
                std::thread::sleep(cfg.pause_poll);
            }
            last_flush = Instant::now();
        }

        // poll 超时 = 剩余到窗口的时间；无 pending 时空闲轮询（低频防空转）。
        let timeout_ms: i32 = if pending.is_empty() {
            100
        } else {
            let remain = cfg.flush_interval.saturating_sub(last_flush.elapsed());
            remain.as_millis().clamp(1, 1000) as i32
        };
        let mut pfd = libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        };
        let rc = unsafe { libc::poll(&mut pfd, 1, timeout_ms) };
        if rc < 0 {
            let e = std::io::Error::last_os_error();
            if e.kind() != std::io::ErrorKind::Interrupted {
                read_error = Some(e);
                break;
            }
            continue;
        }
        if rc == 0 {
            // 超时：回到循环顶部评估 flush 窗口
            continue;
        }
        if pfd.revents & (libc::POLLIN | libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0 {
            // 可读或挂断/出错：read 一次（POLLHUP 会得到 Ok(0)=EOF 或 Err）
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => pending.extend_from_slice(&chunk[..n]),
                Err(e) => {
                    read_error = Some(e);
                    break;
                }
            }
        }
    }

    // EOF/error：交付残量（"最后一屏"保证），同 run。
    while !pending.is_empty() {
        if flush_fn(&pending) {
            stats.flushes += 1;
            stats.bytes += pending.len() as u64;
            pending.clear();
            break;
        }
        stats.backpressure_pauses += 1;
        std::thread::sleep(cfg.pause_poll);
    }

    PumpOutcome {
        stats,
        error: read_error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::io;
    use std::sync::{Arc, Mutex};

    const NO_DELAY: Option<Duration> = None;

    /// Reader scripted with fixed chunks; optional per-read pre-sleep simulates
    /// producer silence without flaky real-time assumptions.
    struct ScriptedReader {
        steps: VecDeque<(Option<Duration>, Vec<u8>)>,
    }

    impl ScriptedReader {
        fn new(steps: Vec<(Option<Duration>, Vec<u8>)>) -> Self {
            Self {
                steps: steps.into(),
            }
        }
    }

    impl Read for ScriptedReader {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            match self.steps.pop_front() {
                None => Ok(0), // EOF
                Some((delay, chunk)) => {
                    if let Some(d) = delay {
                        std::thread::sleep(d);
                    }
                    let n = chunk.len().min(buf.len());
                    buf[..n].copy_from_slice(&chunk[..n]);
                    Ok(n)
                }
            }
        }
    }

    type FlushLog = Arc<Mutex<Vec<Vec<u8>>>>;

    /// Records accepted flushes; optionally rejects the first N attempts to
    /// simulate a saturated sink (backpressure path).
    struct Sink {
        log: FlushLog,
        reject_next: usize,
    }

    impl Sink {
        fn recording() -> (Self, FlushLog) {
            let log: FlushLog = Arc::new(Mutex::new(Vec::new()));
            (
                Self {
                    log: log.clone(),
                    reject_next: 0,
                },
                log,
            )
        }

        fn with_rejections(mut self, n: usize) -> Self {
            self.reject_next = n;
            self
        }

        fn into_flush_fn(mut self) -> impl FnMut(&[u8]) -> bool {
            move |data: &[u8]| {
                if self.reject_next > 0 {
                    self.reject_next -= 1;
                    return false;
                }
                self.log.lock().unwrap().push(data.to_vec());
                true
            }
        }
    }

    fn joined(log: &FlushLog) -> Vec<u8> {
        log.lock().unwrap().concat()
    }

    #[test]
    fn coalesces_burst_into_single_flush_in_order() {
        let reader = ScriptedReader::new(vec![
            (NO_DELAY, b"abc".to_vec()),
            (NO_DELAY, b"def".to_vec()),
            (NO_DELAY, b"ghi".to_vec()),
        ]);
        let (sink, log) = Sink::recording();
        let outcome = run(
            Box::new(reader),
            &PumpConfig {
                flush_interval: Duration::from_millis(50),
                ..PumpConfig::default()
            },
            sink.into_flush_fn(),
        );
        let batches = log.lock().unwrap();
        assert_eq!(batches.len(), 1, "burst within window must coalesce");
        assert_eq!(batches[0], b"abcdefghi");
        assert_eq!(outcome.stats.bytes, 9);
    }

    #[test]
    fn flushes_at_high_water_mark_without_loss() {
        let reader = ScriptedReader::new(vec![
            (NO_DELAY, vec![7u8; 10]),
            (NO_DELAY, vec![8u8; 10]),
            (NO_DELAY, vec![9u8; 10]),
        ]);
        let (sink, log) = Sink::recording();
        let outcome = run(
            Box::new(reader),
            &PumpConfig {
                max_buffer: 16,
                flush_interval: Duration::from_secs(3600),
                pause_poll: Duration::from_millis(1),
            },
            sink.into_flush_fn(),
        );
        assert!(
            log.lock().unwrap().len() >= 2,
            "high-water mark must force intermediate flushes"
        );
        assert_eq!(
            joined(&log),
            [vec![7u8; 10], vec![8u8; 10], vec![9u8; 10]].concat()
        );
        assert_eq!(outcome.stats.bytes, 30);
    }

    #[test]
    fn backpressure_pauses_then_delivers_everything() {
        let reader = ScriptedReader::new(vec![
            (NO_DELAY, b"one-".to_vec()),
            (NO_DELAY, b"two-".to_vec()),
            (NO_DELAY, b"three".to_vec()),
        ]);
        let (sink, log) = Sink::recording();
        let outcome = run(
            Box::new(reader),
            &PumpConfig {
                max_buffer: 1024,
                flush_interval: Duration::from_secs(3600),
                pause_poll: Duration::from_millis(1),
            },
            sink.with_rejections(1).into_flush_fn(),
        );
        assert!(log.lock().unwrap().len() >= 1);
        assert_eq!(joined(&log), b"one-two-three");
        assert_eq!(
            outcome.stats.bytes, 13,
            "rejected batch must be retried, never dropped"
        );
    }

    #[test]
    fn flushes_residual_on_eof() {
        let reader = ScriptedReader::new(vec![(NO_DELAY, b"tail".to_vec())]);
        let (sink, log) = Sink::recording();
        let outcome = run(
            Box::new(reader),
            &PumpConfig {
                flush_interval: Duration::from_secs(3600),
                ..PumpConfig::default()
            },
            sink.into_flush_fn(),
        );
        let batches = log.lock().unwrap();
        assert_eq!(batches.len(), 1, "EOF must flush residual buffer");
        assert_eq!(batches.concat(), b"tail");
        assert_eq!(outcome.stats.bytes, 4);
    }

    #[test]
    fn no_empty_flush_when_no_data() {
        let reader = ScriptedReader::new(vec![]);
        let (sink, log) = Sink::recording();
        let outcome = run(
            Box::new(reader),
            &PumpConfig::default(),
            sink.into_flush_fn(),
        );
        assert!(
            log.lock().unwrap().is_empty(),
            "EOF with no data must not flush"
        );
        assert_eq!(outcome.stats.bytes, 0);
    }

    #[test]
    fn producer_silence_merges_into_pending_batch() {
        // Design §6 trade-off: with blocking reads, the coalescing window is
        // only evaluated between reads — a silent producer keeps its batch
        // parked until the next byte or EOF. Assert the documented contract.
        let reader = ScriptedReader::new(vec![
            (None, b"A".to_vec()),
            (Some(Duration::from_millis(25)), b"B".to_vec()),
        ]);
        let (sink, log) = Sink::recording();
        let outcome = run(
            Box::new(reader),
            &PumpConfig {
                max_buffer: PumpConfig::default().max_buffer,
                flush_interval: Duration::from_millis(5),
                pause_poll: Duration::from_millis(1),
            },
            sink.into_flush_fn(),
        );
        let batches = log.lock().unwrap();
        assert_eq!(batches.len(), 1, "silence merges into one parked batch");
        assert_eq!(batches.concat(), b"AB");
        assert_eq!(outcome.stats.bytes, 2);
    }

    #[test]
    fn read_error_flushes_residual_and_stops() {
        struct FailingAfterOne {
            reads: usize,
        }
        impl Read for FailingAfterOne {
            fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
                self.reads += 1;
                if self.reads == 1 {
                    buf[0] = b'X';
                    Ok(1)
                } else {
                    Err(io::Error::other("pty gone"))
                }
            }
        }
        let (sink, log) = Sink::recording();
        let outcome = run(
            Box::new(FailingAfterOne { reads: 0 }),
            &PumpConfig {
                flush_interval: Duration::from_secs(3600),
                ..PumpConfig::default()
            },
            sink.into_flush_fn(),
        );
        assert_eq!(joined(&log), b"X", "error path must not drop bytes");
        assert_eq!(outcome.stats.bytes, 1);
        assert!(
            outcome.error.is_some(),
            "read error must be reported to caller"
        );
    }
}
