//! git 元数据 watcher 集成与注入测试：真实 FS 事件送达、失败分支、自愈补挂。

use super::super::paths::{resolve_git_meta_paths, GitMetaPaths};
use super::super::watcher::{
    apply_rearm_result, create_git_meta_watcher, create_git_meta_watcher_with,
};
use notify::{RecommendedWatcher, Watcher};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

// ── 真实文件系统集成测试：验证 notify 事件送达（方案 B 修复的核心假设） ────
//
// 这些测试使用真实 notify::RecommendedWatcher + 真实临时 git 仓库，验证：
// 1. `.git/index` 的原子写（lock + rename，git 真实行为）能被捕获 → on_index_changed
// 2. `.git/HEAD` 的原子写能被捕获 → on_head_changed
// 3. 无关元数据（config / ORIG_HEAD）不触发任何回调
// 有界等待（5s）避免 flaky；非递归监听 `.git` 目录即足以捕获（git 在目录顶层
// 原子替换 HEAD/index）。

/// 集成测试助手：创建临时普通仓库 + git 元数据 watcher，返回计数 flag。
/// `tempfile::TempDir` 必须随返回保持存活，否则目录被删、watcher 无事件。
#[allow(clippy::type_complexity)]
fn spawn_git_meta_watcher_spy() -> (
    tempfile::TempDir,
    super::super::watcher::GitMetaWatcherHandle,
    GitMetaPaths,
    Arc<AtomicUsize>,
    Arc<AtomicUsize>,
) {
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path();
    let git_dir = repo.join(".git");
    std::fs::create_dir_all(&git_dir).unwrap();
    std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    std::fs::write(git_dir.join("index"), "v1").unwrap();
    let meta = resolve_git_meta_paths(repo).unwrap();

    let index_changed = Arc::new(AtomicUsize::new(0));
    let head_changed = Arc::new(AtomicUsize::new(0));
    let index_flag = index_changed.clone();
    let head_flag = head_changed.clone();

    let watcher = create_git_meta_watcher(
        "integration-test".to_string(),
        &meta,
        move || {
            index_flag.fetch_add(1, Ordering::SeqCst);
        },
        move |_has_wt| {
            head_flag.fetch_add(1, Ordering::SeqCst);
        },
        || {},
    )
    .expect("git meta watcher should be created");

    (tmp, watcher, meta, index_changed, head_changed)
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
    let (_tmp, watcher, meta, index_changed, head_changed) = spawn_git_meta_watcher_spy();
    // 给 notify 一点注册时间，降低首事件丢失概率（尤其 FSEvents）
    std::thread::sleep(Duration::from_millis(300));

    // 模拟 git 原子写 index：先写 index.lock 再 rename 为 index
    std::fs::write(meta.git_dir.join("index.lock"), "v2").unwrap();
    std::fs::rename(meta.git_dir.join("index.lock"), meta.git_dir.join("index")).unwrap();

    assert!(
        wait_until(
            || index_changed.load(Ordering::SeqCst) > 0,
            Duration::from_secs(5)
        ),
        "index 变更应触发 on_index_changed"
    );
    // index 变更不应触发 HEAD 回调
    assert_eq!(head_changed.load(Ordering::SeqCst), 0);
    drop(watcher);
}

/// 集成验证：`.git/HEAD` 原子写（分支切换的真实行为）能触发 on_head_changed。
#[test]
fn git_meta_watcher_detects_head_change_on_real_fs() {
    let (_tmp, watcher, meta, _index_changed, head_changed) = spawn_git_meta_watcher_spy();
    std::thread::sleep(Duration::from_millis(300));

    // 模拟 git 切分支改写 HEAD：lock + rename
    std::fs::write(meta.git_dir.join("HEAD.lock"), "ref: refs/heads/dev\n").unwrap();
    std::fs::rename(meta.git_dir.join("HEAD.lock"), meta.git_dir.join("HEAD")).unwrap();

    assert!(
        wait_until(
            || head_changed.load(Ordering::SeqCst) > 0,
            Duration::from_secs(5)
        ),
        "HEAD 变更应触发 on_head_changed"
    );
    drop(watcher);
}

/// 集成验证：无关 git 元数据（config / ORIG_HEAD）不应触发任何回调。
/// 负向断言，验证事件分类过滤在真实文件系统上同样生效。
#[test]
fn git_meta_watcher_ignores_unrelated_git_meta_on_real_fs() {
    let (_tmp, watcher, meta, index_changed, head_changed) = spawn_git_meta_watcher_spy();
    std::thread::sleep(Duration::from_millis(300));

    std::fs::write(meta.git_dir.join("config"), "[core]\n").unwrap();
    std::fs::write(meta.git_dir.join("ORIG_HEAD"), "abc123\n").unwrap();

    // 等待足够时间，确认两个回调都未被触发
    std::thread::sleep(Duration::from_millis(600));
    assert_eq!(index_changed.load(Ordering::SeqCst), 0);
    assert_eq!(head_changed.load(Ordering::SeqCst), 0);
    drop(watcher);
}

// ── worktrees 自愈补挂（会话中途 git worktree add） ────────────────────────

