use chrono::Local;
use log::{Level, Metadata, Record};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

static FILE_LOGGER: Mutex<Option<PathBuf>> = Mutex::new(None);

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

        if let Some(ref path) = *FILE_LOGGER.lock().unwrap() {
            if let Ok(mut file) = OpenOptions::new().append(true).open(path) {
                let _ = file.write_all(message.as_bytes());
            }
        }
    }

    fn flush(&self) {}
}

static LOGGER: FileLogger = FileLogger;

pub fn init_logger() {
    let log_path = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".neeko")
        .join("neeko.log");

    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    *FILE_LOGGER.lock().unwrap() = Some(log_path.clone());

    log::set_logger(&LOGGER)
        .map(|()| log::set_max_level(log::LevelFilter::Debug))
        .ok();
}
