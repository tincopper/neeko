# Phase 5/6: Diff 视图集成为 Tab

## 概述

将三种 diff 打开方式统一为创建 diff tab，重构 MainContent 使用 UnifiedTabBar + activeTab.kind 渲染。

## 需求

### 功能需求
1. 更新 diff 打开流程：
   - `useLocalProjects.handleSelectFile` → 创建 diff tab（diffSource: local）
   - `useWorktreeActions.handleSelectWorktreeFile` → 创建 diff tab（diffSource: worktree）
   - `useWslActions.handleSelectWslFile` → 创建 diff tab（diffSource: wsl）

2. 重构 `src/components/MainContent.tsx`：
   - 移除旧的互斥条件链
   - 渲染 UnifiedTabBar
   - 根据 activeTab.kind 渲染内容：
     - terminal → SplitLayout + TerminalView
     - file → FileViewer
     - diff → DiffView
     - 无 tab → ProjectGuidePage
   - Agent Bar 仅终端 tab 时显示

3. 更新 `src/hooks/useAppContainer.ts`：
   - tabKey 改为直接使用 currentProjectId

### 约束
- DiffView 组件本身不修改
- 后端不修改
- 旧字段（worktreeDiffState/wslDiffState）暂时保留

## 验收标准

- [x] 三种 diff 打开方式都创建 diff tab
- [x] MainContent 使用 UnifiedTabBar
- [x] activeTab.kind 渲染正确
- [x] Agent Bar 条件渲染正确
- [x] WSL/Remote 项目渲染不变
- [x] pnpm type-check 通过
- [x] pnpm test:run 通过

## 实现笔记

- diff tab ID 格式：`diff:{projectId}:{filePath}:{timestamp}`
- DiffView 的 onBack 回调改为 closeTab
- UnifiedTabBar 的 showAgentBar 通过 activeTab?.data.kind === "terminal" 判断
- Guide Page 在无 active tab 且有 active project 时显示
