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


### Layout / Dock 边界规则（2026-07-24）

`layout/` 是**纯窗口骨架**，不得 import `@/features/*` 或 `@/app/*`（含 `lazy`）。

| 允许 | 禁止 |
|------|------|
| `layout` 内部互引、`@/shared/*`、`@/ui/*`、`@/lib/*` | `import ... from '@/features/...'` / `@/app/...` |
| 通过 props/slots/Context 接收业务 UI | 在 layout 内持有 feature 组件注册表实现 |
| `useDockRegistry()` 消费 app 注入的 ViewDef | `layout/dockPanels.ts` 式的 lazy 注册表（已删除） |

#### Dock 注册表分层（强制）

```
shared/dock/panelMeta.ts   ← dockStore 默认 zones / bar / toggle 补区
app/dock/registry.ts       ← title/icon + lazy(features/app) 绑定
layout/DockRegistryContext ← app 用 DockRegistryProvider 注入；DockLayout/Zone 只消费
```

新增 panel checklist：
1. `shared/dock/panelMeta.ts` 增加 meta
2. `app/dock/registry.ts` 增加 UI binding（title/icon/lazy/minPanelSize）
3. 需要 props 胶水时改 `app/dock/wrappers/<Panel>Wrapper.tsx`（每面板一文件，独立 lazy chunk；业务编排下沉到 feature hooks）
4. **不要**在 `layout/` 增加 feature/app import

ESLint：`import/no-restricted-paths` 禁止 layout→features/app；**无** dockPanels 文件级例外。

**禁止模式**：
- 禁止 `window.__neeko*` 全局函数桥接跨层通信（改用 Context，如 `TerminalInsertContext`：Provider + register/unregister + 消费方降级）
- 禁止 dock wrapper 内嵌业务编排（git 刷新、tab 创建等）——下沉 feature 域 hooks（`useRefreshGitInfo` / `useOpenDiffTab` / `useGitLogKeyboardNav`）
- **禁止跨 feature 深导入**：`@/features/<f>/components|hooks|utils|contexts/...` 一律走 feature `index.ts` 门面（白名单 `store/` `types/` `api/` 可直导，`export type` 类型直导豁免）；门面缺符号时先行补导出再改消费方。`shared/` 层反向引用 features 为 pre-existing 豁免（带 `import/no-restricted-paths` disable 注释），不得门面化（会引入循环依赖）。
`shared/` 不得 import `layout/`（dockStore 只依赖 `shared/dock`）。

当前 Git 相关 dock panel 只有 **`gitControl`**（title: Git Control）。旧的 `gitCommit` / `gitLog` 已合并进其内部 Changes | History tabs，不要再注册为独立 dock panel。

Git Control 打开 Diff view 的 Tab 标题须按来源加前缀，分隔符用中点 `·`（U+00B7）：

| 来源 | 模式 | 标题 |
| --- | --- | --- |
| Changes（即将提交的变更） | 单文件 | `Commit Diff · <文件名>` |
| History（已提交历史） | 单文件 / 钉住 | `History Diff · <文件名>` |
| History（已提交历史） | 合并多文件 | `History Commit · <hash 前7> · N files` |

要点：单文件 Diff 用 `… Diff · …` 表达"来自某面板的单文件 diff"；合并模式仍保留 `History Commit` 前缀以锚定所在 commit。标题前缀是单一事实源，禁止回退为裸文件名。


#### 多 Tab Dock Panel：保留子面板挂载状态

**问题**：内部 tab 用条件渲染（`activeTab === 'x' ? <A/> : <B/>`）会卸载非活动面板，导致草稿 commit message、文件勾选、对话框状态丢失。

**正确做法**：两个子面板都始终挂载，用 `hidden` 切换可见性；键盘快捷键在 wrapper 层按 `activeTab` 门控。

```tsx
// Good — 状态在 tab 切换后仍在
<div className={cn('h-full', activeTab !== 'changes' && 'hidden')}>
  <GitCommitPanel ... />
</div>
<div className={cn('h-full', activeTab !== 'history' && 'hidden')}>
  <GitLogPanel ... />
</div>

// Bad — 切到 History 会丢掉 Changes 草稿
{activeTab === 'changes' ? <GitCommitPanel /> : <GitLogPanel />}
```

