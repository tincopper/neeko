use serde::{Deserialize, Serialize};

/// Diff 行类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DiffLine {
    Context(String),
    Added(String),
    Removed(String),
    /// 折叠的连续未修改上下文（"12 unmodified lines"）
    Collapsed(String),
}

/// Diff Hunk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

/// Diff 结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    pub hunks: Vec<DiffHunk>,
    /// 是否因为 line_limit 被截断
    #[serde(default)]
    pub truncated: bool,
}

/// Git push/pull/fetch 操作结果。
/// 成功返回 `Success`，鉴权失败返回 `AuthRequired`（前端弹登录框或 ssh-agent 引导）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PushOutcome {
    /// 操作成功。
    Success,
    /// 需要鉴权。`ssh=true` 时前端不弹密码框，引导 ssh-agent。
    AuthRequired {
        remote_url: String,
        username_hint: Option<String>,
        ssh: bool,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_serialize_and_deserialize_push_outcome() {
        // Success
        let success = PushOutcome::Success;
        let json = serde_json::to_string(&success).unwrap();
        let de: PushOutcome = serde_json::from_str(&json).unwrap();
        assert!(matches!(de, PushOutcome::Success));

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
