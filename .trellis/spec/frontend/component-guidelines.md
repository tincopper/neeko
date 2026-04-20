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

`App.tsx` 是唯一**不**用 `React.memo` 包裹的组件——它作为状态协调器存在。

---

## Props 约定

### 规则

1. **始终使用 `interface`** 定义 Props（不使用 `type` 别名）
2. **Props 接口定义在组件同一文件中**，紧邻组件上方
3. **回调 Props** 使用 `onXxx` 命名：`onSelectAgent`、`onToggleAddMenu`、`onAddProject`
4. **可选 Props** 使用 `?`，通过解构赋默认值
5. **领域模型类型** 从 `types.ts` 导入（`Project`、`AgentConfig` 等）

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
