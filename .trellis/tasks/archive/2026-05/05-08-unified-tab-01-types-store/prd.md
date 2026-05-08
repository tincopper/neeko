# Phase 1/6: 统一 Tab 类型系统与 Zustand Store 重构

## 概述

新建 src/types/tab.ts 定义统一 Tab 类型系统，重构 appStore 新增 per-project tabs 字段和 CRUD actions。

## 需求

### 功能需求
1. 新建 `src/types/tab.ts` 定义以下类型：
   - `TabKind`：`"terminal" | "file" | "diff"`
   - `TerminalTabData`：`{ kind, agentId, status }`
   - `FileTabData`：`{ kind, filePath, fileName, content, isDirty }`
   - `DiffTabData`：`{ kind, filePath, fileName, diffSource, initialMode? }`
   - `TabData`：discriminated union
   - `Tab`：`{ id, projectId, title, order, data }`
   - `ProjectTabs`：`{ tabs, activeTabId }`

2. 更新 `src/types/index.ts` 添加 barrel export

3. 在 `src/store/appStore.ts` 中新增：
   - `tabs: Record<string, ProjectTabs>` — per-project tab 状态
   - `activeTabId: string | null` — 全局激活 tab
   - `addTab(projectId, tab)` — 添加 tab（终端限制 10 个）
   - `closeTab(projectId, tabId)` — 关闭 tab 并激活相邻
   - `activateTab(projectId, tabId)` — 切换激活
   - `updateTab(projectId, tabId, partial)` — 类型安全更新
   - `clearProjectTabs(projectId)` — 清理项目所有 tabs

### 约束
- 保留旧字段（fileTabs/activeFileTabId/fileViewOpen/worktreeDiffState）兼容
- 不使用 `any`，不使用 `as` 断言
- 使用 discriminated union 的 `in` 操作符进行类型收窄

## 验收标准

- [x] src/types/tab.ts 创建完成
- [x] src/types/index.ts 导出 tab 类型
- [x] appStore 新增 tabs/activeTabId 字段
- [x] appStore 新增 5 个 CRUD actions
- [x] 终端 tab 上限 10 个校验
- [x] pnpm type-check 通过
- [x] pnpm test:run 通过

## 实现笔记

- `mergeTabData` helper 使用 `in` 操作符收窄 Partial<TabData>，避免 as 断言
- `closeTab` 使用原始 index 判断激活下一个还是前一个
- kind 不匹配时 partial 静默忽略，防止跨 variant 非法修改
