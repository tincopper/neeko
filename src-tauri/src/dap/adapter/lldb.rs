//! LLDB / CodeLLDB adapter plugin (Rust and native binaries).

use async_trait::async_trait;
use serde_json::{json, Value};

use super::DebugAdapterPlugin;
use crate::common::executor::factory::ExecTarget;
use crate::core::exec;
use crate::dap::types::{
    AdapterKind, AdapterSpawn, AdapterTransport, HandshakeOrder, LaunchConfig,
};
use crate::AppError;

/// LLDB / CodeLLDB adapter plugin for Rust and native binaries.
pub struct LldbAdapter;

#[async_trait]
impl DebugAdapterPlugin for LldbAdapter {
    fn kind(&self) -> AdapterKind {
        AdapterKind::Lldb
    }

    fn matches_type(&self, type_: &str) -> bool {
        matches!(type_, "lldb" | "rust" | "codelldb")
    }

    fn adapter_id(&self) -> &'static str {
        "lldb"
    }

    fn handshake_order(&self) -> HandshakeOrder {
        // lldb-dap (LLVM 22+) launch 响应被 configurationDone 门控，必须 pipelined
        // （实证：BreakpointsBeforeLaunch 顺序 → "Expected process to be stopped"
        // + timeout waiting for launch）。
        HandshakeOrder::PipelinedLaunch
    }

    async fn resolve_spawn(
        &self,
        target: &ExecTarget,
        adapter_binary: Option<&str>,
    ) -> Result<AdapterSpawn, AppError> {
        // 用户显式配置（config `dap.adapterBinaries.lldb`）最高优先——不必改 PATH。
        if let Some(bin) = adapter_binary {
            if !bin.is_empty() {
                return Ok(AdapterSpawn {
                    program: bin.to_string(),
                    args: codelldb_args(bin),
                    transport: AdapterTransport::Stdio,
                });
            }
        }
        // Rust 断点前提：rustc 把 DWARF 源路径写成 `/<真实路径>/@/<cgu>`，
        // lldb-dap（LLVM 22）精确匹配失败 → verified:false 永不命中（四路 probe 实证）。
        // CodeLLDB 专门 fork 处理 Rust（VSCode/RA/Zed 的默认引擎）——优先 codelldb，
        // lldb-dap 仅兜底（Go 等无 `/@/` 问题）。
        if exec::command_exists(target, "codelldb").await {
            return Ok(AdapterSpawn {
                program: "codelldb".into(),
                args: codelldb_args("codelldb"),
                transport: AdapterTransport::Stdio,
            });
        }
        if let Some(path) = known_codelldb_path().await {
            return Ok(AdapterSpawn {
                program: path.clone(),
                args: codelldb_args(&path),
                transport: AdapterTransport::Stdio,
            });
        }
        if exec::command_exists(target, "lldb-dap").await {
            return Ok(AdapterSpawn {
                program: "lldb-dap".into(),
                args: vec![],
                transport: AdapterTransport::Stdio,
            });
        }
        if let Some(path) = known_lldb_dap_path().await {
            return Ok(AdapterSpawn {
                program: path,
                args: vec![],
                transport: AdapterTransport::Stdio,
            });
        }
        Err(AppError::Dap(format!(
            "Debug adapter for lldb/rust not found (prefer codelldb for Rust breakpoints; looked for codelldb, lldb-dap, known install paths). {}",
            self.install_hint()
        )))
    }

    async fn is_available(&self, target: &ExecTarget) -> bool {
        exec::command_exists(target, "codelldb").await
            || known_codelldb_path().await.is_some()
            || exec::command_exists(target, "lldb-dap").await
            || known_lldb_dap_path().await.is_some()
    }

    fn build_launch_args(&self, cfg: &LaunchConfig, workspace: &str) -> Result<Value, AppError> {
        let cwd = cfg.cwd.clone().unwrap_or_else(|| workspace.to_string());
        let program = cfg.program.clone().ok_or_else(|| {
            AppError::Dap("Rust/lldb launch requires \"program\" (path to binary)".into())
        })?;
        let stop_on_entry = cfg.stop_on_entry.unwrap_or(false);
        Ok(json!({
            "program": program,
            "cwd": cwd,
            "args": cfg.args,
            "stopOnEntry": stop_on_entry,
            // CodeLLDB 必需（Zed 同款）：声明被调语言，触发 Rust 专门的
            // `/@/<cgu>` 路径处理与类型格式化。纯 lldb-dap 会忽略该字段
            //（对 Rust 断点无解——见 resolve_spawn 注释）。
            "sourceLanguages": ["rust"],
        }))
    }

    fn entry_function_for_stop_on_entry(&self, _stop_on_entry: bool) -> Option<&'static str> {
        // lldb uses native stopOnEntry in launch args.
        None
    }

    fn install_hint(&self) -> &'static str {
        "Install CodeLLDB (VSCode extension `vadimcn.vscode-lldb`, or GitHub \
         release binary on PATH) — lldb-dap cannot set Rust breakpoints \
         (rustc writes `/<path>/@/<cgu>` in DWARF, which lldb-dap fails to match)."
    }
}

