//! git 元数据 watcher 集成与注入测试：真实 FS 事件送达、失败分支、自愈补挂。

use super::super::paths::{resolve_git_meta_paths, GitMetaPaths};
use super::super::watcher::{create_git_meta_watcher, create_git_meta_watcher_with};
use notify::{RecommendedWatcher, RecursiveMode};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

// ── 真实文件系统集成测试：验证 notify 事件送达（方案 B 修复的核心假设） ────
//
// 这些测试使用真实 notify::RecommendedWatcher + 真实临时 git 仓库，验证：
// 1. `.git/index` 的原子写（lock + rename，git 真实行为）能被捕获 → on_index_changed
// 2. `.git/HEAD` 的原子写能被捕获 → on_head_changed
// 3. worktree 区域事件经 rearm 递归监听送达（自愈补挂）
//
// 确定性约定：
// - 不设注册预热 / 观察窗口 sleep，不用墙钟窗口做负向断言；
// - 「写-轮询」等待事件到达（25ms 有界轮询，整体 5s 上限）——notify 未就绪时
//   首事件可能丢失，重试写入即自愈；
// - 负向分类属性（config / ORIG_HEAD → Nothing）由 units.rs 纯函数测试确定性覆盖，
//   不在真实 FS 上做「一段时间内无事件」的墙钟断言。

/// 集成测试助手：为给定 `GitMetaPaths` 建 watcher，返回各回调计数 flag。
///
/// 调用方负责让 `meta` 对应的目录保持存活（`TempDir` 不得在此函数内 drop）。
#[allow(clippy::type_complexity)]
fn spawn_watcher_for(
    meta: &GitMetaPaths,
) -> (
    super::super::watcher::GitMetaWatcherHandle,
    Arc<AtomicUsize>,
    Arc<AtomicUsize>,
    Arc<AtomicUsize>,
) {
    let index_changed = Arc::new(AtomicUsize::new(0));
    let head_changed = Arc::new(AtomicUsize::new(0));
    let refs_changed = Arc::new(AtomicUsize::new(0));
    let index_flag = index_changed.clone();
    let head_flag = head_changed.clone();
    let refs_flag = refs_changed.clone();

    let watcher = create_git_meta_watcher(
        "integration-test".to_string(),
        meta,
        move || {
            index_flag.fetch_add(1, Ordering::SeqCst);
        },
        move || {
            head_flag.fetch_add(1, Ordering::SeqCst);
        },
        move || {
            refs_flag.fetch_add(1, Ordering::SeqCst);
        },
    )
    .expect("git meta watcher should be created");

    (watcher, index_changed, head_changed, refs_changed)
}

/// 集成测试助手：创建临时普通仓库 + git 元数据 watcher，返回各回调计数 flag。
/// `tempfile::TempDir` 必须随返回保持存活，否则目录被删、watcher 无事件。
/// 返回 `(tmp, handle, meta, index_changed, head_changed, refs_changed)`。
#[allow(clippy::type_complexity)]
fn spawn_git_meta_watcher_spy() -> (
    tempfile::TempDir,
    super::super::watcher::GitMetaWatcherHandle,
    GitMetaPaths,
    Arc<AtomicUsize>,
    Arc<AtomicUsize>,
    Arc<AtomicUsize>,
) {
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path();
    let git_dir = repo.join(".git");
    std::fs::create_dir_all(git_dir.join("refs").join("heads")).unwrap();
    // 注意：不得在 watcher 建立前写入 HEAD/index —— macOS FSEvents 异步送达会把
    // 注册前写入的迟到事件漏进流内，污染负向测试的绝对零断言（CI 实测 index_changed
    // 被污染为 2）。各测试在 watcher 建立后自行 lock+rename 写入。
    let meta = resolve_git_meta_paths(repo).unwrap();

    let (watcher, index_changed, head_changed, refs_changed) = spawn_watcher_for(&meta);

    (
        tmp,
        watcher,
        meta,
        index_changed,
        head_changed,
        refs_changed,
    )
}

/// 有界轮询等待条件成立（notify 异步送达，避免 flaky）
fn wait_until(cond: impl Fn() -> bool, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if cond() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    cond()
}

