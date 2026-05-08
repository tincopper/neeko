# 统一 Tab 系统：合并终端/文件/Diff Tab，消除视图互斥

## 概述

将 TerminalTab、FileTab、DiffTab 统一为一种 Tab 类型（discriminated union），共享同一个 TabBar 组件，消除 MainContent 中的互斥条件链。

## 问题背景

当前系统有三套互斥视图，通过 MainContent 的条件链切换：
1. FileViewer（文件编辑）— 独占，隐藏终端
2. DiffView（diff 查看）— 独占，有 onBack 按钮
3. SplitLayout（终端）— 独占，隐藏文件

**痛点**：
- 打开文件时终端消失
- 查看 diff 时无法同时看终端
- diff 没有 tab 概念，只能通过 × 关闭回到终端
- 两套独立的 tab 系统（TerminalTabBar + FileViewer 内联 tab bar）代码重复

## 需求

### 功能需求
1. 定义统一 Tab 类型（TerminalTabData / FileTabData / DiffTabData discriminated union）
2. 统一 TabBar 组件替代 TerminalTabBar 和 FileViewer 内联 tab bar
3. 终端、文件、Diff 作为 tab 可以同时打开、自由切换
4. Agent Bar 仅在终端 tab 激活时显示
5. 保持终端 SplitLayout 分屏能力
6. 终端 tab 限制 10 个，文件/diff 不限制

### 非功能需求
1. shadcn/ui 组件 + Tailwind 样式
2. 高内聚：每个组件/hook 只负责一个领域
3. 低耦合：跨域交互通过 Context/Store
4. 展示组件 props ≤ 5
5. 类型集中在 src/types/tab.ts

## 验收标准

- [x] 统一 Tab 类型定义完成
- [x] Zustand store 支持 per-project tabs 管理
- [x] UnifiedTabBar 组件替代旧 tab bar
- [x] 文件 tab 迁移到 unified store
- [x] 终端 tab 迁移到 unified store
- [x] Diff 打开流程改为创建 diff tab
- [x] MainContent 使用 activeTab.kind 渲染
- [x] 旧组件和废弃字段清理完成
- [x] type-check 通过
- [x] test:run 通过（292 passed）

## 子任务

| Phase | 任务 | 状态 |
|-------|------|------|
| 1 | 统一 Tab 类型系统与 Zustand Store 重构 | ✅ |
| 2 | 统一 TabBar 和 TabItem 组件 | ✅ |
| 3 | 文件 Tab 迁移到统一 Store | ✅ |
| 4 | 终端 Tab 迁移到 Zustand Store | ✅ |
| 5 | Diff 视图集成为 Tab | ✅ |
| 6 | 清理旧代码与回归测试 | ✅ |

## 技术笔记

- 类型定义：src/types/tab.ts（TabKind, TerminalTabData, FileTabData, DiffTabData, Tab, ProjectTabs）
- Store 扩展：appStore 新增 tabs/activeTabId + 5 个 CRUD actions
- 组件：UnifiedTabBar + UnifiedTabItem 替代 TerminalTabBar + TerminalTab
- 迁移策略：Phase 3-4 使用 dual-write 保持旧字段同步，Phase 6 统一清理
