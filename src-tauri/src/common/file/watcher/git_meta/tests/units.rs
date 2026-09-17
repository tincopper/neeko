//! git 元数据路径解析与事件分类的纯逻辑测试。

use super::super::classify::{classify_git_meta_event, GitMetaChange};
use super::super::paths::{resolve_git_head_path, resolve_git_meta_paths, resolve_worktree_roots};
use std::path::PathBuf;

// ── HEAD 路径解析 ────────────────────────────────────────────────────────

/// 普通仓库：HEAD 位于 `<repo>/.git/HEAD`
#[test]
fn resolve_git_head_path_normal_repo() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path();
    let git_dir = repo.join(".git");
    std::fs::create_dir_all(&git_dir).unwrap();
    std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();

    let head = resolve_git_head_path(repo).expect("should resolve HEAD");
    assert_eq!(head, git_dir.join("HEAD"));
}

/// linked worktree：`.git` 是指针文件，HEAD 位于 gitdir 指向的目录下
#[test]
fn resolve_git_head_path_linked_worktree() {
    let tmp = tempfile::tempdir().unwrap();
    let main_repo = tmp.path().join("main");
    let wt = tmp.path().join("wt");
    let wt_gitdir = main_repo.join(".git").join("worktrees").join("dev");
    std::fs::create_dir_all(&wt_gitdir).unwrap();
    std::fs::write(wt_gitdir.join("HEAD"), "ref: refs/heads/dev\n").unwrap();
    std::fs::create_dir_all(&wt).unwrap();
    std::fs::write(
        wt.join(".git"),
        format!("gitdir: {}\n", wt_gitdir.display()),
    )
    .unwrap();

    let head = resolve_git_head_path(&wt).expect("should resolve worktree HEAD");
    assert_eq!(head, wt_gitdir.join("HEAD"));
}

/// 非 git 目录：返回 None
#[test]
fn resolve_git_head_path_not_a_repo() {
    let tmp = tempfile::tempdir().unwrap();
    assert!(resolve_git_head_path(tmp.path()).is_none());
}

/// 主仓库 + linked worktree 并存：
/// 主仓库 HEAD 解析到 `.git/HEAD`，且 `.git/worktrees` 目录存在
/// （HEAD watcher 据此判定需要全量 emit 兜底，覆盖 worktree 场景）。
#[test]
fn resolve_git_head_path_with_linked_worktrees() {
    let tmp = tempfile::tempdir().unwrap();
    let main = tmp.path().join("main");
    let main_repo = git2::Repository::init(&main).unwrap();

    // 需要至少一个 commit 才能添加 worktree
    let sig = git2::Signature::now("Test", "test@test.com").unwrap();
    std::fs::write(main.join("README.md"), "# Test\n").unwrap();
    {
        let mut index = main_repo.index().unwrap();
        index.add_path(std::path::Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = main_repo.find_tree(tree_id).unwrap();
        main_repo
            .commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .unwrap();
    }

    // 添加 linked worktree（git worktree add 等价操作）
    let wt = tmp.path().join("wt");
    main_repo
        .worktree("dev", &wt, None)
        .expect("should add worktree");

    // 主仓库 HEAD 仍是 `.git/HEAD`
    let main_head = resolve_git_head_path(&main).expect("should resolve main HEAD");
    assert_eq!(main_head, main.join(".git").join("HEAD"));

    // `.git/worktrees` 目录存在 → has_worktrees 判定为 true
    let wt_dir = main.join(".git").join("worktrees");
    assert!(
        wt_dir.is_dir(),
        "linked worktree 应创建 .git/worktrees 目录"
    );

    // linked worktree 的 HEAD 解析到 worktree 专属 gitdir。
    // macOS 上 /var 是 /private/var 符号链接，git2 写入的 gitdir 为 realpath，
    // 比较前先 canonicalize 归一化路径。
    let wt_head = resolve_git_head_path(&wt).expect("should resolve worktree HEAD");
    let wt_head_canon = wt_head.canonicalize().unwrap_or(wt_head.clone());
    let wt_dir_canon = wt_dir.canonicalize().unwrap_or(wt_dir.clone());
    assert!(
        wt_head_canon.starts_with(&wt_dir_canon),
        "worktree HEAD 应位于 .git/worktrees/<name>/HEAD，实际 {}",
        wt_head.display()
    );
    assert!(wt_head.ends_with("HEAD"));
}

// ── git 元数据路径解析（HEAD + index + git_dir + worktrees） ──────────────

/// 普通仓库：HEAD 与 index 均位于 `<repo>/.git` 下
#[test]
fn resolve_git_meta_paths_normal_repo() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path();
    let git_dir = repo.join(".git");
    std::fs::create_dir_all(&git_dir).unwrap();
    std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    std::fs::write(git_dir.join("index"), "\0").unwrap();

    let meta = resolve_git_meta_paths(repo).expect("should resolve git meta paths");
    // git_dir 会被 canonicalize（macOS /var → /private/var），断言按归一化后比较
    let git_dir_canon = git_dir.canonicalize().unwrap_or_else(|_| git_dir.clone());
    assert_eq!(meta.head, git_dir_canon.join("HEAD"));
    assert_eq!(meta.index, git_dir_canon.join("index"));
    assert_eq!(meta.git_dir, git_dir_canon);
    assert!(!meta.has_worktrees);
}

