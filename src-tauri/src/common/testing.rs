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

/// 剥掉**行注释**（`//` 及其后内容），**保留行数**（不把多行并成一行，行号仍对得上）。
///
/// # `:` 后紧跟的 `//` 不是注释
///
/// 上报模板里有 `http://127.0.0.1`：若「见到 `//` 就截断」，loopback 那一行会被整段删掉，
/// 而断言是对着半份文件说的。JS/TS 里 `//` 出现在字符串中的现实形态只有 URL，
/// 它的前一个字符必是 scheme 分隔符 `:` —— 这条规则就够，且窄到不会误伤别的形态。
///
/// # 什么时候需要它
///
/// 「某段代码里出现了 X」这类源码级判据：`contains` 对**被注释掉的**代码同样成立，
/// 于是判据只能在「代码还在」时变绿 —— 而「还在但被注释」正是它要挡的东西。
#[must_use]
pub fn strip_line_comments(body: &str) -> String {
    let mut out = String::with_capacity(body.len());
    for (index, line) in body.split('\n').enumerate() {
        if index > 0 {
            out.push('\n');
        }
        out.push_str(&line[..comment_start(line).unwrap_or(line.len())]);
    }
    out
}

/// 行内注释的起始字节位置（`//` 且前一字符不是 `:`）；无注释返回 `None`。
fn comment_start(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'/' && bytes[i + 1] == b'/' && (i == 0 || bytes[i - 1] != b':') {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// 从 `source[open]`（一个 `{` / `(` / `[`）起按括号计数，返回**块内正文**（不含两侧括号）。
///
/// # 为什么需要它
///
/// 「某段代码里出现了这个调用」必须先把范围收窄到一个块：对整份文件用 `contains`，
/// 别处的同名调用会顶替**缺失的那一处**，判据于是永远是绿的。
///
/// 只数同类括号、不认字符串字面量里的括号 —— 当前用法（闭包体 / 实参表 / 对象字面量）
/// 都不含；真含了会先 panic（找不到匹配闭括号）而不是悄悄给出错误的区段。
///
/// # Panics
///
/// `open` 越界、开头不是三种括号之一、或括号不配对。
#[must_use]
pub fn enclosed_body(source: &str, open: usize) -> &str {
    let opener = source[open..]
        .chars()
        .next()
        .unwrap_or_else(|| panic!("enclosed_body: {open} 越过源码末尾"));
    let closer = match opener {
        '{' => '}',
        '(' => ')',
        '[' => ']',
        other => panic!("enclosed_body: 只接受 `{{` / `(` / `[`，收到 {other:?}"),
    };
    let mut depth = 0usize;
    for (offset, ch) in source[open..].char_indices() {
        if ch == opener {
            depth += 1;
        } else if ch == closer {
            depth -= 1;
            if depth == 0 {
                return &source[open + 1..open + offset];
            }
        }
    }
    panic!("enclosed_body: `{opener}` 没有匹配的 `{closer}`（源码被截断？）");
}
