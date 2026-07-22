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
}

impl LspProcess {
    /// Take ownership of stdio handles (for reader/writer threads).
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
/// Safe to call from `spawn_blocking` (uses [`AppRuntime::from_tauri`]).
pub fn spawn_lsp_process(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
    current_dir: Option<&str>,
) -> Result<LspProcess, String> {
    let runtime = AppRuntime::try_current_or_tauri();
    runtime
        .handle()
        .block_on(spawn_lsp_process_async(target, cmd, args, current_dir))
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
    fn new(rx: mpsc::Receiver<Vec<u8>>) -> Self {
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
pub fn run_command_blocking(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
) -> Result<(i32, String, String), String> {
    let runtime = AppRuntime::try_current_or_tauri();
    runtime.handle().block_on(async {
        let output = crate::common::executor::sync::collect_output(target, cmd, args)
            .await
            .map_err(|e| e.to_string())?;
        Ok((
            output.exit_code,
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        ))
    })
}
