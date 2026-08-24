//! Terminal event names used by local/remote PTY pipelines and task runs.
//! Keep in sync with `src/shared/utils/terminalEvents.ts`.

/// Event name prefix for writing bytes into a PTY session.
pub const TERMINAL_INPUT_EVENT: &str = "terminal-input";
/// Event name prefix for streaming PTY output to the frontend.
pub const TERMINAL_OUTPUT_EVENT: &str = "terminal-output";
/// Event name prefix for reporting PTY/session closure.
pub const TERMINAL_CLOSED_EVENT: &str = "terminal-closed";

/// Builds the frontend input event name for a session id.
#[must_use]
pub fn terminal_input_event(session_id: &str) -> String {
    format!("{TERMINAL_INPUT_EVENT}-{session_id}")
}

/// Builds the output event name for a session id.
#[must_use]
pub fn terminal_output_event(session_id: &str) -> String {
    format!("{TERMINAL_OUTPUT_EVENT}-{session_id}")
}

/// Builds the closed event name for a session id.
#[must_use]
pub fn terminal_closed_event(session_id: &str) -> String {
    format!("{TERMINAL_CLOSED_EVENT}-{session_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_suffixed_terminal_event_names() {
        assert_eq!(terminal_input_event("pty-1"), "terminal-input-pty-1");
        assert_eq!(terminal_output_event("pty-1"), "terminal-output-pty-1");
        assert_eq!(terminal_closed_event("pty-1"), "terminal-closed-pty-1");
    }
}