/// linked worktree：HEAD 与 index 位于 `<git_dir>/worktrees/<name>` 下
#[test]
fn resolve_git_meta_paths_linked_worktree() {
    let tmp = tempfile::tempdir().unwrap();
    let main_repo = tmp.path().join("main");
    let wt = tmp.path().join("wt");
    let wt_gitdir = main_repo.join(".git").join("worktrees").join("dev");
    std::fs::create_dir_all(&wt_gitdir).unwrap();
    std::fs::write(wt_gitdir.join("HEAD"), "ref: refs/heads/dev\n").unwrap();
    std::fs::write(wt_gitdir.join("index"), "\0").unwrap();
    std::fs::create_dir_all(&wt).unwrap();
    std::fs::write(
        wt.join(".git"),
        format!("gitdir: {}\n", wt_gitdir.display()),
    )
    .unwrap();

    let meta = resolve_git_meta_paths(&wt).expect("should resolve worktree git meta paths");
    // git_dir 会被 canonicalize，断言按归一化后比较
    let wt_gitdir_canon = wt_gitdir
        .canonicalize()
        .unwrap_or_else(|_| wt_gitdir.clone());
    assert_eq!(meta.head, wt_gitdir_canon.join("HEAD"));
    assert_eq!(meta.index, wt_gitdir_canon.join("index"));
    assert_eq!(meta.git_dir, wt_gitdir_canon);
    assert!(!meta.has_worktrees);
}

/// 非 git 目录：返回 None
#[test]
fn resolve_git_meta_paths_not_a_repo() {
    let tmp = tempfile::tempdir().unwrap();
    assert!(resolve_git_meta_paths(tmp.path()).is_none());
}

