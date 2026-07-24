# 质量指南

> 前端开发的代码质量标准。

---

## 概述

项目当前的主要质量门禁是：

1. **ESLint**（`eslint src/`）—— 架构约束 + 代码风格 + 命名规范
2. **TypeScript 类型检查**（`tsc --noEmit`）—— 类型安全
3. **Vitest** 回归测试

CI 在所有三个平台（Windows、macOS、Linux）上运行 `pnpm tsc --noEmit`。本地通过 `pnpm lint` 运行全部质量检查。

### ESLint 配置要点

配置文件：`.eslintrc.cjs`（ESLint 8 格式，支持 `.eslintrc.*` 文件）

核心规则：

| 规则 | 级别 | 用途 |
|------|------|------|
| `import/no-restricted-paths` | error | 禁止跨 feature 引用，强制单向依赖流 |
| `import/no-cycle` | error | 检测循环依赖 |
| `import/order` | warn | import 语句分组排序 |
| `check-file/filename-naming-convention` | warn | `.tsx` 使用 PascalCase，`.ts` 使用 camelCase |
| `check-file/folder-naming-convention` | error | 目录使用 kebab-case（`__tests__` 除外） |
| `no-restricted-imports` | error | 禁止在 `api/` 目录外直接 `import { invoke } from "@tauri-apps/api/core"` |
| `prettier/prettier` | error | 代码格式统一 |

注意：ESLint 10+ 移除了 `.eslintrc.*` 支持，仅支持 flat config。本项目使用 ESLint 8 以兼容插件生态。


### Layout 边界规则（2026-07-24）

`layout/` 是**纯窗口骨架**，不得 import `@/features/*` 或 `@/app/*`。

| 允许 | 禁止 |
|------|------|
| `layout` 内部互引、`@/shared/*`、`@/ui/*`、`@/lib/*` | `import ... from '@/features/...'` |
| 通过 props/slots 接收业务 UI（`children`、`actions`、`buttons`） | 在 layout 内读取 feature store / 调用 feature API |
| `dockPanels.ts` 声明式 `lazy(() => import(...))`（ESLint 例外） | 在 `DockBar`/`TitleBar`/`AppLayout` 硬编码业务按钮 |

ESLint 强制：

```js
// .eslintrc.cjs — import/no-restricted-paths
{
  target: './src/layout',
  from: ['./src/features', './src/app'],
  message:
    'layout/ must not import from features/ or app/. Move coordination logic to src/app/.',
}

// 唯一例外：面板注册表
// files: ['src/layout/dockPanels.ts']
// rules: { 'import/no-restricted-paths': 'off', 'import/no-cycle': 'off' }
```

协调逻辑归属：

| 职责 | 位置 |
|------|------|
| 项目工作区 / agent 检测 / remote auth 组装 | `app/components/ProjectWorkspace.tsx` |
| Dock panel feature 注入 | `app/dock/DockPanelWrappers.tsx` |
| TitleBar / DockBar 业务按钮 | `app/App.tsx` 注入 `actions` / `leftButtons` / `rightButtons` |
| settings / skills 视图切换 | `app/App.tsx` 的 `children` 路由 |

已知遗留（不在 layout 清理范围内）：`shared/store/dockStore.ts` 仍 import `layout/dockPanels`，形成 shared ↔ layout 环；后续应将 registry 注入改为 app 组装。


---

## 禁止模式

### 1. 无理由使用 `any`

避免 `any` —— 使用正确的类型或 `unknown` 配合类型收窄。代码库中现有的 `any` 用法（如 `terminal.agent: any`）属于技术债务，不是应该效仿的示例。

```tsx
// 错误
const data = await invoke<any>("load_session");

// 正确
const data = await invoke<SessionData>("load_session");
```

### 2. 直接操作 DOM（特殊情况除外）

使用 React 状态驱动 UI。直接 DOM 操作仅在以下情况可接受：
- CSS 自定义属性更新（`document.documentElement.style.setProperty`）
- xterm.js 终端集成（设计上需要 DOM 访问）

### 3. 静态值使用内联样式

静态样式使用 CSS 类。仅在真正的动态值时使用内联 `style`：

```tsx
// 错误 —— 静态样式用了内联
<div style={{ padding: "8px", color: "#abb2bf" }}>

// 正确 —— 使用 CSS 类
<div className="my-section">

// 可以 —— 动态值
<div style={{ width: `${calculatedWidth}px` }}>
```

### 4. 从组件内部文件导入

