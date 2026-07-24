# 目录结构

> 前端代码在本项目中的组织方式。

---

## 概述

Neeko 是一个基于 **Tauri v2** 的桌面应用，前端使用 **React 18 + TypeScript + Vite 7** 构建。它是一个单视图应用，视图切换通过状态管理实现。包管理器为 **pnpm**。

---

## 目录布局

```
src/
├── app/                     # 应用壳层与组合层（组装 layout slots + 协调 features）
│   ├── App.tsx              # 根组件：TitleBar.actions / AppLayout children&buttons / 视图路由
│   ├── AppProviders.tsx     # Provider 组合层
│   ├── AppModals.tsx        # 模态框组合层
│   ├── components/          # app 级协调组件（可 import features）
│   │   ├── ProjectWorkspace.tsx  # 项目工作区协调器（原 layout/MainContent）
│   │   ├── DockBarButton.tsx     # Dock 栏按钮（读 feature store）
│   │   ├── OpenIdeButton.tsx     # IDE 打开按钮
│   │   └── SplashScreen.tsx
│   ├── dock/                # Dock 面板胶水 + UI 注册表
│   │   ├── registry.ts      # title/icon/lazy component 绑定（合并 DOCK_PANEL_META）
│   │   └── DockPanelWrappers.tsx # feature store/context → panel 注入
│   └── hooks/               # app 级共享 hooks（useAppShell 等）
│
├── main.tsx                 # 入口文件（ReactDOM.createRoot）
├── vite-env.d.ts            # 资源模块声明
│
├── features/                # Feature 域（每个域独立状态、组件、逻辑、IPC 封装）
│   ├── agent/               # Agent 管理域
│   │   ├── api/agentApi.ts  # Agent 相关 IPC 封装（invoke）
│   │   ├── hooks/           # Agent 相关 hooks
│   │   ├── components/      # Agent 相关组件
│   │   └── types.ts         # Agent 类型定义
│   ├── browser/
│   │   └── api/browserApi.ts
│   ├── editor/              # 编辑器域（文件 Tab / split layout / FileActionsContext）
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── FileActionsContext.tsx
│   │   └── types.ts
│   ├── connection/
│   │   ├── api/connectionApi.ts
│   │   ├── components/          # Remote/WSL 连接对话框（ConnectionProjectCard, RemoteDialog, WSLDialog 等）
│   │   ├── contexts/           # RemoteContext.tsx, WslContext.tsx（legacy, prefer ConnectionProjectContext）
│   │   ├── hooks/              # 连接 hooks（useRemoteAuthActions 等）
│   │   ├── store.ts
│   │   └── types.ts
│   ├── file/
│   │   ├── api/fileApi.ts
│   │   └── types.ts          # FileTransportKind, FileContent, FileNode
│   ├── git/
│   │   ├── api/gitApi.ts     # Git + 文件操作 IPC（含 GitTransportKind, FileTransportKind）
│   │   ├── components/diff/  # Diff 组件
│   │   ├── components/gitlog/
│   │   └── types.ts          # FileDiffStats, GitInfo, CommitEntry 等
│   ├── project/
│   │   ├── api/projectApi.ts
│   │   ├── hooks/               # 含 use-active-project/ 子目录（kebab-case）
│   │   ├── components/          # 含 ProjectsPanel、SectionHeader、ContextMenu 等
│   │   ├── context.tsx
│   │   ├── store.ts
│   │   └── types.ts
│   ├── session/
│   │   ├── api/sessionApi.ts
│   │   ├── hooks/
│   │   └── types.ts
│   ├── settings/
│   │   ├── api/settingsApi.ts
│   │   ├── components/
│   │   ├── hooks/
│   │   └── types.ts
│   ├── skill/
│   │   ├── api/skillApi.ts
│   │   └── types.ts
│   ├── task/
│   │   ├── api/taskApi.ts
│   │   └── types.ts
│   ├── terminal/
│   │   ├── api/terminalApi.ts
│   │   ├── components/
│   │   ├── strategies/
│   │   └── types.ts
│   └── theme/
│       └── api/themeApi.ts
│
├── layout/                  # 窗口边框 & 导航（纯骨架：不 import features/ 或 app/）
│   ├── ActivityBar.tsx      # 左侧活动栏（projects/files/skills 切换）
│   ├── AppLayout.tsx        # 纯骨架：children + leftButtons/rightButtons + isSettingsOpen
│   ├── TitleBar.tsx         # 标题栏（actions slot，由 app 注入业务按钮）
│   ├── PanelArea.tsx
│   ├── RightPanel.tsx
│   ├── WindowControls.tsx
│   ├── AddProjectMenu.tsx
│   ├── useFullscreen.ts
│   ├── DockRegistryContext.tsx  # 注册表 Context（由 app 注入，layout 只消费）
│   ├── dock-layout/         # Dock 布局系统（纯框架，useDockRegistry）
│   │   ├── index.ts
│   │   ├── DockBar.tsx      # 工具栏（buttons: ReactNode[] prop）
│   │   ├── DockLayout.tsx
│   │   ├── DockZone.tsx
│   │   ├── DockZoneTabs.tsx
│   │   └── useDragToReDock.ts
│   ├── hooks/               # Layout hooks（useAppLayoutProps 等）
│   └── index.ts
│
├── ui/                      # UI 基元组件（shadcn-styled）
│   ├── index.ts
│   ├── ContextMenu.tsx
│   ├── DropdownMenu.tsx
│   ├── ResizablePanel.tsx
│   ├── ScrollArea.tsx
│   └── ToggleGroup.tsx
│
├── shared/                  # 共享层（contexts/hooks/store/utils/types）
│   ├── contexts/            # 基础 Context（全局配置、侧栏、技能）
│   │   ├── index.ts
│   │   ├── AppContext.tsx
│   │   ├── SidebarContext.tsx
│   │   └── skill-context.tsx
│   ├── components/          # 共享组件
│   │   ├── AppToast.tsx
│   │   ├── BranchDropdownContent.tsx
│   │   └── icons/
│   ├── hooks/               # 共享 hooks（含 __tests__）
│   ├── store/               # 共享状态（appStore、dockStore）
│   ├── dock/                # Dock 纯数据 meta（无 React / 无 features）
│   │   ├── types.ts         # DockPanelMeta
│   │   ├── panelMeta.ts     # DOCK_PANEL_META
│   │   └── index.ts
│   ├── types/               # 共享类型（project、session、connection、file 等，无 adapter.ts）
│   └── utils/               # 纯工具函数
│       ├── agents.ts
│       ├── codemirror.ts
│       ├── distros.ts
│       ├── fileIcons.ts
│       ├── idePresets.ts
│       ├── platform.ts
│       └── terminal.ts
│
├── styles/                  # 样式入口（Tailwind CSS v4）
│   └── tailwind.css         # @theme + @layer components
│
├── lib/                     # 库包装
├── types.ts                 # 共享 TypeScript 接口（顶层兼容导出）
│
├── testing/                 # 测试配置
│   ├── setup.ts             # Vitest 全局配置
│   └── factories.ts         # 测试数据工厂
│
└── assets/                  # 静态资源（图片）
    ├── agents/              # Agent 图标（PNG/SVG）
    ├── distros/             # Linux 发行版图标（SVG）
    ├── icons/               # 文件类型图标（SVG）
    └── ides/                # IDE 图标（SVG/PNG）
```

