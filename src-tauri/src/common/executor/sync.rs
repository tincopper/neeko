//! Synchronous wrappers around [`CommandExecutor`].
//!
//! Uses [`Handle::block_on`] so the current thread must be inside a tokio
//! runtime (e.g. a Tauri command or `spawn_blocking` closure).

use tokio::io::AsyncReadExt;
use tokio::runtime::Handle;

use super::factory::{create_executor, ExecTarget};
use super::{CommandExecutor, ExecError};

/// Create an executor for [`ExecTarget`], spawn the command, collect all
/// stdout/stderr, and return the result as a string.
pub fn exec_on(target: &ExecTarget, cmd: &str, args: &[&str]) -> Result<String, ExecError> {
    let executor = create_executor(target);
    exec_sync(&*executor, cmd, args)
}

/// Generic synchronous spawn + collect.
///
/// Internally uses [`Handle::block_on`].
pub fn exec_sync(
    executor: &dyn CommandExecutor,
    cmd: &str,
    args: &[&str],
) -> Result<String, ExecError> {
    let handle = Handle::current();
    let _guard = handle.enter();

    handle.block_on(async {
        let mut child = executor.spawn(cmd, args).await?;

        let mut stdout = Vec::new();
        if let Some(ref mut reader) = child.stdout {
            reader.read_to_end(&mut stdout).await.map_err(ExecError::Io)?;
        }

        let mut stderr = Vec::new();
        if let Some(ref mut reader) = child.stderr {
            reader.read_to_end(&mut stderr).await.map_err(ExecError::Io)?;
        }

        match child.wait.await {
            Ok(0) => Ok(String::from_utf8_lossy(&stdout).to_string()),
            Ok(code) => {
                let msg = if !stderr.is_empty() {
                    String::from_utf8_lossy(&stderr).to_string()
                } else {
                    format!("Command exited with code {}", code)
                };
                Err(ExecError::Ssh(msg))
            }
            Err(e) => Err(e),
        }
    })
}
