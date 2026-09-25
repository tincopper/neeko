// Git operations — discard sub-module.

//! 丢弃（discard）的唯一实现。
//!
//! ## 第一性原理：一次 discard = 一组路径
//!
//! 「丢弃单个文件」「丢弃选中」「丢弃整组」在 UI 上是三种入口，在 git 语义上
//! 是**同一件事**：给定一组 pathspec，让工作区回到「无变更」状态。差别只在路径
//! 集合从哪来 —— 那是 UI 的表现问题，不是后端语义。故此处只提供一个入口
//! `discard_paths(paths)`，三个入口全部由它承载（OCP：新增入口 = 新增调用方，
//! 不改本文件）。
//!
//! ## 第二性原理：用哪条 git 命令由仓库状态决定，不由调用方声明
//!
//! 同一份知识只允许有一处表示（DRY）：路径是 tracked 还是 unversioned，只能问
//! `git status`，不能让前端传一个 `is_untracked` 标记 —— 前端快照可能陈旧，
//! 而「确认文案里显示的那批文件」必须和「实际执行的那批文件」完全一致，否则
//! 二次确认就是谎言。因此后端自己分类、自己分派：
//!
//! - `??`（未跟踪）→ `git clean -fd`：内容在 git 里**不存在**，删除即永久丢失。
//! - 其余（已跟踪）→ 先 `git reset HEAD --` 撤销暂存，再 `git checkout --`
//!   把工作区恢复到 index 版本。
//!
//! 这两类操作的不可逆性不同（前者不可恢复、后者可从 HEAD 复原），把它们塞进
//! 同一个「discard all」正是本模块要消除的缺陷。

use std::collections::HashMap;

use super::invalidate_caches;
use crate::common::git::transport::{GitExecError, GitTransport};
use anyhow::{bail, Result};

/// `git status --porcelain=1 -z` 的一条记录。
struct StatusRecord {
    /// X 位（index 状态）。`?` 表示未跟踪。
    x: u8,
    /// Y 位（worktree 状态）。
    y: u8,
    /// 参与 git 命令的 pathspec。rename/copy 记录在 `-z` 下占两个 NUL 字段
    /// （`new\0old`），两条都必须参与：old 要恢复、new 要移除，只带一条会漏掉另一条。
    paths: Vec<String>,
}

/// 解析 `git status --porcelain=1 -z` 输出。
///
/// `-z` 下记录以 NUL 分隔（而非换行），路径不做 C 转义 —— 含空格/换行/非 ASCII
/// 的路径因此不会被截断或误解析。这是路径能安全回传给 git 的前提。
fn parse_porcelain_z(output: &str) -> Vec<StatusRecord> {
    let mut records = Vec::new();
    let mut fields = output.split('\0');

    while let Some(field) = fields.next() {
        let bytes = field.as_bytes();
        // 记录恒为 `XY<space>path`；末尾 NUL 产生的空字段被长度检查过滤
        if bytes.len() < 4 || bytes[2] != b' ' {
            continue;
        }
        let x = bytes[0];
        let y = bytes[1];
        let mut paths = vec![field[3..].to_string()];
        // rename/copy 在 `-z` 下为 `XY new\0old`（顺序与 porcelain 行的
        // `old -> new` 相反），两条都要收下。
        if matches!(x, b'R' | b'C') {
            if let Some(new_path) = fields.next() {
                if !new_path.is_empty() {
                    paths.push(new_path.to_string());
                }
            }
        }
        records.push(StatusRecord { x, y, paths });
    }

    records
}

/// 按「是否已纳入版本控制」拆分：未跟踪 → 删除；已跟踪 → 撤销暂存 + 恢复。
fn partition_by_class(records: Vec<StatusRecord>) -> (Vec<String>, Vec<StatusRecord>) {
    let mut untracked: Vec<String> = Vec::new();
    let mut tracked: Vec<StatusRecord> = Vec::new();

    for record in records {
        if record.x == b'?' && record.y == b'?' {
            untracked.extend(record.paths);
        } else {
            tracked.push(record);
        }
    }

    (untracked, tracked)
}

fn all_paths(records: &[StatusRecord]) -> Vec<&str> {
    records
        .iter()
        .flat_map(|record| record.paths.iter())
        .map(String::as_str)
        .collect()
}

