// `use super::*` 提供 mod.rs 的 `pub use <op>::*`（被 re-export 的操作函数）。
// 原先还依赖 mod.rs 里为 re-export 而写的普通 `use`，那条泄漏已封堵，
// 故此处显式引入所需类型/函数（AGENTS.md 规则 #9：mod.rs 只留声明与 pub use）。
use super::*;

use std::sync::{Arc, Mutex};

use anyhow::Result;

use crate::common::executor::factory::ExecTarget;
use crate::common::executor::{ExecChunkSink, ExecStream};
use crate::common::git::transport::{
    ErrorKind, GitExecError, GitExecOptions, GitRunHooks, GitTransport,
};
use crate::common::git::types::DiffLine;
use crate::core::exec::collect;

// ── resolve_worktree_path ─────────────────────────────────────────────

#[test]
fn resolve_worktree_path_none_falls_back_to_project_root() {
    let wd = "/repo/main".to_string();
    assert_eq!(resolve_worktree_path(&None, &wd), "/repo/main");
}

#[test]
fn resolve_worktree_path_empty_string_falls_back_to_project_root() {
    // 回归：前端 git-changed 在无激活 worktree 时传空字符串，
    // 不能把 "" 当字面路径，否则 shell 回退会在 app 启动 CWD 跑 git。
    let wd = "/repo/main".to_string();
    assert_eq!(
        resolve_worktree_path(&Some(String::new()), &wd),
        "/repo/main"
    );
    assert_eq!(
        resolve_worktree_path(&Some("   ".to_string()), &wd),
        "/repo/main"
    );
}

#[test]
fn resolve_worktree_path_uses_worktree_path_when_provided() {
    let wd = "/repo/main".to_string();
    let wt = Some("/repo/wt".to_string());
    assert_eq!(resolve_worktree_path(&wt, &wd), "/repo/wt");
}

// ── parse_worktree_list（清单产出即归一，#1 的回归钉）────────────────────

/// 清单路径会被前端拼成 `WorkspaceKey`，因此必须与 `WorkspaceRef::key()` 同形（身份渲染）。
/// 局部路径（Local）要归一：`git worktree add` 记录的字符串不保证归一。
#[test]
fn parse_worktree_list_normalizes_local_paths_to_workspace_ref_form() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = tmp.path().join("repo");
    let wt = tmp.path().join("wt-a");
    std::fs::create_dir_all(&root).expect("mkdir repo");
    std::fs::create_dir_all(&wt).expect("mkdir worktree");

    // 尾分隔符 + `.` 成分：同一目录的另一种写法，git 会把原样记进清单
    let raw = format!("{}/./", wt.to_string_lossy());
    let output = format!(
        "worktree {}\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main\n\nworktree {raw}\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/dev\n",
        root.to_string_lossy()
    );

    let list = parse_worktree_list(&output, &ExecTarget::Local);
    assert_eq!(list.len(), 2);
    assert_eq!(list[1].branch, "dev");
    let identity = crate::common::git::WorkspaceRef::resolve(
        "p1",
        &root.to_string_lossy(),
        Some(&raw),
        &ExecTarget::Local,
    )
    .expect("identity must resolve");
    assert_eq!(
        list[1].path,
        identity
            .worktree_path()
            .expect("linked checkout has a path"),
        "清单路径与 WorkspaceRef 身份必须同形"
    );
    // 断对象而不是断字符串形态（形态是平台细节）
    assert_eq!(
        std::fs::canonicalize(&list[1].path).expect("identity must be a usable path"),
        wt.canonicalize().expect("canonicalize fixture worktree")
    );
}

/// 远端（WSL / SSH）路径只能词法归一：绝不能经宿主 `std::path`（Windows 宿主会把
/// 前导 `/` 变成 `\`），且归一结果必须与 `WorkspaceRef::resolve` 的非 Local 分支一致。
#[test]
fn parse_worktree_list_lexically_normalizes_remote_paths() {
    let remote = ExecTarget::Remote {
        host: "h".to_string(),
        port: 22,
        username: "u".to_string(),
        auth: crate::common::connection::types::AuthMethod::Password("x".to_string()),
    };
    let output = "worktree /srv/app\nHEAD a\nbranch refs/heads/main\n\nworktree /srv/app-wt/./\nHEAD b\nbranch refs/heads/dev\n";
    let list = parse_worktree_list(output, &remote);
    assert_eq!(list.len(), 2);
    assert_eq!(list[1].path, "/srv/app-wt");
    let identity = crate::common::git::WorkspaceRef::resolve(
        "p1",
        "/srv/app",
        Some("/srv/app-wt/./"),
        &remote,
    )
    .expect("identity must resolve");
    assert_eq!(
        list[1].path,
        identity
            .worktree_path()
            .expect("linked checkout has a path")
    );
}

/// 归一失败的条目不得进清单：宁可缺一项，也不产出第二种身份表示（红线 8）。
#[test]
fn parse_worktree_list_drops_unnormalizable_entries() {
    let output = "worktree /repo\nHEAD a\nbranch refs/heads/main\n\nworktree /repo/../escape\nHEAD b\nbranch refs/heads/dev\n";
    let list = parse_worktree_list(output, &ExecTarget::Local);
    assert_eq!(list.len(), 1, "含 `..` 的清单条目必须被丢弃");
    assert!(list[0].branch == "main");
}
use async_trait::async_trait;
use tempfile::tempdir;

/// 在测试中执行本地 git 命令（async，走统一接口）。
async fn git_local(path: &str, args: &[&str]) -> crate::common::executor::ExecOutput {
    collect(&ExecTarget::Local, "git", args, Some(path))
        .await
        .expect("run git command")
}

