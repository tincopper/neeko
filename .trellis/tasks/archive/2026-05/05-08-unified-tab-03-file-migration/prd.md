# Phase 3/6: 文件 Tab 迁移到统一 Store

## 概述

将 useFileView 的文件 tab 管理迁移到 Zustand 统一 store，FileViewer 移除内联 tab bar 简化为纯 FileEditor 组件。

## 需求

### 功能需求
1. 重构 `src/hooks/useFileView.ts`：
   - `openFile` 调用 `store.addTab(kind: "file")`
   - `closeTab` 调用 `store.closeTab`
   - `activateTab` 调用 `store.activateTab`
   - `updateTabContent` 调用 `store.updateTab`
   - `tabs` 从 store.tabs 过滤 kind === "file" 并转换为 FileTab[]
   - 返回接口保持不变

2. 简化 `src/components/files/FileViewer.tsx`：
   - 移除内联 tab bar（46-68 行）
   - 从 unified store 读取 activeFileTab
   - FileEditor 接收的数据来源改为 Tab.data

### 约束
- 向后兼容：useFileView 返回接口不变
- 旧 store 字段暂时保留（Phase 6 清理）
- FileEditor 组件本身不修改
- 不修改 MainContent.tsx（Phase 5 统一处理）

## 验收标准

- [x] useFileView 使用 unified store
- [x] FileViewer 移除内联 tab bar
- [x] 文件打开/关闭/切换功能正常
- [x] isDirty 追踪正常
- [x] 文件保存功能正常
- [x] pnpm type-check 通过
- [x] pnpm test:run 通过

## 实现笔记

- 使用 isFileTab 类型守卫 + tabToFileTab 转换器桥接 Tab ↔ FileTab
- dual-write useEffect 同步旧 store 字段，确保 MainContent 的 showFileViewer 条件仍然工作
- activeTabId 解析优先使用项目级 activeTabId（如果是 file tab），否则 fallback 到第一个 file tab
