#![allow(unused_imports, missing_docs)]
pub mod branch;
pub mod diff;
pub mod status;
pub mod worktree;

pub use branch::*;
pub use diff::*;
pub use status::*;
pub use worktree::*;

use crate::common::executor::factory::ExecTarget;
use crate::common::executor::SpawnOptions;
use crate::common::executor::{ExecError, ExecOutput};
use crate::core::exec::collect_blocking_with;
use std::path::Path;

/// 统一命令执行：在本地同步运行 `program`（git / wc 等），返回原始输出（含非零退出码）。
pub(crate) fn run_cmd_local(
    current_dir: Option<&Path>,
    program: &str,
    args: &[&str],
) -> Result<ExecOutput, ExecError> {
    let mut opts = SpawnOptions::new(program, args);
    if let Some(dir) = current_dir {
        let dir_str = dir
            .to_str()
            .ok_or_else(|| ExecError::InvalidConfig("non-UTF8 path".to_string()))?;
        opts = opts.with_current_dir(dir_str);
    }
    collect_blocking_with(&ExecTarget::Local, opts)
}
