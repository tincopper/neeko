# 目录结构

> 前端代码在本项目中的组织方式。

---

## 概述

Neeko 是一个基于 **Tauri v2** 的桌面应用，前端使用 **React 18 + TypeScript + Vite 7** 构建。它是一个单视图应用，视图切换通过状态管理实现。包管理器为 **pnpm**。

---

## 目录布局

```
src/
├── App.tsx                  # 根组件壳层（TitleBar + AppProviders + AppLayout + AppModals）
├── AppProviders.tsx         # Provider 组合层
├── AppModals.tsx            # 模态框组合层
├── main.tsx                 # 入口文件（ReactDOM.createRoot）
├── tailwind.css             # Tailwind CSS v4 入口 + @theme + @layer components
├── types.ts                 # 共享 TypeScript 接口
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
│   ├── connection/
│   │   └── api/connectionApi.ts
│   ├── editor/
│   │   └── hooks/useFileView.ts  # 使用 fileApi
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
│   │   ├── hooks/
│   │   ├── components/
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
├── components/              # UI 组件（按领域组织）
│   ├── DiffView.tsx         # 兼容入口，转发到 components/diff
│   ├── MainContent.tsx
│   ├── SettingsPanel.tsx    # 兼容入口，转发到 components/settings
│   ├── connections/         # SSH/WSL 连接对话框
│   │   ├── index.ts         # 桶文件导出
│   │   ├── ProjectBody.tsx
│   │   ├── ProjectItemCard.tsx
│   │   ├── WSLProjectCard.tsx
│   │   ├── RemoteProjectCard.tsx
│   │   ├── RemoteAuthDialog.tsx
│   │   ├── RemoteDialog.tsx
│   │   ├── RemoteItems.tsx
│   │   └── WSLDialog.tsx
│   ├── diff/                # Diff 领域拆分
│   │   ├── DiffView.tsx
│   │   ├── UnifiedDiffTable.tsx
│   │   ├── SplitDiffTable.tsx
│   │   ├── useDiffData.ts
│   │   ├── diffAlgorithm.ts
│   │   ├── highlight.ts
│   │   └── index.ts
│   ├── layout/              # 窗口边框 & 导航
│   │   ├── index.ts
│   │   ├── ActivityBar.tsx  # 左侧活动栏（projects/files/skills 切换）
│   │   ├── AppLayout.tsx    # 顶层布局编排（ActivityBar + PanelArea + MainContent）
│   │   ├── AgentIcon.tsx
│   │   ├── AgentSelector.tsx
│   │   ├── TitleBar.tsx
│   │   └── WindowControls.tsx
│   ├── panels/              # 侧栏面板内容（按活动栏选项切换）
│   │   ├── FilesPanel.tsx   # 文件树面板（files 活动）
│   │   ├── FileViewer.tsx   # 文件编辑器（CodeMirror，多 Tab）
│   │   └── ProjectsPanel.tsx
│   ├── project/             # 项目侧边栏 & Git UI
│   │   ├── index.ts
│   │   ├── AddProjectModal.tsx
│   │   ├── FileTree.tsx
│   │   ├── GitDialog.tsx
│   │   ├── ProjectItem.tsx
│   │   ├── ProjectItemHeader.tsx
│   │   ├── ProjectGitSection.tsx
│   │   ├── useProjectItemDrag.ts
│   │   ├── useProjectItemMenu.ts
│   │   └── ProjectSidebar.tsx
│   ├── settings/            # 设置面板拆分
│   │   ├── SettingsPanel.tsx
│   │   ├── AppearancePanel.tsx
│   │   ├── EditorPanel.tsx
│   │   ├── TerminalPanel.tsx
│   │   ├── AgentsPanel.tsx
│   │   ├── IdePanel.tsx
│   │   ├── GitPanel.tsx
│   │   └── index.ts
│   └── terminal/            # 终端视图（xterm.js）
│       ├── index.ts
│       ├── TerminalView.tsx
│       ├── terminalCache.ts
│       ├── terminalFactory.ts
│       ├── terminalCommands.ts
│       ├── terminalTypes.ts
│       ├── WorktreeTerminalView.tsx
│       ├── WSLTerminalView.tsx
│       └── RemoteTerminalView.tsx
│
├── hooks/                   # 自定义 React Hooks（扁平目录）
│   ├── useAppContainer.ts   # App 容器层，聚合各领域 Hook 与回调
│   ├── useAppConfig.ts
│   ├── useFileView.ts       # 文件面板：多 Tab 状态管理（openFile/closeTab/saveFile）
│   ├── useKeyboardShortcuts.ts
│   ├── useLocalProjects.ts
│   ├── useRemoteProjects.ts
│   ├── useSideTerminalResize.ts
│   ├── useToast.ts
│   ├── useWorktreeState.ts
│   └── useWslProjects.ts
│
├── context/                 # 基础 Context（全局配置、侧栏、技能）
│   ├── app-context.tsx
│   ├── sidebar-context.tsx
│   ├── skill-context.tsx
│   └── index.ts
│
├── contexts/                # 领域动作 Context（project/file/wsl/remote/editor）
│   ├── project-actions-context.tsx
│   ├── file-actions-context.tsx
│   ├── wsl-context.tsx
│   ├── remote-context.tsx
│   ├── editor-context.tsx
│   └── index.ts
│
├── utils/                   # 纯工具函数（扁平目录）
│   ├── agents.ts            # Agent 图标查找表
│   ├── codemirror.ts        # CodeMirror 配置（语言加载、主题、字体样式扩展）
│   ├── distros.ts           # WSL 发行版图标映射
│   ├── fileIcons.ts         # 文件扩展名到图标的映射
│   ├── idePresets.ts        # IDE 预设定义
│   ├── platform.ts          # 平台检测常量
│   └── terminal.ts          # 终端字体构建器
│
│   └── testing/             # 测试配置
│       ├── setup.ts         # Vitest 全局配置
│       └── factories.ts     # 测试数据工厂
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

### 目录变更 2026-04-21

`ProjectStateContext` 已移除，文件视图状态进入 `useAppStore`。目录职责调整如下：

| 文件 | 角色 |
|------|------|
| `contexts/project-actions-context.tsx` | 项目与 worktree 侧副作用动作 |
| `contexts/file-actions-context.tsx` | 文件树加载、文件保存、Tab 动作 |
| `hooks/useFileView.ts` | 文件域动作与错误处理，状态写入 store |
| `store/appStore.ts` | `project/file/worktree` 状态单源 |

### 组件子目录按领域/功能组织

| 目录 | 领域 | 包含内容 |
|------|------|---------|
| `components/layout/` | 窗口边框 | 标题栏、窗口控制、Activity Bar、全局布局 |
| `components/panels/` | 侧栏面板 | FilesPanel（文件树）、FileViewer（多 Tab 编辑器）、ProjectsPanel |
| `components/project/` | 项目管理 | 项目卡片壳层 + 头部 + Git 区段 + 拖拽/菜单 Hook |
| `components/terminal/` | 终端视图 | React 终端组件 + 缓存/工厂/命令 API |
| `components/connections/` | 远程连接 | SSH/WSL 对话框 |
| `components/diff/` | Diff | 算法、语言高亮、数据加载与渲染分层 |
| `components/settings/` | 设置 | 按面板拆分的设置 UI |

### 桶文件导出

每个组件子目录都有一个 `index.ts` 桶文件，提供整洁的导入方式：

```tsx
// components/layout/index.ts
export { default as TitleBar } from "./TitleBar";
export { default as WindowControls } from "./WindowControls";
export { default as AgentSelector } from "./AgentSelector";
export { default as AgentIcon } from "./AgentIcon";
```

Terminal 桶文件还会导出工具函数和缓存：

```tsx
// components/terminal/index.ts
export { default as TerminalView } from "./TerminalView";
export { terminalCache, terminalCacheKey } from "./terminalCache";
export { createTerminalForProject } from "./terminalFactory";
export { launchAgentInTerminal, switchAgentInTerminal } from "./terminalCommands";
```

### 新代码应该放在哪里

| 新代码类型 | 位置 |
|-----------|------|
| 新的领域组件组 | `components/<domain>/` 配合 `index.ts` 桶文件，或 `features/<domain>/components/` |
| 独立组件 | `components/<Name>.tsx`（顶层） |
| 自定义 Hook | `hooks/use<Name>.ts` 或 `features/<domain>/hooks/` |
| 新的全局基础状态分发 | `context/<domain>-context.tsx` |
| 新的领域状态分发 | `contexts/<domain>-context.tsx` |
| 纯工具函数 | `utils/<name>.ts` |
| IPC 封装（必需） | `features/<domain>/api/<domain>Api.ts`，每个 feature 域一个 |
| 共享类型 | `types.ts`，或 `features/<domain>/types.ts` |
| Feature 域入口 | `features/<domain>/` 域目录结构参考 features/agent/ |
| 测试配置 | `testing/setup.ts`, `testing/factories.ts` |
| 静态资源 | `assets/<category>/` |

> **IPC 封装规则**：所有 `invoke` 调用必须放在 `features/<domain>/api/` 目录下的文件中。禁止在其他位置直接 import `@tauri-apps/api/core`。ESLint 的 `no-restricted-imports` 规则强制执行此约束。

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
| 桶文件 | `index.ts` 或 `index.tsx` | `components/layout/index.ts` |
| 资源目录 | 小写复数 | `agents/`、`distros/`、`icons/` |
| CSS 类名 | BEM-lite，kebab-case | `titlebar-left`、`app-toast--error` |

---

## 示例

- 组织良好的领域模块：`src/components/layout/` —— 4 个相关组件配合桶文件导出
- Hook 模式：`src/hooks/useToast.ts` —— 简洁、专注的 Hook
- 工具模式：`src/utils/platform.ts` —— 简单的常量导出
