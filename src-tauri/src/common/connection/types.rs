//! SSH connection types (authentication methods).

use serde::{Deserialize, Serialize};

/// SSH authentication method.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuthMethod {
    /// Password-based authentication.
    Password(String),
    /// Key-file-based authentication.
    KeyFile(String),
    /// Key file with an encrypted passphrase.
    KeyFileWithPassphrase {
        /// Path to the SSH private key file.
        key_path: String,
        /// Passphrase to decrypt the key.
        passphrase: String,
    },
}
