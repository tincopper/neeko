# Task: WSL/SSH项目展示改为Changes布局

## Overview

将WSL和SSH项目的侧边栏展示从当前的"分支列表"形式改为与本地项目一致的"local + Changes"布局模式。当前WSL/SSH项目在侧边栏中以平铺的分支列表展示所有分支，点击分支直接切换；而本地项目使用交互式分支下拉 + 独立的"Changes (N) +X -Y"折叠区域。本次改动统一两者体验。

## Requirements

### R1: 重写 ProjectBody 布局
- 替换 "Branches" 平铺列表为 "local" 行 + "Changes" 折叠区域
- "local" 行包含：TerminalIcon、"local" 标签、交互式分支下拉 badge
- 分支下拉面板：搜索框、分支列表（过滤 worktree 分支）、绿色圆点标记当前分支、"New Branch" 按钮
- "Changes (N) +X -Y" 折叠区域：显示 additions/deletions 统计 + FileTree

### R2: 移除 ProjectItemCard header 静态分支 badge
- 当前 header 有一个不可交互的静态分支 badge
- 移除后分支 badge 仅在 body 的 "local" 行中以交互式下拉形式展示

### R3: per-worktree Changes 展示
- 每个 worktree 行支持展开/折叠
- 展开后懒加载该 worktree 的 changed files
- 显示 "Changes (N) +X -Y" 子区域 + FileTree
- 删除前检查 dirty 状态，dirty 时显示 "Force Remove"

### R4: 新增 Rust 后端命令
- `wsl_get_worktree_changed_files(distro, worktree_path) -> Vec<FileChange>`
- `wsl_is_worktree_dirty(distro, worktree_path) -> bool`
- `wsl_get_worktree_file_diff(distro, worktree_path, file_path) -> DiffResult`
- `remote_get_worktree_changed_files(host, port, username, auth, worktree_path) -> Vec<FileChange>`
- `remote_is_worktree_dirty(host, port, username, auth, worktree_path) -> bool`
- `remote_get_worktree_file_diff(host, port, username, auth, worktree_path, file_path) -> DiffResult`

### R5: 前端回调串联
- WSLProjectCard / RemoteProjectCard 实现 onGetWorktreeChangedFiles / onIsWorktreeDirty 回调
- 通过 ProjectItemCard 传递给 ProjectBody

## Acceptance Criteria

- [ ] WSL 项目侧边栏展示与本地项目一致：local 行 + Changes 折叠区域
- [ ] SSH 项目侧边栏展示与本地项目一致：local 行 + Changes 折叠区域
- [ ] 分支 badge 可交互：点击打开下拉、支持搜索、点击切换分支
- [ ] "Changes (N) +X -Y" 正确显示 additions/deletions 统计
- [ ] Worktree 展开后显示 per-worktree Changes（含 FileTree）
- [ ] 删除 worktree 前检查 dirty 状态
- [ ] ProjectItemCard header 不再显示静态分支 badge
- [ ] 新增的 6 个 Rust 命令在 `neeko_invoke_handler!` 中注册
- [ ] `cargo check` 通过
- [ ] `pnpm type-check` 通过

## Technical Notes

### 后端模式
- WSL 命令为同步 `fn`，使用 `#[cfg(target_os = "windows")]` 守卫，返回 `Result<T, AppError>`
- Remote 命令为 `async fn`，使用 `ssh_exec_command` 执行远程命令
- 复用 `remote::parse_status_line` 解析 `git status --porcelain` 输出
- `FileChange` 的 `additions`/`deletions` 为 0（与现有 `refresh_wsl_git_info` 一致）

### 前端模式
- `ProjectBody` 参考 `ProjectGitSection.tsx` 的布局结构
- 分支下拉参考 `ProjectGitSection` 的 dropdown 实现（lines 146-209）
- Worktree Changes 参考 `WorktreeList.tsx` 的 lazy-load 模式
- `ProjectBodyProps` 新增 `onSelectProject`, `isActive`, `onRefreshGit`, `onShowToast`, `onOpenDialog`, `onGetWorktreeChangedFiles`, `onIsWorktreeDirty`

### 类型导入
- 前端需要从 `../../types` 导入 `FileChange`, `DiffResult`
- Rust 命令使用 `crate::models::*` 和 `crate::AppError`

## Out of Scope

- 不修改本地项目的 ProjectGitSection 布局
- 不修改 WSL/SSH 的 git 操作逻辑（checkout、create、rename 等）
- 不修改 ProjectItemCard 的 context menu 和 settings dialog
- 不添加 worktree 的 `is_dirty` dirty check 的 force remove 警告 UI（复用现有 modal 模式）
