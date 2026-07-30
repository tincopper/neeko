//! Spawn LSP servers in Local / WSL / SSH environments via the unified executor.
//!
//! Bridges async [`ExecChild`] stdio to synchronous [`Read`]/[`Write`] so the
//! existing LSP reader/writer threads keep working.

use std::collections::VecDeque;
use std::io::{self, Read, Write};
use std::sync::mpsc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc as tokio_mpsc;

use crate::common::executor::factory::{create_executor, ExecTarget};
use crate::common::executor::{ExecChild, SpawnOptions};
use crate::common::runtime::AppRuntime;

/// Long-lived LSP process with sync stdio + kill handle.
pub struct LspProcess {
    stdin: Option<Box<dyn Write + Send>>,
    stdout: Option<Box<dyn Read + Send>>,
    stderr: Option<Box<dyn Read + Send>>,
    kill: Option<Box<dyn FnOnce() + Send>>,
    /// Best-effort OS / remote process id.
    pub pid: Option<u32>,
}

impl LspProcess {
    /// Take ownership of stdio handles (for reader/writer threads).
    #[allow(clippy::type_complexity)]
    pub fn take_stdio(
        &mut self,
    ) -> Result<
        (
            Box<dyn Write + Send>,
            Box<dyn Read + Send>,
            Box<dyn Read + Send>,
        ),
        String,
    > {
        let stdin = self
            .stdin
            .take()
            .ok_or_else(|| "LSP stdin already taken".to_string())?;
        let stdout = self
            .stdout
            .take()
            .ok_or_else(|| "LSP stdout already taken".to_string())?;
        let stderr = self
            .stderr
            .take()
            .ok_or_else(|| "LSP stderr already taken".to_string())?;
        Ok((stdin, stdout, stderr))
    }

    /// Kill the language server process (best-effort).
    pub fn kill(&mut self) {
        if let Some(kill) = self.kill.take() {
            kill();
        }
    }
}

