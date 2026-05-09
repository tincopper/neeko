# IDEA 5栏 Docking 布局重构 - 技术设计方案

## 1. 概述

### 1.1 目标

将 Neeko 当前的 VS Code 风格 3-4 栏固定布局，重构为 IntelliJ IDEA 风格的 **5 栏 Docking 弹性布局**。核心依赖为 **shadcn/ui `Resizable` 组件**（底层 `react-resizable-panels`），实现以下能力：

- 双侧工具窗口栏（左栏 + 右栏图标条）
- 左、右、底部三个可停靠面板区，支持 Tab 堆叠
- 统一的拖拽 resize 系统（替代当前 4 套独立实现）
- 面板 Pin/Auto-hide 状态切换
- 布局持久化（localStorage 自动存储）
- 面板拖拽换位（Drag-to-re-dock）

### 1.2 核心原则

1. **最小侵入** — `MainContent`（编辑器区）内部结构不变，仅外层布局容器替换
2. **渐进迁移** — 逐个组件替换，确保每一步可回归验证
3. **shadcn 优先** — resize / tabs / tooltip / badge / context-menu 均使用 shadcn 组件
4. **无自定义 resize 代码** — 全部由 `react-resizable-panels` 处理

### 1.3 开发约束

1. **高内聚低耦合** — 代码采用组件化设计，每个组件职责单一、边界清晰。组件内部逻辑自包含，对外仅暴露最小接口。
2. **统一状态管理** — 组件间通信通过 Zustand `dockStore` 或 React Context 完成，**禁止**通过大量 props 穿透多层组件传递数据和回调函数。
3. **文件行数限制** — 单个组件文件不超过 **200 行**。超过时需拆分为子组件或提取 hooks/工具函数。

---

## 2. IDEA 5 栏 Dock 布局分析

### 2.1 布局模型

