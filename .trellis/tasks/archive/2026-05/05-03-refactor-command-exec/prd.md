# Task: Refactor command execution functions

## Overview
Unify scattered command execution functions (`no_window_cmd`, `run_wsl_bash`, `ssh_exec`, `ssh_exec_command`) into a centralized `command/` module with consistent naming: `command::local::exec`, `command::wsl::exec`, `command::ssh::exec`.

## Current State

### Functions to Refactor

| Function | Current Location | Purpose | Signature |
|----------|-----------------|---------|----------|
| `no_window_cmd` | `git/local.rs:7` | Local process execution (no window) | `fn(program: &str) -> Command` |
| `no_window_cmd` | `git/wsl.rs:11` | WSL process execution (no window, duplicate) | `fn(program: &str) -> Command` |
| `run_wsl_bash` | `git/wsl.rs:23` | WSL bash command execution | `pub fn(distro: &str, cmd: &str) -> Result<String>` |
| `ssh_exec` | `opencode_theme.rs:69` | SSH channel execution (verify exit code) | `async fn(channel, cmd: &str) -> Result<()>` |
| `ssh_exec_command` | `git/remote.rs:28` | SSH full execution (auth + return result) | `pub async fn(host, port, username, auth, cmd) -> Result<String>` |

### Problems
1. **Duplicate definitions**: `no_window_cmd` defined twice in `local.rs` and `wsl.rs`
2. **Inconsistent naming**: `no_window_cmd`, `run_wsl_bash`, `ssh_exec`, `ssh_exec_command` have different styles
3. **Scattered distribution**: Same-type functions spread across 4 different files
4. **Platform handling**: `local.rs` version has `#[cfg(target_os = "windows")]` but `wsl.rs` version is Windows-only

## Requirements

### Target Structure

```
src-tauri/src/command/
├── mod.rs           # Module entry, declare sub-modules
├── local.rs         # Local command execution
├── wsl.rs           # WSL command execution
└── ssh.rs           # SSH command execution
```

### Unified Naming Convention

| Module | Function | Description |
|--------|----------|-------------|
| `command::local` | `exec(program: &str) -> Command` | Former `no_window_cmd` |
| `command::wsl` | `exec(distro: &str, cmd: &str) -> Result<String>` | Former `run_wsl_bash` |
| `command::ssh` | `exec(channel, cmd) -> Result<()>` | Former `ssh_exec` (opencode_theme) |
| `command::ssh` | `exec_command(host, port, username, auth, cmd) -> Result<String>` | Former `ssh_exec_command` |

## Acceptance Criteria

- [ ] Create `src-tauri/src/command/` directory with `mod.rs`, `local.rs`, `wsl.rs`, `ssh.rs`
- [ ] Move `no_window_cmd` from `git/local.rs` to `command/local.rs` as `exec`
- [ ] Move `run_wsl_bash` from `git/wsl.rs` to `command/wsl.rs` as `exec`
- [ ] Move `ssh_exec` from `opencode_theme.rs` to `command/ssh.rs` as `exec`
- [ ] Move `ssh_exec_command` from `git/remote.rs` to `command/ssh.rs` as `exec_command`
- [ ] Register `command` module in `src-tauri/src/lib.rs`
- [ ] Update all import references in:
  - `git/local.rs` - use `command::local::exec`
  - `git/wsl.rs` - use `command::wsl::exec`
  - `git/remote.rs` - use `command::ssh::exec_command`
  - `opencode_theme.rs` - use `command::ssh::exec`
- [ ] Remove duplicate `no_window_cmd` from `git/wsl.rs`
- [ ] Remove `safe_path` from `git/remote.rs` (move to `command/ssh.rs`)
- [ ] Code compiles without errors: `cargo check --manifest-path src-tauri/Cargo.toml`
- [ ] All tests pass: `cargo test --manifest-path src-tauri/Cargo.toml`

## Technical Notes

### command/local.rs
```rust
use std::process::Command;

/// Create no-window process command (hide window on Windows)
pub fn exec(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}
```

### command/wsl.rs
```rust
use anyhow::Result;
use crate::command::local;

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn safe_path(path: &str) -> String {
    path.replace('\'', "'\\''")
}

/// Execute command via WSL bash and return stdout
pub fn exec(distro: &str, cmd: &str) -> Result<String> {
    let mut wsl_cmd = local::exec("wsl.exe");
    let output = wsl_cmd
        .arg("-d")
        .arg(distro)
        .arg("bash")
        .arg("-c")
        .arg(cmd)
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to execute wsl.exe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("Command failed with status {}", output.status)
        };
        return Err(anyhow::anyhow!("{}", msg));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Open IDE in WSL (run in background)
pub fn open_ide(distro: &str, project_path: &str, ide: &str) -> Result<()> {
    let _ = local::exec("wsl.exe")
        .arg("-d")
        .arg(distro)
        .arg("--cd")
        .arg(project_path)
        .arg("--")
        .arg(ide)
        .arg(".")
        .spawn()
        .map_err(|e| anyhow::anyhow!("Failed to launch IDE in WSL: {}", e))?;
    Ok(())
}
```

