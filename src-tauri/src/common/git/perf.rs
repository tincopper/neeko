//! Git 仓库性能优化引导（G7，对齐调研文档公理 3「借力 git 本身的优化」）。
//!
//! 检测大仓库上未启用的 git 原生缓存（fsmonitor / untracked cache），经一次性
//! 事件提示用户。**只提示不代改**——启用会改变用户仓库行为（AGENTS 审查红线：
//! 禁止向 git 调用注入配置改变用户仓库语义），由用户复制命令自行决定。

use std::path::Path;

use serde::Serialize;

use crate::common::executor::factory::ExecTarget;
use crate::core::exec::collect_blocking;

/// 触发建议的已跟踪文件数阈值：低于该值 status 本身足够便宜，引导只会造成噪声
pub const TRACKED_FILE_COUNT_THRESHOLD: usize = 20_000;

/// 单条性能建议
#[derive(Debug, Clone, Serialize)]
pub struct GitPerfSuggestion {
    /// 建议类别标识（前端按此去重/分组）
    pub kind: &'static str,
    /// 用户可复制的 git 命令
    pub command: String,
    /// 说明文案
    pub label: String,
}

/// 纯决策：按两项能力的启用状态产出建议（可单测）
#[must_use]
pub fn perf_suggestions(
    fsmonitor_enabled: bool,
    untracked_cache_enabled: bool,
) -> Vec<GitPerfSuggestion> {
    let mut out = Vec::new();
    if !fsmonitor_enabled {
        out.push(GitPerfSuggestion {
            kind: "fsmonitor",
            command: "git config core.fsmonitor true".to_string(),
            label: "fsmonitor daemon lets status skip a full tree scan".to_string(),
        });
    }
    if !untracked_cache_enabled {
        out.push(GitPerfSuggestion {
            kind: "untrackedCache",
            command: "git config core.untrackedCache true".to_string(),
            label: "untracked cache memoizes directory scans, speeding up untracked detection"
                .to_string(),
        });
    }
    out
}

/// 读取 git 布尔配置（key 未设置 = false）
fn git_config_enabled(repo_path: &Path, key: &str) -> bool {
    let output = collect_blocking(
        &ExecTarget::Local,
        "git",
        &[
            "-C",
            &repo_path.to_string_lossy(),
            "config",
            "--bool",
            "--get",
            key,
        ],
    );
    match output {
        Ok(out) if out.exit_code == 0 => String::from_utf8_lossy(&out.stdout).trim() == "true",
        _ => false,
    }
}

/// 已跟踪文件数（直接读取 git index entry count；避免缓冲完整 `git ls-files` stdout）
fn count_tracked_files(repo_path: &Path) -> usize {
    git2::Repository::open(repo_path)
        .and_then(|repo| {
            let index = repo.index()?;
            Ok(index.len())
        })
        .unwrap_or(0)
}

/// 检测入口：超过阈值且存在未启用能力时给出建议（否则空）
#[must_use]
pub fn detect_perf_suggestions(repo_path: &Path) -> Vec<GitPerfSuggestion> {
    let tracked = count_tracked_files(repo_path);
    detect_perf_suggestions_with_count(repo_path, tracked)
}

/// 以已跟踪文件数作为输入的完整阈值链路，供测试覆盖阈值决策而不构造 2 万个文件。
fn detect_perf_suggestions_with_count(repo_path: &Path, tracked: usize) -> Vec<GitPerfSuggestion> {
    if tracked < TRACKED_FILE_COUNT_THRESHOLD {
        return Vec::new();
    }
    let fsmonitor = git_config_enabled(repo_path, "core.fsmonitor");
    let untracked_cache = git_config_enabled(repo_path, "core.untrackedCache");
    log::info!(
        "[GitPerf] {} tracked files at {} (fsmonitor={}, untrackedCache={})",
        tracked,
        repo_path.display(),
        fsmonitor,
        untracked_cache
    );
    perf_suggestions(fsmonitor, untracked_cache)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn perf_suggestions_pure_decision() {
        assert_eq!(perf_suggestions(true, true).len(), 0);
        let both = perf_suggestions(false, false);
        assert_eq!(both.len(), 2);
        assert_eq!(both[0].kind, "fsmonitor");
        assert_eq!(both[0].command, "git config core.fsmonitor true");
        assert_eq!(both[1].kind, "untrackedCache");
        // 单项启用只缺另一项
        let one = perf_suggestions(true, false);
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].kind, "untrackedCache");
    }

    #[test]
    fn detect_perf_suggestions_with_count_applies_full_threshold_chain() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        init_test_repo(repo);

        // 小仓库：不查询配置，直接返回空
        assert!(detect_perf_suggestions_with_count(repo, 1).is_empty());

        // 大仓库 + 两项能力都未启用：产出两条建议
        let both_disabled = detect_perf_suggestions_with_count(repo, TRACKED_FILE_COUNT_THRESHOLD);
        assert_eq!(both_disabled.len(), 2);

        // 大仓库 + 两项能力都启用：不产生建议
        for key in ["core.fsmonitor", "core.untrackedCache"] {
            std::process::Command::new("git")
                .args(["config", key, "true"])
                .current_dir(repo)
                .output()
                .unwrap();
        }
        assert!(detect_perf_suggestions_with_count(repo, TRACKED_FILE_COUNT_THRESHOLD).is_empty());
    }

    #[test]
    fn count_tracked_files_counts_index_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        init_test_repo(repo);
        std::fs::write(repo.join("a.txt"), "a\n").unwrap();
        std::fs::write(repo.join("b.txt"), "b\n").unwrap();
        for args in [vec!["add", "a.txt"], vec!["add", "b.txt"]] {
            std::process::Command::new("git")
                .args(&args)
                .current_dir(repo)
                .output()
                .unwrap();
        }

        assert_eq!(count_tracked_files(repo), 2);
    }

    fn init_test_repo(repo: &Path) {
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test"],
            vec!["config", "core.autocrlf", "false"],
        ] {
            let output = std::process::Command::new("git")
                .args(&args)
                .current_dir(repo)
                .output()
                .unwrap();
            assert!(output.status.success());
        }
        std::fs::write(repo.join(".gitattributes"), "* -text\n").unwrap();
    }

    #[test]
    fn git_config_enabled_detects_true_and_unset() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "t@t"],
            vec!["config", "user.name", "t"],
        ] {
            std::process::Command::new("git")
                .args(&args)
                .current_dir(repo)
                .output()
                .unwrap();
        }
        // 未设置 → false
        assert!(!git_config_enabled(repo, "core.fsmonitor"));
        // 设置 true → true
        std::process::Command::new("git")
            .args(["config", "core.fsmonitor", "true"])
            .current_dir(repo)
            .output()
            .unwrap();
        assert!(git_config_enabled(repo, "core.fsmonitor"));
    }
}
