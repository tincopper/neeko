//! Git 命令层：按关注点拆分的 `#[tauri::command]` 集合。
//!
//! 每个子模块只做参数接收 + 调度下层 service，业务逻辑在 `common/git`。
//! `pub use *` 把子模块命令拍平到本模块，供 `neeko_invoke_handler!` 注册。

/// 分支：切换 / 创建 / 删除 / 重命名 / detached checkout。
pub mod branch;
/// 提交：提交选中文件、cherry-pick、revert、打 tag。
pub mod commit;
/// 历史：commit log/detail/files/diff、stash 浏览与应用、ahead-behind。
pub mod history;
/// 暂存区：stage / unstage / discard（单文件与全量）。
pub mod index;
/// GitHub PR：经 `gh` CLI 的列举 / 详情 / 创建 / 合并 / 评论 / review。
pub mod pr;
/// 查询：仓库信息、分支信息、变更文件、未跟踪文件、diff 统计。
pub mod query;
/// 同步：fetch / pull / push（含凭据注入变体）。
pub mod sync;
/// Worktree：创建 / 删除 / 重命名 / 脏检查。
pub mod worktree;

pub use branch::*;
pub use commit::*;
pub use history::*;
pub use index::*;
pub use pr::*;
pub use query::*;
pub use sync::*;
pub use worktree::*;