跨 tab 数据一致性：Changes 提交成功后的 `onRefreshGit` 应同时刷新 History 的 log（`useGitLog().refresh()`）。


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

### 6. 异步竞态测试依赖微任务顺序（假 GREEN）

依赖「`A` 的 setState 排在 `B` 之后」这种微任务 FIFO 顺序来断言竞态保护，**不构成有效 RED 测试**。

**陷阱**：`await Promise.all([...]).catch(...)` 或 `Promise.allSettled` 链中，`.catch()` / `.finally()` 为每个 promise 引入额外微任务跳，使未修复代码的 setState 顺序在 V8/Node 下碰巧与有修复时一致——测试在 unfixed 代码上**也通过**，无法暴露 bug。

**正确做法**：让**先 `setState` 的回调主动 `resolve` 后入队的 promise**，把后者的 setState 强制排进下一轮微任务，确定性暴露顺序差异。

**回归验证**：提交前临时删除被测守卫（generation 计数器 / 锁 / AbortController），测试必须 RED；恢复后 GREEN。

---

## 必需模式

### 1. TypeScript 严格模式合规

项目使用严格 TypeScript（`strict: true`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`）。所有代码必须通过 `tsc --noEmit`。

### 2. 所有非根组件使用 `React.memo`

在 Props 与 Context 混合分发架构中，用 `React.memo` 包裹组件导出以防止不必要的重渲染：

```tsx
export default React.memo(MyComponent);
```

> **豁免（2026-08-29）**：纯装配组件可不包 memo —— 其 props 为每次渲染恒新的对象/数组字面量（如 `app/utils/ComposeProviders.tsx` 接收 providers 数组），memo 比较永不命中，属死重。判定标准：**props 引用有可能稳定时才包 memo**；新增此类豁免组件时在此处登记。

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

---

## 架构原则（前端）

### 组件设计

1. **单一职责**：一个组件只负责一个 UI 概念。如果组件超过 200 行，考虑拆分。
2. **逻辑下沉**：业务逻辑放在 hook 中，组件只负责渲染。禁止在组件中直接调用 `invoke`。
3. **Props 最小化**：只传递组件实际需要的数据，禁止透传大量不相关 props。
4. **组合优于继承**：使用 `children` 和 render props 模式，而非通过 props 控制渲染分支。

### 状态管理

1. **就近原则**：局部 UI 状态用 `useState`，跨组件共享用 feature store，全局用 `shared/store`。
2. **禁止冗余**：能从 props/store 派生的数据不用 `useState` 存储，用 `useMemo` 计算。
3. **单向数据流**：子组件通过回调通知父组件，禁止直接修改父级状态。

### 依赖方向

1. **单向依赖**：`features/` 之间禁止互相引用，跨域通信通过 `shared/` 或 `useAppShell`。
2. **API 封装**：所有 `invoke` 调用封装在 `api/` 目录，禁止在组件/hook 中直接 import `@tauri-apps/api/core`。
3. **类型共享**：跨域类型定义在 `shared/types/`，禁止在组件内重复定义接口类型。

---

## TDD 要求（前端）

### 开发流程

1. **定义接口**：先写 props 类型 / hook 签名。
2. **编写测试**：覆盖正常渲染、用户交互、边界情况、错误状态。
3. **确认失败**：运行测试，确认红色（测试失败）。
4. **实现功能**：写最少代码让测试通过。
5. **重构优化**：消除重复，提升可读性，保持测试绿色。

### 测试规范

- 测试文件：`*.test.ts` / `*.test.tsx`，与源文件同目录
- Hook 测试：`renderHook` + `act` / `waitFor`
- 组件测试：`render` + `screen` 查询
- 每个测试只验证一个行为
- 测试描述使用 `it('should <预期行为> when <条件>')` 格式

### 覆盖率要求

| 类型 | 最低要求 |
|------|---------|
| 纯函数 / utils | 100% |
| 自定义 Hooks | 关键行为 100% |
| 业务组件 | 关键交互路径 |
