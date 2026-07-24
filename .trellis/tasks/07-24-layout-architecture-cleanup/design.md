# Design — Layout Architecture Cleanup

## Problem

`src/layout/` 中 7 个文件直接 import `@/features/`，违反了项目 spec 规定的单向依赖流：

```
shared/ ← features/ ← app/
layout/ ← app/              (layout 只被 app 组装，不 import features)
```

ESLint `import/no-restricted-paths` 规则已配置但代码早于规则引入，尚未清零。

## Current Violation Map

### A 级 — 协调逻辑渗入布局骨架

| 文件 | feature imports | 本质 |
|---|---|---|
| `MainContent.tsx` | agent, project, editor, connection, file | app 层协调器：project 路由、agent 检测、remote auth 组装 |
| `AppLayout.tsx` | settings, skill | app 层路由：settings/skills 视图切换 |
| `dock-layout/DockPanelWrappers.tsx` | file, editor, project, git, skill, conversation, agent | 胶水层：feature store/context 注入到 panel |

### B 级 — 布局组件持有 feature 状态

| 文件 | feature imports | 问题 |
|---|---|---|
| `TitleBar.tsx` | task/TaskRunButton, debug | 功能按钮硬编码在 titlebar |
| `dock-layout/DockBarButton.tsx` | project/store | 读取 activeProjectId 构造 tabKey |
| `OpenIdeButton.tsx` | session/api, project/store | 本质是业务按钮 |

### C 级 — 注册表声明式引用（可保留）

`dockPanels.ts` 中 5 处 `lazy(() => import('@/features/...'))` 是声明式注册。

## Target Architecture

```
ui/          ← layout/     (纯骨架)
shared/      ← features/   (独立业务域)
features/    ← app/        (协调层)
layout/      ← app/        (app 组装骨架并填充 slot)
```

### Layout 保留的纯骨架文件

- `DockLayout.tsx` — dock 框架容器
- `DockBar.tsx` — 工具栏（改为接受 buttons prop）
- `DockZone.tsx` / `DockZoneTabs.tsx` — panel 区域渲染
- `useDragToReDock.ts` — 拖拽 hook
- `TitleBar.tsx` — 标题栏（改为接受 actions prop）
- `ActivityBar.tsx` — 左栏图标导航
- `WindowControls.tsx` — 窗口控制按钮
- `PanelArea.tsx` / `RightPanel.tsx` — 旧布局（可能废弃）
- `useFullscreen.ts` — 全屏检测
- `AddProjectMenu.tsx` — 添加项目菜单
- `dockPanels.ts` — 注册表（例外：允许 lazy import features）

### 迁入 app/ 的文件

| 原路径 | 新路径 | 原因 |
|---|---|---|
| `layout/MainContent.tsx` | `app/components/ProjectWorkspace.tsx` | app 层协调器 |
| `layout/dock-layout/DockPanelWrappers.tsx` | `app/dock/DockPanelWrappers.tsx` | feature 胶水 |
| `layout/OpenIdeButton.tsx` | `app/components/OpenIdeButton.tsx` | 业务按钮 |
| `layout/dock-layout/DockBarButton.tsx` | `app/components/DockBarButton.tsx` | 依赖 feature store |

## Key Design Decisions

### D1: AppLayout 改为 children prop

AppLayout 删除所有 feature import，改为接受 `children?: React.ReactNode`。
App.tsx 根据 `useAppViewStore` 决定传入什么 children：
- `appView === 'settings'` → `<SettingsView />`
- `skillsActive` → `<ProjectWorkspace />` + `<SkillContent />`（hidden 切换保持原有行为）
- 其他 → `<ProjectWorkspace />`

### D2: TitleBar 改为 actions slot

```tsx
// TitleBar.tsx: 接受 actions prop，删除 TaskRunButton/DebugRunButton 直接引用
interface TitleBarProps { actions?: React.ReactNode; }
```

```tsx
// App.tsx: 注入
<TitleBar actions={<><TaskRunButton /><DebugRunButton /></>} />
```

### D3: DockBar 改为 buttons prop

DockBar 接受 `buttons: React.ReactNode[]`，App.tsx 构建 DockBarButton 列表传入。
DockBarButton 本身移到 app/，可自由使用 feature store。

### D4: dockPanels.ts 保留在 layout/

该文件是面板注册表，定义 id、title、icon 等元数据 + lazy component 绑定。
元数据部分属于 layout 关注点，lazy import 部分属于声明式绑定。
ESLint 规则中为该文件单独例外。

### D5: ESLint 边界规则增强

在 `.eslintrc.cjs` 的两个 override block 中：
- 保持现有 zone：`{ target: './src/layout', from: ['./src/features', './src/app'] }`
- 为 `dockPanels.ts` 添加例外
- 添加 `message` 字段

## Risk: shared/ → layout/ 循环

`shared/store/dockStore.ts` import `layout/dockPanels.ts`（shared → layout）。
这在迁移前已存在，不属于本次范围。正确方向应是 app 层注入 registry 到 dockStore，
或 dockStore 接受 registry 参数。未来单独处理。
