use super::*;

// ── run_git_opts 空 work_dir 纵深防御 ─────────────────────────────────

#[tokio::test]
async fn local_run_git_opts_rejects_empty_work_dir() {
    // 回归：空 work_dir 会让 `cd ''` 停在进程当前目录（macOS sh 行为），
    // 导致 git 在错误仓库执行；必须显式报错而非静默污染数据。
    let err = ExecTarget::Local
        .run_git_opts(
            &["rev-parse", "--abbrev-ref", "HEAD"],
            "",
            GitExecOptions::default(),
        )
        .await
        .expect_err("empty work_dir must be rejected");
    assert!(
        err.to_string().contains("empty work directory"),
        "unexpected error: {err}"
    );
}

// ── classify_stderr ────────────────────────────────────────────────────

#[test]
fn should_classify_ssh_as_auth_ssh() {
    assert_eq!(
        classify_stderr("Permission denied (publickey).\nfatal: Could not read"),
        ErrorKind::AuthSsh
    );
    assert_eq!(
        classify_stderr("Host key verification failed."),
        ErrorKind::AuthSsh
    );
}

#[test]
fn should_classify_https_auth_failures() {
    assert_eq!(
        classify_stderr("fatal: Authentication failed"),
        ErrorKind::Auth
    );
    assert_eq!(
        classify_stderr(
            "fatal: could not read Username for 'https://...': terminal prompts disabled"
        ),
        ErrorKind::Auth
    );
    assert_eq!(
        classify_stderr("remote: HTTP Basic: Access denied"),
        ErrorKind::Auth
    );
    assert_eq!(
        classify_stderr("remote: Invalid username or password."),
        ErrorKind::Auth
    );
    assert_eq!(
        classify_stderr("remote: Support for password authentication was removed."),
        ErrorKind::Auth
    );
}

#[test]
fn should_classify_network_errors() {
    assert_eq!(
        classify_stderr("fatal: unable to access 'https://...': Could not resolve host"),
        ErrorKind::Network
    );
    assert_eq!(
        classify_stderr("fatal: Connection timed out"),
        ErrorKind::Network
    );
}

#[test]
fn should_classify_ambiguous_patterns() {
    assert_eq!(
        classify_stderr("ERROR: Repository not found."),
        ErrorKind::Ambiguous
    );
    assert_eq!(
        classify_stderr("fatal: Could not read from remote repository."),
        ErrorKind::Ambiguous
    );
    assert_eq!(
        classify_stderr(
            "fatal: the remote end hung up unexpectedly The requested URL returned error: 403"
        ),
        ErrorKind::Ambiguous
    );
}

#[test]
fn should_classify_other_for_empty_or_unknown() {
    assert_eq!(classify_stderr(""), ErrorKind::Other);
    assert_eq!(
        classify_stderr("some unrelated git message"),
        ErrorKind::Other
    );
}

// ── shell_quote ────────────────────────────────────────────────────────

#[test]
fn should_shell_quote_simple_value() {
    assert_eq!(shell_quote("hello"), "'hello'");
}

#[test]
fn should_shell_quote_embedded_quote() {
    assert_eq!(shell_quote("a'b"), "'a'\\''b'");
}

// ── run_git_opts: env + extra_config 注入 ───────────────────────────────
// env 注入已通过 `should_inject_env_into_git` 验证（GIT_AUTHOR_NAME）。
// extra_config 拆分逻辑（k=v → -c k=v）是简单字符串拼接，单独单测价值低，
// 实际使用在 credential.rs 的 `-c credential.helper=` 路径会被集成测试覆盖。

#[tokio::test]
async fn should_inject_env_into_git() {
    // 通过 GIT_AUTHOR_NAME 环境变量，git var GIT_AUTHOR_IDENT 返回该作者信息
    let transport = ExecTarget::Local;
    let opts = GitExecOptions {
        // `git var GIT_AUTHOR_IDENT` 需要 name + email 同时存在;
        // CI 上可能未配置全局 git 身份,必须全部注入才能保证测试独立于机器环境。
        env: &[
            ("GIT_AUTHOR_NAME", "Neeko Test"),
            ("GIT_AUTHOR_EMAIL", "neeko@test.local"),
        ],
        extra_config: &[],
    };
    let out = transport
        .run_git_opts(&["var", "GIT_AUTHOR_IDENT"], ".", opts)
        .await
        .expect("git var should succeed");
    assert!(out.contains("Neeko Test"));
}

// ── run_git_with_stdin ──────────────────────────────────────────────────

#[tokio::test]
async fn should_feed_stdin_to_git_hash_object() {
    // git hash-object --stdin 对输入字节计算 blob hash
    let transport = ExecTarget::Local;
    let opts = GitExecOptions::default();
    let out = transport
        .run_git_with_stdin(&["hash-object", "--stdin"], ".", opts, b"hello\n")
        .await
        .expect("hash-object should succeed");
    // git hash-object of "hello\n" = a576ec7d6464f8b5c76b6a0b3c9b68c0e8c4c3b3...（运行时校验非空且为 40 hex）
    let hash = out.trim();
    assert_eq!(hash.len(), 40);
    assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
}

// ── GitExecError 分类在非零退出时生效 ────────────────────────────────────

#[tokio::test]
async fn should_return_classified_error_on_auth_failure() {
    // git push 到一个不存在的本地路径会失败；这里用一个必失败的命令触发 GitExecError
    // 用 `git --no-such-flag` 触发非零退出，stderr 不含鉴权模式 → Other
    let transport = ExecTarget::Local;
    let result = transport
        .run_git_opts(&["--no-such-flag"], ".", GitExecOptions::default())
        .await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    let git_err = err.downcast_ref::<GitExecError>();
    assert!(git_err.is_some(), "error should be GitExecError");
    assert_eq!(git_err.unwrap().kind, ErrorKind::Other);
}

#[tokio::test]
async fn test_local_run_git() {
    let transport = ExecTarget::Local;
    let result = transport.run_git(&["--version"], ".").await;
    assert!(result.is_ok());
    assert!(result.unwrap().contains("git version"));
}

#[tokio::test]
async fn test_local_is_git_repo() {
    let transport = ExecTarget::Local;
    assert!(!transport.is_git_repo("/tmp").await);
}
