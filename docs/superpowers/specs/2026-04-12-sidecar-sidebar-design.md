# Sidecar Sidebar 重构设计

**日期**: 2026-04-12  
**任务**: ui-primitives-refactor（feat/ui-primitives-refactor）  
**作者**: tincopper  

---

## 背景

Neeko 当前的左侧导航由两个独立模块组成：
- `ActivityBar`（48px 图标列）：管理导航项激活状态
- `PanelArea`（可拖拽内容列）：渲染当前激活面板内容

两者的状态分散在两个 context：
- `sidebar-context.tsx`：名义上管 ProjectSidebar resize，实际 `SidebarRoot` 组件已废弃不用；`App.tsx` 仍用 `SidebarProvider` 包裹副终端宽度，但副终端宽度已由 `useSideTerminalResize` hook 独立管理，Provider 包装是冗余的
- `activity-bar-context.tsx`：管理 activePanel + panelWidth + panel resize

目标：参照 shadcn 的 sidecar sidebar 模式，将两列布局统一为 `Sidebar` 原语组件，同时合并 context 层，消除状态分散和重复 resize 逻辑。

---

## 目标

1. **功能不变**：ActivityBar 的 toggle 行为、PanelArea 的 resize 行为保持一致
2. **原语统一**：ActivityBar 和 PanelArea 的 JSX 用 `ui/sidebar.tsx` 原语重写
3. **Context 合并**：废弃两个旧 context，新建统一 `SidebarContext`
4. **CSS 风格对齐**：sidecar 双列结构（图标窄列 + 内容宽列）的边框/布局方式与 shadcn 一致

**不在本次范围**：
- 不改变 ActivityBar 的导航项（Projects / Git / Settings）
- 不改变 PanelArea 内部的 ProjectsPanel / GitPanel 内容
- 不引入 shadcn 的 `collapsible` 折叠动画
- 不改变 AppLayout 对外的 props 接口

---

## Context 层设计

### 废弃
- `src/context/activity-bar-context.tsx` — 职责迁移到重写后的 `sidebar-context.tsx`

### 清理
- `App.tsx` 中删除 `<SidebarProvider>` 包装（冗余，副终端宽度已由 `useSideTerminalResize` hook 直接管理，无需 context）
- `src/components/ui/sidebar.tsx` 中删除 `SidebarRoot`（已废弃，无调用方）

### 重写 `src/context/sidebar-context.tsx`

```tsx
export type ActivityPanel = "projects" | "git";

interface SidebarContextValue {
  // 面板状态
  activePanel: ActivityPanel | null;
  togglePanel: (panel: ActivityPanel) => void;
  // 面板宽度（右列）
  panelWidth: number;
  onPanelResizeStart: (e: React.MouseEvent) => void;
}

interface SidebarProviderProps {
  initialPanel?: ActivityPanel;
  initialPanelWidth?: number;
  onPanelWidthPersist?: (w: number) => void;
  children: React.ReactNode;
}

export function SidebarProvider(props: SidebarProviderProps): JSX.Element;
export function useSidebar(): SidebarContextValue;
```

**常量**：`PANEL_MIN = 180`，`PANEL_MAX = 480`，`PANEL_DEFAULT = 280`

**行为**：
- `togglePanel(panel)`：同 panel 再点 = 收起（`activePanel` 置 null）
- `onPanelResizeStart`：pointer events 拖拽，拖拽时更新 `--panel-width` CSS 变量，松手后调用 `onPanelWidthPersist`
- Provider 初始化时同步 `--panel-width` CSS 变量

### 更新 `src/context/index.ts`

```ts
export { AppProvider, useAppContext } from "./app-context";
export { SidebarProvider, useSidebar, type ActivityPanel } from "./sidebar-context";
```

---

## UI 原语扩展

### `src/components/ui/sidebar.tsx` 新增原语

#### `Sidebar`（布局容器）

替代现有 `SidebarRoot`，支持 `variant` 区分左列和右列：

```tsx
interface SidebarProps extends React.ComponentProps<"div"> {
  variant?: "icon" | "panel";  // icon = 48px 固定宽；panel = var(--panel-width) 可变
}
```

- `variant="icon"`：`w-12 shrink-0 flex flex-col bg-bg-secondary border-r border-border`
- `variant="panel"`：`relative flex flex-col shrink-0 bg-bg-secondary border-r border-border overflow-hidden`，宽度由 CSS 变量 `--panel-width` 控制，内置 resize 手柄
- 默认（无 variant）：`flex flex-col`，用于通用场景

**resize 手柄**：仅 `variant="panel"` 时渲染，从 `useSidebar()` 取 `onPanelResizeStart`

#### `SidebarHeader`

```tsx
// 顶部区域
// className: "border-b border-border"
```

#### `SidebarMenu`

```tsx
// <ul> 容器
// className: "flex flex-col gap-0.5 w-full"
```

#### `SidebarMenuItem`

```tsx
// <li> 包装
// className: "list-none"
```

#### `SidebarMenuButton`

```tsx
interface SidebarMenuButtonProps extends React.ComponentProps<"button"> {
  isActive?: boolean;   // 激活态：左侧蓝色竖条 + text-text-primary
  tooltip?: string;     // title 属性（图标模式 hover 提示）
}
```

