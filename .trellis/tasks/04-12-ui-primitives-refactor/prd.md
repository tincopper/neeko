# UI 原语组件库重构

## 概览

参照 shadcn-admin 的设计模式，对 Neeko 前端进行三阶段结构性重构。目标是建立可复用的 UI 原语组件层，消除各对话框/表单中大量重复的结构代码，并将 CSS 架构拆分为职责清晰的两个文件。

**本任务不实现新功能**，只改善代码结构和可维护性。

---

## 背景分析

### 现状痛点

当前项目中，每个对话框（GitDialog、AddProjectModal、ProjectSettingsDialog、RemoteDialog、WSLDialog、RemoteAuthDialog）都在重复写相同的结构：

```tsx
// 每个对话框都有这段几乎相同的代码：
<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000]" onClick={onClose}>
  <div className="bg-bg-secondary border border-border rounded-lg p-6 min-w-[400px] shadow-xl" onClick={e => e.stopPropagation()}>
    <h3 className="mb-3 text-lg font-semibold text-text-primary">标题</h3>
    {/* 内容 */}
    <div className="flex justify-end gap-3 mt-5">
      <button className="px-4 py-2 bg-bg-tertiary ...">Cancel</button>
      <button className="px-4 py-2 bg-accent-blue ...">Confirm</button>
    </div>
  </div>
</div>
```

同样，每个 input、button、select 都有重复的长 className 字符串，没有统一管理变体（主要/次要/危险）。

### shadcn-admin 的解法

shadcn-admin 通过以下方式解决：
1. `components/ui/` 存放 Radix UI 封装的原语组件（Button、Dialog、Input 等）
2. `class-variance-authority (cva)` 统一管理组件的变体/尺寸
3. `styles/theme.css` + `styles/index.css` 分离颜色定义与框架配置
4. 复合组件模式（Dialog + DialogHeader + DialogContent + DialogFooter）

---

## 阶段一：CSS 架构拆分

### 目标结构

```
src/
├── styles/
│   ├── theme.css       ← 纯 CSS 变量（One Dark Pro 色板）
│   └── index.css       ← Tailwind 入口 + @theme + @layer base/components
├── tailwind.css        ← 删除
```

### theme.css 内容规范

只包含 CSS 变量定义，不含任何 Tailwind 指令：

```css
/* src/styles/theme.css */
:root {
  /* 背景层级 */
  --bg-primary:   #282c34;
  --bg-secondary: #21252b;
  --bg-tertiary:  #2c313a;
  --bg-hover:     #323842;

  /* 文字 */
  --text-primary:   #abb2bf;
  --text-secondary: #5c6370;
  --text-muted:     #4b5263;

  /* 边框 */
  --border-color: #181a1f;

  /* 强调色（One Dark Pro） */
  --accent-blue:   #61afef;
  --accent-green:  #98c379;
  --accent-yellow: #e5c07b;
  --accent-red:    #e06c75;

  /* 状态色 */
  --status-idle:    #98c379;
  --status-running: #e5c07b;
  --status-failed:  #e06c75;

  /* Diff */
  --diff-added:        #98c37920;
  --diff-removed:      #e06c7520;
  --diff-added-text:   #98c379;
  --diff-removed-text: #e06c75;

  /* 布局 */
  --sidebar-width: 280px;
  --font-size: 14px;
}
```

### index.css 内容规范

```css
/* src/styles/index.css */
@import "tailwindcss";
@import "@xterm/xterm/css/xterm.css";
@import "./theme.css";

/* Tailwind 主题色映射 */
@theme {
  --color-bg-primary:    var(--bg-primary);
  --color-bg-secondary:  var(--bg-secondary);
  /* ... 其余映射保持不变 ... */
}

/* 全局基础样式 */
@layer base {
  /* ... 保持现有 @layer base 内容不变 ... */
}

/* 复杂 CSS（无法用 utility class 表达） */
@layer components {
  /* ... 保持现有 @layer components 内容不变 ... */
}
```

### 修改文件清单

| 文件 | 操作 |
|------|------|
| `src/tailwind.css` | 删除 |
| `src/styles/theme.css` | 新建 |
| `src/styles/index.css` | 新建（内容从 tailwind.css 迁移） |
| `src/main.tsx` | 修改 import 路径 |

---

## 阶段二：UI 原语组件库

### 目录结构

```
src/components/ui/
├── button.tsx      ← cva() 变体管理
├── dialog.tsx      ← Radix Dialog 封装（复合组件）
├── input.tsx       ← 统一 input 样式
├── select.tsx      ← Radix Select 封装
├── badge.tsx       ← cva() 状态标签
├── checkbox.tsx    ← Radix Checkbox 封装
└── index.ts        ← barrel export
```

### 新增依赖

```json
{
  "@radix-ui/react-dialog":    "^1.1.x",
  "@radix-ui/react-select":    "^2.2.x",
  "@radix-ui/react-checkbox":  "^1.3.x",
  "@radix-ui/react-slot":      "^1.2.x",
  "class-variance-authority":  "^0.7.x"
}
```

