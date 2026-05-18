# 组件指南

> 本项目中组件的构建方式。

---

## 概述

组件使用 **React 18** + **TypeScript** 构建。大多数组件用 `React.memo` 包裹以优化性能。样式使用 **Tailwind CSS v4**（`src/tailwind.css`）——通过 `@theme` 映射 CSS 变量到 Tailwind 主题色。

---

## 组件结构

### 标准组件文件布局

```tsx
// 1. 导入
import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { SomeType } from "../types";

// 2. Props 接口（在同一文件中）
interface MyComponentProps {
  title: string;
  onAction: (id: string) => void;
  isActive?: boolean;
}

// 3. 组件定义
const MyComponent: React.FC<MyComponentProps> = ({ title, onAction, isActive = false }) => {
  // hooks、事件处理、渲染
  return <div className="my-component">...</div>;
};

// 4. 使用 memo 包裹并默认导出
export default React.memo(MyComponent);
```

### 两种可接受的组件声明模式

**模式 A —— `React.FC` + 箭头函数**（适用于小/中型组件，首选）：

```tsx
// src/components/layout/AgentIcon.tsx
interface AgentIconProps {
  icon?: string | null;
  size?: number;
  fallback?: string;
}

const AgentIcon: React.FC<AgentIconProps> = ({ icon, size = 16, fallback = "🤖" }) => {
  // ...
};

export default React.memo(AgentIcon);
```

**模式 B —— 具名函数**（用于较大的组件）：

```tsx
// src/components/layout/TitleBar.tsx
interface TitleBarProps {
  activeProject: Project | null;
  onOpenSettings: () => void;
  // ...
}

function TitleBar({ activeProject, onOpenSettings, ... }: TitleBarProps) {
  // ...
}

export default React.memo(TitleBar);
```

### 根组件 App（例外）

`App.tsx` 是唯一**不**用 `React.memo` 包裹的组件。当前职责是壳层编排，状态协调逻辑位于 `useAppContainer`。

---

## Props 约定

### 规则

1. **始终使用 `interface`** 定义 Props（不使用 `type` 别名）
2. **Props 接口定义在组件同一文件中**，紧邻组件上方
3. **回调 Props** 使用 `onXxx` 命名：`onSelectAgent`、`onToggleAddMenu`、`onAddProject`
4. **可选 Props** 使用 `?`，通过解构赋默认值
5. **领域模型类型** 从 `types.ts` 导入（`Project`、`AgentConfig` 等）

### 大型组件 Props 分组约定

当 Props 数量接近两位数时，优先按职责分组，避免继续扩张扁平接口：

```tsx
interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  actions: ProjectItemActions;
  viewConfig?: ProjectItemViewConfig;
}
```

分组建议：

1. `actions`：事件回调与命令式操作
2. `state`：仅当子组件需要外部状态快照时使用
3. `viewConfig`：样式、图标、可选 UI 配置

### 示例

```tsx
interface ProjectItemProps {
  project: Project;                           // 从 types.ts 导入
  isActive: boolean;                          // 组件特有的 prop
  onSelect: (id: string) => void;
  onRemove?: (id: string) => void;            // 可选回调
  collapsed?: boolean;                        // 可选，带默认值
}

const ProjectItem: React.FC<ProjectItemProps> = ({
  project,
  isActive,
  onSelect,
  onRemove,
  collapsed = false,
}) => { ... };
```

---

## 样式模式

### Tailwind CSS v4 + CSS 自定义属性

样式使用 **Tailwind CSS v4**，入口文件为 `src/tailwind.css`。CSS 自定义属性通过 `@theme` 块映射到 Tailwind 主题色：

```css
@theme {
  --color-primary: var(--bg-primary);
  --color-accent: var(--accent);
  --color-text: var(--text-primary);
}
```

### 实用类优先

组件内直接使用 Tailwind 实用类，不写自定义 CSS：

```tsx
<div className="flex items-center gap-2 px-3 py-1">
  <span className="text-sm text-accent">{name}</span>
  <button className="p-1 hover:bg-white/10 rounded">
    <Icon />
  </button>
</div>
```

### 动态类合并：`cn()`

需要条件组合类名时使用 `cn()`（`clsx` + `tailwind-merge`）：

```tsx
import { cn } from "../utils/cn";

<div className={cn(
  "flex items-center gap-1 px-2 py-0.5 rounded",
  isActive && "bg-accent/10",
  isDragging && "opacity-50 ring-2 ring-accent",
)} />
```

### 动态样式

仅在运行时需要计算的值仍使用内联 `style` 属性：

```tsx
<div style={{ display: isVisible ? "block" : "none" }}>
<img width={size} height={size} style={{ display: "inline-block", verticalAlign: "middle" }} />
```

