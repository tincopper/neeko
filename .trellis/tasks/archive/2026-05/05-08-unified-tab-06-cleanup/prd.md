# Phase 6/6: 清理旧代码与回归测试

## 概述

删除旧组件，移除废弃的 store 字段，清理冗余代码，运行回归测试。

## 需求

### 功能需求
1. 删除旧组件：
   - `src/components/layout/TerminalTabBar.tsx`
   - `src/components/layout/TerminalTab.tsx`

2. 移除 appStore 废弃字段：
   - `fileTabs: FileTab[]`
   - `activeFileTabId: string | null`
   - `fileViewOpen: boolean`
   - `worktreeDiffState: WorktreeDiffState | null`
   - `toggleFileView: () => void`
   - `WorktreeDiffState` 接口

3. 清理 useFileView.ts：
   - 移除 dual-write useEffect
   - 移除 tabToFileTab helper
   - 移除 fileViewOpen 相关写入

4. 清理其他文件：
   - useAppContainer.ts：移除 setWorktreeDiffState 相关逻辑
   - useWorktreeActions.ts：移除 setWorktreeDiffState 参数
   - project-actions-context.tsx：移除 onWorktreeDiffBack
   - layout/index.ts：移除旧组件导出
   - 测试文件：清理旧 store 字段引用

### 约束
- 不修改 DiffView 组件
- 不修改后端（src-tauri/）
- 保持类型兼容

## 验收标准

- [x] TerminalTabBar.tsx 删除
- [x] TerminalTab.tsx 删除
- [x] appStore 废弃字段移除
- [x] dual-write 逻辑移除
- [x] 所有旧字段引用清理
- [x] pnpm type-check 通过
- [x] pnpm test:run 通过（292 passed）
- [x] cargo check 通过

## 实现笔记

- 使用 grep 搜索所有对旧字段的引用，确保全部清理
- 测试文件中需要同步清理 store seed 数据
- cargo fmt 有预存的格式差异，与本次变更无关