/// 集成验证：`.git/index` 原子写（lock + rename，git add / rm --cached /
/// reset / commit 的真实行为）能触发 on_index_changed——这是方案 B 修复
/// 的核心假设：外部只改 index 的 git 操作必须驱动 git-changed 全量刷新，
/// 否则 ignored_files（文件树 .gitignore 灰色）残留旧值。
#[test]
fn git_meta_watcher_detects_index_change_on_real_fs() {
    let (_tmp, watcher, meta, index_changed, head_changed, refs_changed) =
        spawn_git_meta_watcher_spy();

    // 模拟 git 原子写 index（lock + rename）。「写-轮询」：反复写入直到被捕获，
    // 不设注册预热 sleep——notify 未就绪时首事件可能丢失，重试写入即自愈。
    assert!(
        wait_until(
            || {
                std::fs::write(meta.git_dir.join("index.lock"), "v2").unwrap();
                std::fs::rename(meta.git_dir.join("index.lock"), meta.git_dir.join("index"))
                    .unwrap();
                index_changed.load(Ordering::SeqCst) > 0
            },
            Duration::from_secs(5),
        ),
        "index 变更应触发 on_index_changed"
    );
    // index 变更不应触发 HEAD / refs 回调
    assert_eq!(head_changed.load(Ordering::SeqCst), 0);
    assert_eq!(refs_changed.load(Ordering::SeqCst), 0);
    drop(watcher);
}

/// 集成验证：`.git/HEAD` 原子写（分支切换的真实行为）能触发 on_head_changed。
#[test]
fn git_meta_watcher_detects_head_change_on_real_fs() {
    let (_tmp, watcher, meta, _index_changed, head_changed, _refs_changed) =
        spawn_git_meta_watcher_spy();

    // 模拟 git 切分支改写 HEAD（lock + rename）。「写-轮询」：反复写入直到被捕获。
    assert!(
        wait_until(
            || {
                std::fs::write(meta.git_dir.join("HEAD.lock"), "ref: refs/heads/dev\n").unwrap();
                std::fs::rename(meta.git_dir.join("HEAD.lock"), meta.git_dir.join("HEAD")).unwrap();
                head_changed.load(Ordering::SeqCst) > 0
            },
            Duration::from_secs(5),
        ),
        "HEAD 变更应触发 on_head_changed"
    );
    drop(watcher);
}

// ── worktrees 自愈补挂（会话中途 git worktree add） ────────────────────────

// ── refs 递归监听（外部 push / fetch）──────────────────────────────────────

/// 真实现场形态的 linked worktree：主仓 `.git` + 私有 gitdir（`worktrees/<name>`，
/// 含 `commondir` 指针）+ `wt/.git` 指针文件。`refs` / `packed-refs` 在**公共 gitdir**。
/// 返回 `(tmp, worktree_path)`；`tmp` 必须随返回保持存活。
fn linked_worktree_repo() -> (tempfile::TempDir, std::path::PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let main = tmp.path().join("repo");
    let git = main.join(".git");
    std::fs::create_dir_all(git.join("refs").join("heads")).unwrap();
    std::fs::create_dir_all(git.join("refs").join("remotes")).unwrap();
    std::fs::write(git.join("packed-refs"), "# pack-refs\n").unwrap();
    std::fs::write(git.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    let private = git.join("worktrees").join("dev");
    std::fs::create_dir_all(&private).unwrap();
    std::fs::write(private.join("HEAD"), "ref: refs/heads/feature\n").unwrap();
    std::fs::write(private.join("index"), "\0TREE-WT").unwrap();
    std::fs::write(private.join("commondir"), "../..\n").unwrap();
    let wt = tmp.path().join("wt-dev");
    std::fs::create_dir_all(&wt).unwrap();
    std::fs::write(wt.join(".git"), format!("gitdir: {}\n", private.display())).unwrap();
    (tmp, wt)
}

/// R4.3：真实 FS 写 `.git/refs/heads/<b>` 必须触发 `on_refs_changed` —— 这是
/// 「外部 `git push` 后 ahead/behind 自动更新」链路的入口验证（推送改写
/// `.git/refs/remotes/origin/<b>`，与本地分支同形）。
#[test]
fn git_meta_watcher_detects_refs_change_on_real_fs() {
    let (_tmp, watcher, meta, _index_changed, _head_changed, refs_changed) =
        spawn_git_meta_watcher_spy();

    assert!(
        wait_until(
            || {
                let heads = meta.refs_dir.join("heads");
                std::fs::create_dir_all(&heads).unwrap();
                std::fs::write(
                    heads.join("dev"),
                    "0123456789abcdef0123456789abcdef01234567\n",
                )
                .unwrap();
                refs_changed.load(Ordering::SeqCst) > 0
            },
            Duration::from_secs(5),
        ),
        "写 .git/refs/heads/<b> 应触发 on_refs_changed"
    );
    assert_eq!(_index_changed.load(Ordering::SeqCst), 0);
    assert_eq!(_head_changed.load(Ordering::SeqCst), 0);
    drop(watcher);
}

/// Fix 1（R1.1）：linked worktree 的 `packed-refs` 落在**公共 gitdir 根**下（私有 gitdir
/// 的兄弟），`refs/` 递归监听覆盖不到。必须额外非递归监听公共 gitdir，否则 `git gc` /
/// `pack-refs` 后 ahead/behind 无界陈旧。
#[test]
fn git_meta_watcher_detects_packed_refs_change_in_common_gitdir() {
    let (_tmp, wt) = linked_worktree_repo();
    let meta = resolve_git_meta_paths(&wt).expect("linked worktree must resolve");
    let common_dir = meta.packed_refs.parent().unwrap().to_path_buf();
    assert_ne!(
        common_dir, meta.git_dir,
        "夹具前提：linked worktree 的公共 gitdir 与私有 gitdir 不同"
    );

    let (watcher, _index_changed, _head_changed, refs_changed) = spawn_watcher_for(&meta);
    assert!(
        wait_until(
            || {
                std::fs::write(&meta.packed_refs, "# pack-refs\n").unwrap();
                refs_changed.load(Ordering::SeqCst) > 0
            },
            Duration::from_secs(5),
        ),
        "写公共 gitdir 的 packed-refs 应触发 on_refs_changed"
    );
    drop(watcher);
}

// ── create_git_meta_watcher 失败分支（确定性注入，跨平台安全） ─────────────

/// 核心 `git_dir` 监听失败 = watcher 无意义 → 返回 `None`。
///
/// 通过 `create_git_meta_watcher_with` 注入 watch_fn 模拟失败：不依赖 notify
/// 对「不存在路径」的报错行为（macOS FSEvents 惰性不报错，真实触发会跨平台
/// flaky），失败分支得以在任意平台确定性覆盖。
#[test]
fn create_git_meta_watcher_returns_none_when_git_dir_watch_fails() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path();
    let git_dir = repo.join(".git");
    std::fs::create_dir_all(&git_dir).unwrap();
    std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    std::fs::write(git_dir.join("index"), "\0").unwrap();
    let meta = resolve_git_meta_paths(repo).unwrap();

    // 注入：核心 git_dir 监听一律失败（模拟权限/删除竞态）
    let result = create_git_meta_watcher_with(
        "test".to_string(),
        &meta,
        || {},
        || {},
        || {},
        |_watcher: &mut RecommendedWatcher, _path, _mode| {
            Err(notify::Error::generic("simulated watch failure"))
        },
    );
    assert!(
        result.is_none(),
        "核心 git_dir 监听失败 → watcher 无意义 → None"
    );
}