Tauri 后端（Rust）：
```
src-tauri/
├── src/
│   ├── main.rs              # 入口文件
│   ├── lib.rs               # Tauri 命令 & 初始化
│   └── ...                  # 后端模块
├── Cargo.toml
└── tauri.conf.json          # Tauri 配置
```

---

## 模块组织

### 目录变更 2026-04-21 / 2026-05-31 / 2026-07-24

2026-04-21：`ProjectStateContext` 已移除，文件视图状态进入 `useAppStore`。

2026-05-31 (Phase B)：重构目录布局、文件命名合规化、去除 `src/components/` 中间层。

2026-07-24（layout-architecture-cleanup）：将 `layout/` 中对 `@/features/` 的协调逻辑迁入 `app/`，`layout/` 降为纯骨架 + slot。

| 文件 / 目录（旧） | 文件 / 目录（新） | 说明 |
|------|------|------|
| `layout/MainContent.tsx` | `app/components/ProjectWorkspace.tsx` | app 层项目工作区协调器 |
| `layout/dock-layout/DockPanelWrappers.tsx` | `app/dock/DockPanelWrappers.tsx` | feature store/context 注入到 panel |
| `layout/OpenIdeButton.tsx` | `app/components/OpenIdeButton.tsx` | 业务按钮 |
| `layout/dock-layout/DockBarButton.tsx` | `app/components/DockBarButton.tsx` | 依赖 feature store 的 Dock 按钮 |
| `AppLayout` 直接 import settings/skill | `AppLayout` 仅 `children` + slots | 视图路由上移到 `app/App.tsx` |
| `TitleBar` 硬编码 Task/Debug 按钮 | `TitleBar.actions` slot | 由 `app/App.tsx` 注入 |
| `DockBar` 内部构造按钮 | `DockBar.buttons` prop | 由 `app/App.tsx` 注入 `DockBarButton` 列表 |

