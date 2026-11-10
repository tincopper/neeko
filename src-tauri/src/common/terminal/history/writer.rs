//! 独立写线程：把 PTY 输出净化后批量落盘，绝不反压读泵。
//!
//! 生命周期靠 channel：reader / SSH-IO 线程持有 `Recorder`，它退出时 sender drop，
//! 写线程收到断开发 `finish()` 并做最后一次原子写后自行退出 —— 不需要显式 `stop`，
//! 也不会因为漏调清理而泄漏线程（`concurrency-guidelines.md` 单一强所有者口径）。

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, SyncSender};
use std::time::Duration;

use super::sanitizer::Sanitizer;
use super::store::{tail, write_atomic};

/// 写线程批量落盘的间隔：合并 16ms 级的 PTY flush，避免每批一次磁盘写。
const WRITE_INTERVAL: Duration = Duration::from_millis(250);

/// reader 线程给写线程的有界队列容量。满了就丢（回放是尽力而为），绝不反压读泵 ——
/// 背压由 `SessionDrain` 独立负责。
const RECORD_QUEUE_CAPACITY: usize = 64;

/// 一个会话的落盘句柄。克隆它不会复制日志：所有 clone 共享同一个写线程。
#[derive(Clone, Debug)]
pub struct Recorder {
    tx: SyncSender<Vec<u8>>,
}

impl Recorder {
    /// 启动写线程，`seed` 是本次会话日志的初始正文（恢复时为旧历史，新建时为空）。
    /// 路径合法性已由 [`super::store::HistoryStore::checked_log_path`] 保证；本函数不再返回
    /// `Option`，避免调用方把「非法 id」误当成「可以不落盘」而静默吞掉。
    #[must_use]
    pub(crate) fn start(dir: PathBuf, path: PathBuf, seed: Vec<u8>) -> Self {
        let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(RECORD_QUEUE_CAPACITY);
        let short: String = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .chars()
            .take(8)
            .collect();
        let _ = std::thread::Builder::new()
            .name(format!("pty-log-{short}"))
            .spawn(move || write_loop(&dir, &path, rx, seed));
        Self { tx }
    }

    /// 读泵侧调用：非阻塞投递，队列满直接丢弃。
    pub fn record(&self, bytes: &[u8]) {
        if !bytes.is_empty() {
            let _ = self.tx.try_send(bytes.to_vec());
        }
    }
}

fn write_loop(dir: &Path, path: &Path, rx: mpsc::Receiver<Vec<u8>>, mut buf: Vec<u8>) {
    let mut sanitizer = Sanitizer::new();
    // 恢复场景下 seed 就是历史正文；即使新会话没有任何输出，也必须把它落盘，
    // 否则二次恢复会把历史整段丢掉。
    let mut dirty = !buf.is_empty();

    loop {
        match rx.recv_timeout(WRITE_INTERVAL) {
            Ok(chunk) => {
                let text = sanitizer.feed(&chunk);
                if !text.is_empty() {
                    buf = tail(&buf, text.as_bytes());
                    dirty = true;
                }
                // 合批：把当前已排队的 chunk 一次性吃光再落一次盘。
                while let Ok(chunk) = rx.try_recv() {
                    let text = sanitizer.feed(&chunk);
                    if !text.is_empty() {
                        buf = tail(&buf, text.as_bytes());
                        dirty = true;
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let text = sanitizer.finish();
                if !text.is_empty() {
                    // 最后一行未以 LF 结束：补行尾，避免下一会话首行与它粘连。
                    let mut chunk = text.into_bytes();
                    chunk.extend_from_slice(b"\r\n");
                    buf = tail(&buf, &chunk);
                    dirty = true;
                }
                if dirty {
                    write_atomic(dir, path, &buf);
                }
                break;
            }
        }
        if dirty {
            write_atomic(dir, path, &buf);
            dirty = false;
        }
    }
}