```
┌──────────────────────────────────────────────────────────────┐
│  Title Bar（项目名 / 分支 / 窗口控制）                         │
├────┬─────────┬───────────────────────┬──────────┬────────────┤
│ C1 │  C2     │       C3 (Editor)     │   C4     │    C5      │
│ 左 │  左侧   │    中心编辑器区        │  右侧   │   右侧     │
│ 侧 │  停靠区 │    (MainContent)       │  停靠区  │   图标栏   │
│ 图 │         │                       │          │           │
│ 标 │  Tabs:  │  ┌─────────────────┐  │  Tabs:   │  Tooltip  │
│ 栏 │ Projects│  │ UnifiedTabBar   │  │ Commit   │  + Badge  │
│    │ Files   │  │ Terminal/Diff/  │  │ PR       │           │
│ 48 │ Skills  │  │ FileViewer      │  │          │  48px     │
│ px │         │  ├─────────────────┤  │          │           │
│    │         │  │ Bottom Dock Zone│  │          │           │
│    │         │  │ (Build/Output)  │  │          │           │
├────┴─────────┴───────────────────────┴──────────┴────────────┤
│  Status Bar                                                    │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 5 栏定义

| 栏位 | 名称 | 宽度 | 说明 |
|------|------|------|------|
| C1 | 左侧工具窗口栏 | 48px 固定 | 图标按钮 + Tooltip + Badge，点击 toggle 对应面板 |
| C2 | 左侧停靠区 | 默认 280px，resizable 180-480px | Tabs 堆叠：Projects / Files / Skills |
| C3 | 编辑器区 | flex-1 自适应 | 包含 UnifiedTabBar + 主内容 + 底部停靠区 |
| C4 | 右侧停靠区 | 默认 320px，resizable 260-600px | Tabs 堆叠：Commit / PR / Notifications |
| C5 | 右侧工具窗口栏 | 48px 固定 | 可选，对称设计 |

### 2.3 关键交互行为

| 行为 | 说明 |
|------|------|
| **Toggle** | 单击图标栏按钮 → 展开/折叠对应面板到其默认停靠区 |
| **Pin/Unpin** | 面板可固定（始终可见）或设为 Auto-hide（折叠后仅留 Tabs 标签条） |
| **Tab Stacking** | 同一停靠区可容纳多个面板，通过 Tabs 切换 |
| **Drag Re-dock** | 拖拽 Tab 到另一停靠区，改变停靠位置 |
| **Resize** | 拖拽 ResizableHandle 调整相邻停靠区尺寸，支持 min/max 约束 |
| **Auto-save** | `autoSaveId` 属性自动将面板尺寸持久化到 localStorage |

---

## 3. 当前状态 vs 目标状态

### 3.1 差异矩阵

| 维度 | 当前 Neeko | 目标 Dock 布局 |
|------|-----------|---------------|
| 工具栏数量 | 1 个（左侧 ActivityBar） | 2 个（左 + 右 DockBar） |
| 停靠区数量 | 2 个（PanelArea + RightPanel） | 3 个（left / right / bottom），均支持 Tab 堆叠 |
| 底部区 | 无 | 底部 DockZone（终端输出 / 构建日志） |
| Resize 实现 | 4 套独立实现 | 1 套统一（react-resizable-panels） |
| 面板拖拽换位 | 不支持 | 支持 Drag-to-re-dock |
| Pin 状态 | binary on/off | 3 态：固定 / Auto-hide / 关闭 |
| 布局持久化 | 部分（仅 panelWidth） | 完整自动持久化（autoSaveId） |
| 可访问性 | resize 无键盘支持 | 内置键盘支持 + ARIA |

### 3.2 当前 resize 实现清单（4 套）

| 位置 | 实现文件 | 替换方式 |
|------|----------|----------|
| 左侧面板宽度 | `sidebar-context.tsx` (panelWidth state + onPanelResizeStart) | `ResizablePanel` |
| 右侧面板宽度 | `AppLayout.tsx` (rightPanelWidth state + handleRightPanelResizeStart) | `ResizablePanel` |
| 终端切分比例 | `useSplitLayout.ts` (PaneNode tree + mousemove) | 保留不变（终端内部切分逻辑不同） |
| 通用浮动面板 | `resizable-panel.tsx` (ResizablePanel + useResizableWidth) | shadcn `Sheet` 或嵌入 DockZone |

---

## 4. 技术架构

### 4.1 整体架构

```
App.tsx
└── DockProvider (Context: 面板可见性、激活状态、位置)
    └── DockLayout (布局容器)
        ├── DockBar side="left"              // 48px 固定
        ├── ResizablePanelGroup (horizontal, autoSaveId="neeko-main")
        │   ├── ResizablePanel (left zone,   defaultSize=18%, minSize=12%, maxSize=35%)
        │   │   └── DockZone zoneId="left"   // Tabs: Projects | Files | Skills
        │   ├── ResizableHandle withHandle
        │   ├── ResizablePanel (center,       defaultSize=60%, minSize=30%)
        │   │   └── ResizablePanelGroup (vertical, autoSaveId="neeko-center")
        │   │       ├── ResizablePanel (editor, defaultSize=75%, minSize=40%)
        │   │       │   └── MainContent (现有组件，不变)
        │   │       ├── ResizableHandle withHandle
        │   │       └── ResizablePanel (bottom, defaultSize=25%, minSize=10%, maxSize=50%)
        │   │           └── DockZone zoneId="bottom"  // 底部输出面板
        │   ├── ResizableHandle withHandle
        │   └── ResizablePanel (right zone,  defaultSize=22%, minSize=15%, maxSize=40%)
        │       └── DockZone zoneId="right"  // Tabs: Commit | PR
        └── DockBar side="right"             // 48px 固定（可选）
```

### 4.2 核心依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `react-resizable-panels` | ^2.x / ^3.x (via shadcn) | 可调整大小的面板组 |
| `@radix-ui/react-tabs` | ^1.x (via shadcn) | Tabs 组件 |
| `@radix-ui/react-tooltip` | ^2.x (via shadcn) | 工具提示 |
| `@radix-ui/react-context-menu` | ^2.x (via shadcn) | 右键菜单 |
| `@radix-ui/react-scroll-area` | ^1.x (via shadcn) | 自定义滚动条 |
| `lucide-react` | ^1.7.0（已有） | 图标 |
| `class-variance-authority` | ^0.7.1（已有） | 样式变体 |
| `clsx` | ^2.1.1（已有） | 类名合并 |

### 4.3 状态管理（Zustand Store）

```typescript
// stores/dockStore.ts — 仅管理面板可见性/激活/位置
// 注意：不管理 resize 状态，由 react-resizable-panels 内部处理