/// codelldb 启动参数：附带 `--liblldb`（CodeLLDB 需要显式 lldb 库路径，
/// 布局 `<bin_dir>/../lldb/lib/liblldb.dylib`；PATH 解析的 codelldb 无已知库则无参）。
fn codelldb_args(program: &str) -> Vec<String> {
    let bin_dir = std::path::Path::new(program)
        .parent()
        .map(|p| p.to_path_buf());
    let lib = bin_dir
        .and_then(|dir| dir.parent().map(|p| p.join("lldb/lib/liblldb.dylib")))
        .filter(|p| p.is_file());
    match lib {
        Some(p) => vec!["--liblldb".into(), p.to_string_lossy().into_owned()],
        None => vec![],
    }
}

/// 已知 codelldb 安装位置（VSCode/Cursor 扩展目录 + 独立安装）。CodeLLDB 是
/// VSCode 扩展 `vadimcn.vscode-lldb`，二进制在 `…/extensions/vadimcn.vscode-lldb-*/adapter/codelldb`。
/// 独立用户可从 GitHub release 解压后放 PATH。
fn find_existing_codelldb(home_dirs: &[&str]) -> Option<String> {
    for dir in home_dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("vadimcn.vscode-lldb") {
                continue;
            }
            let candidate = entry.path().join("adapter").join("codelldb");
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}

/// codelldb 已知位置探测（阻塞 fs；包进 spawn_blocking 满足阻塞 I/O 隔离红线）。
/// 先查常见 bin 目录（用户本地安装 / 系统 PATH），再扫 VSCode/Cursor 扩展目录。
async fn known_codelldb_path() -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let direct: Vec<String> = [".local/bin/codelldb", "bin/codelldb"]
        .into_iter()
        .map(|p| format!("{home}/{p}"))
        .chain([
            "/usr/local/bin/codelldb".to_string(),
            "/opt/homebrew/bin/codelldb".to_string(),
        ])
        .collect();
    let ext_dirs: Vec<String> = [
        ".vscode/extensions",
        ".vscode-oss/extensions",
        ".cursor/extensions",
    ]
    .into_iter()
    .map(|d| format!("{home}/{d}"))
    .collect();
    tokio::task::spawn_blocking(move || {
        let direct_refs: Vec<&str> = direct.iter().map(|s| s.as_str()).collect();
        find_existing_lldb_dap(&direct_refs).or_else(|| {
            let ext_refs: Vec<&str> = ext_dirs.iter().map(|s| s.as_str()).collect();
            find_existing_codelldb(&ext_refs)
        })
    })
    .await
    .ok()
    .flatten()
}

/// 已知 lldb-dap 安装位置（Homebrew LLVM / CommandLineTools / 常见 Linux LLVM
/// 布局）。GUI 应用（Tauri）的 PATH 常不含 Homebrew 目录，但 lldb-dap 装在这里。
const KNOWN_LLDB_DAP_CANDIDATES: &[&str] = &[
    "/opt/homebrew/opt/llvm/bin/lldb-dap",
    "/usr/local/opt/llvm/bin/lldb-dap",
    "/home/linuxbrew/.linuxbrew/opt/llvm/bin/lldb-dap",
    "/Library/Developer/CommandLineTools/usr/bin/lldb-dap",
    "/usr/lib/llvm-21/bin/lldb-dap",
    "/usr/lib/llvm-20/bin/lldb-dap",
    "/usr/lib/llvm-19/bin/lldb-dap",
    "/usr/lib/llvm-18/bin/lldb-dap",
    "/usr/lib/llvm-17/bin/lldb-dap",
];

/// 在候选绝对路径中找第一个存在的 lldb-dap（纯函数，可单测）。
fn find_existing_lldb_dap(candidates: &[&str]) -> Option<String> {
    candidates
        .iter()
        .find(|p| std::path::Path::new(p).is_file())
        .map(|p| p.to_string())
}

/// 已知位置探测（阻塞 fs；包进 spawn_blocking 满足阻塞 I/O 隔离红线）。
async fn known_lldb_dap_path() -> Option<String> {
    tokio::task::spawn_blocking(move || find_existing_lldb_dap(KNOWN_LLDB_DAP_CANDIDATES))
        .await
        .ok()
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_existing_lldb_dap_returns_first_present_in_order() {
        let dir = tempfile::tempdir().expect("tempdir");
        let present = dir.path().join("lldb-dap");
        std::fs::write(&present, "").expect("write");
        let missing = "/definitely/not/lldb-dap";
        let candidate = present.to_str().expect("utf8 path");
        assert_eq!(
            find_existing_lldb_dap(&[missing, candidate]).as_deref(),
            Some(candidate)
        );
        assert_eq!(find_existing_lldb_dap(&[missing]), None);
    }

    #[test]
    fn find_existing_codelldb_scans_vscode_extensions() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ext = dir
            .path()
            .join("vadimcn.vscode-lldb-1.13.1")
            .join("adapter");
        std::fs::create_dir_all(&ext).expect("mkdir");
        let binary = ext.join("codelldb");
        std::fs::write(&binary, "").expect("write");
        let root = dir.path().to_str().expect("utf8 path");
        assert_eq!(
            find_existing_codelldb(&[root]).as_deref(),
            Some(binary.to_str().expect("utf8"))
        );
    }

    #[test]
    fn find_existing_codelldb_returns_none_when_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().to_str().expect("utf8 path");
        assert_eq!(find_existing_codelldb(&[root]), None);
    }
}