/// 工作区有变更（Y 位非空格）的路径 —— 只有它们需要 `checkout` 恢复。
fn worktree_changed_paths(records: &[StatusRecord]) -> Vec<&str> {
    records
        .iter()
        .filter(|record| record.y != b' ')
        .flat_map(|record| record.paths.iter())
        .map(String::as_str)
        .collect()
}

fn with_paths<'a>(subcommand: &[&'a str], paths: &'a [String]) -> Vec<&'a str> {
    let mut args: Vec<&'a str> = subcommand.to_vec();
    args.extend(paths.iter().map(String::as_str));
    args
}

async fn status_records(
    transport: &dyn GitTransport,
    work_dir: &str,
    paths: &[String],
) -> Result<Vec<StatusRecord>> {
    let args = with_paths(&["status", "--porcelain=1", "-z", "--"], paths);
    let output = transport.run_git(&args, work_dir).await?;
    Ok(parse_porcelain_z(&output))
}

/// 删除未跟踪文件 / 目录：`git clean -fd -- <paths>`
async fn clean(transport: &dyn GitTransport, work_dir: &str, paths: &[String]) -> Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let args = with_paths(&["clean", "-fd", "--"], paths);
    transport.run_git(&args, work_dir).await?;
    Ok(())
}

/// 恢复工作区：`git checkout -- <paths>`
async fn checkout(transport: &dyn GitTransport, work_dir: &str, paths: &[String]) -> Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let args = with_paths(&["checkout", "--"], paths);
    transport.run_git(&args, work_dir).await?;
    Ok(())
}

/// 撤销暂存：`git reset HEAD -- <paths>`。
///
/// **兜底判定是确定性的，不嗅探 stderr**：reset 失败后先用 [`has_head`] 确认仓库
/// 确实没有 HEAD（unborn 分支，index 条目只可能是 staged 新增 `A`），才走
/// `rm --cached` 使其退化为未跟踪（随后由重查后的 `clean` 删除）。HEAD 存在时
/// reset 的任何错误都是真实错误 —— 一律传播；凭 stderr 文本猜测兜底会把真实
/// 错误吞成「成功」，让 UI 误报。
async fn unstage(transport: &dyn GitTransport, work_dir: &str, paths: &[String]) -> Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let reset_args = with_paths(&["reset", "HEAD", "--"], paths);
    if let Err(reset_err) = transport.run_git(&reset_args, work_dir).await {
        if has_head(transport, work_dir).await? {
            return Err(reset_err);
        }
        let rm_args = with_paths(&["rm", "--cached", "-f", "--"], paths);
        transport.run_git(&rm_args, work_dir).await?;
    }
    Ok(())
}

/// 仓库是否有可解析的 HEAD（unborn 分支 → `false`）。
///
/// 探测用 `rev-parse --verify --quiet HEAD`：ref 无法解析时以 **exit 1** 退出
/// （git 源码 `die_no_single_rev` 的稳定行为：`--quiet` 走 1，报错版走 128）。
/// exit 1 → 无 HEAD；其余错误（非仓库、权限等）一律传播，不误判为 unborn。
async fn has_head(transport: &dyn GitTransport, work_dir: &str) -> Result<bool> {
    match transport
        .run_git(&["rev-parse", "--verify", "--quiet", "HEAD"], work_dir)
        .await
    {
        Ok(_) => Ok(true),
        Err(e) => match e.downcast_ref::<GitExecError>() {
            Some(ge) if ge.exit_code == 1 => Ok(false),
            _ => Err(e),
        },
    }
}

/// 已暂存 rename 的 `new → old` 映射。
///
/// **为什么需要**：pathspec 受限的 `git status` **无法识别 rename 对** ——
/// 只给 new 路径时 git 输出的是 `A  <new>`，old 侧完全不可见。此时只 reset new，
/// 会把 old 留在「已暂存删除」状态：discard 掉 new 之后旧文件凭空消失（等于把
/// 一次 rename 丢弃变成了「删除文件」）。故命中 staged-add 时补一次无 pathspec
/// 的 status 把 rename 对解析出来，old 侧一并参与 reset/checkout。
async fn staged_rename_old_side(
    transport: &dyn GitTransport,
    work_dir: &str,
) -> Result<HashMap<String, String>> {
    let output = transport
        .run_git(&["status", "--porcelain=1", "-z"], work_dir)
        .await?;
    Ok(parse_porcelain_z(&output)
        .into_iter()
        .filter(|record| matches!(record.x, b'R' | b'C'))
        .filter_map(|record| {
            // `-z` 下 rename/copy 的字段顺序是 `new\0old`（与 porcelain 行的
            // `old -> new` 相反），故 first=new、second=old。
            let new = record.paths.first()?.clone();
            let old = record.paths.get(1)?.clone();
            Some((new, old))
        })
        .collect())
}

