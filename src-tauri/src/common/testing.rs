//! 隔离的 `AppStateWrapper` 测试夹具 —— **唯一实现**（`#[cfg(test)]`）。
//!
//! 为什么收在这里：同一段「StorageManager 指向 tempdir + 内存 LibraryStore」的构造原先在
//! `dap/testing.rs`、`browser/url_validator.rs`、`dap/adapter/java/backend.rs` 各写一份
//! （3 份 ⇒ 越过「重复 ≥3 必须抽象」的线）。三份里任何一份忘了改，测试就会去碰真实
//! `~/.neeko`（project auto-save 会覆盖用户数据）。收成一份后「隔离」只有一处实现。
//!
//! 路径一律由 `tempfile::TempDir` 推导，不硬编码（红线 13）。

use std::sync::Arc;

use crate::app_state::AppStateWrapper;
use crate::session::StorageManager;

/// 隔离的 `AppStateWrapper`：StorageManager 指向临时目录。
///
/// **严禁**用默认 `~/.neeko` —— 否则 project 的 auto-save 会覆盖用户数据。
#[must_use]
pub fn isolated_state(tmp: &tempfile::TempDir) -> AppStateWrapper {
    let storage =
        StorageManager::with_dir(tmp.path().join(".neeko")).expect("fixture: storage manager");
    let store = Arc::new(
        crate::library::LibraryStore::open_in_memory().expect("fixture: in-memory library store"),
    );
    AppStateWrapper::new_with_storage_and_library(storage, store)
}

/// 注册一个普通项目，返回 `(state, project_id)`。
///
/// 断点 / 静音 / 会话编排的单测只依赖项目注册 + 磁盘路径。
#[must_use]
pub fn plain_project_state(tmp: &tempfile::TempDir) -> (AppStateWrapper, String) {
    let state = isolated_state(tmp);
    let project_dir = tmp.path().join("proj");
    std::fs::create_dir_all(&project_dir).expect("fixture: project dir");
    let project = state
        .project_manager
        .lock()
        .expect("fixture: project_manager")
        .add_project(project_dir, None, None, None)
        .expect("fixture: add_project");
    (state, project.id)
}

/// 初始化一个带**首个提交**的真实 git 仓（测试夹具）。
///
/// 路径由调用方从 `tempfile::TempDir` 派生（红线 13）；断言只打 git 归一化视图（红线 11）。
/// 收在这里是因为「建一个可用仓库」在多个域的单测里重复（git status 编排 / watcher 生命周期）。
pub fn init_git_repo(dir: &std::path::Path) {
    let repo = git2::Repository::init(dir).expect("fixture: init git repo");
    let sig = git2::Signature::now("Test", "test@test.com").expect("fixture: signature");
    std::fs::write(dir.join("README.md"), "# Test\n").expect("fixture: write README");
    let mut index = repo.index().expect("fixture: index");
    index
        .add_path(std::path::Path::new("README.md"))
        .expect("fixture: add README");
    index.write().expect("fixture: write index");
    let tree = repo
        .find_tree(index.write_tree().expect("fixture: write tree"))
        .expect("fixture: find tree");
    repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
        .expect("fixture: initial commit");
}

/// 让脚本文件具备可执行位（Unix 语义）；无腿平台给空 stub，调用点保持无条件。
///
/// 收在这里的理由与本文档头一致：同一段 9 行 chmod 原先在 `core/exec.rs`、`core/exec_env.rs`、
/// `common/utils/command/local.rs`（×2）各写一份（4 份 ⇒ 越过「重复 ≥3 必须抽象」的线）。
/// 平台差异按门控粒度纪律落在 **item 级**（`#[cfg]` 挂在函数上，而不是测试体内的裸块，
/// 见红线 10 与 `check_platform_cfg_placement`）。
#[cfg(unix)]
pub fn make_executable(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let mut perm = std::fs::metadata(path)
        .expect("fixture: metadata")
        .permissions();
    perm.set_mode(0o755);
    std::fs::set_permissions(path, perm).expect("fixture: chmod");
}

/// Windows stub：无 POSIX 可执行位概念（保持调用点无条件）。
#[cfg(not(unix))]
pub fn make_executable(_path: &std::path::Path) {}

/// 建一个**目录**符号链接（两平台各有真实实现：unix `symlink` / windows `symlink_dir`）。
///
/// 收在这里的理由同 [`make_executable`]：同一段两平台各一行的夹具原先在
/// `common/git/{checkout_path,path_guard,workspace_ref}.rs` 各写一份（3 份 ⇒ 越过 DRY 线）。
/// 平台差异只允许出现在 **item 级**门控上（红线 10；`check_platform_cfg_placement`）。
#[cfg(unix)]
pub fn symlink_dir(real: &std::path::Path, link: &std::path::Path) {
    std::os::unix::fs::symlink(real, link).unwrap();
}

/// Windows 实现：`symlink_dir`（与 unix 的 `symlink` 语义对齐为目录链接）。
#[cfg(windows)]
pub fn symlink_dir(real: &std::path::Path, link: &std::path::Path) {
    std::os::windows::fs::symlink_dir(real, link).unwrap();
}

/// 平台绝对路径夹具：由 `tempdir()` 推导，**目录活着**，调用方持有它。
///
/// 红线 13 的正解不是「记住别写 `/tmp/...`」，而是**让安全写法更便宜**：想要一个
/// 「平台绝对、不必存在」的路径时，一行 [`abs_fixture`] 就够，没有理由去写 POSIX 字面量。
///
/// 为什么返回 `TempDir` 而不是 `PathBuf`：只拿 `.path()` 的字符串、随即 drop，路径在断言
/// 期间就不存在了 —— `canonicalize` / 存在性判定会在 Windows 与 macOS 上给出不同答案。
///
/// ```ignore
/// let (_tmp, expected) = abs_fixture("db-dev");
/// let padded = format!("  {}  ", expected.display());
/// assert_eq!(resolve_db_dir(Some(&padded), fallback), expected);
/// ```
#[must_use]
pub fn abs_fixture(label: &str) -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().expect("fixture: tempdir");
    let path = dir.path().join(label);
    (dir, path)
}