### Button 组件规范

```tsx
// src/components/ui/button.tsx
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../../utils/cn";

const buttonVariants = cva(
  // 基础样式
  "inline-flex items-center justify-center gap-1.5 rounded-md text-[var(--font-size)] font-medium cursor-pointer transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary:   "bg-accent-blue text-white hover:bg-[#4d9fd6]",
        secondary: "bg-bg-tertiary border border-border text-text-primary hover:bg-bg-hover",
        ghost:     "text-text-primary hover:bg-bg-hover",
        danger:    "bg-accent-red text-white hover:bg-[#be4f58]",
      },
      size: {
        sm:      "px-3 py-1.5 text-[13px]",
        default: "px-4 py-2",
        icon:    "w-7 h-7 p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
);

interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
```

### Dialog 组件规范（复合组件）

```tsx
// src/components/ui/dialog.tsx
// 封装 Radix Dialog，提供：
// Dialog, DialogTrigger, DialogContent, DialogHeader,
// DialogTitle, DialogDescription, DialogFooter, DialogClose

// 关键样式：
// DialogOverlay: "fixed inset-0 bg-black/60 z-[999]"
// DialogContent: "fixed z-[1000] bg-bg-secondary border border-border rounded-lg
//                 shadow-xl top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
//                 w-full max-w-[480px] p-6"
// DialogHeader:  "mb-4"
// DialogTitle:   "text-lg font-semibold text-text-primary"
// DialogFooter:  "flex justify-end gap-3 mt-5"

// 尺寸变体（通过 className 覆盖 max-w）：
// sm:  max-w-[360px]
// md:  max-w-[480px]（默认）
// lg:  max-w-[600px]
```

### Input 组件规范

```tsx
// src/components/ui/input.tsx
// 统一替代所有手写的 <input className="w-full p-3 bg-bg-primary border border-border ...">

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "w-full px-3 py-2.5 bg-bg-primary border border-border rounded-md",
        "text-text-primary text-[var(--font-size)] font-mono",
        "outline-none transition-colors duration-200",
        "focus:border-accent-blue",
        "placeholder:text-text-muted",
        // Hide number spinners
        "[type=number]:[-moz-appearance:textfield]",
        "[type=number]:[&::-webkit-inner-spin-button]:appearance-none",
        className
      )}
      {...props}
    />
  );
}
```

### Badge 组件规范

```tsx
// src/components/ui/badge.tsx
const badgeVariants = cva(
  "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
  {
    variants: {
      variant: {
        added:    "bg-accent-green/20 text-accent-green",
        modified: "bg-accent-yellow/20 text-accent-yellow",
        deleted:  "bg-accent-red/20 text-accent-red",
        default:  "bg-bg-tertiary text-text-secondary",
      },
    },
    defaultVariants: { variant: "default" },
  }
);
```

### Checkbox 组件规范

```tsx
// src/components/ui/checkbox.tsx
// 用 Radix Checkbox 替代当前 tailwind.css 中的 .custom-checkbox CSS 类
// 保持视觉一致：15px 正方形，圆角 4px，选中时 accent-blue 背景+白色勾
```

### Select 组件规范

```tsx
// src/components/ui/select.tsx
// 用 Radix Select 封装，提供：
// Select, SelectTrigger, SelectContent, SelectItem, SelectValue
// 视觉风格与 Input 一致：bg-bg-primary + border-border + focus:border-accent-blue
```

---

## 阶段三：重构现有组件

### 重构映射表

| 原组件 | 重构方式 | 减少代码量（估算） |
|--------|---------|-----------------|
| `GitDialog.tsx` | 用 Dialog + Input + Button 重写 | ~40% |
| `AddProjectModal.tsx` | 用 Dialog + Button 重写 | ~35% |
| `ProjectSettingsDialog.tsx` | 用 Dialog + Input + Select + Button 重写 | ~45% |
| `RemoteDialog.tsx` | 用 Dialog + Input + Button 重写 | ~40% |
| `WSLDialog.tsx` | 用 Dialog + Input + Button 重写 | ~35% |
| `RemoteAuthDialog.tsx` | 用 Dialog + Input + Button 重写 | ~40% |
| `SettingsPanel.tsx` | 用 Input + Select + Button + Checkbox 重写 | ~30% |
| `FileTree.tsx` | 用 Badge 替换手写状态标签 | ~15% |

### GitDialog 重构示例

重构前（当前代码片段）：
```tsx
<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000]" onClick={onClose}>
  <div className="bg-bg-secondary border border-border rounded-lg p-6 min-w-[400px] shadow-xl" onClick={e => e.stopPropagation()}>
    <h3 className="mb-3 text-lg font-semibold text-text-primary">New Branch</h3>
    <input className="w-full p-3 bg-bg-primary border border-border rounded-md text-text-primary ..." />
    <div className="flex justify-end gap-3 mt-5">
      <button className="px-4 py-2 bg-bg-tertiary border border-border rounded-md ...">Cancel</button>
      <button className="px-4 py-2 bg-accent-blue border-none rounded-md text-white ...">Create Branch</button>
    </div>
  </div>
</div>
```