/// 丢弃已跟踪文件的变更（撤销暂存 + 恢复工作区）。
async fn discard_tracked(
    transport: &dyn GitTransport,
    work_dir: &str,
    records: &[StatusRecord],
) -> Result<()> {
    let staged = records.iter().any(|r| r.x != b' ' && r.x != b'?');
    if !staged {
        // 仅工作区变更：无需触碰 index，直接恢复到 index 版本。
        let restore: Vec<String> = worktree_changed_paths(records)
            .into_iter()
            .map(str::to_string)
            .collect();
        return checkout(transport, work_dir, &restore).await;
    }

    let mut paths: Vec<String> = all_paths(records).into_iter().map(str::to_string).collect();
    // 仅当批次内存在 staged 新增时才付出这次全量 status（rename 只可能出现在其中）
    if records.iter().any(|r| r.x == b'A') {
        let old_side = staged_rename_old_side(transport, work_dir).await?;
        for new in paths.clone() {
            if let Some(old) = old_side.get(&new) {
                if !paths.iter().any(|p| p == old) {
                    paths.push(old.clone());
                }
            }
        }
    }
    unstage(transport, work_dir, &paths).await?;

    // 撤销暂存会改变分类：staged 新增（`A`）退化为未跟踪，必须删除而非 checkout
    // （checkout 对未跟踪路径报 pathspec 错误）。故重查一次再分派。
    let after = status_records(transport, work_dir, &paths).await?;
    let (untracked, rest) = partition_by_class(after);
    clean(transport, work_dir, &untracked).await?;
    let restore: Vec<String> = worktree_changed_paths(&rest)
        .into_iter()
        .map(str::to_string)
        .collect();
    checkout(transport, work_dir, &restore).await
}

/// 单次 git 调用携带的 pathspec 上限。
///
/// **物理约束（跨平台）**：Windows `CreateProcess` 命令行上限 32,767 字符
/// （Linux `ARG_MAX` 宽得多，但 SSH transport 同样把参数编进远端命令行）。
/// 变更快照最多 1000 条，全选后一次性把所有路径铺进 argv 会突破该上限 ——
/// 破坏性操作因此失败是不可接受的，故分批下发。
const MAX_PATHS_PER_GIT_CALL: usize = 100;

/// 丢弃一组路径上的变更（`file_paths` 为仓库内相对路径）。
///
/// 未跟踪路径被删除，已跟踪路径被撤销暂存并恢复到 index 版本。整组操作共用
/// 一次状态查询与一次缓存失效 —— N 个文件不再是 N 次 IPC。
pub async fn discard_paths(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_paths: &[String],
) -> Result<()> {
    if file_paths.is_empty() {
        bail!("No files selected to discard.");
    }

    let mut saw_change = false;
    for chunk in file_paths.chunks(MAX_PATHS_PER_GIT_CALL) {
        saw_change |= discard_batch(transport, work_dir, chunk).await?;
    }
    if !saw_change {
        bail!("The selected file(s) have no changes to discard.");
    }

    invalidate_caches(work_dir);
    Ok(())
}

/// 一批（≤ `MAX_PATHS_PER_GIT_CALL`）路径的丢弃：分类 → 分派。
/// 返回是否命中任何变更（供调用方判断是否整体「无可丢弃」）。
async fn discard_batch(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_paths: &[String],
) -> Result<bool> {
    let records = status_records(transport, work_dir, file_paths).await?;
    let (untracked, tracked) = partition_by_class(records);
    if untracked.is_empty() && tracked.is_empty() {
        return Ok(false);
    }

    clean(transport, work_dir, &untracked).await?;
    discard_tracked(transport, work_dir, &tracked).await?;
    Ok(true)
}
