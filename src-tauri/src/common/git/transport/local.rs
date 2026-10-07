#![allow(unused_imports, missing_docs)]

/// Local `is_git_repo` check via filesystem.
///
/// 判定的**单一实现**在 [`crate::common::git::local::is_git_repo`]：同语义不留两份 `.git` 探测
/// （两份实现靠人肉保持同步，迟早漂移；本函数只保留 transport-local 的外观）。
pub(crate) fn is_git_repo_local(path: &str) -> bool {
    crate::common::git::local::is_git_repo(std::path::Path::new(path))
}