始终通过桶文件 `index.ts` 导入：

```tsx
// 错误
import TitleBar from "@/layout/TitleBar";

// 正确
import { TitleBar } from "@/layout";
```

### 5. 在 API wrapper 目录外直接使用 `invoke`

`invoke` 调用必须封装在 `src/features/<domain>/api/<domain>Api.ts` 中，禁止在其他文件中直接导入 `@tauri-apps/api/core`：

```typescript
// 错误 —— 在 hook 中直接调用 invoke
import { invoke } from "@tauri-apps/api/core";
const projects = await invoke<Project[]>("list_projects");

// 正确 —— 通过 API wrapper
import { listProjects } from "../api/projectApi";
const projects = await listProjects();
```

ESLint 的 `no-restricted-imports` 规则会检测并报 error 拦截违反此约定的导入。

---

## 必需模式

### 1. TypeScript 严格模式合规

项目使用严格 TypeScript（`strict: true`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`）。所有代码必须通过 `tsc --noEmit`。

### 2. 所有非根组件使用 `React.memo`

在 Props 与 Context 混合分发架构中，用 `React.memo` 包裹组件导出以防止不必要的重渲染：

```tsx
export default React.memo(MyComponent);
```

### 3. 所有回调 Props 使用 `useCallback`

任何作为 prop 传递的函数都必须用 `useCallback` 包裹：

```tsx
const handleSelect = useCallback((id: string) => {
  setActiveProjectId(id);
}, []);
```

### 4. Tauri 调用的错误处理

所有 `invoke` 调用都用 try/catch 包裹，并使用 `console.error`：

```tsx
import { saveConfig } from "@/features/settings/api/settingsApi";

try {
  await saveConfig(config);
} catch (e) {
  console.error("[App] Failed to save config:", e);
}
```

日志前缀格式为 `[模块名]`（如 `[App]`、`[Terminal]`）。

---

## 测试要求

使用 **Vitest** + **React Testing Library**。详见[单元测试指南](../unit-test/index.md)。

- 测试文件：`*.test.ts` / `*.test.tsx`，与源文件放在一起
- Hook 测试：`renderHook` + `act` / `waitFor`
- 组件测试：`render` + `screen` 查询
- 在 `src/test/setup.ts` 中全局 mock Tauri API

---

## 代码审查清单

提交代码前，验证以下项目：

- [ ] `pnpm tsc --noEmit` 通过，无错误
- [ ] 没有引入新的无理由 `any` 类型
- [ ] 新组件使用 `React.memo` 导出
- [ ] 作为 Props 传递的回调使用了 `useCallback`
- [ ] Tauri `invoke` 调用有错误处理
- [ ] 领域模型类型从 `types.ts` 导入（没有本地重复声明）
- [ ] 新的组件子目录有桶文件 `index.ts`
- [ ] 没有在 `api/` 目录外直接 import `invoke`（使用对应域的 API wrapper 或 `connectionApi` 再导出）
- [ ] Tauri 事件监听器在 `useEffect` 返回函数中清理
- [ ] 所有 `.tsx` 文件使用 PascalCase，`.ts` 文件使用 camelCase（`check-file/filename-naming-convention`）
- [ ] 目录名使用 kebab-case，`__tests__` 除外（`check-file/folder-naming-convention`）
- [ ] 没有未使用的导入或变量（`noUnusedLocals` 强制执行）

---

## 构建与 CI

### 本地开发

```bash
pnpm dev          # 启动 Vite 开发服务器（端口 1420）
pnpm tauri dev    # 启动完整的 Tauri 开发环境
```

### 质量门禁

```bash
pnpm lint         # 运行全部质量检查：cargo fmt + clippy + eslint + tsc
pnpm type-check   # 仅 TypeScript 类型检查
pnpm lint:fix     # 自动修复 ESLint/prettier 问题（如需要，手动执行 npx eslint --fix）
```

### CI 流水线（`.github/workflows/ci.yml`）

在 push/PR 到 `main` 时运行：
1. `pnpm tsc --noEmit` —— TypeScript 检查（Windows、macOS、Linux）
2. `cargo check` —— Rust 检查（Windows、macOS、Linux）

### 发布构建（`.github/workflows/build.yml`）

在版本标签（`v*`）触发：
- 构建 `.exe`、`.msi`（Windows）、`.dmg`（macOS）、`.AppImage`、`.deb`（Linux）
- 创建 GitHub Release 并附带构建产物