### 复杂 CSS

无法用实用类表达的样式（`:has()` 选择器、伪元素 `::after`、动画、滚动条样式、xterm 终端覆盖等）保留在 `src/tailwind.css` 的 `@layer components` 中。

### Tauri 拖拽区域

可拖拽窗口的区域使用 `data-tauri-drag-region`：

```tsx
<div className="titlebar" data-tauri-drag-region>
```

---

## 纯表现包装器模式（DraggableProjectItem）

对于需要将交互逻辑与视觉表现分离的场景，使用纯表现包装器组件：

```tsx
// src/components/project/DraggableProjectItem.tsx
interface DraggableProjectItemProps {
  dragId: string;                          // data-drag-id 标识
  isDragging: boolean;                     // 从 useProjectItemDrag 获取
  dragOffset: DragOffset;                  // 从 useProjectItemDrag 获取
  dropIndicator: DropIndicator | null;     // 从 useProjectItemDrag 获取
  isActive?: boolean;
  onPointerDown: (e: React.PointerEvent) => void;  // 透传 hook handlers
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  children: React.ReactNode;               // 被包装的实际内容
  className?: string;
}
```

**设计原则**：
1. **零业务逻辑**：组件不包含任何状态管理或业务逻辑，仅接收 props 并渲染
2. **样式组合**：通过 `cn()` 组合 Tailwind 类，处理条件样式
3. **动态样式**：使用内联 `style` 处理运行时计算值（`transform: translate()`）
4. **指示器叠加**：放置指示器（蓝色边框 + 发光）作为绝对定位元素渲染在 children 前后
5. **`React.memo` 包裹**：避免在 Props 与 Context 混合分发架构中的不必要重渲染

**使用方式**：

```tsx
// 在 ProjectItem 或 ConnectionProjectCard 中
const { isDragging, dragOffset, dropIndicator, ...handlers } = useProjectItemDrag({
  projectId: project.id,
  onDragEnd,
});

return (
  <DraggableProjectItem
    dragId={project.id}
    isDragging={isDragging}
    dragOffset={dragOffset}
    dropIndicator={dropIndicator}
    isActive={isActive}
    {...handlers}
  >
    {/* 实际项目内容 */}
    <ProjectItemHeader ... />
    <ProjectGitSection ... />
  </DraggableProjectItem>
);
```

**视觉行为**：
- 拖拽中：`opacity-50 scale-[1.02] rotate-[0.5deg] shadow-lg z-50`
- 光标跟随：`transform: translate(${dragOffset.x}px, ${dragOffset.y}px)`
- 放置指示器：蓝色顶部/底部边框 + 发光效果
- 非拖拽时：`cursor-grab`

详见 [交互模式指南](./interaction-patterns.md)。

---

## 展示组件 + 数据 adapter 跨域复用模式

当多个领域（local / WSL / SSH）需要同款视觉，但底层数据形态与 IPC 命令不同时，把视觉抽成纯展示组件，由各域调用方做 adapter（数据 normalize + 回调注入）。

**实例**：`ProjectGroup` + `SessionRow` + `SessionChips`（`src/components/project/`）三端共用，`ProjectItem`（local，`src/components/project/ProjectItem.tsx`）与 `ConnectionProjectCard`（wsl/remote，`src/components/connections/ConnectionProjectCard.tsx`）各自做 adapter。

**纯展示组件契约**：
1. 不直接 `invoke` Tauri 命令、不读写 store
2. 接收的 props 只有数据（值）+ 回调（函数）
3. 回调按语义命名（`onAddWorktree` 而非 `onPlusClick`）
4. `React.memo` 包装

**adapter 调用方契约**：
1. 数据 normalize：把领域模型映射成展示组件期望的 props（如把 `git_info.worktrees` 映射成 `SessionRow` 数组）
2. 回调注入：把领域 IPC 包装成展示组件期望的回调（如 `onAddWorktree = () => onOpenDialog("new-worktree", ...)`）
3. store 读写在 adapter 层完成（如 `aheadBehind` 用 `aheadBehindKey()` 查表）

**反模式**：让纯展示组件 import `invoke` 或 `useAppStore`——会立刻丧失三端复用能力，把 wsl/remote 路径推回写另一份并行实现。

**好坏对照**：

```tsx
// Wrong —— 展示组件直接读 store，硬编码 local key 形态
const SessionRow = ({ project }) => {
  const ahead = useAppStore((s) => s.aheadBehind[project.id]?.ahead);
  // wsl/remote 永远 lookup 失败
};
```

