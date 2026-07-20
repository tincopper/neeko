//! SSH remote command executor.
//!
//! Runs commands on a remote host via SSH using `russh`. Provides streaming
//! I/O via a background task that bridges `russh::Channel` events to
//! `tokio::mpsc` channels, exposing the same [`CommandExecutor`] interface
//! used by local and WSL executors.
//!
//! # Architecture
//!
//! A single `tokio::spawn` background task owns the `russh::Channel` and runs a
//! `loop { tokio::select! }` that drives two directions concurrently:
//!
//! * **stdin → remote**: reads from an `mpsc` channel, calls `channel.data()`.
//! * **remote → stdout/stderr**: calls `channel.wait()`, fans out `Data` to
//!   stdout and `ExtendedData` to stderr via separate `mpsc` channels.

use std::pin::Pin;
use std::task::{Context, Poll};

use async_trait::async_trait;
use futures::FutureExt;
use russh::{Channel, ChannelMsg};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::mpsc::{self, UnboundedSender};

use russh::client;
use russh::client::Handle;

use super::{BoxAsyncRead, BoxAsyncWrite, CommandExecutor, ExecChild, ExecError, SpawnOptions};
use crate::common::connection::types::AuthMethod;
use crate::common::executor::ssh_auth;
use crate::common::executor::ssh_auth::Client;

/// Receiver type for collecting stdout/stderr data from an SSH channel.
type StdioReceiver = mpsc::Receiver<Vec<u8>>;

// ── RusshReadAdapter ────────────────────────────────────────────────

struct RusshReadAdapter {
    receiver: StdioReceiver,
    buffer: Vec<u8>,
    cursor: usize,
}

impl AsyncRead for RusshReadAdapter {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        if self.cursor < self.buffer.len() {
            let n = std::cmp::min(self.buffer.len() - self.cursor, buf.remaining());
            buf.put_slice(&self.buffer[self.cursor..self.cursor + n]);
            self.cursor += n;
            return Poll::Ready(Ok(()));
        }
        match self.receiver.poll_recv(cx) {
            Poll::Ready(Some(data)) => {
                if data.is_empty() {
                    return Poll::Ready(Ok(()));
                }
                self.buffer = data;
                self.cursor = 0;
                let n = std::cmp::min(self.buffer.len(), buf.remaining());
                buf.put_slice(&self.buffer[0..n]);
                self.cursor = n;
                Poll::Ready(Ok(()))
            }
            Poll::Ready(None) => Poll::Ready(Ok(())),
            Poll::Pending => Poll::Pending,
        }
    }
}

// ── RusshWriteAdapter ───────────────────────────────────────────────

struct RusshWriteAdapter {
    sender: UnboundedSender<Vec<u8>>,
}

impl AsyncWrite for RusshWriteAdapter {
    fn poll_write(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        if self.sender.send(buf.to_vec()).is_ok() {
            Poll::Ready(Ok(buf.len()))
        } else {
            Poll::Ready(Err(std::io::ErrorKind::BrokenPipe.into()))
        }
    }

    fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}

// ── SshExecutor ─────────────────────────────────────────────────────

/// SSH remote command executor using the `russh` library.
pub struct SshExecutor {
    /// Remote host address.
    pub host: String,
    /// SSH port (default 22).
    pub port: u16,
    /// Remote username.
    pub username: String,
    /// Authentication method (password, key file, or key with passphrase).
    pub auth: AuthMethod,
}

impl SshExecutor {
    /// Create a new `SshExecutor` for the given remote host and authentication.
    pub fn new(host: &str, port: u16, username: &str, auth: AuthMethod) -> Self {
        Self {
            host: host.to_string(),
            port,
            username: username.to_string(),
            auth,
        }
    }
}

