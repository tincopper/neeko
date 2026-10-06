//! `operations` 各子模块共享的常量与 helpers（原先平铺在 `mod.rs`）。
//!
//! **只读 git 语义不在此处声明** —— 它由执行层单点注入（`common::executor::env_defaults.rs`，
//! 经 `core::exec` facade + `common::git::transport` 三端），业务代码禁止逐点补 opts /
//! CLI 标志；依据与护栏见 `.trellis/spec/backend/git-domain.md` §9。

/// 写操作成功后失效该仓库的全部内存缓存（AGENTS.md：缓存失效不得散落调用点遗漏）。
pub(crate) fn invalidate_caches(work_dir: &str) {
    crate::common::git::cache::invalidate_repo_caches(std::path::Path::new(work_dir));
}

/// 解析 worktree_path：空字符串视为「未指定 worktree」，回落项目根目录。
#[must_use]
pub fn resolve_worktree_path<'a>(worktree_path: &'a Option<String>, wd: &'a str) -> &'a str {
    match worktree_path.as_deref() {
        Some(p) if !p.trim().is_empty() => p,
        _ => wd,
    }
}
