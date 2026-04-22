# 质量指南

> 前端开发的代码质量标准。

---

## 概述

项目当前的主要质量门禁是 **TypeScript 类型检查**（`tsc --noEmit`）与 **Vitest** 回归测试。项目目前没有配置 ESLint、Prettier。CI 在所有三个平台（Windows、macOS、Linux）上运行 `pnpm tsc --noEmit`。

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
import TitleBar from "../components/layout/TitleBar";

// 正确
import { TitleBar } from "../components/layout";
```

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
try {
  await invoke("save_config", { config });
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
- [ ] Tauri 事件监听器在 `useEffect` 返回函数中清理
- [ ] 没有未使用的导入或变量（`noUnusedLocals` 强制执行）

---

## 构建与 CI

### 本地开发

```bash
pnpm dev          # 启动 Vite 开发服务器（端口 1420）
pnpm tauri dev    # 启动完整的 Tauri 开发环境
```

### 类型检查

```bash
pnpm tsc --noEmit    # 前端类型检查
cargo check          # 后端（Rust）类型检查
```

### CI 流水线（`.github/workflows/ci.yml`）

在 push/PR 到 `main` 时运行：
1. `pnpm tsc --noEmit` —— TypeScript 检查（Windows、macOS、Linux）
2. `cargo check` —— Rust 检查（Windows、macOS、Linux）

### 发布构建（`.github/workflows/build.yml`）

在版本标签（`v*`）触发：
- 构建 `.exe`、`.msi`（Windows）、`.dmg`（macOS）、`.AppImage`、`.deb`（Linux）
- 创建 GitHub Release 并附带构建产物
