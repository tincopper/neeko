//! Simple file-based logger that writes structured log lines to `~/.neeko/neeko.log`.
//!
//! Includes size-based rotation: once the log exceeds [`MAX_LOG_BYTES`], it is
//! rotated to `neeko.log.1` (shifting older backups) and a fresh file is opened,
//! keeping the log bounded and preventing unbounded disk growth.

use chrono::Local;
use log::{Level, Metadata, Record};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Global file handle guarded by a mutex for thread-safe log writes.
static FILE_LOGGER: Mutex<Option<std::fs::File>> = Mutex::new(None);

/// Last time we checked whether rotation is needed (throttled to avoid a stat
/// on every single log line — the watcher can emit thousands per second).
static LAST_ROTATE_CHECK: Mutex<Option<Instant>> = Mutex::new(None);

/// Rotate the log file once it exceeds this size.
const MAX_LOG_BYTES: u64 = 20 * 1024 * 1024; // 20 MB
/// How often to re-check the file size for rotation.
const ROTATE_CHECK_INTERVAL: Duration = Duration::from_secs(5);
/// Number of rotated backups to keep (`neeko.log.1` … `neeko.log.{MAX_BACKUPS}`).
const MAX_BACKUPS: u32 = 3;

/// A [`log::Log`] implementation that writes timestamped log lines to a file.
struct FileLogger;

impl log::Log for FileLogger {
    fn enabled(&self, _metadata: &Metadata) -> bool {
        true
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let level = match record.level() {
            Level::Error => "ERROR",
            Level::Warn => " WARN",
            Level::Info => " INFO",
            Level::Debug => "DEBUG",
            Level::Trace => "TRACE",
        };

        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let target = record.target();
        let line = record.line().unwrap_or(0);

        let message = format!(
            "[{}][{}][{}:{}] {}\n",
            timestamp,
            level,
            target,
            line,
            record.args()
        );

        if let Ok(mut guard) = FILE_LOGGER.lock() {
            if let Some(ref mut file) = *guard {
                let _ = file.write_all(message.as_bytes());
                rotate_if_needed(&mut guard);
            }
        }
    }

    fn flush(&self) {}
}

/// Singleton logger instance.
static LOGGER: FileLogger = FileLogger;

/// The absolute path of the active log file (resolved once at init).
static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Initialize the file logger, creating the log directory and opening the log file.
pub fn init_logger() {
    let log_path = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".neeko")
        .join("neeko.log");

    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .ok();

    if let Ok(mut logger) = FILE_LOGGER.lock() {
        *logger = file;
    }
    if let Ok(mut stored) = LOG_PATH.lock() {
        *stored = Some(log_path);
    }

    log::set_logger(&LOGGER)
        .map(|()| log::set_max_level(log::LevelFilter::Debug))
        .ok();
}

/// Rotate the log file if it has grown past [`MAX_LOG_BYTES`].
///
/// Called while holding the `FILE_LOGGER` mutex (the current file handle is
/// replaced in place). Size checks are throttled to [`ROTATE_CHECK_INTERVAL`]
/// so the high-frequency watcher debug logs don't pay a stat per line.
fn rotate_if_needed(guard: &mut std::sync::MutexGuard<'_, Option<std::fs::File>>) {
    let now = Instant::now();
    let due = {
        let last = LAST_ROTATE_CHECK.lock().ok().and_then(|l| *l);
        match last {
            Some(ts) => now.duration_since(ts) >= ROTATE_CHECK_INTERVAL,
            None => true,
        }
    };
    if !due {
        return;
    }
    if let Ok(mut last) = LAST_ROTATE_CHECK.lock() {
        *last = Some(now);
    }

    let path = match LOG_PATH.lock().ok().and_then(|p| p.clone()) {
        Some(p) => p,
        None => return,
    };

    if !rotate_log_file(&path, MAX_LOG_BYTES, MAX_BACKUPS) {
        return;
    }

    // Flush + close the current handle before renaming.
    if let Some(ref mut file) = **guard {
        let _ = file.flush();
    }
    **guard = None;

    // Open a fresh log file.
    let new_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok();
    **guard = new_file;

    // Write a rotation marker directly (cannot use log::info! here — it would
    // re-lock FILE_LOGGER and deadlock, since we already hold the guard).
    if let Some(ref mut file) = **guard {
        let _ = file.write_all(b"[Logger] Log file rotated\n");
    }
}