```tsx
// Correct —— 展示组件只接收数据
interface SessionRowProps {
  ahead?: number;
  changes?: { add: number; del: number };
}

// adapter（local）
<SessionRow
  ahead={
    useAppStore((s) => s.aheadBehind[aheadBehindKey("local", id, id)])?.ahead
  }
/>;
// adapter（wsl）
<SessionRow
  ahead={
    useAppStore((s) => s.aheadBehind[aheadBehindKey("wsl", distro, id)])?.ahead
  }
/>;
```

---

## 视觉层级：Section header vs Project header

侧边栏中两类容器有显著的语义差异，对应不同的视觉强度。

| 角色 | 强度 | 实例 | 关键样式 |
|------|------|------|----------|
| **Project header** | 强 | 单个项目卡（含 avatar + 名 + count + hover IDE/Git/Trash 槽） | `text-[var(--font-size)] font-semibold`、28×28 头像、行高 ≈ 40px |
| **Section header** | 弱 | WSL/SSH 外层 distro/server 分组 | `text-[10.5px] font-bold tracking-[0.16em] uppercase text-text-muted`、无头像、行高 ≈ 22px、hover 才显示 +/Trash |

**取舍准则**：
- 该层只是"分类容器、无独立操作"——用 section header
- 该层是"用户主要交互目标，含独立 CRUD"——用 project header
- 同屏避免出现两层强 header（视觉抢中心、识别成本高）

**实例参考**：
- Section header：`src/components/connections/RemoteItems.tsx` 的 `WSLItem` / `RemoteItem` 顶部
- Project header：`src/components/project/ProjectGroup.tsx`

---

## 无障碍

- 装饰性图片使用 `alt=""`
- 图标按钮使用 `title` 属性提供悬停提示
- 加载中状态使用 `disabled` 禁用按钮

---

## 常见错误

### 1. 重复定义 `types.ts` 中已有的接口

**错误做法** —— `TitleBar.tsx` 局部重新声明自己的 `Project` 和 `AgentConfig` 接口：

```tsx
// 不要这样做：重新声明 types.ts 中已有的类型
interface Project {
  id: string;
  name: string;
  // ... 真实类型的部分拷贝
}
```

**正确做法** —— 从 `types.ts` 导入：

```tsx
import { Project, AgentConfig } from "../../types";
```

### 2. 忘记使用 `React.memo`

除 `App.tsx` 外的所有组件都应使用 `React.memo` 导出，以避免在 Props 与 Context 混合分发架构中的不必要重渲染。

### 3. 在 JSX 中内联 SVG 图标

项目中将小型 SVG 图标直接嵌入 JSX（参见 `TitleBar.tsx`）。对于简单图标这是可接受的。对于可复用的图标，考虑提取为独立组件或资源文件。

### 4. 字体大小使用硬编码 Tailwind 类

**错误做法** —— 在侧边栏、文件树、Tab 等 UI 元素中使用 `text-xs`、`text-sm` 等固定类：

```tsx
// 不要这样做：硬编码字体大小，无法响应用户设置
<span className="text-sm font-semibold">{project.name}</span>
<div className="text-xs cursor-pointer">{fileName}</div>
```

**正确做法** —— 使用 CSS 变量，确保元素跟随用户在 Settings 中的字体大小设置：

```tsx
// UI 元素（侧边栏、文件树、Tab 标签等）→ --font-size（由 appearanceFontSize 驱动）
<span className="text-[var(--font-size)] font-semibold">{project.name}</span>

// 终端区域元素（终端 Tab、Agent 按钮等）→ --terminal-font-size（由 terminalFontSize 驱动）
<span style={{ fontSize: "var(--terminal-font-size)" }}>{tabTitle}</span>
```

---

## CSS 字体大小变量规范

项目使用三套独立的字体大小配置，均由用户在 Settings → Appearance/Editor/Terminal 中调整：

| CSS 变量 | 默认值 | 驱动字段 | 适用范围 |
|----------|--------|---------|---------|
| `--font-size` | `12px` | `config.appearanceFontSize` | 侧边栏项目名、文件树、Tab 标签、TitleBar 等所有 UI 文本 |
| `--terminal-font-size` | `14px` | `config.terminalFontSize` | 终端 Tab、Agent 按钮列表、终端相关 UI |
| （直接传 prop）| `14px` | `config.editorFontSize` | CodeMirror 编辑器，通过 `editorFontSize` prop 传入 `FileViewer` |

**使用原则**：
- Tailwind 类语法（推荐用于静态文本）：`className="text-[var(--font-size)]"`
- 内联 style（用于动态或按钮元素）：`style={{ fontSize: "var(--terminal-font-size)" }}`
- 新增任何侧边栏/文件树/Tab 组件时，**禁止**使用 `text-xs`、`text-sm`、`text-base` 等固定 Tailwind 字体类
