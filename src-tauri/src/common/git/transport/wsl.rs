#![allow(unused_imports, missing_docs)]

use crate::common::executor::factory::ExecTarget;
use crate::core::exec::run;

/// WSL `is_git_repo` check：argv 形态的 `test -e <path>/.git`（不经 shell）。
///
/// 只服务 WSL，Local 走 git2（见 [`super::local::is_git_repo_local`]）。
pub(crate) async fn is_git_repo_wsl(target: &ExecTarget, path: &str) -> bool {
    run(target, "test", &["-e", &format!("{path}/.git")])
        .await
        .is_ok()
}
