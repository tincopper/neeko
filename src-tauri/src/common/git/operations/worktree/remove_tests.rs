//! `remove_worktree` 的幂等契约与「真错误不吞」契约。
//!
//! **为什么需要幂等**：`git worktree remove` 的墙钟超时只停止等待、**不杀进程**
//! （`transport::run_spawn_streaming`）—— 一次大工作树的删除跑过 30s 就会「命令报错、
//! 目录随后消失」。用户重试时 git 只能说 `fatal: '<path>' is not a working tree`：
//! 那不是失败，是**目标状态已达成**（登记表才是工作树行的来源）。
//!
//! 文本匹配在这里是唯一可用信号：三种结果同为 exit 128（`git worktree remove` 的
//! `die()` 路径），deterministic 字段区分不了 —— 与 `has_head` 的 exit-1 场景不同。
//! 因此本文件把三种真实文案（2.54 实测）逐条钉住，并把「主工作树」这条**必须继续报错**
//! 的反例钉死：吞掉它就是在假装删掉了当前正在用的仓库。

use anyhow::Result;
use async_trait::async_trait;

use crate::common::executor::factory::ExecTarget;
use crate::common::git::operations::remove_worktree;
use crate::common::git::transport::{ErrorKind, GitExecError, GitExecOptions, GitTransport};

/// 只回一份 canned 失败的 transport：argv 与 stderr 都可见，断言「吞哪一条」有据可依。
struct CannedRemoveTransport {
    stderr: &'static str,
}

impl CannedRemoveTransport {
    fn new(stderr: &'static str) -> Self {
        Self { stderr }
    }
}

#[async_trait]
impl GitTransport for CannedRemoveTransport {
    async fn run_git(&self, _args: &[&str], _work_dir: &str) -> Result<String> {
        Err(GitExecError {
            kind: ErrorKind::Other,
            stderr: self.stderr.to_string(),
            stdout: String::new(),
            command: "git worktree remove --force <path>".to_string(),
            exit_code: 128,
        }
        .into())
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

/// 用户重试一次已经完成的删除 ⇒ 必须是 `Ok`（登记表里已经没有它，目标状态达成）。
///
/// 实测文案：`fatal: '../wt1' is not a working tree`（exit 128）。
#[tokio::test]
async fn remove_worktree_is_idempotent_when_the_path_is_not_registered() {
    let transport = CannedRemoveTransport::new("fatal: '/tmp/gone/wt' is not a working tree\n");
    let dir = tempfile::tempdir().expect("tempdir");
    remove_worktree(&transport, &dir.path().to_string_lossy(), "/tmp/gone/wt")
        .await
        .expect("已经不在登记表里 = 目标状态达成，不得报错");
}

/// **反例**：主工作树 (`fatal: '.' is a main working tree`) 与验证失败
/// (`fatal: validation failed, cannot remove working tree`) 都是真错误 ——
/// 吞掉它们等于告诉用户「主仓已删除」。
#[tokio::test]
async fn remove_worktree_still_propagates_real_failures() {
    let dir = tempfile::tempdir().expect("tempdir");
    let work_dir = dir.path().to_string_lossy().to_string();

    for stderr in [
        "fatal: '.' is a main working tree\n",
        "fatal: validation failed, cannot remove working tree: '/tmp/wt' contains modified or untracked files (and --force not used)\n",
        "fatal: not a git repository\n",
    ] {
        let transport = CannedRemoveTransport::new(stderr);
        let err = remove_worktree(&transport, &work_dir, "/tmp/wt")
            .await
            .expect_err(&format!("must not swallow: {stderr}"));
        assert!(
            format!("{err:#}").contains(stderr.trim()),
            "错误必须保留 git 的原始 stderr，got: {err:#}"
        );
    }
}
