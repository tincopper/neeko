//! `list_worktrees` / `list_linked_worktree_roots` 的契约测试。
//!
//! 两个函数都建立在同一条**不可见事实**上：`git worktree list --porcelain` 的**首项恒为主
//! 工作树**（git-worktree(1) 契约，2.54 实测）。剔除它、并把 `path` 归一为身份渲染，
//! 是 git info 与会话单元归属共同依赖的行为 —— 它搬进共享函数后必须继续被钉住，
//! 否则「清单里混进主工作树」只会在下游表现为「单元串门」。
//!
//! 夹具路径一律由 `tempdir()` 推导（红线 13）：Local 的身份渲染要 canonicalize，
//! 硬编码 POSIX 绝对路径在 Windows 上会直接失败。

use anyhow::Result;
use async_trait::async_trait;

use crate::common::executor::factory::ExecTarget;
use crate::common::git::operations::{list_linked_worktree_roots, list_worktrees};
use crate::common::git::transport::{ErrorKind, GitExecError, GitExecOptions, GitTransport};

/// 只回一份 canned porcelain 输出的 transport（`exec_target` = Local，走身份铸造）。
struct CannedWorktreeTransport {
    output: Result<String>,
}

impl CannedWorktreeTransport {
    fn ok(output: String) -> Self {
        Self { output: Ok(output) }
    }

    fn failing() -> Self {
        Self {
            output: Err(GitExecError {
                kind: ErrorKind::Other,
                stderr: "fatal: not a git repository".to_string(),
                stdout: String::new(),
                command: "git worktree list --porcelain".to_string(),
                exit_code: 128,
            }
            .into()),
        }
    }
}

#[async_trait]
impl GitTransport for CannedWorktreeTransport {
    async fn run_git(&self, _args: &[&str], _work_dir: &str) -> Result<String> {
        match &self.output {
            Ok(text) => Ok(text.clone()),
            // `GitExecError` 不是 Clone ⇒ 用同一 stderr / 状态重造一份。
            Err(_) => Err(GitExecError {
                kind: ErrorKind::Other,
                stderr: "fatal: not a git repository".to_string(),
                stdout: String::new(),
                command: "git worktree list --porcelain".to_string(),
                exit_code: 128,
            }
            .into()),
        }
    }

    async fn run_git_opts(
        &self,
        args: &[&str],
        work_dir: &str,
        _opts: GitExecOptions<'_>,
    ) -> Result<String> {
        self.run_git(args, work_dir).await
    }

    async fn run_git_with_stdin(
        &self,
        args: &[&str],
        work_dir: &str,
        _opts: GitExecOptions<'_>,
        _stdin: &[u8],
    ) -> Result<String> {
        self.run_git(args, work_dir).await
    }

    fn open_repo(&self, _path: &str) -> Option<git2::Repository> {
        None
    }

    async fn open_repo_async(&self, _path: &str) -> Option<git2::Repository> {
        None
    }

    fn exec_target(&self) -> ExecTarget {
        ExecTarget::Local
    }

    async fn is_git_repo(&self, _path: &str) -> bool {
        true
    }
}

/// 主工作树（首项）被剔除：两个调用方要的都是 linked 部分。
#[tokio::test]
async fn list_worktrees_drops_the_main_worktree_which_git_lists_first() {
    let dir = tempfile::tempdir().expect("tempdir");
    let main = dir.path().join("repo");
    let dev = dir.path().join("wt-dev");
    std::fs::create_dir_all(&main).expect("mkdir main");
    std::fs::create_dir_all(&dev).expect("mkdir worktree");

    let output = format!(
        "worktree {}\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main\n\n\
         worktree {}\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/dev\n",
        main.to_string_lossy(),
        dev.to_string_lossy()
    );
    let transport = CannedWorktreeTransport::ok(output);

    let list = list_worktrees(&transport, &main.to_string_lossy())
        .await
        .expect("list must parse");
    assert_eq!(list.len(), 1, "主工作树必须被剔除");
    assert_eq!(list[0].branch, "dev");
    assert_eq!(
        std::fs::canonicalize(&list[0].path).expect("identity must be a usable path"),
        dev.canonicalize().expect("canonicalize fixture"),
        "清单 path 必须是身份渲染（能与 WorkspaceRef::key 同形拼装）"
    );
}

/// 只有主工作树时返回空清单（不是「把主工作树当 linked」）。
#[tokio::test]
async fn list_worktrees_is_empty_when_only_the_main_worktree_exists() {
    let dir = tempfile::tempdir().expect("tempdir");
    let main = dir.path().join("repo");
    std::fs::create_dir_all(&main).expect("mkdir main");
    let output = format!(
        "worktree {}\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main\n",
        main.to_string_lossy()
    );
    let transport = CannedWorktreeTransport::ok(output);
    let list = list_worktrees(&transport, &main.to_string_lossy())
        .await
        .expect("list must parse");
    assert!(list.is_empty());
}

/// 会话单元归属用同一份清单的 path 分量：接口给的是 `Vec<String>`，与 `Worktree.path` 同源。
#[tokio::test]
async fn list_linked_worktree_roots_returns_the_identity_paths() {
    let dir = tempfile::tempdir().expect("tempdir");
    let main = dir.path().join("repo");
    let dev = dir.path().join("wt-dev");
    std::fs::create_dir_all(&main).expect("mkdir main");
    std::fs::create_dir_all(&dev).expect("mkdir worktree");
    let output = format!(
        "worktree {}\nHEAD 1\nbranch refs/heads/main\n\nworktree {}\nHEAD 2\nbranch refs/heads/dev\n",
        main.to_string_lossy(),
        dev.to_string_lossy()
    );
    let transport = CannedWorktreeTransport::ok(output);

    let roots = list_linked_worktree_roots(&transport, &main.to_string_lossy())
        .await
        .expect("list must parse");
    assert_eq!(roots.len(), 1);
    assert_eq!(
        std::fs::canonicalize(&roots[0]).expect("identity must be usable"),
        dev.canonicalize().expect("canonicalize fixture")
    );
}

/// git 失败必须上抛（调用方据此决定降级，见 `UnitScope::resolve`）。
#[tokio::test]
async fn list_worktrees_propagates_git_failures() {
    let transport = CannedWorktreeTransport::failing();
    let err = list_worktrees(&transport, "/whatever")
        .await
        .expect_err("git failure must surface");
    assert!(
        format!("{err:#}").contains("not a git repository"),
        "错误必须保留 git 的原始 stderr，got: {err:#}"
    );
    assert!(list_linked_worktree_roots(&transport, "/whatever")
        .await
        .is_err());
}
