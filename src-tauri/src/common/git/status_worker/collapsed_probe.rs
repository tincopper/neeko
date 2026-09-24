//! 折叠 untracked 目录的内容摘要：让 status 闸门「看得见」折叠目录内部的增删。
//!
//! 背景：`git status --porcelain` 对未跟踪目录是**折叠**语义（输出一条 `?? dir/`），
//! 因此目录内部新增/删除文件时输出字符串一字不变 → worker 的「查询-比较闸门」判定
//! 无变化 → 不 emit、version 不前进 → 前端既收不到事件、也没有任何失效信号。
//!
//! 本模块只做一件事：对快照里每个折叠目录（`is_dir = true`）枚举其下未跟踪文件，
//! 产出一个可比较的摘要。摘要**只喂比较闸门**，不进 `GitStatusSnapshot` 载荷 ——
//! IPC 条目数严格不变，折叠语义（防内存爆炸）也不动。
//!
//! 为什么不复用展示层的 500 条截断：截断属于**展示**职责（`operations::get_untracked_files`
//! 限 IPC 大小）。探测侧一旦截断，第 501 个文件之后的变化永远不改变摘要 → 漏发。
//! 两个职责不能共用同一个裁剪语义（design §3.1）。

use std::collections::hash_map::DefaultHasher;
use std::hash::Hasher;
use std::path::Path;

use crate::common::executor::factory::ExecTarget;
use crate::common::types::FileChange;
use crate::core::exec::collect_blocking;

/// 单次枚举输出的上界：超过即 `Unknown`（放行 emit）。
///
/// 目的：极端目录（数十万未跟踪文件）不把整份路径列表留在内存里 —— 折叠语义本来
/// 就是为了防这类目录把内存撑爆。**残余风险**：`collect_blocking` 会先物化 stdout
/// 再交由本模块判界，故峰值内存仍与目录规模同阶（实测留痕见任务笔记）。此处选择
/// 「超限走 Unknown」而非「截断」：宁可多发一次快照，也不能漏发。
const MAX_PROBE_BYTES: usize = 8 * 1024 * 1024;

/// 折叠目录内容摘要。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Digest {
    /// `dirs` 折叠目录数、`files` 枚举到的未跟踪文件数、`hash` 路径集合摘要。
    Known {
        /// 参与探测的折叠目录数。
        dirs: usize,
        /// 各目录下枚举到的未跟踪文件总数。
        files: usize,
        /// 目录路径 + 文件路径集合的摘要。
        hash: u64,
    },
    /// 探测未给出确定答案（git 失败 / 目录并行消失 / 超出上界）。
    /// 闸门语义：未知**放行**（宁可多发一次快照，不可漏发）。
    Unknown,
}

impl Digest {
    /// 是否为「未知」——闸门据此放行 emit。
    #[must_use]
    pub const fn is_unknown(self) -> bool {
        matches!(self, Self::Unknown)
    }
}

/// 计算 `entries` 中所有折叠目录的内容摘要。
///
/// 空目录集返回稳定的 `Known { dirs: 0, files: 0, .. }`（不产生任何 git 调用），
/// 便于闸门直接与该值比较。
#[must_use]
pub fn collapsed_dirs_digest(repo_path: &Path, entries: &[FileChange]) -> Digest {
    let repo = repo_path.to_string_lossy().into_owned();
    let mut hasher = DefaultHasher::new();
    let mut dirs = 0_usize;
    let mut files = 0_usize;

    for entry in entries.iter().filter(|entry| entry.is_dir) {
        let dir = entry.path.to_string_lossy().replace('\\', "/");
        if dir.is_empty() {
            continue;
        }
        let Some(listing) = list_untracked_paths(&repo, &dir) else {
            return Digest::Unknown;
        };
        if listing.len() > MAX_PROBE_BYTES {
            ::log::warn!(
                "collapsed_dirs_digest: untracked listing for {} is {} bytes (> {}), treating as unknown",
                dir,
                listing.len(),
                MAX_PROBE_BYTES
            );
            return Digest::Unknown;
        }
        dirs += 1;
        files += listing.iter().filter(|byte| **byte == 0).count();
        // 目录路径参与摘要：目录重命名 / 增删目录本身也要被看见
        hasher.write(dir.as_bytes());
        hasher.write_u8(0);
        hasher.write(&listing);
        hasher.write_u8(0);
    }

    Digest::Known {
        dirs,
        files,
        hash: hasher.finish(),
    }
}