重构后：
```tsx
<Dialog open onOpenChange={(open) => !open && onClose()}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>New Branch</DialogTitle>
    </DialogHeader>
    <Input
      placeholder="Branch name"
      value={branchName}
      onChange={e => setBranchName(e.target.value)}
      onKeyDown={e => e.key === "Enter" && handleCreateBranch()}
      autoFocus
    />
    {error && <ErrorMessage>{error}</ErrorMessage>}
    <DialogFooter>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={handleCreateBranch} disabled={!branchName.trim() || submitting}>
        {submitting ? "Creating..." : "Create Branch"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### SettingsPanel 中的 custom-checkbox 替换

重构前（依赖 tailwind.css 中的 .custom-checkbox CSS 类）：
```tsx
<label className="custom-checkbox flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer">
  <input type="checkbox" checked={newBranch} onChange={e => setNewBranch(e.target.checked)} />
  <span className="checkbox-mark" />
  Create new branch
</label>
```

重构后（Radix Checkbox，CSS-in-JSX，无需外部 CSS 类）：
```tsx
<Checkbox
  checked={newBranch}
  onCheckedChange={checked => setNewBranch(!!checked)}
  label="Create new branch"
/>
```

---

## 验收标准

### 阶段一（CSS 拆分）

- [ ] `src/tailwind.css` 已删除
- [ ] `src/styles/theme.css` 存在，只含 CSS 变量，无 Tailwind 指令
- [ ] `src/styles/index.css` 存在，包含 @import tailwindcss + @import theme + @theme + @layer
- [ ] `src/main.tsx` import 路径更新为 `./styles/index.css`
- [ ] `pnpm build` 通过，视觉无变化

### 阶段二（UI 原语库）

- [ ] `src/components/ui/` 目录存在，包含 6 个组件文件 + index.ts
- [ ] 新增依赖：@radix-ui/react-dialog、@radix-ui/react-select、@radix-ui/react-checkbox、@radix-ui/react-slot、class-variance-authority
- [ ] Button 有 4 种 variant（primary/secondary/ghost/danger）和 3 种 size（sm/default/icon）
- [ ] Dialog 支持复合组件模式（DialogHeader/DialogTitle/DialogFooter/DialogContent）
- [ ] Input 统一处理 placeholder、focus、number-spinner 等边界情况
- [ ] `pnpm test` 通过（199 tests）
- [ ] `npx tsc --noEmit` 通过（0 errors）

### 阶段三（组件重构）

- [ ] 7 个对话框组件均使用 Dialog 原语，不再有手写 overlay div
- [ ] SettingsPanel 中的 checkbox、input、button 均使用原语组件
- [ ] tailwind.css 中的 `.custom-checkbox` / `.custom-radio` CSS 已删除（被 Checkbox 组件取代）
- [ ] FileTree.tsx 中的 git 状态标签使用 Badge 组件
- [ ] `pnpm test` 通过
- [ ] `pnpm build` 通过
- [ ] `npx tsc --noEmit` 通过（0 errors）

---

## 约束与边界

### 不在本任务范围内

- **不修改业务逻辑**：invoke 调用、状态管理、props 接口均不变
- **不引入路由**：Neeko 是单视图应用，不引入 TanStack Router
- **不引入状态管理库**：不引入 Zustand（当前 hooks 架构已足够）
- **不实现暗色模式**：theme.css 只定义 One Dark Pro 单一主题
- **不重构 Feature 目录**：目录结构（components/hooks/utils）保持不变
- **不修改 xterm.js 相关代码**：终端组件不在本次重构范围

### Radix UI 使用原则

- Radix 组件**只作为无障碍基础**（焦点管理、键盘导航、ARIA 属性）
- **视觉样式完全由 Tailwind 控制**，不依赖 Radix 的默认样式
- 对话框关闭行为：统一由 `Dialog` 的 `onOpenChange` 处理，不再需要手写 overlay onClick

### 与现有代码的兼容性

- `cn()` 工具路径 `../../utils/cn` 保持不变
- 所有原语组件从 `../ui` 导入（barrel export）
- `React.memo` 包裹规则不变（非 App.tsx 的所有组件）
- Tauri `-webkit-app-region: drag` 标记不受影响

---

## 实施顺序

```
Phase 1: CSS 拆分（~30 分钟）
  └── 独立可验证，风险最低

Phase 2: 原语组件库（~2 小时）
  ├── Button（最先，被其他组件依赖）
  ├── Input
  ├── Dialog
  ├── Select
  ├── Checkbox
  └── Badge

Phase 3: 组件重构（~3 小时）
  ├── GitDialog（最简单，用作参考实现）
  ├── AddProjectModal
  ├── RemoteAuthDialog
  ├── WSLDialog
  ├── ProjectSettingsDialog
  ├── RemoteDialog（最复杂，含路径自动补全）
  └── SettingsPanel（最后，改动最大）
```

每个阶段完成后独立验证：`pnpm test` + `npx tsc --noEmit` + `pnpm build`。