interface DockZoneState {
  id: string;                          // "left" | "right" | "bottom"
  panels: string[];                    // 有序 panelId 列表
  activePanelId: string | null;        // 当前激活面板
  expanded: boolean;                   // 是否展开
  pinned: boolean;                     // true=固定，false=Auto-hide
}

interface DockBarItem {
  panelId: string;
  side: "left" | "right";
  order: number;
  visible: boolean;
}

interface DockStore {
  zones: Record<string, DockZoneState>;
  barItems: DockBarItem[];

  // Actions
  togglePanel: (panelId: string) => void;
  activatePanel: (zoneId: string, panelId: string) => void;
  movePanel: (panelId: string, targetZoneId: string, index?: number) => void;
  closePanel: (panelId: string) => void;
  pinZone: (zoneId: string, pinned: boolean) => void;
  expandZone: (zoneId: string) => void;
  collapseZone: (zoneId: string) => void;
  restoreDefaultLayout: () => void;
}
```

### 4.4 面板注册表

```typescript
// registries/dockPanels.ts
// 集中定义所有可停靠面板的元数据

export interface DockPanelDef {
  id: string;
  title: string;
  icon: string;                    // lucide icon name
  defaultZone: "left" | "right" | "bottom";
  defaultOrder: number;
  component: React.LazyComponent;  // lazy loaded
  minPanelSize?: number;           // px, 用于撑开时最小尺寸
}

export const dockPanelRegistry: Record<string, DockPanelDef> = {
  projects: {
    id: "projects", title: "Projects", icon: "FolderOpen",
    defaultZone: "left", defaultOrder: 0,
    component: lazy(() => import("@/components/panels/ProjectsPanel")),
    minPanelSize: 200,
  },
  files: {
    id: "files", title: "Files", icon: "FileText",
    defaultZone: "left", defaultOrder: 1,
    component: lazy(() => import("@/components/panels/FilesPanel")),
    minPanelSize: 180,
  },
  skills: {
    id: "skills", title: "Skills", icon: "Wrench",
    defaultZone: "left", defaultOrder: 2,
    component: lazy(() => import("@/components/skills/SkillsPanel")),
    minPanelSize: 200,
  },
  gitCommit: {
    id: "gitCommit", title: "Commit", icon: "GitCommitHorizontal",
    defaultZone: "right", defaultOrder: 0,
    component: lazy(() => import("@/components/project/GitCommitPanel")),
    minPanelSize: 260,
  },
  // 后续扩展
  // pullRequests: { ... },
  // terminalOutput: { ... },
};
```

---

## 5. shadcn/ui 组件映射

### 5.1 组件安装清单

```bash
npx shadcn@latest add resizable    # ResizablePanelGroup / ResizablePanel / ResizableHandle
npx shadcn@latest add tabs         # DockZone 内面板 Tab 切换
npx shadcn@latest add tooltip      # 图标栏按钮 tooltip
npx shadcn@latest add badge        # 通知计数
npx shadcn@latest add context-menu # Tab 右键菜单
npx shadcn@latest add scroll-area  # 面板内容滚动
npx shadcn@latest add separator    # 分割线装饰
npx shadcn@latest add dropdown-menu # 面板设置菜单
npx shadcn@latest add button       # 统一按钮样式（可选）
```

### 5.2 组件用途映射

| shadcn 组件 | 用于 | 替代现有 |
|-------------|------|----------|
| `ResizablePanelGroup` + `ResizablePanel` + `ResizableHandle` | 整体 Dock 布局容器 | `sidebar-context` resize + `AppLayout` resize + `resizable-panel.tsx` |
| `Tabs` | DockZone 内面板 Tab 切换 | 自定义 tab button |
| `Tooltip` | DockBar 图标按钮悬停提示 | 原生 `title` 属性 |
| `Badge` | DockBar 图标上的通知数字 | 无（新增） |
| `ContextMenu` | Tab 右键菜单（关闭/移动/切分） | 无（新增） |
| `ScrollArea` | 面板内容自定义滚动条 | 原生 `overflow-y-auto` |
| `Separator` | 停靠区之间的分割线装饰 | 无（新增） |
| `DropdownMenu` | 面板设置菜单 / 布局管理 | 部分自定义 dropdown |

### 5.3 与现有 Radix 包装的共存

项目 `src/components/ui/` 下已有 8 个 Radix 包装组件。shadcn 组件与其根目录重叠（如 `button.tsx`, `dialog.tsx` 等）。

**共存策略**：
1. shadcn 组件安装到独立目录 `src/components/shadcn/`（通过 `components.json` 配置 `aliases.components`）
2. 逐步将现有 `src/components/ui/` 迁移到 shadcn 等效组件
3. 最终目标：删除 `src/components/ui/` 下的自定义包装，统一使用 shadcn

---

## 6. 组件详细设计

### 6.1 DockLayout（布局容器）

**职责**：统筹 5 栏布局，管理嵌套 ResizablePanelGroup

**通信方式**：仅接收 **0 个 props**。所有状态通过 `useDockStore()` 和 `dockPanelRegistry` 获取。

**约束落实**：
- 不传递 props 给子组件用于状态同步，子组件自行订阅 store
- 文件预计 ~80 行（纯布局组合，无业务逻辑）

**关键属性**：
- `autoSaveId="neeko-main-layout"` → 自动持久化主水平布局
- `autoSaveId="neeko-center-layout"` → 自动持久化编辑器/底部垂直布局
- `defaultSize` / `minSize` / `maxSize` 使用百分比

### 6.2 DockBar（工具窗口栏）

**职责**：48px 固定宽度的垂直图标栏

**Props**：仅接收 `side: "left" | "right"` 一个 prop。

**约束落实**：
- `DockBar` 内部通过 `useDockStore()` 获取 `barItems`，不依赖父组件传入
- `DockBarButton` 通过 `useDockStore` 获取面板状态，接收 `panelId` 一个 prop
- 文件预计 ~60 行

```tsx
// DockBar — 极简 props
<DockBar side="left" />   // 唯一 prop

