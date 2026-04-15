# Git Commit Panel 功能

## 概述

新增一个类似于 JetBrains IDEA 的 Git Commit 面板，用于管理 Git 提交工作流。该面板将作为 RightPanel 的一个标签页，提供完整的 Git 提交功能。

## 需求描述

- 参考 Idea 的 Commit 选项功能设计
- 按照 React 组件化设计，尽量与其它组件低耦合
- 通过在右侧实现一个 Panel 组件用于放置右侧相关组件，当前 Commit 只是其中一个组件

## 功能分层

### 上层：分支信息和操作按钮

- 显示当前分支名称
- Git 操作按钮：
  - Fetch（获取远程更新）
  - Pull（拉取远程更新）
  - Push（推送到远程）
  - New Branch（新建分支）
  - New Worktree（新建工作树）
  - Refresh（刷新）

### 上层：Changes 功能

- 显示当前各个改动文件的列表
- 文件状态标识：
  - Modified (M) - 已修改
  - Added (A) - 新增
  - Deleted (D) - 已删除
  - Renamed (R) - 重命名
  - Untracked (U) - 未跟踪
- 文件选择/取消选择
- 全选/取消全选
- 文件状态过滤（All/Modified/Added/Deleted/Renamed/Untracked）
- 支持目录折叠

### 中层：Commit 表单

- Commit 消息输入框（多行文本框）
- Commit 按钮 - 提交选中的文件
- Commit & Push 按钮 - 提交并推送到远程
- AI 自动生成 Commit 信息按钮

### 底层：提交历史

- 显示最近 10 条提交记录
- 每条记录显示：
  - 短哈希（7位）
  - 提交者姓名
  - 提交时间
  - 提交消息
- 可折叠/展开

## 技术要求

### 前端

- 使用 React 18 + TypeScript
- 使用现有的 UI 组件库（Button、Input、Badge 等）
- 组件使用 React.memo 包裹
- Props 接口定义在组件同一文件中
- 使用 Tailwind CSS v4 样式

### 后端

- 使用现有的 git2-rs 库实现 Git 操作
- 新增 Tauri 命令供前端调用
- 使用 anyhow::Result 作为返回类型

### 组件设计

1. **GitCommitPanel** - 主面板组件（编排所有子组件）
2. **BranchInfo** - 分支信息栏组件
3. **ChangesList** - 变更文件列表组件
4. **CommitForm** - 提交表单组件
5. **CommitHistory** - 提交历史组件

## 验收标准

- [ ] 分支信息正确显示当前分支名称
- [ ] Fetch/Pull/Push 操作正常工作
- [ ] 文件变更列表正确显示所有变更文件
- [ ] 文件状态徽章正确显示（M/A/D/R/U）
- [ ] 文件选择/取消选择功能正常
- [ ] 全选/取消全选功能正常
- [ ] 文件状态过滤功能正常
- [ ] 提交消息输入框正常工作
- [ ] Commit 按钮正常工作
- [ ] Commit & Push 按钮正常工作
- [ ] AI 生成消息功能正常（如果有后端支持）
- [ ] 提交历史正确显示最近 10 条提交
- [ ] 面板可折叠/展开
- [ ] 所有组件使用 React.memo 优化
- [ ] 遵循项目的组件设计规范

## 技术笔记

### 需要新增的文件

**后端 (Rust)：**
- `src-tauri/src/state/project.rs` - 添加 CommitInfo 和 CommitMessage 类型
- `src-tauri/src/git/local.rs` - 实现 Git 操作函数
- `src-tauri/src/commands/git.rs` - 添加 Tauri 命令

**前端 (React)：**
- `src/types.ts` - 添加类型定义
- `src/components/project/BranchInfo.tsx` - 分支信息组件
- `src/components/project/ChangesList.tsx` - 变更文件列表组件
- `src/components/project/CommitForm.tsx` - 提交表单组件
- `src/components/project/CommitHistory.tsx` - 提交历史组件
- `src/components/project/GitCommitPanel.tsx` - 主面板组件

### 集成点

- 在 RightPanel 中添加 "Commit" 标签页
- 复用现有的 FileTree 组件显示文件列表
- 复用现有的 Badge 组件显示文件状态
- 复用现有的 Button、Input 组件

### 参考资料

- 现有组件：`src/components/project/GitDialog.tsx`
- 现有组件：`src/components/project/FileTree.tsx`
- 现有类型：`src/types.ts` 中的 `FileChange`、`GitInfo`
- 后端实现：`src-tauri/src/git/local.rs`
- Tauri 命令：`src-tauri/src/commands/git.rs`
