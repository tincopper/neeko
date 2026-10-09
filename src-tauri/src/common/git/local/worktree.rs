#![allow(unused_imports, missing_docs)]
use super::run_cmd_local;
use crate::common::executor::factory::ExecTarget;
use crate::common::git::checkout_path::CheckoutPath;
use crate::project::types::Worktree;
use git2::Repository;

/// linked worktree 清单（Local）。**本函数是 Local 侧清单的唯一产出点。**
///
/// **路径即身份**：返回值会被前端拼成 `WorkspaceKey`，必须与后端 `WorkspaceRef::key()` 逐字同形 ——
/// 因此对外字段取 [`CheckoutPath::identity`]（平台无关字母表），而 `git -C` 入参取
/// [`CheckoutPath::exec`]（宿主形态）。`WorkspaceRef::resolve` 只在**消费侧**归一；产出侧若漏掉，
/// 同一工作树就会有两种形态（清单一种、快照另一种）——前端按清单拼的 key 取不到快照
/// （侧栏 +A/-D 空白），存活校验还会把激活单元误判成「已消失」并回落主仓。
///
/// 实测（2026-09-30，macOS 符号链接 tempdir）：git 与 libgit2 今天返回的都已是 realpath
/// 形态（`git worktree list --porcelain` 亦然），所以这里当前是**幂等加固**而不是修一个
/// 现场缺陷 —— 但那是两者的实现细节，不是本仓可以依赖的契约；产出侧显式归一并由
/// `listed_worktree_paths_are_canonical_workspace_ref_identity` 钉住，换实现（例如设计里计划的
/// 「合并为单一清单实现」）时才不会静默漂移。
///
/// 归一失败的条目不进清单：宁可缺一项，也不对外产出第二种身份表示。
pub(crate) fn get_worktrees(repo: &Repository) -> Vec<Worktree> {
    let mut worktrees = Vec::new();

    let Ok(names) = repo.worktrees() else {
        return worktrees;
    };
    for name in names.iter().flatten() {
        let Ok(wt) = repo.find_worktree(name) else {
            continue;
        };
        // 归一先于任何消费：`-C` 入参、分支探测与对外路径全部用归一后的形态。
        // 非 UTF-8 直接丢弃（`CheckoutPath` 的构造期同样拒绝非 UTF-8 —— git CLI 的 argv
        // 与 IPC 都要求 UTF-8，`to_string_lossy` 会把它悄悄换成 U+FFFD 的第二身份）。
        let Some(raw_path) = wt.path().to_str() else {
            log::warn!("[git] dropping worktree `{name}`: path is not valid UTF-8");
            continue;
        };
        let Ok(path) = CheckoutPath::resolve(&ExecTarget::Local, raw_path) else {
            log::warn!("[git] dropping worktree `{name}`: path `{raw_path}` is not normalizable");
            continue;
        };
        // Use git command to get branch and head info (avoids N+1 repo opens)
        // —— 进程入参必须用**执行渲染**（宿主形态）。
        let Ok(output) = run_cmd_local(
            None,
            "git",
            &["-C", path.exec(), "rev-parse", "--abbrev-ref", "HEAD"],
        ) else {
            continue;
        };
        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let branch = if branch.is_empty() {
            "HEAD".to_string()
        } else {
            branch
        };

        let Ok(output) = run_cmd_local(None, "git", &["-C", path.exec(), "rev-parse", "HEAD"])
        else {
            continue;
        };
        let head = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let head = if head.is_empty() {
            "detached".to_string()
        } else {
            head
        };

        worktrees.push(Worktree {
            // 对外路径 = **身份渲染**（前端据此拼 `WorkspaceKey`，见函数头注释）
            path: path.identity().to_string(),
            branch,
            head,
        });
    }

    worktrees
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::exec::collect_blocking;
    use std::path::Path;

    /// 在 `dir` 下跑一条 git 命令（走 `core::exec` 统一接口，红线 1）。
    fn git_in(dir: &Path, args: &[&str]) -> String {
        let dir = dir.to_string_lossy().to_string();
        let mut full = vec!["-C", dir.as_str()];
        full.extend_from_slice(args);
        let output = collect_blocking(&ExecTarget::Local, "git", &full).expect("spawn git");
        assert_eq!(
            output.exit_code,
            0,
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    /// 真实 linked worktree 夹具：主仓（1 次提交）+ `git worktree add` 的第二工作树。
    /// 路径全由 `tempdir()` 派生（红线 13）。
    fn repo_with_worktree(tmp: &Path) -> (Repository, std::path::PathBuf, std::path::PathBuf) {
        let main = tmp.join("repo");
        std::fs::create_dir_all(&main).expect("create main repo dir");
        let repo = Repository::init(&main).expect("init git repo");
        let sig = git2::Signature::now("Test", "test@test.com").expect("signature");
        std::fs::write(main.join("README.md"), "# Test\n").expect("write README");
        {
            let mut index = repo.index().expect("index");
            index.add_path(Path::new("README.md")).expect("add README");
            index.write().expect("write index");
            let tree = repo
                .find_tree(index.write_tree().expect("write tree"))
                .expect("find tree");
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
                .expect("initial commit");
        }
        let worktree = tmp.join("repo-wt");
        git_in(
            &main,
            &[
                "worktree",
                "add",
                "-b",
                "feature",
                &worktree.to_string_lossy(),
            ],
        );
        (repo, main, worktree)
    }

    /// **清单路径 ≡ `WorkspaceRef` 身份形态**（前端按清单拼 `WorkspaceKey` 所依赖的契约）。
    ///
    /// 断言的是「同一目录的另一种写法（尾分隔符 + `.` 成分）经身份入口解析后与清单逐字相同」。
    /// 实测 libgit2 今天已返回 realpath 形态，故本用例当前不会由红转绿；它的价值是钉住
    /// **产出侧**的归一义务，让换实现（或换到 `git worktree list --porcelain`）时若丢掉
    /// 归一，CI 立刻红 —— 而不是等到「侧栏 chip 空白 / 激活态反复回落主仓」在现场出现。
    ///
    /// 第二条断言刻意比对**对象**而不是字符串形态：形态是平台细节（Windows `\\?\` /
    /// 分隔符），比对字符串就是在断言平台（红线 13 的同族陷阱）。
    #[test]
    fn listed_worktree_paths_are_canonical_workspace_ref_identity() {
        let tmp = tempfile::tempdir().unwrap();
        let (repo, main, worktree) = repo_with_worktree(tmp.path());

        let list = get_worktrees(&repo);
        assert_eq!(list.len(), 1, "夹具必须产出恰好一个 linked worktree");
        assert_eq!(list[0].branch, "feature");

        // 同一目录的另一种写法（尾分隔符 + `.` 成分）经身份入口解析 ⇒ 必须与清单逐字相同
        let other_form = format!("{}/./", worktree.to_string_lossy());
        let identity = crate::common::git::WorkspaceRef::resolve(
            "p1",
            &main.to_string_lossy(),
            Some(&other_form),
            &ExecTarget::Local,
        )
        .expect("identity must resolve");
        assert_eq!(
            list[0].path,
            identity
                .worktree_path()
                .expect("linked checkout has a path"),
            "清单路径与 WorkspaceRef 身份必须同形（否则前端 key 与快照 key 分叉）"
        );
        assert_eq!(
            std::fs::canonicalize(&list[0].path).expect("identity must be a usable path"),
            worktree
                .canonicalize()
                .expect("canonicalize fixture worktree"),
            "清单路径必须指向该工作树（同对象，而不是同字符串）"
        );
    }
}
