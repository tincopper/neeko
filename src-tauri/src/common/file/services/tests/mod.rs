//! `common::file::services` 域共享单元测试入口（原 tests.rs 839 行超健康线，
//! 按被测子模块拆分；`temp_root` / `block_on` 为域内共享 helper）。

mod ignored_cache;
mod path_ops;
mod shell_cmd;
mod tree_read;

use std::fs;
use std::future::Future;
use std::path::PathBuf;

/// 测试临时根目录（进程内唯一前缀，避免并行污染）
fn temp_root(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("neeko_file_mgmt_{}_{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// 独立 tokio runtime 阻塞执行 async fn（供同步 `#[test]` 调用异步服务）
fn block_on<F: Future>(future: F) -> F::Output {
    tokio::runtime::Runtime::new().unwrap().block_on(future)
}