/// 自愈补挂集成验证（G3 语义）：会话中途 `git worktree add`（worktrees 目录出现）后，
/// 心跳线程调用 `rearm_worktrees_if_needed` 补挂递归监听，此后该 worktree 区域
/// （`.git/worktrees/<n>/HEAD` / index）的变更触发 `on_worktree_meta_changed`
/// （驱动 git-changed → 前端按 activeWorktree 刷新；不再依赖主 HEAD 的 has_wt 语义）。
#[test]
fn git_meta_watcher_rearms_worktrees_watch_after_dir_appears() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path();
    let git_dir = repo.join(".git");
    std::fs::create_dir_all(&git_dir).unwrap();
    std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    std::fs::write(git_dir.join("index"), "v1").unwrap();
    let meta = resolve_git_meta_paths(repo).unwrap();
    assert!(!meta.has_worktrees, "启动时应无 worktrees");

    let wt_changed = Arc::new(AtomicUsize::new(0));
    let wt_flag = wt_changed.clone();
    let handle = create_git_meta_watcher(
        "rearm-test".to_string(),
        &meta,
        || {},
        |_| {},
        move || {
            wt_flag.fetch_add(1, Ordering::SeqCst);
        },
    )
    .expect("git meta watcher should be created");
    // 给 notify 一点注册时间，降低首事件丢失概率
    std::thread::sleep(Duration::from_millis(300));

    // 1. 启动时无 worktrees：rearm 为 no-op
    handle.rearm_worktrees_if_needed();

    // 2. 会话中途 git worktree add：创建 worktrees/dev 目录。
    //    worktrees 目录创建事件由非递归 .git 监听送达，分类为 WorktreeMetaChanged
    //    （G3：worktree 区域事件独立信号）。wait_until 保证该事件已计入。
    let wt_dir = git_dir.join("worktrees").join("dev");
    std::fs::create_dir_all(&wt_dir).unwrap();
    assert!(
        wait_until(
            || wt_changed.load(Ordering::SeqCst) >= 1,
            Duration::from_secs(5)
        ),
        "worktrees 目录创建事件应送达（分类为 WorktreeMetaChanged）"
    );

    // 3. rearm 前：深度 2 的 worktree HEAD 写入不被非递归 .git 监听捕获
    //    （该路径只能由 rearm 后的递归监听送达——递归监听是必要路径）。
    std::fs::write(wt_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    std::thread::sleep(Duration::from_millis(400));
    let before_rearm = wt_changed.load(Ordering::SeqCst);

    // 4. 自愈补挂：worktrees 目录已出现 → 挂上递归监听
    handle.rearm_worktrees_if_needed();
    std::thread::sleep(Duration::from_millis(300));

    // 5. rearm 后：worktree HEAD 变更（lock + rename，git 真实行为）
    //    应触发 on_worktree_meta_changed（驱动前端 activeWorktree 刷新）
    std::fs::write(wt_dir.join("HEAD.lock"), "ref: refs/heads/feature\n").unwrap();
    std::fs::rename(wt_dir.join("HEAD.lock"), wt_dir.join("HEAD")).unwrap();

    assert!(
        wait_until(
            || wt_changed.load(Ordering::SeqCst) > before_rearm,
            Duration::from_secs(5)
        ),
        "rearm 后 worktree HEAD 变更应触发 on_worktree_meta_changed"
    );
    drop(handle);
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
        |_| {},
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

/// `.git/worktrees` 子监听失败 = 非致命 → 仍返回 watcher
/// （本仓库 HEAD/index 监听保持有效）。
#[test]
fn create_git_meta_watcher_tolerates_worktree_subwatch_failure() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path();
    let git_dir = repo.join(".git");
    std::fs::create_dir_all(&git_dir).unwrap();
    // worktrees 目录存在，使「子监听失败」分支被走到
    std::fs::create_dir_all(git_dir.join("worktrees")).unwrap();
    std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    std::fs::write(git_dir.join("index"), "\0").unwrap();
    let meta = resolve_git_meta_paths(repo).unwrap();

    // 注入：核心 git_dir 监听成功，仅 worktrees 子目录监听失败
    let result = create_git_meta_watcher_with(
        "test".to_string(),
        &meta,
        || {},
        |_| {},
        || {},
        |watcher: &mut RecommendedWatcher, path, mode| {
            if path.ends_with("worktrees") {
                Err(notify::Error::generic("simulated worktrees watch failure"))
            } else {
                watcher.watch(path, mode)
            }
        },
    );
    assert!(
        result.is_some(),
        "worktrees 子监听失败 → 非致命 → 仍返回 watcher"
    );
}

// ── rearm 结果状态迁移（apply_rearm_result 纯函数） ────────────────────────

/// rearm 失败：标志保持 false，返回 false（下轮 10s 后重试）——确定性覆盖
/// `rearm_worktrees_if_needed` 的 Err 分支（真实 notify 对不可监听路径的行为
/// 三平台不统一，故经纯函数注入错误直接断言状态迁移）。
#[test]
fn apply_rearm_result_on_failure_keeps_flags_clear_for_retry() {
    let armed = AtomicBool::new(false);
    let has_wt = AtomicBool::new(false);
    let ok = apply_rearm_result(
        Path::new("/repo/.git/worktrees"),
        Err(notify::Error::generic("simulated rearm failure")),
        &armed,
        &has_wt,
    );
    assert!(!ok, "rearm 失败应返回 false");
    assert!(
        !armed.load(Ordering::SeqCst),
        "失败后 armed 应保持 false（下轮重试）"
    );
    assert!(!has_wt.load(Ordering::SeqCst), "失败后 has_wt 应保持 false");
}

/// rearm 成功：置位 armed + has_wt，返回 true（worktree HEAD 事件此后
/// 携带 has_wt=true 驱动全量刷新）。
#[test]
fn apply_rearm_result_on_success_sets_flags() {
    let armed = AtomicBool::new(false);
    let has_wt = AtomicBool::new(false);
    let ok = apply_rearm_result(Path::new("/repo/.git/worktrees"), Ok(()), &armed, &has_wt);
    assert!(ok, "rearm 成功应返回 true");
    assert!(armed.load(Ordering::SeqCst), "成功后 armed 应置位");
    assert!(has_wt.load(Ordering::SeqCst), "成功后 has_wt 应置位");
}