/// Rotate `log_path` if it exceeds `max_bytes`, keeping `backups` rotated files
/// (`neeko.log.1` … `neeko.log.{backups}`). Returns `true` if rotation happened.
///
/// Pure filesystem operation (no file handles) — extracted for testability.
fn rotate_log_file(log_path: &Path, max_bytes: u64, backups: u32) -> bool {
    let size = fs::metadata(log_path).map(|m| m.len()).unwrap_or(0);
    if size < max_bytes {
        return false;
    }

    // Shift existing backups: neeko.log.{i-1} -> neeko.log.{i}.
    for i in (1..=backups).rev() {
        let from = backup_path(log_path, i - 1);
        let to = backup_path(log_path, i);
        if from.exists() {
            let _ = fs::rename(&from, &to);
        }
    }

    // Rotate current log to neeko.log.1.
    let _ = fs::rename(log_path, backup_path(log_path, 1));
    true
}

/// Path of the `i`-th rotated backup (`neeko.log`, `neeko.log.1`, …).
fn backup_path(log_path: &Path, index: u32) -> PathBuf {
    if index == 0 {
        log_path.to_path_buf()
    } else {
        PathBuf::from(format!("{}.{}", log_path.display(), index))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_path_formats_indexed_names() {
        let base = PathBuf::from("/tmp/neeko.log");
        assert_eq!(backup_path(&base, 0), PathBuf::from("/tmp/neeko.log"));
        assert_eq!(backup_path(&base, 1), PathBuf::from("/tmp/neeko.log.1"));
        assert_eq!(backup_path(&base, 3), PathBuf::from("/tmp/neeko.log.3"));
    }

    #[test]
    fn rotate_log_file_rotates_when_over_threshold() {
        let tmp = tempfile::tempdir().unwrap();
        let log = tmp.path().join("neeko.log");
        std::fs::write(&log, "x".repeat(100)).unwrap();

        let rotated = rotate_log_file(&log, 50, 3);
        assert!(rotated, "超过阈值应触发轮转");
        assert!(
            log.join("neeko.log").exists() || !log.exists(),
            "原文件应被移走"
        );
        assert!(
            tmp.path().join("neeko.log.1").exists(),
            "应生成 neeko.log.1"
        );
    }

    #[test]
    fn rotate_log_file_skips_when_below_threshold() {
        let tmp = tempfile::tempdir().unwrap();
        let log = tmp.path().join("neeko.log");
        std::fs::write(&log, "small").unwrap();

        let rotated = rotate_log_file(&log, 1000, 3);
        assert!(!rotated, "低于阈值不应轮转");
        assert!(log.exists(), "原文件应保留");
        assert!(!tmp.path().join("neeko.log.1").exists(), "不应生成备份");
    }

    #[test]
    fn rotate_log_file_shifts_existing_backups() {
        let tmp = tempfile::tempdir().unwrap();
        let log = tmp.path().join("neeko.log");
        std::fs::write(&log, "x".repeat(100)).unwrap();
        // 预置两个备份
        std::fs::write(tmp.path().join("neeko.log.1"), "backup1").unwrap();
        std::fs::write(tmp.path().join("neeko.log.2"), "backup2").unwrap();

        let rotated = rotate_log_file(&log, 50, 3);
        assert!(rotated);
        // 旧 .1 -> .2，旧 .2 -> .3
        assert!(tmp.path().join("neeko.log.2").exists());
        assert!(tmp.path().join("neeko.log.3").exists());
        // 新备份 .1 是原日志内容
        let b1 = std::fs::read_to_string(tmp.path().join("neeko.log.1")).unwrap();
        assert_eq!(b1.len(), 100);
    }

    #[test]
    fn write_through_rotate_log_file_keeps_append_handle() {
        // 端到端：轮转后新文件可继续追加写入
        let tmp = tempfile::tempdir().unwrap();
        let log = tmp.path().join("neeko.log");
        std::fs::write(&log, "x".repeat(100)).unwrap();

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log)
            .unwrap();
        file.write_all(b"tail").unwrap();
        file.flush().unwrap();

        rotate_log_file(&log, 50, 3);
        let mut new_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log)
            .unwrap();
        new_file.write_all(b"fresh").unwrap();
        new_file.flush().unwrap();

        let content = std::fs::read_to_string(&log).unwrap();
        assert_eq!(content, "fresh");
    }
}
