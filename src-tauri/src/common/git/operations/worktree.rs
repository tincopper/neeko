// Git operations — worktree sub-module (split from operations.rs God File).

use super::invalidate_caches;
use crate::common::executor::factory::ExecTarget;
use crate::common::git::transport::GitTransport;
use crate::project::types::Worktree;
use anyhow::Result;

/// 移除指定 linked worktree。
pub async fn remove_worktree(
    transport: &dyn GitTransport,
    work_dir: &str,
    worktree_path: &str,
) -> Result<()> {
    transport
        .run_git(&["worktree", "remove", "--force", worktree_path], work_dir)
        .await?;
    invalidate_caches(work_dir);
    invalidate_caches(worktree_path);
    Ok(())
}

/// Rename a worktree: `git worktree move <old_path> <new_path>`
pub async fn rename_worktree(
    transport: &dyn GitTransport,
    work_dir: &str,
    old_path: &str,
    new_path: &str,
) -> Result<()> {
    transport
        .run_git(&["worktree", "move", old_path, new_path], work_dir)
        .await?;
    invalidate_caches(work_dir);
    invalidate_caches(old_path);
    invalidate_caches(new_path);
    Ok(())
}

/// Check if a worktree is dirty: `git status --porcelain` returns output
pub async fn is_worktree_dirty(transport: &dyn GitTransport, worktree_path: &str) -> Result<bool> {
    let output = transport
        .run_git(&["status", "--porcelain"], worktree_path)
        .await?;
    Ok(!output.trim().is_empty())
}

/// Create a worktree: `git worktree add <path> <branch>`
pub async fn create_worktree(
    transport: &dyn GitTransport,
    work_dir: &str,
    worktree_path: &str,
    branch_name: &str,
    new_branch: bool,
) -> Result<()> {
    let mut args = vec!["worktree", "add"];
    if new_branch {
        args.push("-b");
        args.push(branch_name);
    }
    args.push(worktree_path);
    if !new_branch {
        args.push(branch_name);
    }
    transport.run_git(&args, work_dir).await?;
    invalidate_caches(work_dir);
    invalidate_caches(worktree_path);
    Ok(())
}

/// Get default branch: `git remote show origin | grep HEAD`
pub async fn default_branch(transport: &dyn GitTransport, work_dir: &str) -> Result<String> {
    let output = transport
        .run_git(&["remote", "show", "origin"], work_dir)
        .await?;
    for line in output.lines() {
        if let Some(branch) = line.trim().strip_prefix("HEAD branch: ") {
            return Ok(branch.to_string());
        }
    }
    let output = transport
        .run_git(&["rev-parse", "--abbrev-ref", "origin/HEAD"], work_dir)
        .await?;
    let branch = output
        .trim()
        .strip_prefix("origin/")
        .unwrap_or(output.trim());
    Ok(branch.to_string())
}

// ─── Worktree list ───────────────────────────────────────────────────────────

/// 单条清单条目的归一化出口（唯一）：归一失败返回 `None`，由调用方丢弃该条目。
///
/// 输出取**身份渲染**（前端据此拼 `WorkspaceKey`），与 `WorkspaceRef::key()` 同形。
fn normalized_worktree(
    target: &ExecTarget,
    raw_path: &str,
    branch: String,
    head: String,
) -> Option<Worktree> {
    match crate::common::git::checkout_path::CheckoutPath::resolve(target, raw_path) {
        Ok(path) => Some(Worktree {
            path: path.identity().to_string(),
            branch,
            head,
        }),
        Err(e) => {
            log::warn!("[git] dropping worktree `{raw_path}`: path is not normalizable: {e}");
            None
        }
    }
}

