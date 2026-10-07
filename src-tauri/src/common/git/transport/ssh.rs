#![allow(unused_imports, missing_docs)]

use crate::common::executor::factory::ExecTarget;
use crate::core::exec::run;

/// Remote `is_git_repo` check：argv 形态的 `test -e <path>/.git`（不经 shell）。
pub(crate) async fn is_git_repo_remote(target: &ExecTarget, path: &str) -> bool {
    run(target, "test", &["-e", &format!("{path}/.git")])
        .await
        .is_ok()
}