/// 行尾无关地断言工作区文件内容（git smudge 可能把 LF 转成平台 CRLF，
/// 工作区字节是不透明平台数据，禁止字节级精确断言）。
fn assert_worktree_eq(dir: &std::path::Path, rel: &str, expected: &str) {
    let content = std::fs::read_to_string(dir.join(rel)).expect("read worktree file");
    assert_eq!(
        content.replace("\r\n", "\n"),
        expected,
        "worktree content mismatch: {rel}"
    );
}

/// 初始化一个含单个提交的临时 git 仓库，返回 (TempDir, 路径)。
async fn init_repo() -> (tempfile::TempDir, String) {
    let dir = tempdir().expect("create temp dir");
    let path = dir.path().to_string_lossy().to_string();
    let commands: Vec<Vec<&str>> = vec![
        vec!["init", "-q"],
        vec!["config", "user.email", "t@t"],
        vec!["config", "user.name", "t"],
        // 换行语义钉死（与 tests/unit/support.rs 的 TestRepo 同一套双保险）：
        // Windows 上 git 默认 autocrlf=true 会把检出内容转成 CRLF，
        // 导致 discard 恢复后内容与写入的 `base\n` 不一致。
        // 仓库级 autocrlf=false + `.gitattributes * -text` 保证跨平台一致。
        vec!["config", "core.autocrlf", "false"],
    ];
    for cmd in &commands {
        let out = git_local(&path, cmd).await;
        assert!(
            out.exit_code == 0,
            "git {:?} failed: {}",
            cmd,
            String::from_utf8_lossy(&out.stderr)
        );
    }
    std::fs::write(dir.path().join("base.txt"), "base\n").expect("write base");
    std::fs::write(dir.path().join(".gitattributes"), "* -text\n").expect("write .gitattributes");
    let out = git_local(&path, &["add", "-A"]).await;
    assert!(out.exit_code == 0, "git add failed");
    let out = git_local(&path, &["commit", "-qm", "init"]).await;
    assert!(out.exit_code == 0, "git commit failed");
    (dir, path)
}

/// 把 `&[&str]` 转成 `discard_paths` 需要的 `Vec<String>`。
fn discard_targets(paths: &[&str]) -> Vec<String> {
    paths.iter().map(|p| (*p).to_string()).collect()
}

#[tokio::test]
async fn discard_paths_should_delete_untracked_file() {
    // 未跟踪文件（git status ??）：`git checkout -- <file>` 会报 pathspec 错误，
    // discard 应改为删除文件，而不是失败。
    let (dir, path) = init_repo().await;
    std::fs::write(dir.path().join("test_structure.html"), "new\n").expect("write untracked");

    let transport = ExecTarget::Local;
    discard_paths(
        &transport,
        &path,
        &discard_targets(&["test_structure.html"]),
    )
    .await
    .expect("discard untracked file should not fail");

    assert!(
        !dir.path().join("test_structure.html").exists(),
        "untracked file should be deleted"
    );
}

#[tokio::test]
async fn discard_paths_should_restore_modified_tracked_file() {
    // 已跟踪文件的工作区修改：应恢复到 HEAD 版本。
    let (dir, path) = init_repo().await;
    std::fs::write(dir.path().join("base.txt"), "modified\n").expect("modify tracked");

    let transport = ExecTarget::Local;
    discard_paths(&transport, &path, &discard_targets(&["base.txt"]))
        .await
        .expect("discard tracked file should succeed");

    assert_worktree_eq(dir.path(), "base.txt", "base\n");
}

#[tokio::test]
async fn discard_paths_should_unstage_and_restore_staged_file() {
    // 已暂存（index 变更）：应撤销暂存并恢复工作区。
    let (dir, path) = init_repo().await;
    std::fs::write(dir.path().join("base.txt"), "staged\n").expect("modify tracked");
    let out = git_local(&path, &["add", "base.txt"]).await;
    assert!(out.exit_code == 0, "git add failed");

    let transport = ExecTarget::Local;
    discard_paths(&transport, &path, &discard_targets(&["base.txt"]))
        .await
        .expect("discard staged file should succeed");

    assert_worktree_eq(dir.path(), "base.txt", "base\n");
}

#[tokio::test]
async fn discard_paths_should_keep_untracked_out_of_scope() {
    // 回归（需求核心）：只丢弃选中的 tracked 文件时，不得顺带删除未跟踪文件。
    // 旧 `discard_all` 无条件 `clean -fd`，正是本用例要钉死的行为。
    let (dir, path) = init_repo().await;
    std::fs::write(dir.path().join("base.txt"), "modified\n").expect("modify tracked");
    std::fs::write(dir.path().join("untracked.txt"), "new\n").expect("write untracked");

    let transport = ExecTarget::Local;
    discard_paths(&transport, &path, &discard_targets(&["base.txt"]))
        .await
        .expect("discard tracked file should succeed");

    assert_worktree_eq(dir.path(), "base.txt", "base\n");
    assert!(
        dir.path().join("untracked.txt").exists(),
        "unversioned file must survive a tracked-only discard"
    );
}

