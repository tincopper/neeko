# Task: Worktree 文件 Diff 预览

## Overview
为 Git Worktree 添加变更文件列表和 Diff 预览功能。当前点击 Worktree 仅打开终端，无法查看该 Worktree 有哪些文件被修改以及具体的 Diff 内容。本功能使 Worktree 的文件预览体验与主项目保持一致。

## Requirements
- 在侧边栏的 Worktree 列表项中，点击展开后显示该 Worktree 的变更文件树（FileTree）
- Worktree 标题行显示变更统计：文件数量、新增行数（+N）、删除行数（-N），格式与主项目 Changes 区域一致
- 文件树显示每个文件的状态（Modified/Added/Deleted/Renamed/Untracked）和增删行数
- 点击文件树中的文件，在主内容区域打开 DiffView 预览该文件的 diff
- DiffView 支持 Unified 和 Split 两种模式切换
- 后端新增 Tauri 命令获取 Worktree 目录的变更文件和文件 diff

## Acceptance Criteria
- [ ] 后端 `get_worktree_changed_files` 命令能返回 Worktree 的变更文件列表（含每个文件的 additions/deletions）
- [ ] 后端 `get_worktree_file_diff` 命令能返回 Worktree 中指定文件的 diff 内容
- [ ] 侧边栏 Worktree 项可展开显示变更文件树
- [ ] Worktree 展开区域顶部显示 `Changes (N)` 和 `+additions -deletions` 统计
- [ ] 点击文件后主区域显示 DiffView，支持 Unified/Split 模式
- [ ] 切换 Worktree 时文件树正确更新
- [ ] 文件树显示正确的文件状态徽章（M/A/D/R）
- [ ] 每个文件项显示该文件的 +additions -deletions 行数

## Technical Notes

### 后端改动
1. **新增 `get_worktree_changed_files` Tauri 命令**（`src-tauri/src/commands/git.rs`）
   - 参数：`project_id: String, worktree_path: String`
   - 调用 `git::get_changed_files_for_path(worktree_path)` 获取变更文件
   - 返回 `Vec<FileChange>`

2. **新增 `get_worktree_file_diff` Tauri 命令**（`src-tauri/src/commands/git.rs`）
   - 参数：`project_id: String, worktree_path: String, file_path: String`
   - 调用 `git::get_file_diff(worktree_path, file_path)` 获取 diff
   - 返回 `DiffResult`

3. **新增 `get_changed_files_for_path` 函数**（`src-tauri/src/git/local.rs`）
   - 复用现有 `get_changed_files` 逻辑，但接受任意路径（worktree 路径）
   - 使用 `Repository::open(worktree_path)` 打开 worktree 的仓库

4. **注册新命令**（`src-tauri/src/lib.rs`）

### 前端改动
1. **ProjectItem 组件**（`src/components/project/ProjectItem.tsx`）
   - Worktree 列表项添加可展开/折叠的功能
   - 展开时调用 `get_worktree_changed_files` 获取变更文件
   - 顶部显示 `Changes (N)` 标签 + `+additions -deletions` 统计（与主项目 Changes 区域一致）
   - 渲染 `FileTree` 组件显示变更文件
   - 每个文件项显示 `+N -D` 行数统计
   - 点击文件时触发 `onSelectWorktreeFile(worktreePath, filePath)`

2. **新增 WorktreeDiffState**（`App.tsx` 或新 hook）
   - 跟踪当前选中的 worktree 文件 `{ worktreePath, filePath } | null`
   - 当 worktreeDiffState 不为 null 时，MainContent 渲染 DiffView

3. **MainContent 组件**（`src/components/MainContent.tsx`）
   - 当有 worktreeDiffState 时渲染 DiffView
   - DiffView 使用 `diffSource={{ type: "worktree", worktreePath }}`
   - 返回时清除 worktreeDiffState

4. **DiffView 组件**（`src/components/DiffView.tsx`）
   - `DiffSource` 类型添加 `worktree` 变体
   - `loadDiff` 中处理 `type: "worktree"` 调用 `get_worktree_file_diff`

5. **AppCallbacks**（`src/hooks/useAppCallbacks.ts`）
   - 添加 `handleSelectWorktreeFile` 回调
   - 添加 `handleWorktreeDiffBack` 回调

## Out of Scope
- WSL/Remote Worktree 的文件 Diff 预览（仅本地项目）
- Worktree 文件变更的实时监听/自动刷新
- Worktree 文件内容的直接编辑

## 参考实现
- 主项目文件 Diff 预览：`useLocalProjects.handleSelectFile` → `set_view_diff` → `DiffView`
- WSL Diff 预览模式：`wslDiffState` + `DiffView` with `diffSource`
- Remote Diff 预览模式：`remoteDiffState` + `DiffView` with `diffSource`