依赖方向（目标）：

```
ui/          ← layout/     (纯骨架：DockLayout、TitleBar slot、ActivityBar)
shared/      ← features/   (各自独立业务域)
features/    ← app/        (协调层：ProjectWorkspace、DockPanelWrappers、slot 填充)
layout/      ← app/        (app 组装骨架并填充 slot)
```

2026-07-24（dock-registry-architecture）：进一步拆分注册表，消除 shared↔layout 环与 layout lazy 例外：
- `shared/dock/panelMeta.ts` — store 用纯 meta
- `app/dock/registry.ts` — UI + lazy 绑定
- `layout/DockRegistryContext` — app 注入，layout 只消费
- 删除 `layout/dockPanels.ts` 与对应 ESLint 例外

| 文件 / 目录（旧） | 文件 / 目录（新） | 说明 |
|------|------|------|
| `components/layout/` | `layout/` | layout 提升到顶层 |
| `components/DockLayout/` | `layout/dock-layout/` | Docker 布局 → kebab-case dir |
| `context/app-context.tsx` | `shared/contexts/AppContext.tsx` | Context 统一到 shared |
| `context/sidebar-context.tsx` | `shared/contexts/SidebarContext.tsx` | PascalCase 文件名 |
| `hooks/useFileView.ts` | `features/editor/hooks/useFileView.ts` | Hook 下沉到 editor 域 |
| `contexts/file-actions-context.tsx` | `features/editor/FileActionsContext.tsx` | PascalCase 文件名 |
| `stores/appStore.ts` | `shared/store/appStore.ts` | 统一到 shared |
| `utils/` | `shared/utils/` | 统一到 shared |
| `components/panels/` | 分散到 `features/*/components/` | 按 feature 域分布 |
| `components/connections/` | `features/connection/components/` | 按 feature 域分布 |
| `components/diff/` | `features/git/components/diff/` | 按 feature 域分布 |
| `components/terminal/` | `features/terminal/components/` | 按 feature 域分布 |
| `components/settings/` | `features/settings/components/` | 按 feature 域分布 |

### 组件子目录按领域/功能组织

| 目录 | 领域 | 包含内容 |
|------|------|---------|
| `layout/` | 窗口边框（纯骨架） | ActivityBar、AppLayout、TitleBar、PanelArea、DockRegistryContext |
| `layout/dock-layout/` | Dock 布局框架 | DockBar、DockLayout、DockZone、拖拽 Hook 等 |
| `app/components/` | app 协调组件 | ProjectWorkspace、DockBarButton、OpenIdeButton、SplashScreen |
| `app/dock/` | Dock UI 注册表 + 胶水 | registry、DockPanelWrappers |
| `shared/dock/` | Dock 纯 meta | DOCK_PANEL_META（供 dockStore） |
| `ui/` | UI 基元 | ContextMenu、DropdownMenu、ResizablePanel、ScrollArea、ToggleGroup |
| `features/project/components/` | 项目管理 | 项目卡片壳层 + Git 区段 + 拖拽/菜单 Hook |
| `features/terminal/components/` | 终端视图 | React 终端组件 + 缓存/工厂/命令 API |
| `features/connection/components/` | 远程连接 | SSH/WSL 对话框 |
| `features/git/components/diff/` | Diff | 算法、语言高亮、数据加载与渲染分层 |
| `features/git/components/gitlog/` | Git 日志 | CommitGraph、CommitList、GitLogPanel |
| `features/settings/components/` | 设置 | 按面板拆分的设置 UI |

### 桶文件导出

每个组件子目录都有一个 `index.ts` 桶文件，提供整洁的导入方式：

```tsx
// ui/index.ts
export { default as ContextMenu } from "./ContextMenu";
export { default as DropdownMenu } from "./DropdownMenu";
export { default as ResizablePanel } from "./ResizablePanel";
```

Feature 桶文件还会导出工具函数和缓存：

```tsx
// features/terminal/components/index.ts
export { default as TerminalView } from "./TerminalView";
export { terminalCache, terminalCacheKey } from "./terminalCache";
export { createTerminalForProject } from "./terminalFactory";
```

### 新代码应该放在哪里

