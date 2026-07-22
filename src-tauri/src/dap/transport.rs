//! Adapter I/O transport: stdio DAP vs TCP-listen DAP.
//!
//! Isolates process pipe handling from DAP session/protocol logic.

use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot, Mutex};

use super::types::{AdapterSpawn, AdapterTransport};
use crate::common::executor::{BoxAsyncRead, BoxAsyncWrite};
use crate::AppError;

/// Parse Delve / headless listen line from a single stdout line.
///
/// Accepts both:
/// - `DAP server listening at: 127.0.0.1:12345`
/// - `API server listening at: 127.0.0.1:12345`
pub fn parse_listen_addr_line(line: &str) -> Option<String> {
    const MARKER: &str = " server listening at: ";
    let idx = line.find(MARKER)?;
    let addr = line[idx + MARKER.len()..].trim();
    if addr.is_empty() {
        return None;
    }
    if addr.eq_ignore_ascii_case("stdio") {
        return None;
    }
    Some(addr.to_string())
}

/// Connected DAP read/write pair plus optional process-output fan-in.
pub struct DapIo {
    /// Read half of the DAP transport (stdout or TCP).
    pub reader: BoxAsyncRead,
    /// Write half of the DAP transport (stdin or TCP).
    pub writer: BoxAsyncWrite,
    /// Process pipe lines as (category, line) for the debug console.
    pub proc_out_rx: mpsc::UnboundedReceiver<(String, String)>,
    /// Accumulated stderr output for error reporting.
    pub stderr_buf: Arc<Mutex<String>>,
}

/// Wire stdio or TCP transport from a spawned adapter's pipes.
pub async fn connect_transport(
    spawn: &AdapterSpawn,
    stdout: BoxAsyncRead,
    stderr: BoxAsyncRead,
    stdin: BoxAsyncWrite,
    kill_tx: oneshot::Sender<()>,
) -> Result<(DapIo, oneshot::Sender<()>), AppError> {
    let stderr_buf = Arc::new(Mutex::new(String::new()));
    let (proc_out_tx, proc_out_rx) = mpsc::unbounded_channel::<(String, String)>();

    let (reader, writer) = match spawn.transport {
        AdapterTransport::Stdio => {
            let err_tx = proc_out_tx;
            let stderr_buf_w = Arc::clone(&stderr_buf);
            tokio::spawn(async move {
                forward_process_lines(stderr, "stderr", err_tx, Some(stderr_buf_w)).await;
            });
            (stdout, stdin)
        }
        AdapterTransport::TcpListen => {
            drop(stdin);
            let out_tx = proc_out_tx.clone();
            let err_tx = proc_out_tx;
            let stderr_buf_w = Arc::clone(&stderr_buf);
            let (addr_tx, addr_rx) = oneshot::channel::<Result<String, String>>();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                let mut addr_tx = Some(addr_tx);
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            if addr_tx.is_some() {
                                if let Some(addr) = parse_listen_addr_line(&line) {
                                    if let Some(tx) = addr_tx.take() {
                                        let _ = tx.send(Ok(addr));
                                    }
                                    continue;
                                }
                            }
                            if !line.trim().is_empty() {
                                let _ = out_tx.send(("stdout".into(), line));
                            }
                        }
                        Ok(None) => {
                            if let Some(tx) = addr_tx.take() {
                                let _ = tx.send(Err(
                                    "Debug adapter exited before announcing a listen address"
                                        .into(),
                                ));
                            }
                            break;
                        }
                        Err(e) => {
                            if let Some(tx) = addr_tx.take() {
                                let _ = tx.send(Err(format!("Failed reading adapter stdout: {e}")));
                            }
                            break;
                        }
                    }
                }
            });
            tokio::spawn(async move {
                forward_process_lines(stderr, "stderr", err_tx, Some(stderr_buf_w)).await;
            });

            let addr = match tokio::time::timeout(Duration::from_secs(10), addr_rx).await {
                Ok(Ok(Ok(a))) => a,
                Ok(Ok(Err(e))) => {
                    let _ = kill_tx.send(());
                    let detail = stderr_buf.lock().await.clone();
                    let detail = detail.trim();
                    return Err(AppError::Dap(if detail.is_empty() {
                        e
                    } else {
                        format!("{e} ({detail})")
                    }));
                }
                Ok(Err(_)) | Err(_) => {
                    let _ = kill_tx.send(());
                    return Err(AppError::Dap(
                        "Timed out waiting for DAP server listen address \
                         (dlv did not print \"DAP server listening at: …\")"
                            .into(),
                    ));
                }
            };
            log::info!("[DAP] connecting to adapter at {addr}");
            let stream = match TcpStream::connect(&addr).await {
                Ok(s) => s,
                Err(e) => {
                    let _ = kill_tx.send(());
                    return Err(AppError::Dap(format!(
                        "Failed to connect to DAP server at {addr}: {e}"
                    )));
                }
            };
            let (read_half, write_half) = stream.into_split();
            (
                Box::pin(read_half) as BoxAsyncRead,
                Box::pin(write_half) as BoxAsyncWrite,
            )
        }
    };

    // TcpListen error paths already consumed kill_tx via send(); success paths
    // still hold it for the process kill callback.
    Ok((
        DapIo {
            reader,
            writer,
            proc_out_rx,
            stderr_buf,
        },
        kill_tx,
    ))
}

/// Read process pipe line-by-line and forward (category, line).
pub async fn forward_process_lines(
    reader: BoxAsyncRead,
    category: &str,
    tx: mpsc::UnboundedSender<(String, String)>,
    acc: Option<Arc<Mutex<String>>>,
) {
    let mut lines = BufReader::new(reader).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if let Some(ref buf) = acc {
                    let mut g = buf.lock().await;
                    g.push_str(&line);
                    g.push('\n');
                    if g.len() > 16 * 1024 {
                        let drain = g.len() - 8 * 1024;
                        g.drain(..drain);
                    }
                }
                if !line.trim().is_empty() {
                    let _ = tx.send((category.to_string(), line));
                }
            }
            Ok(None) | Err(_) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_parse_dap_listen_line() {
        assert_eq!(
            parse_listen_addr_line("DAP server listening at: 127.0.0.1:58129"),
            Some("127.0.0.1:58129".into())
        );
        assert_eq!(
            parse_listen_addr_line("API server listening at: 127.0.0.1:9"),
            Some("127.0.0.1:9".into())
        );
        assert_eq!(parse_listen_addr_line("nope"), None);
        assert_eq!(
            parse_listen_addr_line("DAP server listening at: stdio"),
            None
        );
    }
}
