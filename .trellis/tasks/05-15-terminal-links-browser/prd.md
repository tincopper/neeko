# Task: Terminal Link Click & Embedded Browser Preview

## Overview

在 Neeko 终端中支持链接跳转与文件路径点击，并新增内嵌浏览器 Dock 面板实现实时页面预览和调试。

### 核心交互

| 用户行为 | 系统响应 |
|----------|----------|
| 终端中点击 URL (http/https) | 右侧 Dock 展开 Browser 面板，内嵌浏览器导航到该 URL |
| 终端中点击文件路径 (如 `src/main.rs:42:10`) | 系统文件管理器中 reveal 并选中该文件 |
| 终端中点击目录路径 | 系统文件管理器中打开该目录 |
| 终端中 OSC 8 超链接 | 内嵌浏览器中打开 |
| 手动在地址栏输入 URL | 内嵌浏览器导航并渲染 |
| 点击 DevTools 按钮 | 弹出内嵌浏览器的独立 DevTools 窗口 |

## Requirements

### R1: 终端链接检测与跳转

- R1.1: 使用 `@xterm/addon-web-links` 自动检测终端输出中的 HTTP/HTTPS URL
- R1.2: 使用 `term.registerLinkProvider` 注册文件路径检测（支持以下格式）：
  - 绝对路径: `C:\Users\...\file.rs:10:5` 或 `/home/.../file.rs:10:5`
  - 相对路径: `src/main.rs:10:5`、`./path/to/file:20`
  - MSVC 格式: `file.rs(10,5)`
- R1.3: 支持 OSC 8 超链接（终端程序输出的标准超链接协议）
- R1.4: 仅本地项目启用文件路径 reveal 功能（WSL/Remote 终端不调用）

### R2: 文件/目录 Reveal

- R2.1: 新增 Tauri 命令 `reveal_in_file_manager(path: String)`
- R2.2: Windows 实现：文件用 `explorer /select,path`，文件夹用 `explorer path`
- R2.3: 文件路径 resolve：相对路径拼接 `projectPath` 变为绝对路径
- R2.4: 兼容正斜杠和反斜杠路径分隔符

### R3: URL 点击 → 内嵌浏览器打开

- R3.1: URL 点击不使用系统浏览器，而是在内嵌浏览器 Dock 面板中打开
- R3.2: 若 Browser 面板未展开，点击 URL 时自动展开右侧 Browser 面板
- R3.3: 通过 Zustand store 实现终端链接模块 → Browser 面板的跨组件通信

### R4: 内嵌浏览器 Dock 面板

- R4.1: 使用 Tauri 2 原生多 Webview 方案（`WebviewBuilder` + `Window::add_child`）
- R4.2: 启用 `unstable` feature（`Cargo.toml`）
- R4.3: 支持任意 URL 访问（http/https，无跨域限制）
- R4.4: 注册到右侧 Dock 栏（dockPanels.ts），可通过 DockBar 图标切换
- R4.5: 使用 `ResizeObserver` 同步面板与原生 webview 的位置和大小
- R4.6: 面板折叠/切换时隐藏 webview，展开时显示
- R4.7: 组件 unmount 时销毁 webview
- R4.8: 同时只存在一个浏览器 webview 实例

### R5: 浏览器工具栏

- R5.1: 地址栏 `<input>` 显示当前 URL，回车触发导航
- R5.2: 刷新按钮，重新导航到当前 URL
- R5.3: DevTools 按钮，调用 `browser_open_devtools` 弹出调试窗口
- R5.4: 地址栏支持手动输入任意 URL

### R6: 后端 Tauri 命令

- R6.1: `create_browser_webview(url, x, y, width, height)` → 创建 webview，返回 label
- R6.2: `browser_navigate(label, url)` → 导航到新 URL
- R6.3: `browser_set_bounds(label, x, y, width, height)` → 更新位置大小
- R6.4: `browser_open_devtools(label)` → 打开 DevTools
- R6.5: `browser_close(label)` → 销毁 webview
- R6.6: `browser_set_visible(label, visible)` → 显示/隐藏
- R6.7: `reveal_in_file_manager(path)` → 在文件管理器中打开/选中
- R6.8: 所有 browser 命令必须是 `async`（Windows 同步创建 webview 会死锁）
- R6.9: `on_navigation` 回调仅允许 http/https scheme

### R7: 权限与配置

- R7.1: `Cargo.toml` 添加 `unstable` feature
- R7.2: `capabilities/default.json` 添加 webview 相关权限
- R7.3: `package.json` 添加 `@xterm/addon-web-links` 依赖

## Acceptance Criteria

- [ ] 终端中 `echo https://github.com` 后，链接可点击，Browser 面板自动展开并加载页面
- [ ] Rust 编译错误输出中的文件路径可点击，Windows Explorer 中 reveal 选中
- [ ] 终端中输入目录路径可点击，Explorer 中打开该目录
- [ ] `ls --hyperlink` 输出的 OSC 8 链接可点击并在 Browser 面板打开
- [ ] Browser 面板地址栏输入 URL + 回车 → 页面正确渲染
- [ ] 刷新按钮正常工作
- [ ] DevTools 按钮弹出独立调试窗口
- [ ] 面板 resize 时 webview 跟随调整大小
- [ ] 切换到 Files 面板再切回 Browser → webview 正确显示/隐藏
- [ ] 关闭项目或 unmount → webview 正确销毁
- [ ] `cargo check` 编译通过
- [ ] `pnpm type-check` 类型检查通过
- [ ] `pnpm lint` 无新增 lint 错误

## Development Constraints

### C1: TDD 驱动开发

