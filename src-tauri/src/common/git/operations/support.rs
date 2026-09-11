//! `operations` 各子模块共享的常量与 helpers（原先平铺在 `mod.rs`）。

use crate::common::git::transport::GitExecOptions;

/// 只读 git 查询的执行环境（公理 2：查询无副作用）。
pub(crate) const READONLY_ENV: &[(&str, &str)] = &[("GIT_OPTIONAL_LOCKS", "0")];

/// 构造只读查询的 [`GitExecOptions`]（env 为静态切片，可安全跨 await 借用）。
pub(crate) const fn readonly_opts() -> GitExecOptions<'static> {
    GitExecOptions {
        env: READONLY_ENV,
        extra_config: &[],
    }
}

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
