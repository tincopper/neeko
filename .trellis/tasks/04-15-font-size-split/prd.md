# Task: Settings Font Size Split

## Overview

将 Settings 中现有的单个 `fontSize` 字体大小设置拆分为 3 个独立的配置项，分别控制不同区域的字体大小。

## 现状分析

当前 `AppConfig` 中只有一个 `fontSize: number`，同时用于：
- 终端（xterm.js 的 fontSize）
- 编辑器（CodeMirror 的 fontSize）
- UI 文本（通过 CSS 变量 `--font-size`）

这种设计无法满足用户需要为不同区域设置不同字体大小的需求。

## 需求

### 1. AppConfig 字段变更

```typescript
// 旧
export interface AppConfig {
  fontSize: number;
  // ...
}

// 新
export interface AppConfig {
  appearanceFontSize: number;  // 整体 UI 字体（侧边栏、文件树等）
  editorFontSize: number;      // 编辑器字体（CodeMirror）
  terminalFontSize: number;    // 终端字体（xterm.js）
  // ... 移除 fontSize
}
```

- 默认值：`appearanceFontSize: 12`，`editorFontSize: 14`，`terminalFontSize: 14`
- 范围：每个都在 10-24px 之间

### 2. SettingsPanel UI 变更

| 设置项 | 位置 | 说明 |
|--------|------|------|
| Appearance Font Size | Appearance 面板 | 控制侧边栏、Projects 列表、FileTree 字体 |
| Editor Font Size | Editor 面板 | 控制 FileViewer 中 CodeMirror 编辑器字体 |
| Terminal Font Size | Terminal 面板 | 控制终端（xterm.js）字体 |

每个面板的 Font Size 设置项保持现有的 +/- 按钮交互模式。

### 3. CSS 变量

将 `--font-size` CSS 变量改为由 `appearanceFontSize` 驱动。在 `useAppConfig.ts` 的同步逻辑中：

```typescript
document.documentElement.style.setProperty("--font-size", `${config.appearanceFontSize}px`);
```

### 4. 消费者更新

需要更新的文件：

| 文件 | 用途 | 改动 |
|------|------|------|
| `src/types.ts` | AppConfig 类型 | 移除 `fontSize`，添加 3 个新字段 |
| `src/hooks/useAppConfig.ts` | 配置同步 | 更新 CSS 变量同步、默认值、迁移逻辑 |
| `src/components/SettingsPanel.tsx` | 设置 UI | Appearance/Editor/Terminal 面板各加 Font Size |
| `src/components/panels/FileViewer.tsx` | 编辑器 | 使用 `config.editorFontSize` |
| `src/utils/codemirror.ts` | CodeMirror 配置 | `getCmFontStyle` 无变化（参数来自调用方） |
| `src/components/terminal/TerminalView.tsx` | 终端 | 使用 `config.terminalFontSize` |
| `src/components/terminal/SideTerminalView.tsx` | 副终端 | 使用 `config.terminalFontSize` |
| `src/components/terminal/WSLTerminalView.tsx` | WSL 终端 | 使用 `config.terminalFontSize` |
| `src/components/terminal/RemoteTerminalView.tsx` | SSH 终端 | 使用 `config.terminalFontSize` |
| `src/components/terminal/WorktreeTerminalView.tsx` | Worktree 终端 | 使用 `config.terminalFontSize` |
| `src/components/MainContent.tsx` | 主内容区 | 传递 `config.terminalFontSize` 给终端组件 |

### 5. 迁移逻辑

`useAppConfig.ts` 中需要兼容旧的 `fontSize` 配置（如果用户之前保存过）：

```typescript
if (saved.fontSize !== undefined) {
  // 迁移旧配置：fontSize → terminalFontSize
  if (typeof saved.terminalFontSize !== "number") {
    saved.terminalFontSize = saved.fontSize;
  }
  delete saved.fontSize;
}
```

## Acceptance Criteria

- [ ] AppConfig 中 `fontSize` 已替换为 `appearanceFontSize`、`editorFontSize`、`terminalFontSize`
- [ ] Settings Panel 三个面板各自有独立的 Font Size 设置
- [ ] Appearance 面板调整 `appearanceFontSize` 时，侧边栏和文件树字体实时变化
- [ ] Editor 面板调整 `editorFontSize` 时，CodeMirror 编辑器字体实时变化
- [ ] Terminal 面板调整 `terminalFontSize` 时，终端字体实时变化
- [ ] 旧的 `fontSize` 配置能正确迁移
- [ ] 所有测试通过（TypeScript + Rust + 前端测试）

## Out of Scope

- 字体大小不跟随窗口缩放
- 不增加"恢复默认"按钮
- 不增加字号预览
