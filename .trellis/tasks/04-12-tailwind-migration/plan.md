# Tailwind CSS 迁移 — 技术计划

## 1. 背景

`src/styles.css` 已膨胀至 **3,364 行 / ~520 个类选择器**，单文件维护困难。迁移到 **Tailwind CSS v4**（`@tailwindcss/vite` 插件），实现 utility-first 一致性，自定义 CSS 预计降至 ~260-400 行（减少 ~90%）。

## 2. 范围

| 类别 | 内容 |
|------|------|
| **修改** | 28 个 `.tsx` 组件、`vite.config.ts`、`package.json`、`main.tsx` |
| **新增** | `src/tailwind.css`、`src/utils/cn.ts` |
| **删除** | `src/styles.css`（全部迁移完成后删除） |
| **新增依赖** | `tailwindcss`、`@tailwindcss/vite`、`clsx`、`tailwind-merge` |

## 3. 架构决策

| 决策 | 选择 | 原因 |
|------|------|------|
| Tailwind 版本 | v4（`@tailwindcss/vite`） | 最新版，原生 Vite 集成，`@theme` 语法 |
| 动态类合并 | `clsx` + `tailwind-merge` | 解决冲突 utility（如 `p-2 p-4` → `p-4`） |
| CSS 变量 | 保留 `:root` 定义 + `@theme` 映射 | 运行时可切换（侧边栏拖拽、字体设置） |
| 复杂 CSS | `@layer base` / `@layer components` | `:has()`、`::after`、scrollbar 等无法 Tailwind 化 |
| 迁移策略 | 全量迁移，按依赖从底层到顶层 | 一次性完成，避免混合方案 |

## 4. Phase 1 — 基础设施搭建

### 4.1 安装依赖

```bash
pnpm add -D tailwindcss @tailwindcss/vite
pnpm add clsx tailwind-merge
```

### 4.2 配置 Vite

`vite.config.ts` 添加 Tailwind 插件：

```ts
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  // ... 原有配置不变
}));
```

### 4.3 创建 `src/utils/cn.ts`

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### 4.4 创建 `src/tailwind.css`

文件结构分为三个部分：

```
@import "tailwindcss"                    ← Tailwind 核心
@import "@xterm/xterm/css/xterm.css"     ← xterm 样式（统一放这里，各终端组件不再各自 import）

@theme { ... }                           ← CSS 变量 → Tailwind 主题颜色映射
@layer base { ... }                      ← :root 变量定义 + Tauri drag-region
@layer components { ... }               ← 无法迁移的复杂 CSS（~260 行）
```

**`@theme` 块**（16 个颜色变量，映射为 Tailwind 主题色）：

```css
@theme {
  --color-bg-primary: #282c34;
  --color-bg-secondary: #21252b;
  --color-bg-tertiary: #2c313a;
  --color-bg-hover: #323842;
  --color-text-primary: #abb2bf;
  --color-text-secondary: #5c6370;
  --color-text-muted: #4b5263;
  --color-border: #181a1f;
  --color-accent-blue: #61afef;
  --color-accent-green: #98c379;
  --color-accent-yellow: #e5c07b;
  --color-accent-red: #e06c75;
  --color-status-idle: #98c379;
  --color-status-running: #e5c07b;
  --color-status-failed: #e06c75;
  --color-diff-added: #98c37920;
  --color-diff-removed: #e06c7520;
}
```

映射后可直接使用 Tailwind 类名：`bg-bg-primary`、`text-text-secondary`、`border-border`、`text-accent-blue` 等。

**`@layer base`**：保留 `:root` 22 个 CSS 变量定义（运行时动态变量 `--sidebar-width`、`--font-size` 由 JS 设置）+ Tauri `-webkit-app-region` 规则。

**`@layer components`**（保留 ~260 行，无法用 Tailwind 表达的 CSS）：

| 保留区块 | 原因 | 预估行数 |
|----------|------|---------|
| `.terminal-wrapper .xterm*` 覆盖 | xterm.js 外部库，需 `!important` | ~15 |
| `.side-terminal-grid-container:has(...)` | `:has()` + `:nth-child()` 网格逻辑 | ~30 |
| `.custom-radio` / `.custom-checkbox` | `::after` 伪元素 + `input:checked ~ sibling` | ~60 |
| `::-webkit-scrollbar` | 伪元素滚动条样式 | ~15 |
| `.hljs*` 语法高亮 | highlight.js 外部样式（One Dark Pro 配色） | ~85 |
| `@keyframes` 动画（3 个） | `wt-fade-out`、`toast-in`、`toast-out` | ~20 |
| `.settings-font-item.builtin::after` | 伪元素内容注入 | ~5 |
| `.gh-context-menu-item-disabled` | `pointer-events` 覆盖 | ~5 |
| `-webkit-app-region` | Tauri 窗口拖拽标注 | ~10 |
| `word-diff-removed` / `word-diff-added` | `dangerouslySetInnerHTML` 中的嵌入类名 | ~10 |
| **合计** | | **~255** |

