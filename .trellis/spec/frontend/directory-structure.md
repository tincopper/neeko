# 目录结构

> 前端代码在本项目中的组织方式。

---

## 概述

Neeko 是一个基于 **Tauri v2** 的桌面应用，前端使用 **React 18 + TypeScript + Vite 7** 构建。它是一个单视图应用（没有路由）——视图切换通过 `App.tsx` 中的状态管理实现。包管理器为 **pnpm**。

---

## 目录布局

```
src/
├── App.tsx                  # 根组件 & 状态协调器
├── main.tsx                 # 入口文件（ReactDOM.createRoot）
├── tailwind.css             # Tailwind CSS v4 入口 + @theme + @layer components
├── types.ts                 # 共享 TypeScript 接口
├── vite-env.d.ts            # 资源模块声明
│
├── components/              # UI 组件（按领域组织）
│   ├── DiffView.tsx         # 独立的顶层组件
│   ├── MainContent.tsx
│   ├── SettingsPanel.tsx
│   ├── connections/         # SSH/WSL 连接对话框
│   │   ├── index.ts         # 桶文件导出
│   │   ├── RemoteAuthDialog.tsx
│   │   ├── RemoteDialog.tsx
│   │   ├── RemoteItems.tsx
│   │   └── WSLDialog.tsx
│   ├── layout/              # 窗口边框 & 导航
│   │   ├── index.ts
│   │   ├── AgentIcon.tsx
│   │   ├── AgentSelector.tsx
│   │   ├── TitleBar.tsx
│   │   └── WindowControls.tsx
│   ├── project/             # 项目侧边栏 & Git UI
│   │   ├── index.tsx
│   │   ├── AddProjectModal.tsx
│   │   ├── FileTree.tsx
│   │   ├── GitDialog.tsx
│   │   ├── ProjectItem.tsx
│   │   └── ProjectSidebar.tsx
│   └── terminal/            # 终端视图（xterm.js）
│       ├── index.ts
│       ├── TerminalView.tsx
│       ├── SideTerminalView.tsx
│       ├── WorktreeTerminalView.tsx
│       ├── WSLTerminalView.tsx
│       └── RemoteTerminalView.tsx
│
├── hooks/                   # 自定义 React Hooks（扁平目录）
│   ├── useAppConfig.ts
│   ├── useKeyboardShortcuts.ts
│   ├── useLocalProjects.ts
│   ├── useRemoteProjects.ts
│   ├── useSideTerminalResize.ts
│   ├── useToast.ts
│   ├── useWorktreeState.ts
│   └── useWslProjects.ts
│
├── utils/                   # 纯工具函数（扁平目录）
│   ├── agents.ts            # Agent 图标查找表
│   ├── distros.ts           # WSL 发行版图标映射
│   ├── fileIcons.ts         # 文件扩展名到图标的映射
│   ├── idePresets.ts        # IDE 预设定义
│   ├── platform.ts          # 平台检测常量
│   └── terminal.ts          # 终端字体构建器
│
│   ├── adapters/            # 项目适配器（统一 local/wsl/remote）
│   │   ├── ProjectAdapter.ts
│   │   ├── LocalProjectAdapter.ts
│   │   ├── WslProjectAdapter.ts
│   │   └── RemoteProjectAdapter.ts
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

### 组件子目录按领域/功能组织

| 目录 | 领域 | 包含内容 |
|------|------|---------|
| `components/layout/` | 窗口边框 | 标题栏、窗口控制、Agent 选择器 |
| `components/project/` | 项目管理 | 侧边栏、文件树、Git 对话框 |
| `components/terminal/` | 终端视图 | 所有 xterm.js 终端变体 |
| `components/connections/` | 远程连接 | SSH/WSL 对话框 |

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
export { default as TerminalView, terminalCache, launchAgentInTerminal, ... } from "./TerminalView";
```

### 新代码应该放在哪里

| 新代码类型 | 位置 |
|-----------|------|
| 新的领域组件组 | `components/<domain>/` 配合 `index.ts` 桶文件 |
| 独立组件 | `components/<Name>.tsx`（顶层） |
| 自定义 Hook | `hooks/use<Name>.ts` |
| 纯工具函数 | `utils/<name>.ts` |
| IPC 封装（可选） | `services/<name>.ts`（当前项目直接调用 invoke，暂无此目录） |
| 项目类型适配器 | `adapters/<Name>Adapter.ts` |
| 共享类型 | `types.ts` |
| 测试配置 | `testing/setup.ts`, `testing/factories.ts` |
| 静态资源 | `assets/<category>/` |

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
