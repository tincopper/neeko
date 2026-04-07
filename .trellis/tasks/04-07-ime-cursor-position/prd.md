# 分析：输入法候选窗口位置不在光标处

## Goal

分析并定位终端中输入法（IME）候选窗口不跟随光标位置的根本原因，为后续修复提供依据。

## 问题描述

在使用输入法（如中文输入法）输入时，候选词窗口没有出现在终端光标所在位置，而是出现在其他位置（可能是窗口左上角或固定位置）。

## 代码分析

### 1. IME 组合处理机制（TerminalView.tsx:220-308）

当前实现：
- Unix 系统禁用 PTY 回显（ECHO），由前端负责显示用户输入
- `keydown` 事件中检测 keyCode 229 来识别 IME 组合开始
- `compositionend` 时手动发送最终字符到 PTY 并在前端显示
- 使用 `isComposing` 标志阻断 `onData` 避免重复发送

**问题**：代码只处理了 IME 输入的**数据流**，没有处理 IME 候选窗口的**位置**。

### 2. xterm.js 候选窗口定位原理

xterm.js 使用一个隐藏的 textarea（`.xterm-helper-textarea`）来接收键盘输入。浏览器/WebView 的 IME 候选窗口位置取决于这个 textarea 的位置。

xterm.js 内部会：
1. 在光标位置处放置 `.xterm-helper-textarea`
2. 通过 CSS `transform` 或 `top/left` 定位到光标所在行列

### 3. 当前 CSS 样式（styles.css:1835-1863）

```css
.terminal-wrapper { padding: 4px; ... }
.terminal-wrapper .xterm { height: 100%; }
.terminal-wrapper .xterm-viewport { overflow-y: auto !important; }
.terminal-wrapper .xterm-screen { height: 100%; }
```

**潜在问题**：
- `padding: 4px` 在容器上，可能影响 textarea 的绝对定位计算
- `overflow-y: auto` 在 `.xterm-viewport` 上，可能裁剪或影响定位
- 没有针对 `.xterm-helper-textarea` 的特殊处理

### 4. Tauri WebView 特性

Tauri v2 在各平台使用系统 WebView：
- **Windows**: WebView2 (Chromium)
- **macOS**: WKWebView (WebKit)
- **Linux**: WebKitGTK

不同 WebView 对 IME 候选窗口定位的处理可能不同。

## 根本原因分析

### 最可能的原因：`.xterm-helper-textarea` 定位失效

xterm.js 通过以下方式定位 helper textarea：
1. 获取光标在 `.xterm-screen` 中的像素坐标
2. 将 `.xterm-helper-textarea` 设置为 `position: absolute` 并定位到该坐标

可能导致定位失效的因素：

1. **CSS 容器层级问题**
   - `.terminal-wrapper` → `.xterm` → `.xterm-viewport` → `.xterm-screen`
   - 如果任一层级的 `position` 或 `overflow` 设置不当，绝对定位计算会出错

2. **滚动偏移未正确处理**
   - `.xterm-viewport` 设置了 `overflow-y: auto`
   - 当终端有滚动时，textarea 的定位可能没有考虑滚动偏移

3. **Tauri WebView 的 IME 定位行为**
   - 某些 WebView 版本可能不完全遵循 CSS 定位来确定 IME 窗口位置
   - 可能需要显式设置或调用特定 API

4. **xterm.js 版本问题**
   - 不同版本的 xterm.js 对 IME 定位的处理可能不同

## 验证方向

### 方法 1：检查 DOM 结构
在 DevTools 中检查 `.xterm-helper-textarea` 的：
- `position` 属性值
- `top/left/transform` 值
- 是否在光标位置

### 方法 2：检查 CSS 继承
检查从 `.terminal-wrapper` 到 `.xterm-helper-textarea` 的完整 CSS 继承链，确认没有意外的 `position` 或 `transform` 设置。

### 方法 3：对比正常工作的终端
对比 VS Code 终端或其他基于 xterm.js 的终端的 DOM 结构和 CSS 设置。

## 可能的修复方向

### 方案 A：确保正确的 CSS 层级
```css
.xterm { position: relative; }
.xterm-helper-textarea {
  position: absolute !important;
  /* 确保不被其他样式覆盖 */
}
```

### 方案 B：使用 xterm.js API 手动定位
某些 xterm.js 版本提供了 `registerDecoration` 或其他 API 来控制元素位置。

### 方案 C：Tauri WebView 配置
检查 Tauri 配置中是否有 IME 相关的选项，或需要在 Rust 端设置 WebView 属性。

## 技术笔记

- xterm.js 版本：需要确认（在 package.json 中）
- Tauri v2 可能有 WebView IME 配置选项需要探索
- Windows 上 WebView2 的 IME 行为可能与 macOS/Linux 不同

## 修复方案（已实现）

### 问题根因

xterm.js 6.0.0 中 `.xterm-helper-textarea` 的位置在 IME composition 开始时没有同步到光标位置。这是 xterm.js 的一个已知 bug，已在 7.0.0 中修复（PR #5759）。

### 实现的修复

在 `TerminalView.tsx` 中添加 `syncTextareaToCursor()` 函数，在 IME composition 开始前将 helper textarea 定位到光标位置：

```typescript
const syncTextareaToCursor = () => {
  const cursorEl = element.querySelector('.xterm-cursor')
  if (!cursorEl) return
  const cursorRect = cursorEl.getBoundingClientRect()
  const containerRect = element.getBoundingClientRect()
  const top = cursorRect.top - containerRect.top
  const left = cursorRect.left - containerRect.left
  textarea.style.top = `${top}px`
  textarea.style.left = `${left}px`
}
```

在 `keydown(229)` 和 `compositionstart` 事件中调用此函数，确保 IME 候选窗口出现在光标位置。

### 参考

- xterm.js PR #5759: fix(ime): resync textarea position when composition starts
- 目标版本: xterm.js 7.0.0（当前使用 6.0.0）
