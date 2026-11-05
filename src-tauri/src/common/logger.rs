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

/// 第三方**遍历库**的逐目录 DEBUG 不落盘。
///
/// `ignore`（gitignore 感知的目录遍历）与 `globset`（其模式编译）在 DEBUG 级别下**每个目录 /
/// 每个模式各打一行**。实测 `tail -200000 ~/.neeko/neeko.log` 按模块计数：`ignore::walk`
/// 31,279 行（第一大来源）、`globset` 6,909、`ignore::gitignore` 1,137 —— 合计 ~20%，
/// 而**我们的源码从不读这些行**。代价不只在磁盘（9MB / 会话、轮转档 20–43MB）：事故排查时
/// 它们会把真正的时序淹掉（定位 git 状态互踢时必须先 `grep -v` 掉它们才看得清挂载/释放序列）。
///
/// **只登记「实测占行数且从不被读」的 target 前缀**，不要收成「所有第三方都丢」——
/// `notify`（内核事件投递）/ `sqlx` / `tauri` 的 DEBUG 是有价值的一手证据。
///
/// 再评估方法：
/// `tail -200000 ~/.neeko/neeko.log | grep -aoE '\[DEBUG\]\[[a-z_:]+' | sort | uniq -c | sort -rn`
/// 按**模块名**登记（不是字符串前缀）：`"globset"` 必须同时命中 `globset` 与
/// `globset::glob::GlobSet`，但不能误伤将来叫 `globsetx` 的 crate。
const NOISY_TARGETS: &[&str] = &["ignore", "globset"];

/// 是否应把该条记录写进文件。
///
/// 过滤**只针对 `Debug` 及以下**：来自同一 target 的 `Info` / `Warn` / `Error` 是异常信号
/// （例如遍历库报某个目录不可读），必须保留 —— 它们不是逐目录噪声。
fn should_write(level: Level, target: &str) -> bool {
    // `log::Level` 的序是 Error < Warn < Info < Debug < Trace。
    if level <= Level::Info {
        return true;
    }
    !NOISY_TARGETS
        .iter()
        .any(|prefix| target.starts_with(prefix))
}

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
        if !should_write(record.level(), record.target()) {
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

    /// 接线测试：`log()` 必须真的查询 `should_write`（否则谓词对了、噪声照样落盘）。
    ///
    /// 直接驱动 `LOGGER` 并临时装一个临时文件，绕开 `init_logger`（那会写真实 `~/.neeko`）。
    /// 并行的其他用例在此期间写的行会落进这个临时文件 —— 无害：本用例只断言「noise 不在 / keep-me 在」。
    #[test]
    fn log_writes_only_what_the_filter_allows() {
        use log::Log as _;
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("neeko.log");
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .unwrap();
        *FILE_LOGGER.lock().unwrap() = Some(file);

        LOGGER.log(
            &Record::builder()
                .level(Level::Debug)
                .target("ignore::walk")
                .args(format_args!("noise-should-not-land"))
                .build(),
        );
        LOGGER.log(
            &Record::builder()
                .level(Level::Debug)
                .target("neeko_lib::common::git::status_worker::worker")
                .args(format_args!("keep-me"))
                .build(),
        );

        *FILE_LOGGER.lock().unwrap() = None;
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(!content.contains("noise-should-not-land"), "噪声不得落盘");
        assert!(content.contains("keep-me"), "我们的 DEBUG 必须落盘");
    }

    #[test]
    fn third_party_traversal_debug_is_dropped() {
        // 实测噪声源（占日志行数 ~20%）：逐目录 / 逐模式各一行，我们的源码从不读
        assert!(!should_write(Level::Debug, "ignore::walk"));
        assert!(!should_write(Level::Debug, "ignore::gitignore"));
        assert!(!should_write(Level::Debug, "globset"));
        assert!(!should_write(Level::Trace, "globset::glob::GlobSet"));
    }

    #[test]
    fn our_own_debug_is_kept() {
        // 不能因为降噪把一手证据关掉：后端模块的 DEBUG 是排查挂载/重算时序的唯一来源
        assert!(should_write(
            Level::Debug,
            "neeko_lib::common::file::watcher::manager::core"
        ));
        assert!(should_write(
            Level::Debug,
            "neeko_lib::common::git::status_worker::worker"
        ));
    }

    #[test]
    fn third_party_debug_other_than_traversal_is_kept() {
        // 黑名单只登记「实测占行数且从不被读」的那两个前缀；notify 的内核投递是有效证据
        assert!(should_write(Level::Debug, "notify::inotify"));
        assert!(should_write(Level::Debug, "sqlx::query"));
    }

    #[test]
    fn warn_and_error_from_noisy_targets_are_kept() {
        // 同一 target 的异常信号不是逐目录噪声（如遍历库报某目录不可读）
        assert!(should_write(Level::Warn, "ignore::walk"));
        assert!(should_write(Level::Error, "globset"));
        assert!(should_write(Level::Info, "ignore::walk"));
    }

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