#[async_trait]
impl CommandExecutor for SshExecutor {
    async fn spawn_with(&self, opts: SpawnOptions<'_>) -> Result<ExecChild, ExecError> {
        use crate::common::utils::command::local::{join_quoted_command, quote_shell_arg};

        let handle =
            ssh_auth::connect_and_authenticate(&self.host, self.port, &self.username, &self.auth)
                .await
                .map_err(|e| ExecError::Ssh(e.to_string()))?;

        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(|e| ExecError::Ssh(format!("channel_open_session: {e}")))?;

        // Login shell so remote profile PATH applies (nvm/fnm/cargo, …).
        // First line prints remote PID for kill support; then exec the user command.
        let mut body = String::new();
        if let Some(dir) = opts.current_dir {
            body.push_str("cd ");
            body.push_str(&quote_shell_arg(dir));
            body.push_str(" && ");
        }
        body.push_str("exec ");
        body.push_str(&join_quoted_command(opts.cmd, opts.args));
        let script = format!("echo $$; {body}");
        let full_cmd = format!("bash -lc {}", quote_shell_arg(&script));

        channel
            .exec(true, full_cmd.as_str())
            .await
            .map_err(|e| ExecError::Ssh(format!("exec: {e}")))?;

        let (stdin_tx, stdin_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (stdout_tx, stdout_rx) = mpsc::channel::<Vec<u8>>(64);
        let (stderr_tx, stderr_rx) = mpsc::channel::<Vec<u8>>(64);
        let (exit_tx, exit_rx) = tokio::sync::watch::channel::<Option<u32>>(None);

        let (remote_pid, _pid_overflow) = read_pid(&mut channel, stdout_tx.clone()).await?;

        tokio::spawn(bridge_loop(
            channel, stdin_rx, stdout_tx, stderr_tx, exit_tx,
        ));

        let stdin: BoxAsyncWrite = Box::pin(RusshWriteAdapter { sender: stdin_tx });
        let stdout: BoxAsyncRead = Box::pin(RusshReadAdapter::new(stdout_rx));
        let stderr: BoxAsyncRead = Box::pin(RusshReadAdapter::new(stderr_rx));
        let wait = wait_from_watch(exit_rx);
        let kill = kill_for(handle, remote_pid);

        Ok(ExecChild::new(
            Some(stdin),
            Some(stdout),
            Some(stderr),
            wait,
            kill,
        ))
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

impl RusshReadAdapter {
    fn new(receiver: StdioReceiver) -> Self {
        Self {
            receiver,
            buffer: Vec::new(),
            cursor: 0,
        }
    }
}

async fn read_pid(
    channel: &mut Channel<client::Msg>,
    stdout_tx: mpsc::Sender<Vec<u8>>,
) -> Result<(u32, Vec<u8>), ExecError> {
    let mut pid_buf = Vec::new();
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => {
                pid_buf.extend_from_slice(&data);
                if let Some(pos) = pid_buf.iter().position(|&b| b == b'\n') {
                    // PID 是换行符前的全部字节
                    let pid_bytes = &pid_buf[..pos];
                    let pid_str = String::from_utf8_lossy(pid_bytes).trim().to_string();
                    let pid: u32 = pid_str.parse().map_err(|_| {
                        ExecError::Ssh(format!("Failed to parse remote PID: '{pid_str}'"))
                    })?;

                    // 换行符后的字节是命令的首段 stdout
                    let overflow = pid_buf[(pos + 1)..].to_vec();
                    if !overflow.is_empty() {
                        let _ = stdout_tx.send(overflow.clone()).await;
                    }
                    return Ok((pid, overflow));
                }
            }
            Some(ChannelMsg::Eof) | None => {
                return Err(ExecError::Ssh(
                    "Channel closed before PID could be read".to_string(),
                ));
            }
            _ => {}
        }
    }
}

async fn bridge_loop(
    mut channel: Channel<client::Msg>,
    mut stdin_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    stdout_tx: mpsc::Sender<Vec<u8>>,
    stderr_tx: mpsc::Sender<Vec<u8>>,
    exit_tx: tokio::sync::watch::Sender<Option<u32>>,
) {
    let mut eof_sent = false;
    loop {
        tokio::select! {
            data = stdin_rx.recv(), if !eof_sent => {
                match data {
                    Some(bytes) => {
                        if channel.data(&bytes[..]).await.is_err() {
                            break;
                        }
                    }
                    None => {
                        let _ = channel.eof().await;
                        eof_sent = true;
                        // 继续循环以接收远端输出和退出状态
                    }
                }
            }
            event = channel.wait() => {
                match event {
                    Some(ChannelMsg::Data { data }) => {
                        let _ = stdout_tx.send(data.to_vec()).await;
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        let _ = stderr_tx.send(data.to_vec()).await;
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        let _ = exit_tx.send(Some(exit_status));
                    }
                    Some(ChannelMsg::Eof) | None => break,
                    _ => {}
                }
            }
        }
    }
}

fn wait_from_watch(
    mut rx: tokio::sync::watch::Receiver<Option<u32>>,
) -> impl std::future::Future<Output = Result<i32, ExecError>> + Send + 'static {
    async move {
        loop {
            if rx.changed().await.is_err() {
                return Err(ExecError::Killed);
            }
            if let Some(code) = *rx.borrow() {
                return Ok(i32::try_from(code).unwrap_or(i32::MAX));
            }
        }
    }
}

fn kill_for(
    handle: Handle<Client>,
    pid: u32,
) -> impl FnOnce() -> Pin<Box<dyn std::future::Future<Output = Result<(), ExecError>> + Send>>
       + Send
       + 'static {
    move || {
        async move {
            let kc = handle
                .channel_open_session()
                .await
                .map_err(|e| ExecError::Ssh(format!("kill channel: {e}")))?;
            let kill_cmd = format!("kill -9 {}", pid);
            kc.exec(true, kill_cmd.as_bytes())
                .await
                .map_err(|e| ExecError::Ssh(format!("kill exec: {e}")))?;
            let _ = kc.close().await;
            Ok(())
        }
        .boxed()
    }
}
