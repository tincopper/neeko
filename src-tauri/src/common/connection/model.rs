use serde::{Deserialize, Serialize};

/// SSH 认证方式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuthMethod {
    Password(String),
    KeyFile(String),
    KeyFileWithPassphrase {
        key_path: String,
        passphrase: String,
    },
}
