# Phase 2/6: 统一 TabBar 和 TabItem 组件

## 概述

新建 UnifiedTabBar + UnifiedTabItem 组件替代 TerminalTabBar 和 FileViewer 内联 tab bar。

## 需求

### 功能需求
1. 新建 `src/components/layout/UnifiedTabItem.tsx`：
   - 根据 `tab.data.kind` 显示不同图标（Terminal/FileText/GitBranch）
   - 状态指示器：terminal+Running 绿点，file+isDirty 橙点
   - 标题 truncate，字体使用 `--font-size` CSS 变量
   - 关闭按钮 + stopPropagation
   - React.memo 包裹

2. 新建 `src/components/layout/UnifiedTabBar.tsx`：
   - 横向滚动容器 + onWheel 横向滚动
   - 渲染 UnifiedTabItem 列表
   - `+` 按钮（终端 < 10 时显示）
   - 右键菜单（关闭/关闭其他/关闭所有）
   - Agent Bar 条件渲染（仅终端 tab 激活时）
   - React.memo 包裹

### 约束
- shadcn/ui 组件（DropdownMenu）
- Tailwind CSS + cn() 工具
- 字体大小使用 CSS 变量，不使用 text-xs/text-sm
- 图标从 lucide-react 导入
- 高内聚：TabBar 只负责布局，TabItem 只负责外观
- 低耦合：操作通过 callbacks，不直接操作 store

## 验收标准

- [x] UnifiedTabItem 创建完成
- [x] UnifiedTabBar 创建完成
- [x] 图标映射正确（terminal/file/diff）
- [x] 状态指示器正确（running/dirty）
- [x] 右键菜单功能正常
- [x] Agent Bar 条件渲染
- [x] pnpm type-check 通过

## 实现笔记

- 项目无 @radix-ui/react-tooltip，使用 title 属性替代
- Agent Bar 内联在 UnifiedTabBar 中（与 tab bar 可见性紧密耦合）
- AgentBarButton 为内部组件，使用 AgentIcon + 可选名称