#[tokio::test]
async fn discard_paths_should_classify_each_path_in_a_mixed_batch() {
    // 批量语义：一次调用内按各自状态分派 —— tracked 恢复、untracked 删除。
    let (dir, path) = init_repo().await;
    std::fs::write(dir.path().join("base.txt"), "modified\n").expect("modify tracked");
    std::fs::write(dir.path().join("other.txt"), "other\n").expect("write tracked 2");
    let out = git_local(&path, &["add", "other.txt"]).await;
    assert!(out.exit_code == 0, "git add failed");
    let out = git_local(&path, &["commit", "-qm", "add other"]).await;
    assert!(out.exit_code == 0, "git commit failed");
    std::fs::write(dir.path().join("other.txt"), "other-modified\n").expect("modify tracked 2");
    std::fs::write(dir.path().join("scratch.txt"), "scratch\n").expect("write untracked");

    let transport = ExecTarget::Local;
    discard_paths(
        &transport,
        &path,
        &discard_targets(&["base.txt", "other.txt", "scratch.txt"]),
    )
    .await
    .expect("mixed batch discard should succeed");

    assert_worktree_eq(dir.path(), "base.txt", "base\n");
    assert_worktree_eq(dir.path(), "other.txt", "other\n");
    assert!(
        !dir.path().join("scratch.txt").exists(),
        "untracked file in the batch should be deleted"
    );
}

#[tokio::test]
async fn discard_paths_should_restore_both_sides_of_a_staged_rename() {
    // rename 记录在 `-z` 下占两个 NUL 字段（`old\0new`）：两条都必须参与
    // reset/checkout（old 要恢复、new 要移除）。只带 new 会把 old 留在删除态。
    let (dir, path) = init_repo().await;
    let out = git_local(&path, &["mv", "base.txt", "renamed.txt"]).await;
    assert!(out.exit_code == 0, "git mv failed");

    let transport = ExecTarget::Local;
    discard_paths(&transport, &path, &discard_targets(&["renamed.txt"]))
        .await
        .expect("discard staged rename should succeed");

    assert_worktree_eq(dir.path(), "base.txt", "base\n");
    assert!(
        !dir.path().join("renamed.txt").exists(),
        "new side of the rename should be removed"
    );
}

#[tokio::test]
async fn discard_paths_should_chunk_batches_beyond_pathspec_limit() {
    // 跨平台护栏：Windows 命令行上限 32,767 字符，全选 1000 条不能一次性铺进 argv。
    // 120 > MAX_PATHS_PER_GIT_CALL(100)，必须跨批全部生效（不得只丢前 100 个）。
    let (dir, path) = init_repo().await;
    let mut names: Vec<String> = Vec::new();
    for i in 0..120 {
        let name = format!("scratch_{i:03}.txt");
        std::fs::write(dir.path().join(&name), "new\n").expect("write untracked");
        names.push(name);
    }

    let transport = ExecTarget::Local;
    discard_paths(&transport, &path, &names)
        .await
        .expect("chunked discard should succeed");

    for name in &names {
        assert!(
            !dir.path().join(name).exists(),
            "{name} should be deleted across chunk boundary"
        );
    }
}

#[tokio::test]
async fn discard_paths_should_reject_empty_selection() {
    // 空集合必须在命令层就被拒：静默 no-op 会让 UI 误报「已丢弃」。
    let (_dir, path) = init_repo().await;
    let transport = ExecTarget::Local;
    let result = discard_paths(&transport, &path, &[]).await;
    assert!(result.is_err(), "empty discard must be rejected");
}

#[tokio::test]
async fn discard_paths_should_reject_paths_without_changes() {
    let (_dir, path) = init_repo().await;
    let transport = ExecTarget::Local;
    let result = discard_paths(&transport, &path, &discard_targets(&["base.txt"])).await;
    assert!(result.is_err(), "clean file has nothing to discard");
}

/// 脚本化 mock transport：探测 `unstage` 兜底的**确定性门**（HEAD 存在性探测，
/// 而非 stderr 文本嗅探）。
///
/// - `has_head` 决定 `rev-parse --verify --quiet HEAD` 的结果（成功 sha / exit 1）；
/// - `reset_stderr` 非空时 `reset` 返回该错误（exit 128）；
/// - `status` 在 `rm --cached` 发生前返回 staged 新增（`A`），之后返回未跟踪（`??`），
///   模拟兜底真实生效后的仓库状态迁移。
struct UnstageGateTransport {
    has_head: bool,
    reset_stderr: Option<&'static str>,
    calls: std::sync::Mutex<Vec<String>>,
}

impl UnstageGateTransport {
    fn new(has_head: bool, reset_stderr: Option<&'static str>) -> Self {
        Self {
            has_head,
            reset_stderr,
            calls: std::sync::Mutex::new(Vec::new()),
        }
    }

    fn recorded_calls(&self) -> Vec<String> {
        self.calls.lock().expect("calls mutex").clone()
    }
}

#[async_trait]
impl GitTransport for UnstageGateTransport {
    async fn run_git(&self, args: &[&str], work_dir: &str) -> Result<String> {
        self.run_git_opts(args, work_dir, GitExecOptions::default())
            .await
    }

    async fn run_git_opts(
        &self,
        args: &[&str],
        _work_dir: &str,
        _opts: GitExecOptions<'_>,
    ) -> Result<String> {
        let command = args.join(" ");
        self.calls
            .lock()
            .expect("calls mutex")
            .push(command.clone());
        match args.first() {
            Some(&"status") => {
                let rm_called = self
                    .calls
                    .lock()
                    .expect("calls mutex")
                    .iter()
                    .any(|c| c.starts_with("rm "));
                if rm_called {
                    Ok("?? new.txt\0".to_string())
                } else {
                    Ok("A  new.txt\0".to_string())
                }
            }
            Some(&"reset") => match self.reset_stderr {
                Some(stderr) => Err(GitExecError {
                    kind: ErrorKind::Other,
                    stderr: stderr.to_string(),
                    stdout: String::new(),
                    command,
                    exit_code: 128,
                }
                .into()),
                None => Ok(String::new()),
            },
            // `--quiet` 下 ref 无法解析：exit 1、无输出（git `die_no_single_rev`）
            Some(&"rev-parse") if !self.has_head => Err(GitExecError {
                kind: ErrorKind::Other,
                stderr: String::new(),
                stdout: String::new(),
                command,
                exit_code: 1,
            }
            .into()),
            _ => Ok(String::new()),
        }
    }