激活态样式（与现有 ActivityBar 视觉完全一致）：
```
isActive: "text-text-primary before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:bg-accent-blue before:rounded-r"
非激活: "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
基础: "relative w-full h-12 flex items-center justify-center transition-colors duration-150 focus:outline-none"
```

### 更新 `src/components/ui/index.ts`

新增导出：
```ts
export { Sidebar, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "./sidebar";
```

保留现有导出（`SidebarRoot`/`SidebarContent`/`SidebarFooter` 暂时保留，后续统一清理）。

---

## 组件重写

### `ActivityBar.tsx`

**重写前结构**：手写 `<div>` + 手写 `<button>` className

**重写后结构**：
```tsx
<Sidebar variant="icon">
  <SidebarContent>
    <SidebarMenu>
      {navItems.map(item => (
        <SidebarMenuItem key={item.id}>
          <SidebarMenuButton
            isActive={activePanel === item.id}
            tooltip={item.title}
            onClick={() => togglePanel(item.id)}
          >
            {item.icon}
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  </SidebarContent>
  <SidebarFooter>
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton tooltip="Settings" onClick={onOpenSettings}>
          <SettingsIcon />
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  </SidebarFooter>
</Sidebar>
```

hook 调用：`useActivityBar()` → `useSidebar()`

### `PanelArea.tsx`

**重写前结构**：手写 `<div>` + 内联 style width + 手写 resize 手柄

**重写后结构**：
```tsx
// activePanel === null 时直接 return null（逻辑不变）
<Sidebar variant="panel" style={{ width: panelWidth }}>
  <div className="flex-1 overflow-y-auto overflow-x-hidden">
    {children}
  </div>
  {/* resize 手柄由 Sidebar variant="panel" 内置 */}
</Sidebar>
```

hook 调用：`useActivityBar()` → `useSidebar()`

### `AppLayout.tsx`

只改一行：`useActivityBar()` → `useSidebar()`，`ActivityPanel` type import 改从 `sidebar-context` 取。

### `App.tsx`

两处改动：

**1. Provider 替换**
```tsx
// 前
import { ActivityBarProvider } from "./context/activity-bar-context";
<ActivityBarProvider
  initialPanelWidth={initialSidebarWidth}
  onPanelWidthPersist={session.saveSidebarWidth}
>
  <SidebarProvider initialWidth={sideTerminalWidth} onWidthPersist={setSideTerminalWidth}>
    ...
  </SidebarProvider>
</ActivityBarProvider>

// 后
import { SidebarProvider } from "./context/sidebar-context";
<SidebarProvider
  initialPanelWidth={initialSidebarWidth}
  onPanelWidthPersist={session.saveSidebarWidth}
>
  ...
</SidebarProvider>
// 冗余的 SidebarProvider（副终端宽度）包装直接删除
// sideTerminalWidth 已由 useSideTerminalResize hook 在 App.tsx 层管理，无需 context
```

---

## 受影响文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/context/sidebar-context.tsx` | 重写 | 吸收 activity-bar-context 的全部能力 |
| `src/context/activity-bar-context.tsx` | 删除 | 职责迁移到 sidebar-context |
| `src/context/index.ts` | 更新 | 更新导出，去掉 ActivityBarProvider/useActivityBar |
| `src/components/ui/sidebar.tsx` | 扩展+清理 | 删除废弃 SidebarRoot，新增 5 个原语 |
| `src/components/ui/index.ts` | 更新 | 新增 5 个原语导出，去掉 SidebarRoot |
| `src/components/layout/ActivityBar.tsx` | 重写 | 用原语替代手写 JSX |
| `src/components/layout/PanelArea.tsx` | 重写 | 用原语替代手写 JSX |
| `src/components/layout/AppLayout.tsx` | 小改 | useActivityBar → useSidebar |
| `src/App.tsx` | 小改 | ActivityBarProvider → SidebarProvider；删除冗余 SidebarProvider 包装 |

---

## 验收标准

- [ ] `src/context/activity-bar-context.tsx` 已删除，无残留 import
- [ ] `useSidebar()` 可替代原来的 `useActivityBar()` 和 `useSidebar()` 所有调用点
- [ ] `ActivityBar` 视觉与重构前完全一致（激活态蓝色竖条、hover 高亮、Settings 底部）
- [ ] `PanelArea` resize 拖拽行为与重构前一致（范围 180~480px，松手持久化）
- [ ] `npx tsc --noEmit` 通过（0 errors）
- [ ] `pnpm test` 通过
- [ ] `pnpm build` 通过

---

## 实施顺序

```
Step 1: 重写 sidebar-context.tsx（吸收 ActivityBarContext 能力）
Step 2: 扩展 ui/sidebar.tsx（删除 SidebarRoot，新增 5 个原语）
Step 3: 重写 ActivityBar.tsx（useActivityBar → useSidebar + 原语）
Step 4: 重写 PanelArea.tsx（useActivityBar → useSidebar + 原语）
Step 5: 更新 AppLayout.tsx（useActivityBar → useSidebar）
Step 6: 更新 App.tsx（ActivityBarProvider → SidebarProvider，删除冗余包装）
Step 7: 删除 activity-bar-context.tsx
Step 8: 更新 context/index.ts + ui/index.ts
Step 9: 全量验证（tsc + test + build）
```