/// 主仓库 + linked worktree 并存：has_worktrees 判定为 true
/// （git 元数据 watcher 据此监听 `.git/worktrees` 递归，捕获其他 worktree 的 HEAD）
#[test]
fn resolve_git_meta_paths_with_linked_worktrees() {
    let tmp = tempfile::tempdir().unwrap();
    let main = tmp.path().join("main");
    let main_repo = git2::Repository::init(&main).unwrap();

    let sig = git2::Signature::now("Test", "test@test.com").unwrap();
    std::fs::write(main.join("README.md"), "# Test\n").unwrap();
    {
        let mut index = main_repo.index().unwrap();
        index.add_path(std::path::Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = main_repo.find_tree(tree_id).unwrap();
        main_repo
            .commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .unwrap();
    }

    let wt = tmp.path().join("wt");
    main_repo
        .worktree("dev", &wt, None)
        .expect("should add worktree");

    let meta = resolve_git_meta_paths(&main).expect("should resolve main git meta paths");
    assert!(meta.has_worktrees, "主仓库应检测到 linked worktree");

    let wt_meta = resolve_git_meta_paths(&wt).expect("should resolve worktree git meta paths");
    let wt_dir_canon = main.join(".git").join("worktrees").canonicalize().unwrap();
    let wt_meta_dir_canon = wt_meta
        .git_dir
        .canonicalize()
        .unwrap_or_else(|_| wt_meta.git_dir.clone());
    assert!(
        wt_meta_dir_canon.starts_with(&wt_dir_canon),
        "worktree git_dir 应位于 .git/worktrees/<name>，实际 {}",
        wt_meta.git_dir.display()
    );
    assert_eq!(wt_meta.index.file_name().unwrap(), "index");
    assert_eq!(wt_meta.head.file_name().unwrap(), "HEAD");
}

// ── git 元数据事件分类（HEAD / index / worktrees） ────────────────────────

/// index 变更（git add / rm --cached / reset / commit）→ IndexChanged
#[test]
fn classify_git_meta_event_index_touched() {
    let head = PathBuf::from("/repo/.git/HEAD");
    let index = PathBuf::from("/repo/.git/index");
    let change = classify_git_meta_event(std::slice::from_ref(&index), &head, &index, None, &[]);
    assert_eq!(change, GitMetaChange::IndexChanged);
}

/// HEAD 变更（分支切换）→ HeadChanged
#[test]
fn classify_git_meta_event_head_touched() {
    let head = PathBuf::from("/repo/.git/HEAD");
    let index = PathBuf::from("/repo/.git/index");
    let change = classify_git_meta_event(std::slice::from_ref(&head), &head, &index, None, &[]);
    assert_eq!(change, GitMetaChange::HeadChanged);
}

/// 无关 git 元数据文件（config / ORIG_HEAD 等）→ Nothing
///
/// 这是「无关元数据不触发回调」属性的确定性落点：纯函数、无 FS、无时序。
/// 真实 FS 上不做「一段时间内无事件」的墙钟负向断言（非确定性）。
#[test]
fn classify_git_meta_event_ignores_unrelated_meta() {
    let head = PathBuf::from("/repo/.git/HEAD");
    let index = PathBuf::from("/repo/.git/index");
    for unrelated in ["config", "ORIG_HEAD", "COMMIT_EDITMSG"] {
        let change = classify_git_meta_event(
            &[PathBuf::from(format!("/repo/.git/{unrelated}"))],
            &head,
            &index,
            None,
            &[],
        );
        assert_eq!(
            change,
            GitMetaChange::Nothing,
            "路径 {unrelated} 应分类为 Nothing"
        );
    }
}

/// resolve_worktree_roots：解析 `.git/worktrees/<name>/gitdir`（真实 git 写**裸路径**，
/// 指向 worktree 的 `.git` 文件）→ 剥掉 `.git` 分量得工作目录根
#[test]
fn resolve_worktree_roots_reads_gitdir_files() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path();
    let git_dir = repo.join(".git");
    std::fs::create_dir_all(git_dir.join("worktrees").join("dev")).unwrap();
    std::fs::create_dir_all(git_dir.join("worktrees").join("qa")).unwrap();
    // 真实格式：裸绝对路径 + 末尾 `.git` 分量（无 `gitdir: ` 前缀）
    std::fs::write(
        git_dir.join("worktrees").join("dev").join("gitdir"),
        "/workspace/wt-dev/.git\n",
    )
    .unwrap();
    // 防御性兼容：带 `gitdir: ` 前缀的行（worktree 侧 `.git` 文件的格式）
    std::fs::write(
        git_dir.join("worktrees").join("qa").join("gitdir"),
        "gitdir: /workspace/wt-qa/.git\n",
    )
    .unwrap();

    let roots = resolve_worktree_roots(&git_dir);
    assert!(roots.iter().any(|r| r.ends_with("wt-dev")));
    assert!(roots.iter().any(|r| r.ends_with("wt-qa")));
    // 不得把 `.git` 文件本身当监听根
    assert!(
        roots.iter().all(|r| !r.ends_with(".git")),
        "root must be the worktree dir, not the .git file: {roots:?}"
    );
}

/// resolve_worktree_roots：真实 libgit2 worktree（端到端格式回归——
/// 曾误用 `gitdir: ` 前缀解析且未剥 `.git` 分量，真实仓库上恒返回空）。
#[test]
fn resolve_worktree_roots_parses_real_git_worktree() {
    let tmp = tempfile::tempdir().unwrap();
    let repo_path = tmp.path().join("main");
    let repo = git2::Repository::init(&repo_path).unwrap();
    std::fs::write(repo_path.join("README.md"), "# t\n").unwrap();
    let sig = git2::Signature::now("t", "t@t.com").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(std::path::Path::new("README.md")).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
        .unwrap();

    let wt_path = tmp.path().join("wt-dev");
    repo.worktree("dev", &wt_path, None).unwrap();

    let git_dir = repo_path.join(".git");
    let roots = resolve_worktree_roots(&git_dir);
    assert_eq!(roots.len(), 1, "actual: {roots:?}");
    // canonicalize 在 macOS 会把 /var 归一化为 /private/var，用 ends_with 断言
    assert!(roots[0].ends_with("wt-dev"), "actual: {:?}", roots[0]);
    assert!(!roots[0].ends_with(".git"));
}