// DockBarButton 内部通过 store 获取：isActive, notificationCount, onClick
```

**DockBarButton 组成**：
- `<Tooltip>` 包裹的图标按钮（shadcn）
- `<Badge>` 可选通知计数（shadcn）
- 激活态左边框指示器（保留现有白色竖线）

### 6.3 DockZone（停靠区）

**职责**：容纳多个面板，通过 Tabs 切换

**Props**：仅接收 `zoneId: string` 一个 prop。

**约束落实**：
- 通过 `useDockStore(s => s.zones[zoneId])` 获取当前 zone 状态
- 通过 `dockPanelRegistry` 查找面板元数据和组件
- 拆分策略：`DockZone (~100行)` → `DockZoneTabs (~80行)` → `DockZoneTabTrigger (~50行)`
- 每个子组件文件均不超过 200 行

**核心组成**：
```
DockZone (zoneId)                  // ~100 行，组合编排
├── DockZoneTabs (zoneId)          // ~80 行，Tabs 管理
│   ├── DockZoneTabTrigger × N     // ~50 行，单个 Tab 按钮 + ContextMenu
│   └── ZoneActions                // 可选：Pin/Close/Dropdown
└── DockZoneContent (zoneId)       // ~60 行，TabsContent + ScrollArea
    └── <LazyPanelComponent />     // 懒加载的实际面板
```

**关键行为**：
1. 当 zones[zoneId].expanded = false 且 pinned = false 时 → Auto-hide 态（仅显示极窄 Tab 条）
2. 当 zones[zoneId].expanded = true 时 → 展开态（显示完整面板内容）
3. Tab 右键 → ContextMenu（关闭 / 移动到其他 Zone / 切分）

### 6.4 数据流（Store 驱动，非 Props 穿透）

```
用户点击 DockBarButton
  → DockBarButton 内部直接调用 useDockStore().togglePanel(panelId)
    （不通过父组件回调传递）
  → dockStore.togglePanel(panelId):
    → 找到 panel 的 defaultZone
    → 如果 panel 已在该 zone → remove / collapseZone
    → 否则 → add / activatePanel / expandZone
  → 各组件通过 Zustand selector 自动重渲染：
    → DockZone 检测到 zones[zoneId].panels 变化 → Tabs 列表更新
    → DockBarButton 检测到 isActive 变化 → 激活态切换
  → 无 props 传递链路，无中间组件重渲染
