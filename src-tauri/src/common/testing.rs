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