### command/ssh.rs
```rust
use anyhow::Result;
use russh::*;
use std::sync::Arc;

/// Execute command via SSH channel and wait for completion (verify exit code)
pub async fn exec(
    channel: &mut russh::Channel<russh::client::Msg>,
    cmd: &str,
) -> Result<()> {
    use russh::ChannelMsg;

    channel.exec(true, cmd.as_bytes()).await?;

    loop {
        match channel.wait().await {
            Some(ChannelMsg::ExitStatus { exit_status }) => {
                if exit_status != 0 {
                    return Err(anyhow::anyhow!(
                        "SSH command failed with exit code {}",
                        exit_status
                    ));
                }
            }
            Some(ChannelMsg::Eof) | None => break,
            _ => {}
        }
    }
    Ok(())
}

/// One-shot SSH authentication + execute command + return stdout
pub async fn exec_command(
    host: &str,
    port: u16,
    username: &str,
    auth: &crate::models::AuthMethod,
    cmd: &str,
) -> Result<String> {
    struct Client;

    impl client::Handler for Client {
        type Error = russh::Error;
        async fn check_server_key(
            &mut self,
            _server_public_key: &russh::keys::PublicKey,
        ) -> Result<bool, Self::Error> {
            Ok(true)
        }
    }

    let config = Arc::new(client::Config::default());
    let mut session = client::connect(config, (host, port), Client).await?;

    let auth_result = match auth {
        crate::models::AuthMethod::Password(password) => {
            session.authenticate_password(username, password).await?
        }
        crate::models::AuthMethod::KeyFile(key_path) => {
            let key_pair = russh::keys::load_secret_key(key_path, None)?;
            let key_with_hash =
                russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
            session.authenticate_publickey(username, key_with_hash).await?
        }
        crate::models::AuthMethod::KeyFileWithPassphrase {
            key_path,
            passphrase,
        } => {
            let key_pair = russh::keys::load_secret_key(key_path, Some(passphrase))?;
            let key_with_hash =
                russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
            session.authenticate_publickey(username, key_with_hash).await?
        }
    };

    if !auth_result.success() {
        return Err(anyhow::anyhow!("SSH authentication failed"));
    }

    let mut channel = session.channel_open_session().await?;
    channel.exec(true, cmd.as_bytes()).await?;

    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    let mut exit_code: Option<u32> = None;

    loop {
        match channel.wait().await {
            Some(russh::ChannelMsg::Data { data }) => {
                stdout_buf.extend_from_slice(&data);
            }
            Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                stderr_buf.extend_from_slice(&data);
            }
            Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                exit_code = Some(exit_status);
            }
            Some(russh::ChannelMsg::Eof) | None => break,
            _ => {}
        }
    }

    let _ = channel.close().await;
    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "")
        .await;

    let stdout = String::from_utf8_lossy(&stdout_buf).to_string();

    if let Some(code) = exit_code {
        if code != 0 {
            let stderr = String::from_utf8_lossy(&stderr_buf).trim().to_string();
            let msg = if !stderr.is_empty() {
                stderr
            } else {
                format!("SSH command failed with exit code {}", code)
            };
            return Err(anyhow::anyhow!("{}", msg));
        }
    }

    Ok(stdout)
}

fn safe_path(path: &str) -> String {
    path.replace('\'', "'\\''")
}
```

### command/mod.rs
```rust
pub mod local;
pub mod wsl;
pub mod ssh;
```

## Implementation Steps

### Step 1: Create `command/` module directory and files
Create the following files:
- `src-tauri/src/command/mod.rs`
- `src-tauri/src/command/local.rs`
- `src-tauri/src/command/wsl.rs`
- `src-tauri/src/command/ssh.rs`

### Step 2: Register module
Modify `src-tauri/src/lib.rs`, add:
```rust
pub mod command;
```

### Step 3: Migrate `git/local.rs`
- Delete `no_window_cmd` function
- Add `use crate::command::local::exec;`
- Replace all `no_window_cmd(...)` with `exec(...)`

### Step 4: Migrate `git/wsl.rs`
- Delete `no_window_cmd` function
- Delete `run_wsl_bash` function
- Add `use crate::command::wsl::exec;`
- Replace all `run_wsl_bash(...)` with `exec(...)`

### Step 5: Migrate `git/remote.rs`
- Delete `ssh_exec_command` function
- Delete `safe_path` function (moved to `command/ssh.rs`)
- Add `use crate::command::ssh::exec_command;`
- Replace all `ssh_exec_command(...)` with `exec_command(...)`

### Step 6: Migrate `opencode_theme.rs`
- Delete `ssh_exec` function
- Add `use crate::command::ssh::exec;`
- Replace all `ssh_exec(...)` with `exec(...)`

### Step 7: Verification
```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Out of Scope
- Changing the behavior of any command execution functions
- Refactoring other utility functions not related to command execution
- Modifying frontend code
