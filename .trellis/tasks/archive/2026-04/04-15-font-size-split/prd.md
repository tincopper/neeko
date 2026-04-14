# Task: Settings Font Size Split

## Overview

将 Settings 中现有的单个 `fontSize` 字体大小设置拆分为 3 个独立配置项，分别控制：
- **Appearance**：整体应用 UI 字体（侧边栏项目名、项目列表、文件树、Tab 字体等）
- **Editor**：编辑器字体（FileViewer 中 CodeMirror 编辑器字体大小）
- **Terminal**：终端字体（xterm.js 终端字体 + 终端 Tab 字体大小）

## 现状分析

当前 `AppConfig` 中只有一个 `fontSize: number`（默认 14），同时用于：
- 终端（xterm.js `fontSize`）
- 编辑器（CodeMirror `getCmFontStyle` 中的字体大小）
- UI 文本（通过 CSS 变量 `--font-size` 驱动 `body { font-size: var(--font-size) }`）

`src/styles/theme.css` 定义了 `--font-size: 14px` 默认值，`src/styles/index.css` 在 `body` 上应用它。`useAppConfig.ts` 在 `config.fontSize` 变化时实时更新 CSS 变量。

## 需求

### 1. AppConfig 字段变更（`src/types.ts`）

```typescript
// 旧
export interface AppConfig {
  fontSize: number;
  // ...
}

// 新
export interface AppConfig {
  appearanceFontSize: number;  // 整体 UI 字体（侧边栏、文件树、Tab 等）
  editorFontSize: number;      // 编辑器字体（CodeMirror / FileViewer）
  terminalFontSize: number;    // 终端字体（xterm.js 终端 + 终端 Tab）
  // 移除 fontSize
}
```

- 默认值：`appearanceFontSize: 12`，`editorFontSize: 14`，`terminalFontSize: 14`
- 允许范围：每个都在 10–24px

### 2. `useAppConfig.ts` 变更

**CSS 变量同步**：将 `--font-size` 改由 `appearanceFontSize` 驱动：

```typescript
useEffect(() => {
  document.documentElement.style.setProperty("--font-size", `${config.appearanceFontSize}px`);
}, [config.appearanceFontSize]);
```

**默认值**：
```typescript
const DEFAULT_CONFIG: AppConfig = {
  // ...
  appearanceFontSize: 12,
  editorFontSize: 14,
  terminalFontSize: 14,
};
```

**迁移逻辑**（兼容旧配置）：
```typescript
if (typeof (saved as any).fontSize === "number") {
  // 旧 fontSize 迁移：terminalFontSize 优先保留，否则继承旧值
  if (typeof saved.terminalFontSize !== "number") {
    saved.terminalFontSize = (saved as any).fontSize;
  }
  delete (saved as any).fontSize;
}
```

**相等性检查**（防止不必要 re-render）：将比较字段从 `prev.fontSize` 改为三个新字段。

### 3. SettingsPanel UI 变更（`src/components/SettingsPanel.tsx`）

当前状态：Font Size 控件位于 **Editor** 面板，描述为 "Terminal and UI font size in pixels"，实际控制 `config.fontSize`。

新设计：

| 面板 | 设置项 | 字段 | 描述 |
|------|--------|------|------|
| **Appearance** | Font Size | `appearanceFontSize` | Controls sidebar, project list, file tree, and tab font size. |
| **Editor** | Font Size | `editorFontSize` | Controls CodeMirror editor font size in file viewer. |
| **Terminal** | Font Size | `terminalFontSize` | Controls xterm.js terminal and terminal tab font size. |

每个面板的 Font Size 控件保持现有 `+`/`-` 按钮交互模式，范围 10–24px。

旧 Editor 面板中 "Terminal and UI font size" 控件**替换**为 "Editor Font Size" 控件（描述改为 "Font size for the file editor."）。

### 4. 消费者更新

需要同步更新的文件：

| 文件 | 改动 |
|------|------|
| `src/types.ts` | 移除 `fontSize`，添加三个新字段 |
| `src/hooks/useAppConfig.ts` | 更新默认值、CSS 变量同步、迁移逻辑、相等性检查 |
| `src/components/SettingsPanel.tsx` | Appearance/Editor/Terminal 三个面板各加独立 Font Size 控件；移除旧的 Editor 面板中的 `fontSize` 控件 |
| `src/components/panels/FileViewer.tsx` | `fontSize` prop → `editorFontSize`，或接收方改用 `config.editorFontSize` |
| `src/components/terminal/TerminalView.tsx` | `fontSize` prop 接收/使用 `terminalFontSize` |
| `src/components/terminal/WorktreeTerminalView.tsx` | 同上 |
| `src/components/terminal/WSLTerminalView.tsx` | 同上 |
| `src/components/terminal/RemoteTerminalView.tsx` | 同上 |
| `src/components/MainContent.tsx` | 传递 `config.terminalFontSize` 给终端组件；传递 `config.editorFontSize` 给 FileViewer |
| `src/components/RemoteProjectView.tsx` | `config.fontSize` → `config.terminalFontSize` |
| `src/hooks/useAppCallbacks.ts` | `terminalFontSize` 参数字段名无需变更（已是独立参数），但传值处需改为 `config.terminalFontSize` |
| `src/hooks/useWslActions.ts` | 检查是否使用 `fontSize`，改为 `terminalFontSize` |

### 5. 终端 Tab 字体大小

终端 Tab（`src/components/layout/TerminalTab.tsx`）当前使用 CSS 变量 `--font-size` 控制字体（通过 `body` 继承）。`--font-size` 将改由 `appearanceFontSize` 驱动，但终端 Tab 字体应跟随 **`terminalFontSize`**。

需新增 CSS 变量 `--terminal-font-size`，由 `terminalFontSize` 驱动：

```typescript
// useAppConfig.ts
document.documentElement.style.setProperty("--terminal-font-size", `${config.terminalFontSize}px`);
```

在 `TerminalTab.tsx` 中显式使用 `text-[var(--terminal-font-size)]` 或内联 style。

### 6. CSS 变量（`src/styles/theme.css`）

```css
:root {
  --font-size: 12px;           /* 改为 12，由 appearanceFontSize 驱动 */
  --terminal-font-size: 14px;  /* 新增，由 terminalFontSize 驱动 */
}
```

## Acceptance Criteria

- [ ] `AppConfig` 中 `fontSize` 已替换为 `appearanceFontSize`、`editorFontSize`、`terminalFontSize`
- [ ] Settings Appearance 面板有独立 Font Size 控件（10–24px，默认 12）
- [ ] Settings Editor 面板有独立 Font Size 控件（10–24px，默认 14）
- [ ] Settings Terminal 面板有独立 Font Size 控件（10–24px，默认 14）
- [ ] 调整 `appearanceFontSize` 时，侧边栏项目名、文件树、FilesPanel Tab 字体实时变化
- [ ] 调整 `editorFontSize` 时，FileViewer CodeMirror 编辑器字体实时变化
- [ ] 调整 `terminalFontSize` 时，xterm.js 终端字体及终端 Tab 字体实时变化
- [ ] 旧 `fontSize` 配置能正确迁移（迁移为 `terminalFontSize`）
- [ ] TypeScript 编译无错误（`npx tsc --noEmit`）
- [ ] 前端测试通过（`pnpm test`）

## Out of Scope

- 字体大小不跟随窗口缩放
- 不增加"恢复默认"按钮
- 不增加字号预览
- WSLTerminalView / RemoteTerminalView 中 Side Terminal 的独立字体设置（统一使用 `terminalFontSize`）