```

---

## 7. 实现路线图

### Phase 1 — shadcn 基础组件安装（0.5 天）

| 步骤 | 操作 |
|------|------|
| 1.1 | `npx shadcn@latest init` 初始化，配置 `components.json` |
| 1.2 | `npx shadcn add resizable tabs tooltip badge context-menu scroll-area separator dropdown-menu button` |
| 1.3 | 验证 shadcn 组件 CSS 变量与现有 Tailwind 变量不冲突 |
| 1.4 | 搭建 `src/components/shadcn/` 目录结构 |

**验收**：`npx shadcn` 命令正常；所有安装的组件可正常导入渲染

### Phase 2 — 核心 Dock 框架（1 天）

| 步骤 | 操作 |
|------|------|
| 2.1 | 创建 `stores/dockStore.ts`（Zustand store） |
| 2.2 | 创建 `registries/dockPanels.ts`（面板注册表） |
| 2.3 | 创建 `components/dock/DockLayout.tsx`（布局容器） |
| 2.4 | 创建 `components/dock/DockBar.tsx` + `DockBarButton.tsx` |
| 2.5 | 创建 `components/dock/DockZone.tsx`（含 Tabs + Content） |
| 2.6 | 创建 `components/dock/DockZoneTabs.tsx`（集成 shadcn Tabs + ContextMenu） |
| 2.7 | 创建 `components/dock/index.ts`（统一导出） |

**验收**：Dock 骨架可渲染，resize 拖拽正常工作

### Phase 3 — 布局迁移（1 天）

| 步骤 | 操作 |
|------|------|
| 3.1 | 重构 `AppLayout.tsx`，用 `DockLayout` 替换现有 flex 布局 |
| 3.2 | 将 `ActivityBar` 内容迁移到 `DockBar side="left"` |
| 3.3 | 将 `PanelArea` 内容迁移到 `DockZone zoneId="left"` |
| 3.4 | 将 `RightPanel` 逻辑迁移到 `DockZone zoneId="right"` |
| 3.5 | 保持 `MainContent` 作为 EditorArea 内部结构不变 |
| 3.6 | 验证 settings full-page 模式、skills 模式等特殊布局状态 |

**验收**：所有现有面板功能正常；布局 resizing 行为一致

### Phase 4 — 高级功能（1 天）

| 步骤 | 操作 |
|------|------|
| 4.1 | 实现 Drag-to-re-dock（拖拽 Tab 到目标 Zone） |
| 4.2 | 实现 Auto-hide/Pin 切换动画 |
| 4.3 | 实现布局持久化（dockStore 状态同步到 localStorage） |
| 4.4 | 添加底部 DockZone（初始可留空，后续接入终端输出面板） |
| 4.5 | 添加快捷键导航（Ctrl+1~5 切换面板） |

**验收**：面板可拖拽换位；Pin 态正常工作；刷新页面布局恢复

### Phase 5 — 清理与测试（0.5 天）

| 步骤 | 操作 |
|------|------|
| 5.1 | 移除旧的 `resizable-panel.tsx` |
| 5.2 | 移除 `sidebar-context.tsx` 中的 resize 逻辑（保留 activePanel toggle） |
| 5.3 | 移除 `AppLayout.tsx` 中的 rightPanelWidth 状态 |
| 5.4 | 全量回归测试（`pnpm lint` + `pnpm type-check` + `pnpm test:run`） |
| 5.5 | 手动测试所有布局交互 |

---

## 8. 迁移影响分析

### 8.1 需修改的文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/App.tsx` | 微小调整 | DockProvider 包裹 |
| `src/components/layout/AppLayout.tsx` | **重写** | 替换为 DockLayout |
| `src/components/layout/ActivityBar.tsx` | **重构** | 迁移到 DockBar |
| `src/components/layout/PanelArea.tsx` | **移除** | 功能并入 DockZone |
| `src/components/layout/RightPanel.tsx` | **移除** | 功能并入 DockZone |
| `src/contexts/sidebar-context.tsx` | **简化** | 移除 resize 逻辑，保留 toggle |
| `src/components/ui/sidebar.tsx` | **可能移除** | variant="panel" resize 不再需要 |
| `src/components/ui/resizable-panel.tsx` | **移除** | 被 shadcn Sheet 或 DockZone 替代 |
| `src/hooks/useAppContainer.ts` | 微小调整 | DockProvider 注入 |

### 8.2 Props 简化：Before vs After

**当前 AppLayout 的 props（共 11 个）**：