/// resolve_worktree_roots：无 worktrees 目录时返回空
#[test]
fn resolve_worktree_roots_empty_without_worktrees() {
    let tmp = tempfile::tempdir().unwrap();
    let git_dir = tmp.path().join(".git");
    std::fs::create_dir_all(&git_dir).unwrap();
    assert!(resolve_worktree_roots(&git_dir).is_empty());
}

/// worktrees 目录下的事件（其他 worktree 的 HEAD/index）→ WorktreeMetaChanged
/// （G3：独立分类，前端按 activeWorktree 刷新，不再借用主 HEAD 的 has_wt 语义）
#[test]
fn classify_git_meta_event_worktree_head_touched() {
    let head = PathBuf::from("/repo/.git/HEAD");
    let index = PathBuf::from("/repo/.git/index");
    let wt_dir = PathBuf::from("/repo/.git/worktrees");
    let change = classify_git_meta_event(
        &[PathBuf::from("/repo/.git/worktrees/dev/HEAD")],
        &head,
        &index,
        Some(&wt_dir),
        &[],
    );
    assert_eq!(change, GitMetaChange::WorktreeMetaChanged);

    // worktree 的 index（git add / commit 在 linked worktree 内只改这个文件）
    let change2 = classify_git_meta_event(
        &[PathBuf::from("/repo/.git/worktrees/dev/index")],
        &head,
        &index,
        Some(&wt_dir),
        &[],
    );
    assert_eq!(change2, GitMetaChange::WorktreeMetaChanged);
}

/// linked worktree 工作目录内的事件（文件编辑/新建，P4）→ WorktreeMetaChanged
#[test]
fn classify_git_meta_event_worktree_root_edit_is_worktree_change() {
    let head = PathBuf::from("/repo/.git/HEAD");
    let index = PathBuf::from("/repo/.git/index");
    let roots = [PathBuf::from("/workspace/wt-dev")];
    let change = classify_git_meta_event(
        &[PathBuf::from("/workspace/wt-dev/src/main.rs")],
        &head,
        &index,
        None,
        &roots,
    );
    assert_eq!(change, GitMetaChange::WorktreeMetaChanged);
    // 主仓库路径不误判为 worktree
    let change2 = classify_git_meta_event(
        &[PathBuf::from("/workspace/main/src/app.rs")],
        &head,
        &index,
        None,
        &roots,
    );
    assert_eq!(change2, GitMetaChange::Nothing);
}

/// 无 worktrees 时，worktrees 目录下的事件 → Nothing
#[test]
fn classify_git_meta_event_no_worktrees_dir_ignores_worktree_path() {
    let head = PathBuf::from("/repo/.git/HEAD");
    let index = PathBuf::from("/repo/.git/index");
    let change = classify_git_meta_event(
        &[PathBuf::from("/repo/.git/worktrees/dev/HEAD")],
        &head,
        &index,
        None,
        &[],
    );
    assert_eq!(change, GitMetaChange::Nothing);
}

/// HEAD 与 index 同时变更（git commit：清空暂存 + 更新 HEAD）→ IndexChanged 优先
/// （index 变更需要全量刷新覆盖 ignored_files，优先级高于 HEAD）
#[test]
fn classify_git_meta_event_index_takes_priority_over_head() {
    let head = PathBuf::from("/repo/.git/HEAD");
    let index = PathBuf::from("/repo/.git/index");
    let change = classify_git_meta_event(&[head.clone(), index.clone()], &head, &index, None, &[]);
    assert_eq!(change, GitMetaChange::IndexChanged);
}

/// 空事件路径 → Nothing
#[test]
fn classify_git_meta_event_empty_paths() {
    let head = PathBuf::from("/repo/.git/HEAD");
    let index = PathBuf::from("/repo/.git/index");
    let change = classify_git_meta_event(&[], &head, &index, None, &[]);
    assert_eq!(change, GitMetaChange::Nothing);
}