### 4.5 更新 `src/main.tsx`

```tsx
// 之前
import "./styles.css";

// 之后
import "./tailwind.css";
```

同时删除各终端组件中的 `import "@xterm/xterm/css/xterm.css"`（已统一在 `tailwind.css` 顶部 import）。

### 4.6 删除 `src/styles.css`

全部组件迁移完成、构建验证通过后删除。

## 5. Phase 2 — 组件迁移

### 5.1 迁移模式

**静态类** → 直接替换为 Tailwind utility：

```tsx
// 之前
<div className="modal-overlay">

// 之后
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
```

**动态类** → 使用 `cn()`：

```tsx
// 之前
className={`agent-option ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}`}

// 之后
className={cn(
  "px-3 py-2 cursor-pointer rounded",
  selected && "bg-accent-blue/20 text-accent-blue",
  disabled && "opacity-50 pointer-events-none"
)}
```

**内联 style 一次性值** → 转 Tailwind：

```tsx
// 之前
style={{ opacity: 0.5 }}

// 之后
className="opacity-50"
```

**保留内联 style**（JS 动态计算值）：

```tsx
// JS 拖拽驱动的宽度
style={{ width: sideTerminalWidth }}

// 树深度计算的缩进
style={{ paddingLeft: BASE + depth * STEP }}

// 动态定位（ContextMenu）
style={{ left: pos.left, top: pos.top }}
```

### 5.2 核心 CSS → Tailwind 映射表

| 原 CSS 声明 | Tailwind 类 |
|-------------|------------|
| `display: flex` | `flex` |
| `flex-direction: column` | `flex-col` |
| `align-items: center` | `items-center` |
| `justify-content: center` | `justify-center` |
| `gap: 8px` | `gap-2` |
| `padding: 5px 8px` | `px-2 py-1` |
| `margin-bottom: 2px` | `mb-0.5` |
| `background-color: var(--bg-primary)` | `bg-bg-primary` |
| `color: var(--text-secondary)` | `text-text-secondary` |
| `border: 1px solid var(--border-color)` | `border border-border` |
| `border-radius: 6px` | `rounded-md` |
| `font-size: 0.85em` | `text-[0.85em]` |
| `font-weight: 700` | `font-bold` |
| `overflow: hidden` | `overflow-hidden` |
| `flex: 1` | `flex-1` |
| `flex-shrink: 0` | `shrink-0` |
| `min-width: 0` | `min-w-0` |
| `min-height: 0` | `min-h-0` |
| `user-select: none` | `select-none` |
| `cursor: pointer` | `cursor-pointer` |
| `position: fixed; inset: 0` | `fixed inset-0` |
| `position: relative` | `relative` |
| `position: absolute` | `absolute` |
| `z-index: 50` | `z-50` |
| `opacity: 0.4` | `opacity-40` |
| `transition: background-color 0.15s` | `transition-colors duration-150` |
| `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` | `truncate` |
| `width: 100%; height: 100%` | `w-full h-full` |

### 5.3 迁移顺序

```
Tier 1 — 叶子组件（简单，无依赖）：
  ├── WindowControls.tsx         5 个类
  ├── AgentIcon.tsx              1 个类 + 内联 style
  ├── AppToast.tsx               1 个动态类
  └── FileTree.tsx               7 个类 + 动态 badge

Tier 2 — 终端组件（结构简单）：
  ├── TerminalView.tsx           2 个类
  ├── WorktreeTerminalView.tsx   2 个类
  ├── SideTerminalView.tsx       6 个类
  ├── WSLTerminalView.tsx        7 个类 + 条件 style
  └── RemoteTerminalView.tsx     7 个类 + 条件 style

Tier 3 — 对话框组件（模式一致）：
  ├── GitDialog.tsx              ~15 个类
  ├── AddProjectModal.tsx        ~15 个类 + 内联 style
  ├── ProjectSettingsDialog.tsx  ~15 个类 + 内联 style
  ├── ContextMenu.tsx            5 个类 + 动态 + 定位 style
  ├── RemoteAuthDialog.tsx       ~10 个类
  ├── WSLDialog.tsx              ~25 个类
  └── RemoteDialog.tsx           ~25 个类（已部分使用 utility 类）

Tier 4 — 布局组件：
  ├── TitleBar.tsx               13 个类
  ├── AgentSelector.tsx          8 个动态类
  ├── ProjectSidebar.tsx         4 个类
  ├── MainContent.tsx            9 个类
  └── RemoteProjectView.tsx      6 个类

Tier 5 — 复杂业务组件：
  ├── ProjectItem.tsx            ~35 个类（classList → state 重构）
  ├── WorktreeList.tsx           ~20 个类 + 动画
  ├── RemoteItems.tsx            ~30 个类
  ├── SettingsPanel.tsx          ~50 个类（最复杂）
  └── DiffView.tsx               ~30 个类 + dangerouslySetInnerHTML

Tier 6 — 入口：
  └── App.tsx                    3 个类
```

