//! Simple file-based logger that writes structured log lines to `~/.neeko/neeko.log`.

use chrono::Local;
use log::{Level, Metadata, Record};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

/// Global file handle guarded by a mutex for thread-safe log writes.
static FILE_LOGGER: Mutex<Option<std::fs::File>> = Mutex::new(None);

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
            }
        }
    }

    fn flush(&self) {}
}

/// Singleton logger instance.
static LOGGER: FileLogger = FileLogger;

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

    log::set_logger(&LOGGER)
        .map(|()| log::set_max_level(log::LevelFilter::Debug))
        .ok();
}