/// `git ls-files --others --exclude-standard -z -- <dir>`：与 git 的忽略语义同源
/// （与前端展开用的 `get_untracked_files` 同一条命令，仅此处不截断、仅本机执行）。
///
/// `-z` 输出 NUL 分隔的原始路径，直接哈希即可（不按行切分，不受平台换行影响）。
/// 走 worker 线程上的同步桥（红线：同步桥只在独立 OS 线程 / spawn_blocking 内调用，
/// worker 正是独立 OS 线程）。
fn list_untracked_paths(repo_path: &str, dir: &str) -> Option<Vec<u8>> {
    let output = collect_blocking(
        &ExecTarget::Local,
        "git",
        &[
            "-C",
            repo_path,
            // 全局选项必须位于子命令之前；避免探测顺手刷新 index 形成自反馈回路
            "--no-optional-locks",
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            dir,
        ],
    )
    .ok()?;
    if output.exit_code != 0 {
        return None;
    }
    Some(output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::types::FileStatus;
    use std::fs;
    use std::path::PathBuf;

    fn collapsed_dir(path: &str) -> FileChange {
        FileChange {
            path: PathBuf::from(path),
            status: FileStatus::Untracked,
            additions: 0,
            deletions: 0,
            is_dir: true,
            index_status: Some('?'),
            worktree_status: Some('?'),
            renamed_from: None,
        }
    }

    fn repo_with_commit() -> (tempfile::TempDir, git2::Repository) {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        fs::write(tmp.path().join("README.md"), "# Test\n").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("README.md")).unwrap();
            index.write().unwrap();
            let tree_id = index.write_tree().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
                .unwrap();
        }
        (tmp, repo)
    }

    #[test]
    fn digest_changes_when_file_added_under_collapsed_dir() {
        let (tmp, _repo) = repo_with_commit();
        let dir = tmp.path().join("burst");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.txt"), "x\n").unwrap();
        let entries = [collapsed_dir("burst")];

        let first = collapsed_dirs_digest(tmp.path(), &entries);
        assert!(
            matches!(
                first,
                Digest::Known {
                    dirs: 1,
                    files: 1,
                    ..
                }
            ),
            "单目录单文件：{first:?}"
        );

        fs::write(dir.join("b.txt"), "x\n").unwrap();
        let second = collapsed_dirs_digest(tmp.path(), &entries);
        assert_ne!(
            first, second,
            "目录内新增文件必须改变摘要（否则闸门吞掉变化）"
        );
        assert!(matches!(second, Digest::Known { files: 2, .. }));
    }

    #[test]
    fn digest_stable_when_untracked_file_content_changes_only() {
        let (tmp, _repo) = repo_with_commit();
        let dir = tmp.path().join("d");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.txt"), "one\n").unwrap();
        let entries = [collapsed_dir("d")];

        let before = collapsed_dirs_digest(tmp.path(), &entries);
        fs::write(dir.join("a.txt"), "completely different content\n").unwrap();
        let after = collapsed_dirs_digest(tmp.path(), &entries);

        assert_eq!(
            before, after,
            "只改内容不改文件集合 → 摘要不变（Unversioned 行不展示行数，无需重发快照）"
        );
    }

    #[test]
    fn digest_ignores_ignored_files() {
        let (tmp, _repo) = repo_with_commit();
        fs::write(tmp.path().join(".gitignore"), "ignored.txt\n").unwrap();
        let dir = tmp.path().join("d");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("kept.txt"), "x\n").unwrap();
        let entries = [collapsed_dir("d")];

        let before = collapsed_dirs_digest(tmp.path(), &entries);
        fs::write(dir.join("ignored.txt"), "x\n").unwrap();
        let after = collapsed_dirs_digest(tmp.path(), &entries);

        assert_eq!(
            before, after,
            "被 .gitignore 排除的文件不进摘要（--exclude-standard）"
        );
        assert!(matches!(after, Digest::Known { files: 1, .. }));
    }

    #[test]
    fn digest_stable_and_cheap_when_no_collapsed_dirs() {
        let (tmp, _repo) = repo_with_commit();
        fs::write(tmp.path().join("untracked-file.txt"), "x\n").unwrap();

        let first = collapsed_dirs_digest(tmp.path(), &[]);
        let second = collapsed_dirs_digest(tmp.path(), &[]);
        assert_eq!(first, second);
        assert!(matches!(
            first,
            Digest::Known {
                dirs: 0,
                files: 0,
                ..
            }
        ));
    }

    #[test]
    fn digest_unknown_when_git_cannot_run() {
        let missing = std::env::temp_dir().join("neeko-probe-missing-repo-does-not-exist");
        let entries = [collapsed_dir("any")];
        assert_eq!(
            collapsed_dirs_digest(&missing, &entries),
            Digest::Unknown,
            "非仓库 / 目录消失 → 未知（闸门放行，不静默漏发）"
        );
    }

    #[test]
    fn digest_not_truncated_beyond_display_cap() {
        let (tmp, _repo) = repo_with_commit();
        let dir = tmp.path().join("many");
        fs::create_dir_all(&dir).unwrap();
        // 超过展示层 cap（`operations::get_untracked_files` 的 500 条）
        const COUNT: usize = 501;
        for i in 0..COUNT {
            fs::write(dir.join(format!("f{i}.txt")), "x\n").unwrap();
        }
        let entries = [collapsed_dir("many")];

        let before = collapsed_dirs_digest(tmp.path(), &entries);
        assert!(
            matches!(before, Digest::Known { files, .. } if files == COUNT),
            "探测不得复用展示层截断：必须看到全部 {COUNT} 个文件，实际 {before:?}"
        );

        // 第 COUNT+1 个文件仍必须改变摘要（截断实现会在此漏发）
        fs::write(dir.join("beyond-cap.txt"), "x\n").unwrap();
        let after = collapsed_dirs_digest(tmp.path(), &entries);
        assert_ne!(before, after, "超限目录的新增文件也必须被看见");
        assert!(matches!(after, Digest::Known { files, .. } if files == COUNT + 1));
    }
}