    async fn run_git_with_stdin(
        &self,
        _args: &[&str],
        _work_dir: &str,
        _opts: GitExecOptions<'_>,
        _stdin: &[u8],
    ) -> Result<String> {
        unimplemented!()
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

#[tokio::test]
async fn discard_paths_should_delete_staged_add_in_repo_without_head() {
    // 新仓库无 HEAD（unborn 分支）：staged 新增（A）→ reset 失败 → rev-parse 探测
    // 确认无 HEAD → rm --cached + clean 删除
    let dir = tempdir().expect("create temp dir");
    let path = dir.path().to_string_lossy().to_string();
    let out = git_local(&path, &["init", "-q"]).await;
    assert!(out.exit_code == 0, "git init failed");
    std::fs::write(dir.path().join("new.txt"), "new\n").expect("write new file");
    let out = git_local(&path, &["add", "new.txt"]).await;
    assert!(out.exit_code == 0, "git add failed");

    let transport = ExecTarget::Local;
    discard_paths(&transport, &path, &discard_targets(&["new.txt"]))
        .await
        .expect("discard staged add in no-HEAD repo should succeed");

    assert!(
        !dir.path().join("new.txt").exists(),
        "staged add should be deleted in no-HEAD repo"
    );
}

#[tokio::test]
async fn discard_paths_should_propagate_reset_error_when_head_exists() {
    // HEAD 存在时 reset 的任何错误都是真实错误 → 传播，不得触发 rm --cached 兜底
    let transport = UnstageGateTransport::new(true, Some("fatal: unable to reset"));
    let result = discard_paths(&transport, "/tmp", &discard_targets(&["new.txt"])).await;
    assert!(result.is_err(), "real reset error should propagate");
    assert!(
        !transport
            .recorded_calls()
            .iter()
            .any(|c| c.starts_with("rm ")),
        "rm --cached fallback must not run when HEAD exists"
    );
}

#[tokio::test]
async fn discard_paths_should_not_trust_stderr_sniff_when_head_exists() {
    // 兜底门必须建立在 HEAD 探测上而非 stderr 文本：当 reset 的 stderr 恰好说
    // 「unknown revision」而 HEAD 实际存在（文本漂移/误报场景）时，凭文本猜测会
    // 把真实错误吞成 rm --cached 兜底 —— 确定性探测必须赢过字符串匹配。
    let transport = UnstageGateTransport::new(
        true,
        Some("fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree."),
    );
    let result = discard_paths(&transport, "/tmp", &discard_targets(&["new.txt"])).await;
    assert!(result.is_err(), "stderr text must not decide the fallback");
    assert!(
        !transport
            .recorded_calls()
            .iter()
            .any(|c| c.starts_with("rm ")),
        "rm --cached fallback must not run when HEAD exists"
    );
}

#[tokio::test]
async fn discard_paths_should_fall_back_to_rm_cached_without_head() {
    // 无 HEAD（unborn 分支）：reset 失败 → rev-parse 探测确认 exit 1 → rm --cached
    // 使 staged 新增退化为未跟踪 → 重查后 clean 删除。整条链路在 mock 上闭环。
    let transport = UnstageGateTransport::new(
        false,
        Some("fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree."),
    );
    let result = discard_paths(&transport, "/tmp", &discard_targets(&["new.txt"])).await;
    result.expect("unborn-HEAD fallback should complete the discard");
    let calls = transport.recorded_calls();
    assert!(
        calls.iter().any(|c| c.starts_with("rm --cached")),
        "confirmed missing HEAD must route to rm --cached, got {calls:?}"
    );
    assert!(
        calls.iter().any(|c| c.starts_with("clean")),
        "untracked leftover must be cleaned after rm --cached, got {calls:?}"
    );
}

/// 脚本化 mock transport：open_repo=None 强制走 shell 分支；run_git 返回空 diff，
/// 使 `get_file_diff_shell` 的 fallback 读工作区字节。
struct NoHunkShellTransport;

#[async_trait]
impl GitTransport for NoHunkShellTransport {
    async fn run_git(&self, args: &[&str], work_dir: &str) -> Result<String> {
        self.run_git_opts(args, work_dir, GitExecOptions::default())
            .await
    }

    async fn run_git_opts(
        &self,
        _args: &[&str],
        _work_dir: &str,
        _opts: GitExecOptions<'_>,
    ) -> Result<String> {
        Ok(String::new())
    }

    async fn run_git_with_stdin(
        &self,
        _args: &[&str],
        _work_dir: &str,
        _opts: GitExecOptions<'_>,
        _stdin: &[u8],
    ) -> Result<String> {
        unimplemented!()
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

#[tokio::test]
async fn file_diff_shell_fallback_crlf_file_strips_carriage_returns() {
    // L4 换行边界（shell 分支）：WSL/SSH transport 无 git2 repo（open_repo=None），
    // 走 `get_file_diff_shell` 的 fallback 读工作区字节构建 Added 行。
    // 必须用 `.lines()` 等 CRLF 兼容解析，禁止把 `\r` 泄漏进 diff 视图。
    let (dir, path) = init_repo().await;
    std::fs::write(dir.path().join("crlf.txt"), "line1\r\nline2\r\n").expect("write crlf file");

    let result = get_file_diff(&NoHunkShellTransport, &path, "crlf.txt", false)
        .await
        .expect("shell fallback diff on CRLF file should succeed");

    let added: Vec<&str> = result
        .hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .filter_map(|l| match l {
            DiffLine::Added(s) => Some(s.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(added, vec!["line1", "line2"], "CRLF 行尾不应泄漏 \\r");
}

// ── collapse 参数：false 时跳过上下文折叠、返回完整上下文 ────────────────

/// 脚本化 mock transport：返回带长连续 context 的 diff 文本，并捕获
/// args 与 opts.env（供只读查询契约断言）。
struct DiffTextTransport {
    output: String,
    captured_args: std::sync::Mutex<Vec<String>>,
}

impl DiffTextTransport {
    fn new(output: String) -> Self {
        Self {
            output,
            captured_args: std::sync::Mutex::new(Vec::new()),
        }
    }

    fn last_args(&self) -> Vec<String> {
        self.captured_args.lock().unwrap().clone()
    }
}

#[async_trait]
impl GitTransport for DiffTextTransport {
    async fn run_git(&self, args: &[&str], _work_dir: &str) -> Result<String> {
        self.captured_args.lock().unwrap().push(
            args.iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
                .join(" "),
        );
        Ok(self.output.clone())
    }

    async fn run_git_opts(
        &self,
        args: &[&str],
        _work_dir: &str,
        _opts: GitExecOptions<'_>,
    ) -> Result<String> {
        self.captured_args.lock().unwrap().push(
            args.iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
                .join(" "),
        );
        Ok(self.output.clone())
    }

    async fn run_git_with_stdin(
        &self,
        _args: &[&str],
        _work_dir: &str,
        _opts: GitExecOptions<'_>,
        _stdin: &[u8],
    ) -> Result<String> {
        unimplemented!()
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

/// 构造一段含 20 行连续 context 的 diff 文本（超过 collapse 阈值 12）。
fn long_context_diff() -> String {
    let mut out = String::from("diff --git a/a.txt b/a.txt\n@@ -1,25 +1,26 @@\n");
    for i in 1..=20 {
        out.push_str(&format!(" context{i}\n"));
    }
    out.push_str("-old\n+new\n");
    for i in 21..=25 {
        out.push_str(&format!(" context{i}\n"));
    }
    out
}

#[tokio::test]
async fn get_commit_file_diff_collapse_true_keeps_markers() {
    let transport = DiffTextTransport::new(long_context_diff());
    let result = get_commit_file_diff(&transport, "/tmp", "abc123", "a.txt", true)
        .await
        .expect("parse diff");
    let has_collapsed = result
        .hunks
        .iter()
        .flat_map(|h| &h.lines)
        .any(|l| matches!(l, DiffLine::Collapsed(_)));
    assert!(has_collapsed, "collapse=true should keep Collapsed markers");
    // 20 行连续 context → 前 3 保留 + 1 折叠标记 + 后 3 保留；随后变更行；
    // 尾部 5 行 context 未达阈值 12 全部保留 → 3+1+3+1+1+5 = 14
    let kept: Vec<&DiffLine> = result.hunks[0].lines.iter().collect();
    assert_eq!(
        kept.len(),
        14,
        "3 kept + collapsed + 3 kept + removed + added + 5 tail"
    );
    // collapse=true 不传 -U 全量参数
    assert!(
        !transport.last_args()[0].contains("-U100000"),
        "collapse=true should not pass -U100000"
    );
}

#[tokio::test]
async fn get_commit_file_diff_collapse_false_expands_full_context() {
    let transport = DiffTextTransport::new(long_context_diff());
    let result = get_commit_file_diff(&transport, "/tmp", "abc123", "a.txt", false)
        .await
        .expect("parse diff");
    let has_collapsed = result
        .hunks
        .iter()
        .flat_map(|h| &h.lines)
        .any(|l| matches!(l, DiffLine::Collapsed(_)));
    assert!(
        !has_collapsed,
        "collapse=false should drop Collapsed markers"
    );
    let context_count = result.hunks[0]
        .lines
        .iter()
        .filter(|l| matches!(l, DiffLine::Context(_)))
        .count();
    assert_eq!(context_count, 25, "all 25 context lines should be kept");
    assert!(
        transport.last_args()[0].contains("-U100000"),
        "collapse=false should pass -U100000, got: {}",
        transport.last_args()[0]
    );
}

/// **AC13（远端 status 不被本地判定误杀）**：`status_porcelain` 的「是不是仓库」必须由
/// transport 决定。旧写法先跑本地 `path.join(".git").exists()`，而 WSL / SSH 的工作树
/// 在别的机器上 ⇒ 远端单元的 status 一律失败（Changes 面板永远 Loading）。
#[tokio::test]
async fn status_porcelain_uses_transport_repo_check_not_local_filesystem() {
    use crate::common::git::operations::status_porcelain;

    let transport = DiffTextTransport::new(long_context_diff());
    // 一个本地绝对不存在的路径：只有「按 transport 判定」才可能成功
    let remote_work_dir = "/definitely-not-a-local-path/remote/proj";

    let (entries, branch) = status_porcelain(&transport, remote_work_dir)
        .await
        .expect("远端 work_dir 不得被本地文件系统判定判死");
    assert!(
        transport
            .last_args()
            .iter()
            .any(|args| args.contains("status --porcelain")),
        "必须真的发出 porcelain 命令，got: {:?}",
        transport.last_args()
    );
    let _ = (entries, branch);
}

/// **Fix 5 / R3.2 的远端回归**：`get_ahead_behind` 的「是不是仓库」必须由 transport 判定。
/// 旧写法先跑本地 `assert_git_repo`（`path.join(".git")`），WSL / SSH 的 work_dir 在别的
/// 机器上 ⇒ 远端 ahead/behind 一律失败、被 pull 生产者软化成 `(0,0)`（PRD R3.2 未达）。
/// 用本地不存在的 work_dir 驱动：只有按 transport 判定才可能成功。
#[tokio::test]
async fn get_ahead_behind_uses_transport_repo_check_not_local_filesystem() {
    let transport = DiffTextTransport::new("3\t7\n".to_string());
    // 一个本地绝对不存在的路径：只有「按 transport 判定」才可能成功
    let remote_work_dir = "/definitely-not-a-local-path/remote/proj";

    let ab = get_ahead_behind(&transport, remote_work_dir)
        .await
        .expect("远端 work_dir 不得被本地文件系统判定判死");
    // `@{upstream}...HEAD` 的 left = behind、right = ahead
    assert_eq!(ab.behind, 3);
    assert_eq!(ab.ahead, 7);
    assert!(
        transport
            .last_args()
            .iter()
            .any(|args| args.contains("rev-list --left-right --count @{upstream}...HEAD")),
        "必须真的发出 rev-list 命令，got: {:?}",
        transport.last_args()
    );
}

// ── shell 路径（WSL/SSH transport）collapse 契约 ──────────────────────

/// `get_file_diff_shell`（open_repo=None → shell 实现）的 collapse 参数映射：
/// collapse=false → 全量 `-U100000` 上下文参数、不产生 Collapsed 标记；
/// collapse=true → `-U3` 并将超阈 context 折叠为 Collapsed 标记。
/// 该契约随旧测试被 env 契约测试替换而丢失，这里补回（P2）。
#[tokio::test]
async fn get_file_diff_shell_collapse_contract() {
    let transport = DiffTextTransport::new(long_context_diff());

    // collapse=false：全量上下文参数 + 无折叠标记
    let expanded = get_file_diff(&transport, "/tmp", "a.txt", false)
        .await
        .expect("parse expanded diff");
    let args = transport.last_args();
    assert!(
        args.last().unwrap().contains("-U100000"),
        "collapse=false should pass -U100000, got: {:?}",
        args.last()
    );
    assert!(
        !expanded
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .any(|l| matches!(l, DiffLine::Collapsed(_))),
        "collapse=false should not produce Collapsed markers"
    );

    // collapse=true：-U3 + Collapsed 标记
    let collapsed = get_file_diff(&transport, "/tmp", "a.txt", true)
        .await
        .expect("parse collapsed diff");
    let args = transport.last_args();
    assert!(
        args.last().unwrap().contains("-U3"),
        "collapse=true should pass -U3, got: {:?}",
        args.last()
    );
    assert!(
        collapsed
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .any(|l| matches!(l, DiffLine::Collapsed(_))),
        "collapse=true should keep Collapsed markers"
    );
}

// ── stash apply/pop 错误分流（P3） ────────────────────────────────────

fn git_exec_err(kind: ErrorKind, stderr: &str) -> anyhow::Error {
    git_exec_err_full(kind, stderr, "")
}

fn git_exec_err_full(kind: ErrorKind, stderr: &str, stdout: &str) -> anyhow::Error {
    GitExecError {
        kind,
        stderr: stderr.to_string(),
        stdout: stdout.to_string(),
        command: "git stash apply stash@{0}".to_string(),
        exit_code: 128,
    }
    .into()
}

#[test]
fn stash_action_conflict_on_stderr_returns_success_false() {
    // 本地改动冲突：stderr 携带 "would be overwritten by merge"（classify_stderr → Other）
    let result = stash_action_result(git_exec_err(
            ErrorKind::Other,
            "error: Your local changes to the following files would be overwritten by merge:\n\tf.txt\nAborting",
        ))
        .expect("local-change conflict should be reported as success:false");
    assert!(!result.success, "conflict must not be reported as success");
    assert!(
        result.message.contains("would be overwritten by merge"),
        "stderr should be surfaced, got: {}",
        result.message
    );
}

#[test]
fn stash_action_conflict_on_stdout_extracts_conflict_line() {
    // 真实 3-way 冲突：git 把 "CONFLICT (content): ..." 写到 stdout，stderr 为空
    let result = stash_action_result(git_exec_err_full(
        ErrorKind::Other,
        "",
        "Auto-merging f.txt\nCONFLICT (content): Merge conflict in f.txt\nOn branch main",
    ))
    .expect("stdout conflict should be reported as success:false");
    assert!(!result.success);
    assert_eq!(
        result.message, "CONFLICT (content): Merge conflict in f.txt",
        "stdout conflict line should be extracted, got: {}",
        result.message
    );
}

#[test]
fn stash_action_invalid_selector_is_operation_failure() {
    // 无效 selector（stderr 无 CONFLICT 关键字，仍属操作级）
    let result = stash_action_result(git_exec_err(
        ErrorKind::Other,
        "fatal: log for 'stash' only has 1 entries",
    ))
    .expect("invalid selector should be reported as success:false");
    assert!(!result.success);
    assert!(result.message.contains("only has 1 entries"));
}

#[test]
fn stash_action_unrecognized_other_propagates() {
    // 收紧：未命中操作级 marker 的 Other（如 config 损坏）不再伪装成 success:false
    let err = git_exec_err(ErrorKind::Other, "fatal: bad config file line 1");
    assert!(
        stash_action_result(err).is_err(),
        "unrecognized Other failure must propagate, not be masked as success:false"
    );
}

#[test]
fn stash_action_system_kinds_propagate() {
    // 系统级错误（认证/网络/上游等）必须上抛 Err，不允许伪装成 success:false
    for kind in [
        ErrorKind::Auth,
        ErrorKind::AuthSsh,
        ErrorKind::Network,
        ErrorKind::Ambiguous,
        ErrorKind::NoUpstream,
    ] {
        let err = git_exec_err(kind, "fatal: unable to access");
        assert!(
            stash_action_result(err).is_err(),
            "{kind:?} is a system-level error and must propagate"
        );
    }
}

#[test]
fn stash_action_non_git_error_propagates() {
    // 非 GitExecError（spawn 失败、timeout 等）同样上抛
    let err = anyhow::anyhow!("git command failed to spawn: No such file or directory");
    assert!(stash_action_result(err).is_err());
}

// ── Branch operations（自 local.rs 收缩后迁移，行为等价）─────────────

#[tokio::test]
async fn write_operation_invalidates_diff_stats_cache() {
    // 回归：local.rs 写函数删除后，Local 项目的 shell 写操作是唯一失效入口；
    // 若写后不清缓存，diff 统计（get_cached_diff_stats）将永久陈旧。
    let (dir, path) = init_repo().await;
    let transport = ExecTarget::Local;

    // 1. 修改文件 → 首次统计（填充 DIFF_STATS_CACHE）。
    // local 版是同步 fn（内部走同步桥），必须经 spawn_blocking 调用。
    std::fs::write(dir.path().join("base.txt"), "modified\n").expect("modify");
    let path_clone = path.clone();
    let before = tokio::task::spawn_blocking(move || {
        crate::common::git::local::get_changed_files_diff_stats(std::path::Path::new(&path_clone))
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(before.len(), 1, "precondition: one modified file");

    // 2. shell 写操作恢复文件
    discard_paths(&transport, &path, &discard_targets(&["base.txt"]))
        .await
        .expect("discard");

    // 3. 再取统计：缓存若未失效会返回修改态（Bug）
    let path_clone = path.clone();
    let after = tokio::task::spawn_blocking(move || {
        crate::common::git::local::get_changed_files_diff_stats(std::path::Path::new(&path_clone))
    })
    .await
    .unwrap()
    .unwrap();
    assert!(
        after.is_empty(),
        "cache must be invalidated after discard_paths, got {after:?}"
    );
}

#[tokio::test]
async fn create_branch_then_checkout_switches_head() {
    let (_dir, path) = init_repo().await;
    let transport = ExecTarget::Local;

    create_branch(&transport, &path, "feature-1", None)
        .await
        .expect("create branch");
    checkout_branch(&transport, &path, "feature-1")
        .await
        .expect("checkout branch");

    let out = git_local(&path, &["rev-parse", "--abbrev-ref", "HEAD"]).await;
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "feature-1");
}

#[tokio::test]
async fn create_branch_from_start_point() {
    let (_dir, path) = init_repo().await;
    let transport = ExecTarget::Local;

    // 制造第二个提交
    std::fs::write(std::path::Path::new(&path).join("file2.txt"), "hello\n").expect("write file2");
    let out = git_local(&path, &["add", "-A"]).await;
    assert!(out.exit_code == 0, "git add failed");
    let out = git_local(&path, &["commit", "-qm", "Second"]).await;
    assert!(out.exit_code == 0, "git commit failed");

    create_branch(&transport, &path, "from-first", Some("HEAD~1"))
        .await
        .expect("create branch from HEAD~1");

    let out = git_local(&path, &["rev-parse", "--abbrev-ref", "from-first"]).await;
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "from-first");
    // from-first 应指向第一个提交，而非 HEAD
    let out = git_local(&path, &["rev-parse", "from-first"]).await;
    let from_first = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let out = git_local(&path, &["rev-parse", "HEAD"]).await;
    assert_ne!(from_first, String::from_utf8_lossy(&out.stdout).trim());
}

#[tokio::test]
async fn checkout_nonexistent_branch_fails() {
    let (_dir, path) = init_repo().await;
    let transport = ExecTarget::Local;
    assert!(checkout_branch(&transport, &path, "nonexistent")
        .await
        .is_err());
}

#[tokio::test]
async fn rename_current_branch() {
    let (_dir, path) = init_repo().await;
    let transport = ExecTarget::Local;

    let out = git_local(&path, &["rev-parse", "--abbrev-ref", "HEAD"]).await;
    let current = String::from_utf8_lossy(&out.stdout).trim().to_string();

    rename_branch(&transport, &path, &current, "renamed-branch")
        .await
        .expect("rename current branch");

    let out = git_local(&path, &["rev-parse", "--abbrev-ref", "HEAD"]).await;
    assert_eq!(
        String::from_utf8_lossy(&out.stdout).trim(),
        "renamed-branch"
    );
}

#[tokio::test]
async fn rename_nonexistent_branch_fails() {
    let (_dir, path) = init_repo().await;
    let transport = ExecTarget::Local;
    assert!(
        rename_branch(&transport, &path, "no-such-branch", "new-name")
            .await
            .is_err()
    );
}

#[tokio::test]
async fn get_commit_log_scoped_to_head_excludes_isolated_tool_refs() {
    // 孤立提交仅被 refs/synara/checkpoints/isolated 引用 —— 不应出现在 HEAD-scoped log
    let (_dir, path) = init_repo().await;
    let transport = ExecTarget::Local;

    // 空树孤立提交
    let out = git_local(&path, &["hash-object", "-t", "tree", "--stdin"]).await;
    assert!(out.exit_code == 0, "hash-object failed");
    let empty_tree = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let out = git_local(
        &path,
        &["commit-tree", &empty_tree, "-m", "synara checkpoint"],
    )
    .await;
    assert!(out.exit_code == 0, "commit-tree failed");
    let orphan = String::from_utf8_lossy(&out.stdout).trim().to_string();
    assert_ne!(orphan, "", "orphan commit id must not be empty");

    let out = git_local(
        &path,
        &["update-ref", "refs/synara/checkpoints/isolated", &orphan],
    )
    .await;
    assert!(out.exit_code == 0, "update-ref isolated failed");
    let out = git_local(
        &path,
        &["update-ref", "refs/synara/checkpoints/head-marker", "HEAD"],
    )
    .await;
    assert!(out.exit_code == 0, "update-ref head-marker failed");

    let head_out = git_local(&path, &["rev-parse", "HEAD"]).await;
    let head_id = String::from_utf8_lossy(&head_out.stdout).trim().to_string();

    let log = get_commit_log(&transport, &path, 0, 0)
        .await
        .expect("get commit log");
    assert!(
        log.iter().all(|c| c.hash != orphan),
        "isolated synara-only commit must not appear in HEAD-scoped log"
    );
    let head_entry = log
        .iter()
        .find(|c| c.hash == head_id)
        .expect("HEAD commit should be in log");
    assert!(
        !head_entry.refs.contains("synara"),
        "refs string must not contain tool refs, got: {}",
        head_entry.refs
    );
    assert!(
        head_entry
            .refs_list
            .iter()
            .all(|r| r.name != "synara/checkpoints/head-marker"),
        "refs_list must not contain tool refs"
    );
    assert!(
        head_entry
            .refs_list
            .iter()
            .any(|r| r.kind == crate::common::git::refs::RefKind::Branch),
        "HEAD commit should still expose its branch ref"
    );
}

// ── commit_files：输出实时进 Console（on_output 流式）────────────────────

fn collecting_sink() -> (ExecChunkSink, Arc<Mutex<Vec<(ExecStream, String)>>>) {
    let calls: Arc<Mutex<Vec<(ExecStream, String)>>> = Arc::new(Mutex::new(Vec::new()));
    let sink: ExecChunkSink = {
        let calls = Arc::clone(&calls);
        Arc::new(move |stream: ExecStream, text: &str| {
            calls.lock().unwrap().push((stream, text.to_string()));
        })
    };
    (sink, calls)
}

#[tokio::test]
async fn commit_files_streams_commit_output_to_sink() {
    let (_dir, path) = init_repo().await;
    std::fs::write(std::path::Path::new(&path).join("streamed.txt"), "x\n").expect("write file");
    stage_files(&ExecTarget::Local, &path, &["streamed.txt".to_string()])
        .await
        .expect("stage");

    let (sink, calls) = collecting_sink();
    let result = commit_files(
        &ExecTarget::Local,
        &path,
        &[],
        "stream me",
        GitRunHooks {
            on_output: Some(sink),
            cancel: None,
        },
    )
    .await
    .expect("commit should succeed");

    assert!(!result.hash.is_empty(), "commit hash should be parsed");
    let text: String = calls
        .lock()
        .unwrap()
        .iter()
        .map(|(_, t)| t.as_str())
        .collect();
    assert!(
        text.contains("stream me"),
        "commit 输出（含 message 摘要）必须实时交付，got: {text:?}"
    );
}

#[tokio::test]
async fn commit_files_without_sink_still_returns_hash() {
    let (_dir, path) = init_repo().await;
    std::fs::write(std::path::Path::new(&path).join("quiet.txt"), "x\n").expect("write file");
    stage_files(&ExecTarget::Local, &path, &["quiet.txt".to_string()])
        .await
        .expect("stage");

    let result = commit_files(
        &ExecTarget::Local,
        &path,
        &[],
        "no sink",
        GitRunHooks::none(),
    )
    .await
    .expect("commit without sink must keep working");
    assert!(!result.hash.is_empty());
}

// ── 取消：长 pre-push hook 必须被杀掉并快速返回 ──────────────────────────

#[cfg(unix)]
#[tokio::test]
async fn push_cancel_aborts_pre_push_hook_and_returns_promptly() {
    use std::os::unix::fs::PermissionsExt;

    use crate::common::git::transport::GitSyncHandle;

    let (_dir, path) = init_repo().await;
    let remote_dir = tempdir().expect("remote tempdir");
    let remote = remote_dir.path().to_string_lossy().to_string();
    let out = git_local(&remote, &["init", "--bare", "-q"]).await;
    assert_eq!(out.exit_code, 0, "bare init failed");
    let out = git_local(&path, &["remote", "add", "origin", &remote]).await;
    assert_eq!(out.exit_code, 0, "remote add failed");

    // 模拟本仓真实的 pre-push（分钟级测试）：hook 树不取消时会让 push 挂住。
    let hook = std::path::Path::new(&path).join(".git/hooks/pre-push");
    std::fs::write(&hook, "#!/bin/sh\nsleep 30\n").expect("write pre-push hook");
    let mut perm = std::fs::metadata(&hook)
        .expect("hook metadata")
        .permissions();
    perm.set_mode(0o755);
    std::fs::set_permissions(&hook, perm).expect("chmod hook");

    let handle = GitSyncHandle::new();
    let handle_for_task = handle.clone();
    let repo_path = path.clone();
    let push_task = tokio::spawn(async move {
        push(
            &ExecTarget::Local,
            &repo_path,
            true,
            GitRunHooks {
                on_output: None,
                cancel: Some(handle_for_task),
            },
        )
        .await
    });

    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    handle.cancel().expect("receiver alive");

    let result = tokio::time::timeout(std::time::Duration::from_secs(5), push_task)
        .await
        .expect("cancel must abort the push promptly (hook tree killed)")
        .expect("join");
    let err = result.expect_err("cancelled push must surface an error");
    assert!(
        format!("{err:#}").to_lowercase().contains("cancel"),
        "error must be the cancellation one, got: {err:#}"
    );
}