/// Linked worktree 清单（`git worktree list --porcelain`，**已剔除主工作树**）。
///
/// **归一即产出**：条目 `path` 是身份渲染（见 [`parse_worktree_list`]）—— 前端据此拼
/// `WorkspaceKey`，会话列表也据它判定「会话属于哪个单元」，必须与 `WorkspaceRef::key()` 同形。
///
/// 主工作树恒为 porcelain 输出的首项（git-worktree(1) 契约，2.54 实测），故此处直接剔除：
/// 两个调用方（git info / 会话单元归属）要的都是 linked 部分。
pub async fn list_worktrees(transport: &dyn GitTransport, work_dir: &str) -> Result<Vec<Worktree>> {
    let output = transport
        .run_git(&["worktree", "list", "--porcelain"], work_dir)
        .await?;
    let target = transport.exec_target();
    // 每条目的归一含 `exists` / `canonicalize`（阻塞 fs）⇒ 整份清单在**一次** `spawn_blocking`
    // 内解析（红线 3）：逐条 hop 会把线程池往返乘以条目数，且让清单内部来自不同时刻的 fs 视图。
    let mut worktrees = tokio::task::spawn_blocking(move || parse_worktree_list(&output, &target))
        .await
        .map_err(|e| anyhow::anyhow!("worktree list parsing task failed: {e}"))?;
    if !worktrees.is_empty() {
        worktrees.remove(0);
    }
    Ok(worktrees)
}

/// 项目内 linked worktree 的根清单（身份渲染）。
///
/// **为什么需要它**：单元归属 = 「包含它且最深的那个单元根」（见
/// [`crate::common::git::unit_scope`]）。主工作树与 linked worktree 的根**默认互不包含**
/// （Neeko 默认把 worktree 建在项目根之外，`~/.neeko/worktrees/<name>`，见
/// `common/git/path_guard.rs`），此时前缀判定恰好够用；但两种合法布局会让根重叠 ——
/// 用户约定建在仓内（`<project>/.worktrees/<name>`）与 worktree 里再开 worktree。
/// 重叠时没有这份兄弟清单，主仓单元会把 worktree 的会话一并命中，而续写通道却建立在
/// 调用方当前单元（cwd 与 agent 原生会话 origin 不一致）。
pub async fn list_linked_worktree_roots(
    transport: &dyn GitTransport,
    work_dir: &str,
) -> Result<Vec<String>> {
    Ok(list_worktrees(transport, work_dir)
        .await?
        .into_iter()
        .map(|wt| wt.path)
        .collect())
}

/// Parse `git worktree list --porcelain` into the authoritative worktree list.
///
/// **路径即身份**：这些路径会被前端拼成 `WorkspaceKey`，必须与 `WorkspaceRef::key()` 逐字同形 ——
/// 因此**产出即归一**为**身份渲染**（`CheckoutPath::resolve`，`target` 决定语义：Local 锚定到
/// 文件系统 canonical 形态，WSL / SSH 走 POSIX 词法归一，远端路径绝不能经宿主 `std::path`，
/// 详见 `common/git/checkout_path.rs`）。归一漏掉时同一单元会有两种形态：前端按清单拼的 key
/// 取不到快照（侧栏 +A/-D 空白）、存活校验把激活单元误判成已消失并回落主仓。
///
/// 实测（2026-09-30）git 输出的已是 realpath 形态，所以此处当前是幂等加固；显式归一 +
/// 同名单测是为了让「产物必须与消费侧身份同形」成为可执行契约，而非依赖 git 的实现细节。
///
/// 归一失败的条目不进清单：宁可缺一项，也不对外产出第二种身份表示。
pub(crate) fn parse_worktree_list(output: &str, target: &ExecTarget) -> Vec<Worktree> {
    let mut worktrees = Vec::new();
    let mut current_path = String::new();
    let mut current_branch = String::new();
    let mut current_head = String::new();

    for line in output.lines() {
        let line = line.trim();
        if let Some(stripped) = line.strip_prefix("worktree ") {
            if !current_path.is_empty() {
                if let Some(wt) = normalized_worktree(
                    target,
                    &current_path,
                    std::mem::take(&mut current_branch),
                    std::mem::take(&mut current_head),
                ) {
                    worktrees.push(wt);
                }
            }
            current_path = stripped.to_string();
        } else if let Some(ref_str) = line.strip_prefix("branch ") {
            if let Some(name) = ref_str.strip_prefix("refs/heads/") {
                current_branch = name.to_string();
            }
        } else if let Some(stripped) = line.strip_prefix("HEAD ") {
            current_head = stripped.to_string();
        }
    }
    if !current_path.is_empty() {
        if let Some(wt) = normalized_worktree(target, &current_path, current_branch, current_head) {
            worktrees.push(wt);
        }
    }
    worktrees
}

#[cfg(test)]
mod tests;
