# 组件指南

> 本项目中组件的构建方式。

---

## 概述

组件使用 **React 18** + **TypeScript** 构建。大多数组件用 `React.memo` 包裹以优化性能。样式使用**单一全局 CSS 文件**（`styles.css`）——不使用 CSS Modules、Tailwind 或 CSS-in-JS。

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

### 全局 CSS + 自定义属性

所有样式在 `src/styles.css` 中，使用 CSS 自定义属性进行主题化：

```css
:root {
  --bg-primary: #282c34;
  --text-primary: #abb2bf;
  --accent: #61afef;
  --font-size: 14px;
  /* One Dark Pro 配色 */
}
```

### 类名命名：BEM-lite，kebab-case

```css
.titlebar { }
.titlebar-left { }
.titlebar-right { }
.app-toast--error { }
.gh-badge-modified { }
.tb-icon-btn { }
```

### 动态样式

仅在运行时需要计算的值使用内联 `style` 属性：

```tsx
<div style={{ display: isVisible ? "block" : "none" }}>
<img width={size} height={size} style={{ display: "inline-block", verticalAlign: "middle" }} />
```

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

除 `App.tsx` 外的所有组件都应使用 `React.memo` 导出，以避免在 Props 下传架构中不必要的重渲染。

### 3. 在 JSX 中内联 SVG 图标

项目中将小型 SVG 图标直接嵌入 JSX（参见 `TitleBar.tsx`）。对于简单图标这是可接受的。对于可复用的图标，考虑提取为独立组件或资源文件。