```typescript
// 现状 — 大量 props 穿透
interface AppLayoutProps {
  onAddProject: () => void;
  onAddWsl: () => void;
  onAddRemote: () => void;
  onOpenSettings: () => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
  onConfigChange: (next: AppConfig) => void;
  showGitPanel?: boolean;
  onCloseGitPanel?: () => void;
}
```

**重构后 DockLayout 的 props（0 个）**：

```tsx
// 目标 — 零 props，全部通过 store
<DockLayout />   // 无 props，内部订阅 dockStore
```

- `onAddProject` / `onAddWsl` / `onAddRemote` → 移入 `dockStore` 或保留在调用方直接使用
- `settingsOpen` / `onCloseSettings` / `onConfigChange` → 移入独立的 `SettingsProvider` Context
- `showGitPanel` / `onCloseGitPanel` → 移入 `dockStore.togglePanel("gitCommit")`

### 8.2 不受影响的文件

| 区域 | 说明 |
|------|------|
| `MainContent.tsx` | 编辑器区内部完全不变 |
| `SplitLayout.tsx` + `useSplitLayout.ts` | 终端内部切分保持不变 |
| 所有 `panels/` 目录组件 | 仅入口方式改变，组件内部不变 |
| 所有 `skills/` 目录组件 | 同上 |
| 所有 `terminal/` 目录组件 | 同上 |
| Rust 后端 | 无影响 |

---

## 9. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| shadcn init 与现有 Tailwind 配置冲突 | 中 | 高 | 先在干净分支验证；保留 CSS 变量映射回退方案 |
| `react-resizable-panels` 在 Tauri WebView 中渲染异常 | 低 | 高 | Phase 2 立即在 `pnpm tauri dev` 中验证 |
| 嵌套 ResizablePanelGroup 拖拽冲突 | 中 | 中 | 水平和垂直方向隔离；设置最小尺寸防止面板消失 |
| settings full-page / skills 特殊模式布局错乱 | 中 | 中 | 保留这些模式的条件渲染逻辑 |
| TypeScript 类型与 shadcn 组件不完全兼容 | 低 | 低 | `pnpm type-check` 持续验证 |

---

## 10. 验收标准

| # | 标准 | 验证方式 |
|---|------|----------|
| AC1 | 左侧 DockBar 图标按钮可 toggle 对应面板的展开/折叠 | 手动操作 |
| AC2 | 左侧 DockZone 支持 Projects / Files / Skills 三面板 Tab 切换 | 手动操作 |
| AC3 | 右侧 DockZone 支持 Commit / PR 等面板 Tab 切换 | 手动操作 |
| AC4 | 所有停靠区之间的 ResizableHandle 可拖拽 resize | 手动拖拽 |
| AC5 | resize 支持 min/max 约束，面板不会被压缩到 0 | 拖拽到极限 |
| AC6 | 面板尺寸刷新页面后恢复（autoSaveId 持久化） | 刷新浏览器 |
| AC7 | Pin/Unpin 切换正常工作 | 手动切换 |
| AC8 | 所有现有面板内容（目录树、文件列表、Git 面板等）功能正常 | 功能测试 |
| AC9 | settings 全页模式正常渲染 | 打开 Settings |
| AC10 | skills 模式正常渲染 | 切换到 Skills 面板 |
| AC11 | `pnpm lint` 通过 | 命令行 |
| AC12 | `pnpm type-check` 通过 | 命令行 |
| AC13 | `pnpm test:run` 通过 | 命令行 |

---

## 11. 附录：shadcn Resizable API 速查

```tsx
// 基本用法
<ResizablePanelGroup
  direction="horizontal"           // "horizontal" | "vertical"
  autoSaveId="unique-id"          // 自动持久化 key
  onLayout={(sizes) => {}}        // 布局变化回调
>
  <ResizablePanel
    defaultSize={20}              // 默认百分比
    minSize={15}                   // 最小百分比
    maxSize={40}                   // 最大百分比
    collapsible={true}            // 是否可折叠
    collapsedSize={4}             // 折叠后的百分比
    onCollapse={() => {}}
    onExpand={() => {}}
  >
    Content
  </ResizablePanel>

  <ResizableHandle
    withHandle                     // 显示可视手柄
    // 或自定义子元素作为手柄
  />

  <ResizablePanel defaultSize={80}>
    Content
  </ResizablePanel>
</ResizablePanelGroup>
```