本任务严格遵循 **测试驱动开发**（Test-Driven Development）流程，每个功能模块必须经历 **Red → Green → Refactor** 循环：

**流程要求**：
1. **Red**：先编写失败的测试用例，明确功能预期行为
2. **Green**：编写最小可行代码使测试通过
3. **Refactor**：在测试保护下重构代码，消除重复、提升可读性

**测试分层**：

| 层级 | 工具 | 覆盖范围 |
|------|------|----------|
| 单元测试（Rust） | `cargo test` + `#[cfg(test)]` | 命令参数解析、路径 resolve 逻辑、URL 校验 |
| 单元测试（前端） | `vitest` | hook 逻辑、store 状态流转、正则匹配函数 |
| 集成测试 | `cargo test` + `pnpm test:run` | Tauri 命令调用链、store ↔ 组件交互 |

**测试先行要求**：
- `opener.rs`：测试路径判断（文件 vs 文件夹）、路径规范化
- `browser.rs`：测试 URL scheme 校验（仅允许 http/https）、label 唯一性生成
- `terminalLinks.ts`：测试文件路径正则匹配（绝对路径、相对路径、MSVC 格式、行号列号提取）
- `useBrowserPanel.ts`：测试状态流转（未创建 → 已创建 → 导航中 → 已加载）
- `browserStore.ts`：测试 `navigateTo()` 触发面板激活 + URL 更新的联动逻辑

**验收标准追加**：
- [ ] 后端新增模块 `#[cfg(test)]` 测试全部通过
- [ ] 前端新增模块 vitest 测试全部通过
- [ ] `pnpm test:run` 无失败
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 无失败

### C2: 高内聚、低耦合

**高内聚原则**：
- 每个模块/组件只负责**单一职责**，内部元素紧密关联
- `opener.rs`：只负责系统文件管理器操作，不涉及浏览器逻辑
- `browser.rs`：只负责 webview 生命周期管理，不涉及 UI 渲染
- `terminalLinks.ts`：只负责链接检测与事件分发，不直接操作 DOM 或 store
- `BrowserPanel.tsx`：只负责渲染占位区域和坐标同步，不包含链接解析逻辑
- `useBrowserPanel.ts`：只负责状态管理和 IPC 调用，不包含 UI 渲染

**低耦合原则**：
- 模块间通过**明确定义的接口**通信，不直接依赖内部实现
- 终端链接模块 → Browser 面板：通过 `browserStore` 的 `navigateTo()` 方法，不直接 import BrowserPanel
- Browser 面板 → 后端：通过 `invoke()` IPC 调用，不直接引用 Rust 类型
- Store 定义独立于组件：`browserStore` 不依赖任何 React 组件或 hook

**依赖方向约束**：
```
terminalLinks.ts  ──→  browserStore.ts  ──→  useBrowserPanel.ts  ──→  BrowserPanel.tsx
       │                      │                      │
       ↓                      ↓                      ↓
  (不依赖任何 store)    (不依赖任何组件)      (不依赖终端模块)
```

**禁止事项**：
- 禁止在 `terminalLinks.ts` 中直接 import `BrowserPanel` 或 `useBrowserPanel`
- 禁止在 `browserStore` 中 import React 组件
- 禁止在 `opener.rs` 中引用 browser 相关类型
- 禁止在 `BrowserPanel.tsx` 中硬编码终端事件监听

**模块边界清单**：

| 模块 | 输入 | 输出 | 不应知道 |
|------|------|------|----------|
| `opener.rs` | 文件路径字符串 | `Result<(), AppError>` | 浏览器、终端、UI |
| `browser.rs` | URL + 坐标 | `Result<String, AppError>` (label) | 终端、文件系统 |
| `terminalLinks.ts` | Terminal 实例 + projectPath | 调用 store navigateTo() | Browser 组件实现 |
| `browserStore.ts` | URL | 状态更新 + 面板激活 | DOM、Terminal 实例 |
| `useBrowserPanel.ts` | store 状态 | IPC 调用 + 状态同步 | 终端、文件操作 |
| `BrowserPanel.tsx` | hook 返回值 | React 渲染 | store 内部实现 |

## Technical Notes

### 技术方案

- **后端**: Tauri 2 原生多 Webview（`WebviewBuilder::new` + `Window::add_child`），需要 `unstable` feature
- **前端**: `@xterm/addon-web-links` + 自定义 `registerLinkProvider` + Browser Dock Panel 组件
- **跨组件通信**: Zustand store (`browserStore`) 实现终端 → Browser 面板的 URL 传递
- **坐标同步**: `ResizeObserver` + `invoke("browser_set_bounds")` 保持原生 webview 与 React DOM 同步

### 文件路径 LinkProvider 正则

```
/((?:[A-Z]:\\|\/|\.\/|\.\.\/)?[\w\-\.\/\\]+\.\w+)(?:[(\[](\d+)(?:[,:](\d+))?[)\]])?/g
```

### 已知风险

| 风险 | 对策 |
|------|------|
| `unstable` feature API 可能变化 | Tauri 2.x 内基本稳定，可控 |
| 原生 webview 浮在 React DOM 之上 | Dialog 打开时临时隐藏 webview |
| Windows 坐标偏移 (DPI) | 使用 LogicalPosition/LogicalSize |
| 面板动画期间闪烁 | 动画期间隐藏 webview |

## Out of Scope

- 不支持 WSL/SSH 远程项目的文件 reveal
- 不支持浏览器后退/前进导航按钮
- 不支持多标签浏览器（同时只有一个 webview 实例）
- 不支持 Cookie 持久化/书签等浏览器高级功能
- 不修改现有的 `HtmlPreview`（iframe 方案保持不变）
