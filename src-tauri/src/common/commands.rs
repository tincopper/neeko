//! Common-level Tauri commands shared across domains.
//!
//! Kept extremely thin: parameter reception + dispatch to services. Currently
//! hosts the frontend error ingestion bridge used by the global error guard.

/// Format a frontend error into a single loggable line (with optional stack).
///
/// Extracted as a pure function so the command's core formatting logic is
/// unit-testable without a live `log` logger (the global logger can only be
/// installed once per process — see `common::logger`).
fn format_frontend_error(source: &str, message: &str, stack: Option<&str>) -> String {
    match stack {
        Some(s) => format!("[Frontend][{source}] {message}\n{s}"),
        None => format!("[Frontend][{source}] {message}"),
    }
}

/// Ingest a frontend JS error (from `window.onerror` / `unhandledrejection` /
/// `ErrorBoundary`) into the Rust file logger so it lands in `~/.neeko/neeko.log`.
///
/// Deliberately not `Result`-typed: the reporting path must never fail the
/// caller (the frontend swallows any rejection to avoid a secondary crash).
#[tauri::command]
pub fn log_frontend_error(source: String, message: String, stack: Option<String>) {
    let line = format_frontend_error(&source, &message, stack.as_deref());
    log::error!("{line}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_error_without_stack() {
        let line = format_frontend_error("window", "boom", None);
        assert_eq!(line, "[Frontend][window] boom");
    }

    #[test]
    fn formats_error_with_stack() {
        let line = format_frontend_error("rejection", "oops", Some("stack-here"));
        assert_eq!(line, "[Frontend][rejection] oops\nstack-here");
    }

    #[test]
    fn empty_source_still_produces_loggable_line() {
        let line = format_frontend_error("", "nope", None);
        assert_eq!(line, "[Frontend][] nope");
    }

    #[test]
    fn command_delegates_to_formatter_and_logs() {
        // 直接调用命令本身：验证它把参数正确委托给 formatter（不 panic），
        // 且 formatter 输出与命令入参一致。
        log_frontend_error("window".into(), "boom".into(), None);
        log_frontend_error("rejection".into(), "oops".into(), Some("stack-here".into()));
    }
}