/// 新增的 `refs_dir` 监听失败只告警，不得使整条 watcher 失效 —— HEAD/index 仍有效
/// （对应用户可见契约 R3.3：现有 HEAD / index 触发语义不变）。
#[test]
fn create_git_meta_watcher_survives_refs_watch_failure() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path();
    let git_dir = repo.join(".git");
    std::fs::create_dir_all(git_dir.join("refs").join("heads")).unwrap();
    std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    std::fs::write(git_dir.join("index"), "\0").unwrap();
    let meta = resolve_git_meta_paths(repo).unwrap();
    assert!(
        meta.refs_dir.is_dir(),
        "夹具前提：refs 目录存在，递归监听会被尝试"
    );

    // 注入：git_dir（NonRecursive）成功，refs（Recursive）失败
    let result = create_git_meta_watcher_with(
        "test".to_string(),
        &meta,
        || {},
        || {},
        || {},
        |_watcher: &mut RecommendedWatcher, _path, mode| {
            if mode == RecursiveMode::Recursive {
                Err(notify::Error::generic("simulated refs watch failure"))
            } else {
                Ok(())
            }
        },
    );
    assert!(
        result.is_some(),
        "refs 监听失败不得使整条 watcher 失效（HEAD/index 仍有效）"
    );
}

/// Fix 1 的失败兼容契约：linked worktree 额外的公共 gitdir 监听失败同样只告警，
/// 不得使整条 watcher 失效（HEAD/index/refs 仍有效）。
#[test]
fn create_git_meta_watcher_survives_common_git_dir_watch_failure() {
    let (_tmp, wt) = linked_worktree_repo();
    let meta = resolve_git_meta_paths(&wt).expect("linked worktree must resolve");
    let common_dir = meta.packed_refs.parent().unwrap().to_path_buf();
    assert_ne!(
        common_dir, meta.git_dir,
        "夹具前提：公共 gitdir 与私有 gitdir 不同"
    );
    let fail_dir = common_dir.clone();

    // 注入：只让公共 gitdir（NonRecursive）监听失败
    let result = create_git_meta_watcher_with(
        "test".to_string(),
        &meta,
        || {},
        || {},
        || {},
        move |_watcher: &mut RecommendedWatcher, path: &std::path::Path, mode| {
            if path == fail_dir && mode == RecursiveMode::NonRecursive {
                Err(notify::Error::generic(
                    "simulated common gitdir watch failure",
                ))
            } else {
                Ok(())
            }
        },
    );
    assert!(
        result.is_some(),
        "公共 gitdir 监听失败不得使整条 watcher 失效（HEAD/index/refs 仍有效）"
    );
}
