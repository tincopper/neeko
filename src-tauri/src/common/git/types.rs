//! Git diff and push types.

use serde::{Deserialize, Serialize};

/// A single line in a diff hunk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DiffLine {
    /// Unchanged context line.
    Context(String),
    /// Added line.
    Added(String),
    /// Removed line.
    Removed(String),
    /// Collapsed consecutive unmodified lines ("12 unmodified lines").
    Collapsed(String),
}

/// A single diff hunk (a contiguous block of changed lines).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    /// Starting line number in the old file.
    pub old_start: u32,
    /// Number of lines in the old file covered by this hunk.
    pub old_lines: u32,
    /// Starting line number in the new file.
    pub new_start: u32,
    /// Number of lines in the new file covered by this hunk.
    pub new_lines: u32,
    /// Lines in this hunk.
    pub lines: Vec<DiffLine>,
}

/// The complete diff result for a file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    /// All hunks in the diff.
    pub hunks: Vec<DiffHunk>,
    /// Whether the result was truncated due to a line limit.
    #[serde(default)]
    pub truncated: bool,
}

/// Outcome of a git push/pull/fetch operation.
///
/// Returns `Success` on success or `AuthRequired` when authentication fails
/// (triggers the frontend login dialog or ssh-agent guidance).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PushOutcome {
    /// Operation completed successfully.
    Success {},
    /// Authentication is required. When `ssh=true` the frontend should
    /// guide the user to configure ssh-agent rather than showing a password prompt.
    AuthRequired {
        /// Remote URL that requires authentication.
        remote_url: String,
        /// Optional username hint.
        username_hint: Option<String>,
        /// Whether the remote uses SSH (vs HTTPS).
        ssh: bool,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_serialize_and_deserialize_push_outcome() {
        // Success
        let success = PushOutcome::Success {};
        let json = serde_json::to_string(&success).unwrap();
        let de: PushOutcome = serde_json::from_str(&json).unwrap();
        assert!(matches!(de, PushOutcome::Success {}));

        // AuthRequired (https)
        let auth = PushOutcome::AuthRequired {
            remote_url: "https://github.com/user/repo".to_string(),
            username_hint: Some("alice".to_string()),
            ssh: false,
        };
        let json = serde_json::to_string(&auth).unwrap();
        let de: PushOutcome = serde_json::from_str(&json).unwrap();
        match de {
            PushOutcome::AuthRequired {
                remote_url,
                username_hint,
                ssh,
            } => {
                assert_eq!(remote_url, "https://github.com/user/repo");
                assert_eq!(username_hint, Some("alice".to_string()));
                assert_eq!(ssh, false);
            }
            _ => panic!("deserialized incorrectly"),
        }

        // AuthRequired (ssh)
        let ssh = PushOutcome::AuthRequired {
            remote_url: "git@github.com:user/repo".to_string(),
            username_hint: None,
            ssh: true,
        };
        let json = serde_json::to_string(&ssh).unwrap();
        let de: PushOutcome = serde_json::from_str(&json).unwrap();
        match de {
            PushOutcome::AuthRequired { ssh: s, .. } => {
                assert!(s);
            }
            _ => panic!("deserialized incorrectly"),
        }
    }
}
