use super::*;
use crate::common::executor::factory::ExecTarget;
use crate::common::git::transport::{GitExecOptions, GitTransport};

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
use async_trait::async_trait;
use tempfile::tempdir;

/// 在测试中执行本地 git 命令（async，走统一接口）。
async fn git_local(path: &str, args: &[&str]) -> crate::common::executor::ExecOutput {
    collect_in_dir(&ExecTarget::Local, "git", args, Some(path))
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

#[tokio::test]
async fn discard_file_should_delete_untracked_file() {
    // 未跟踪文件（git status ??）：`git checkout -- <file>` 会报 pathspec 错误，
    // discard 应改为删除文件，而不是失败。
    let (dir, path) = init_repo().await;
    std::fs::write(dir.path().join("test_structure.html"), "new\n").expect("write untracked");

    let transport = ExecTarget::Local;
    discard_file(&transport, &path, "test_structure.html")
        .await
        .expect("discard untracked file should not fail");

    assert!(
        !dir.path().join("test_structure.html").exists(),
        "untracked file should be deleted"
    );
}

#[tokio::test]
async fn discard_file_should_restore_modified_tracked_file() {
    // 已跟踪文件的工作区修改：应恢复到 HEAD 版本。
    let (dir, path) = init_repo().await;
    std::fs::write(dir.path().join("base.txt"), "modified\n").expect("modify tracked");

    let transport = ExecTarget::Local;
    discard_file(&transport, &path, "base.txt")
        .await
        .expect("discard tracked file should succeed");

    assert_worktree_eq(dir.path(), "base.txt", "base\n");
}

#[tokio::test]
async fn discard_file_should_unstage_and_restore_staged_file() {
    // 已暂存（index 变更）：应撤销暂存并恢复工作区。
    let (dir, path) = init_repo().await;
    std::fs::write(dir.path().join("base.txt"), "staged\n").expect("modify tracked");
    let out = git_local(&path, &["add", "base.txt"]).await;
    assert!(out.exit_code == 0, "git add failed");

    let transport = ExecTarget::Local;
    discard_file(&transport, &path, "base.txt")
        .await
        .expect("discard staged file should succeed");

    assert_worktree_eq(dir.path(), "base.txt", "base\n");
}

/// 脚本化 mock transport：status 返回已暂存修改，reset 返回真实错误（非 unknown revision）。
struct ResetErrorTransport;

#[async_trait]
impl GitTransport for ResetErrorTransport {
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
        match args.first() {
            Some(&"status") => Ok("M  base.txt\0".to_string()),
            Some(&"reset") => Err(GitExecError {
                kind: ErrorKind::Other,
                stderr: "fatal: unable to reset".to_string(),
                stdout: String::new(),
                command: "git reset HEAD -- base.txt".to_string(),
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

    async fn is_git_repo(&self, _path: &str) -> bool {
        true
    }
}

#[tokio::test]
async fn discard_file_should_delete_staged_add_in_repo_without_head() {
    // 新仓库无 HEAD：staged 新增（A）→ reset 报 unknown revision → rm --cached + clean 删除
    let dir = tempdir().expect("create temp dir");
    let path = dir.path().to_string_lossy().to_string();
    let out = git_local(&path, &["init", "-q"]).await;
    assert!(out.exit_code == 0, "git init failed");
    std::fs::write(dir.path().join("new.txt"), "new\n").expect("write new file");
    let out = git_local(&path, &["add", "new.txt"]).await;
    assert!(out.exit_code == 0, "git add failed");

    let transport = ExecTarget::Local;
    discard_file(&transport, &path, "new.txt")
        .await
        .expect("discard staged add in no-HEAD repo should succeed");

    assert!(
        !dir.path().join("new.txt").exists(),
        "staged add should be deleted in no-HEAD repo"
    );
}

#[tokio::test]
async fn discard_file_should_propagate_real_reset_error() {
    // reset 返回真实错误（stderr 非 unknown revision / ambiguous）→ 错误应传播而非静默吞掉
    let transport = ResetErrorTransport;
    let result = discard_file(&transport, "/tmp", "base.txt").await;
    assert!(result.is_err(), "real reset error should propagate");
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

#[test]
fn parse_ignored_porcelain_extracts_ignored_paths() {
    // `!! ` 前缀为忽略项；目录带尾斜杠；普通 porcelain 行应被过滤
    let output = "!! .env\n!! dist/\n M src/main.rs\n?? new.txt\n";
    let paths = parse_ignored_porcelain(output);
    assert_eq!(paths, vec![".env", "dist"]);
}

#[test]
fn parse_ignored_porcelain_handles_edge_cases() {
    assert!(parse_ignored_porcelain("").is_empty());
    assert!(parse_ignored_porcelain(" M src/main.rs\n").is_empty());
    assert_eq!(
        parse_ignored_porcelain("!! node_modules/\n"),
        vec!["node_modules"]
    );
}

// ── collapse 参数：false 时跳过上下文折叠、返回完整上下文 ────────────────

/// 脚本化 mock transport：返回带长连续 context 的 diff 文本，并捕获
/// args 与 opts.env（供只读查询契约断言）。
struct DiffTextTransport {
    output: String,
    captured_args: std::sync::Mutex<Vec<String>>,
    captured_env: std::sync::Mutex<Vec<(String, String)>>,
}

impl DiffTextTransport {
    fn new(output: String) -> Self {
        Self {
            output,
            captured_args: std::sync::Mutex::new(Vec::new()),
            captured_env: std::sync::Mutex::new(Vec::new()),
        }
    }

    fn last_args(&self) -> Vec<String> {
        self.captured_args.lock().unwrap().clone()
    }

    fn last_env(&self) -> Vec<(String, String)> {
        self.captured_env.lock().unwrap().clone()
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
        opts: GitExecOptions<'_>,
    ) -> Result<String> {
        self.captured_args.lock().unwrap().push(
            args.iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
                .join(" "),
        );
        self.captured_env.lock().unwrap().push(
            opts.env
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
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

// ── 公理2契约：只读查询必须携带 GIT_OPTIONAL_LOCKS=0（不写 .git/index）──

/// 高频只读查询（changed_files / ignored_files / file_diff / staged_diff）
/// 必须经 `readonly_opts()` 注入 `GIT_OPTIONAL_LOCKS=0`——缺 env 时 git
/// 可能 stat-refresh 写 index，与 .git 元数据 watcher 形成自反馈回路。
#[tokio::test]
async fn readonly_queries_inject_git_optional_locks() {
    let transport = DiffTextTransport::new(long_context_diff());

    let _ = get_worktree_changed_files(&transport, "/tmp").await;
    let _ = get_ignored_files(&transport, "/tmp").await;
    let _ = get_file_diff(&transport, "/tmp", "a.txt", true).await;
    let _ = get_staged_diff(&transport, "/tmp", 100).await;

    let envs = transport.last_env();
    assert!(!envs.is_empty(), "只读查询必须携带 env");
    for env in envs {
        assert_eq!(
            env,
            ("GIT_OPTIONAL_LOCKS".to_string(), "0".to_string()),
            "只读查询必须注入 GIT_OPTIONAL_LOCKS=0（公理2：查询无副作用）"
        );
    }
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
    discard_file(&transport, &path, "base.txt")
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
        "cache must be invalidated after discard_file, got {after:?}"
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