### 5.4 特殊处理

**ProjectItem.tsx — `classList` 改为状态驱动：**

当前 Pointer Events 拖拽通过 `classList.add("dragging")` 操作 DOM，Tailwind 无法响应。需改为 state 驱动：

```tsx
// 之前（DOM 直接操作）
(e.currentTarget.closest(".gh-project") as HTMLElement)?.classList.add("dragging");

// 之后（state 驱动，Tailwind 条件类生效）
const [isDragging, setIsDragging] = useState(false);
const [dragOverId, setDragOverId] = useState<string | null>(null);

// 在 className 中：
className={cn(
  "mb-0.5 rounded-md overflow-visible transition-[opacity,transform] duration-150",
  isActive && "...",
  isDragging && "opacity-40 scale-[0.98] cursor-grabbing",
  dragOverId === project.id && "border-t-2 border-accent-blue -mt-0.5"
)}
```

注意：`drag-over` 高亮目前通过 `classList` 直接操作**目标元素**，改为 state 后需要在父组件或 Context 中协调当前 dragOver 目标的 ID。

**DiffView.tsx — `dangerouslySetInnerHTML`：**

`word-diff-removed` / `word-diff-added` 嵌入在 diff 解析器生成的 HTML 字符串中，无法用 Tailwind utility 替代，**必须**保留在 `@layer components` 中作为具名类。

**SettingsPanel.tsx — 字体下拉 `::after`：**

`.settings-font-item.builtin .settings-font-name::after { content: " (builtin)" }` 是伪元素，无法用 Tailwind 表达，保留在 `@layer components`。

**各终端组件 xterm.css import：**

`TerminalView.tsx`、`WSLTerminalView.tsx`、`RemoteTerminalView.tsx` 中各自有 `import "@xterm/xterm/css/xterm.css"`，迁移后统一由 `tailwind.css` 顶部 import，三处组件中的 import 语句删除。

## 6. 验证清单

| 检查项 | 命令 | 预期结果 |
|--------|------|----------|
| 类型检查 | `npx tsc --noEmit` | 0 错误 |
| 构建 | `pnpm build` | 成功 |
| 测试 | `pnpm test` | 全部通过 |
| 视觉回归 | 手动检查所有界面 | 与迁移前一致 |
| CSS 变量动态性 | 拖拽侧边栏、切换字体大小 | 正常响应 |
| 终端渲染 | 打开终端 / 副终端 / worktree 终端 | 背景色、布局正常 |
| 自定义组件 | radio / checkbox / dialog | 渲染正确 |
| 滚动条 | 文件树、终端 | 样式保持 |
| 语法高亮 | Diff 视图 | One Dark Pro 配色正确 |
| 残留引用 | 搜索原 CSS 类名 | 0 匹配 |
| 自定义 CSS 体积 | 查看 `tailwind.css` `@layer` 部分行数 | ≤ 400 行 |

## 7. 预期效果

| 指标 | 迁移前 | 迁移后 |
|------|--------|--------|
| 自定义 CSS 行数 | 3,364 | ~260-400 |
| CSS 文件数 | 1（`styles.css`） | 1（`tailwind.css`） |
| 组件 className 风格 | BEM 自定义类 | Tailwind utility |
| 动态类处理 | 模板字符串拼接 | `cn()` + `twMerge` |
| 新增依赖 | — | 4 个包 |
| 删除文件 | — | `src/styles.css` |

## 8. 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 视觉回归 | 按 Tier 逐个迁移，每完成一个 Tier 做一次视觉对比 |
| 测试断言类名 | 检查测试文件中的类名断言（`__tests__/` 目录），按需更新 |
| CSS 变量失效 | `@theme` 直接写入颜色值，`:root` 变量定义完整保留 |
| xterm 样式丢失 | `!important` 覆盖保留在 `@layer components` |
| `classList` 拖拽失效 | ProjectItem / RemoteItems 拖拽状态改为 React state 驱动 |
| 合并冲突 | 一次性迁移完成，避免长周期分支，在独立 feature 分支操作 |