impl Drop for LspProcess {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Spawn an LSP server in `target` with optional project working directory.
///
/// Runs on a dedicated OS thread with its own Tokio runtime so it is safe to
/// call from *any* context — including async Tauri commands (where
/// `Handle::block_on` would panic with "cannot start a runtime from within a
/// runtime").
pub fn spawn_lsp_process(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
    current_dir: Option<&str>,
) -> Result<LspProcess, String> {
    let target = target.clone();
    let cmd = cmd.to_string();
    let args = args.iter().copied().map(String::from).collect::<Vec<_>>();
    let current_dir = current_dir.map(String::from);
    blocking_thread(move || {
        let runtime = AppRuntime::from_tauri();
        let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
        runtime.handle().block_on(spawn_lsp_process_async(
            &target,
            &cmd,
            &args_ref,
            current_dir.as_deref(),
        ))
    })
}

async fn spawn_lsp_process_async(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
    current_dir: Option<&str>,
) -> Result<LspProcess, String> {
    let opts = SpawnOptions {
        cmd,
        args,
        current_dir,
    };
    let child = create_executor(target)
        .spawn_with(opts)
        .await
        .map_err(|e| format!("Failed to spawn LSP process: {e}"))?;

    bridge_exec_child(child).await
}

async fn bridge_exec_child(mut child: ExecChild) -> Result<LspProcess, String> {
    let pid = child.pid;
    let (async_stdin, async_stdout, async_stderr) = child.take_stdio();
    let mut async_stdin = async_stdin.ok_or_else(|| "LSP process has no stdin".to_string())?;
    let mut async_stdout = async_stdout.ok_or_else(|| "LSP process has no stdout".to_string())?;
    let mut async_stderr = async_stderr.ok_or_else(|| "LSP process has no stderr".to_string())?;
    let (wait, kill_fn) = child.into_wait_and_kill();

    let (in_tx, mut in_rx) = tokio_mpsc::unbounded_channel::<Vec<u8>>();
    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>();
    let (err_tx, err_rx) = mpsc::channel::<Vec<u8>>();
    let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();

    // stdin: sync writer → async process
    tokio::spawn(async move {
        while let Some(chunk) = in_rx.recv().await {
            if async_stdin.write_all(&chunk).await.is_err() {
                break;
            }
            let _ = async_stdin.flush().await;
        }
    });

    // stdout: async process → sync reader
    tokio::spawn(async move {
        let mut buf = vec![0u8; 16 * 1024];
        loop {
            match async_stdout.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if out_tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // stderr
    tokio::spawn(async move {
        let mut buf = vec![0u8; 8 * 1024];
        loop {
            match async_stderr.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if err_tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // lifecycle: kill signal or natural exit
    let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
    tokio::spawn(async move {
        tokio::select! {
            _ = kill_rx => {
                let _ = kill_fn().await;
            }
            _ = wait => {}
        }
        let _ = done_tx.send(());
    });

    let kill = Box::new(move || {
        let _ = kill_tx.send(());
        // Best-effort wait so pipes drain (avoid zombies on local/WSL).
        let _ = done_rx.recv_timeout(std::time::Duration::from_secs(2));
    });

    Ok(LspProcess {
        stdin: Some(Box::new(ChannelWriter { tx: in_tx })),
        stdout: Some(Box::new(ChannelReader::new(out_rx))),
        stderr: Some(Box::new(ChannelReader::new(err_rx))),
        kill: Some(kill),
        pid,
    })
}

// ── Sync adapters ───────────────────────────────────────────────────────

struct ChannelWriter {
    tx: tokio_mpsc::UnboundedSender<Vec<u8>>,
}

impl Write for ChannelWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.tx
            .send(buf.to_vec())
            .map_err(|e| io::Error::new(io::ErrorKind::BrokenPipe, e))?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct ChannelReader {
    rx: mpsc::Receiver<Vec<u8>>,
    buf: VecDeque<u8>,
    eof: bool,
}

impl ChannelReader {
    const fn new(rx: mpsc::Receiver<Vec<u8>>) -> Self {
        Self {
            rx,
            buf: VecDeque::new(),
            eof: false,
        }
    }
}

impl Read for ChannelReader {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        while self.buf.is_empty() && !self.eof {
            match self.rx.recv() {
                Ok(chunk) => {
                    self.buf.extend(chunk);
                }
                Err(_) => {
                    self.eof = true;
                }
            }
        }
        if self.buf.is_empty() {
            return Ok(0);
        }
        let n = out.len().min(self.buf.len());
        for (i, b) in self.buf.drain(..n).enumerate() {
            out[i] = b;
        }
        Ok(n)
    }
}

/// Run a short command on `target` and return exit code + stdout/stderr (blocking).
///
/// Runs on a dedicated OS thread with its own Tokio runtime so it is safe to
/// call from any context (see [`spawn_lsp_process`]).
pub fn run_command_blocking(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
) -> Result<(i32, String, String), String> {
    let target = target.clone();
    let cmd = cmd.to_string();
    let args = args.iter().copied().map(String::from).collect::<Vec<_>>();
    blocking_thread(move || {
        let runtime = AppRuntime::from_tauri();
        let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
        runtime.handle().block_on(async {
            let output = crate::common::executor::sync::collect_output(&target, &cmd, &args_ref)
                .await
                .map_err(|e| e.to_string())?;
            Ok::<_, String>((
                output.exit_code,
                String::from_utf8_lossy(&output.stdout).into_owned(),
                String::from_utf8_lossy(&output.stderr).into_owned(),
            ))
        })
    })
}

/// Run `func` on a dedicated OS thread with a fresh Tokio runtime, returning
/// its result via a channel. This avoids "cannot start a runtime from within a
/// runtime" panics when the caller is itself on a Tokio runtime thread (e.g.
/// an async Tauri command).
fn blocking_thread<F, R>(func: F) -> Result<R, String>
where
    F: FnOnce() -> Result<R, String> + Send + 'static,
    R: Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(func());
    });
    rx.recv()
        .map_err(|e| format!("blocking thread recv error: {e}"))?
}