| 新代码类型 | 位置 |
|-----------|------|
| 新的领域组件组 | `features/<domain>/components/` 或 `app/<domain>/components/` 或 `ui/`（UI 基元） |
| 独立组件 | `ui/<Name>.tsx` 或 `layout/<Name>.tsx` |
| 自定义 Hook | `features/<domain>/hooks/` 或 `app/<domain>/hooks/` 或 `shared/hooks/` |
| 新的全局基础状态分发 | `shared/contexts/<domain>-context.tsx` |
| 新的领域状态分发 | `features/<domain>/contexts/` 或 `app/<domain>/<Name>Context.tsx` |
| 纯工具函数 | `shared/utils/<name>.ts` |
| IPC 封装（必需） | `features/<domain>/api/<domain>Api.ts`，每个 feature 域一个；或 `app/<domain>/api/<domain>Api.ts`（如 editor 域） |
| 共享类型 | `types.ts`，或 `features/<domain>/types.ts`，或 `app/<domain>/types.ts` |
| Feature 域入口 | `features/<domain>/` 域目录结构参考 features/agent/ |
| App 协调组件 | `app/components/<Name>.tsx` / `app/dock/`；业务域仍在 `features/<domain>/` |
| 测试配置 | `testing/setup.ts`, `testing/factories.ts` |
| 静态资源 | `assets/<category>` |

> **IPC 封装规则**：所有 `invoke` 调用必须放在 `features/<domain>/api/` 或 `app/<domain>/api/` 目录下的文件中。禁止在其他位置直接 import `@tauri-apps/api/core`。ESLint 的 `no-restricted-imports` 规则强制执行此约束。

---

## 场景：Context 与 Store 文件布局契约

### 1. Scope / Trigger

- Trigger：跨组件共享状态字段过多时，Context 容易膨胀并引入重复读取路径。
- Scope：`src/context/`、`src/contexts/`、`src/store/`、`src/hooks/`。

### 2. Signatures

```text
src/context/         基础 UI 上下文（App / Sidebar / Skill）
src/contexts/        领域动作上下文（ProjectActions / FileActions / Wsl / Remote / Editor）
src/store/           共享状态单源（useAppStore）
src/hooks/           动作封装、IPC 调用、状态写入协调
```

### 3. Contracts

1. `context/` 只放稳定基础上下文，避免混入领域状态快照。  
2. `contexts/` 放领域动作上下文，字段应以副作用函数为主。  
3. 共享状态字段新增时优先进入 `store/appStore.ts`，消费者通过 selector 读取。  
4. `AppProviders.tsx` 只负责 Provider 组装，禁止承担业务计算。

### 4. Validation & Error Matrix

| 检查项 | 规则 | 失败信号 |
|--------|------|---------|
| 新增共享字段位置 | 优先写 `store/` | 在 Context 中出现同名状态快照 |
| 新增 Context 文件位置 | 放 `contexts/` 或 `context/` 对应层 | 混放导致 import 路径混乱 |
| Provider 组合深度 | 新增前评估是否可复用现有 Provider | `AppProviders.tsx` 持续膨胀 |

### 5. Good/Base/Bad Cases

- Good：新增文件域动作时创建 `file-actions-context.tsx`，状态仍放 store。
- Base：新增只在单页使用的 UI 状态，保持组件本地 `useState`。
- Bad：在 `contexts/*` 新增大块状态字段并与 store 并存。

### 6. Tests Required

- 静态检查：`rg "useProjectStateContext|project-state-context"` 结果应为空。  
- 类型检查：`npx tsc --noEmit`。  
- 回归测试：`pnpm test:run`。

### 7. Wrong vs Correct

#### Wrong

```tsx
// contexts 中继续承载状态快照
interface ProjectStateContextValue {
  fileTabs: FileTab[];
  activeFileTabId: string | null;
}
```

#### Correct

```tsx
// contexts 只承载动作；状态由 store 读取
interface FileActionsContextValue {
  onFileSave(content: string): Promise<boolean>;
}
const tabs = useAppStore((s) => s.fileTabs);
```

---

## 命名约定

| 项目 | 约定 | 示例 |
|------|------|------|
| 组件文件 | PascalCase | `TitleBar.tsx`、`AgentIcon.tsx` |
| Hook 文件 | camelCase 带 `use` 前缀 | `useAppConfig.ts`、`useToast.ts` |
| 工具文件 | camelCase | `platform.ts`、`fileIcons.ts` |
| 桶文件 | `index.ts` 或 `index.tsx` | `layout/index.ts` |
| 资源目录 | 小写复数 | `agents/`、`distros/`、`icons/` |
| CSS 类名 | BEM-lite，kebab-case | `titlebar-left`、`app-toast--error` |

---

## 示例

- 纯布局骨架：`src/layout/` —— AppLayout/TitleBar/DockLayout 只暴露 slots，不 import features
- app 协调层：`src/app/components/ProjectWorkspace.tsx` + `src/app/dock/DockPanelWrappers.tsx`
- Hook 模式：`src/shared/hooks/` 与 `src/app/hooks/useAppShell.ts`
- 工具模式：`src/shared/utils/platform.ts`
