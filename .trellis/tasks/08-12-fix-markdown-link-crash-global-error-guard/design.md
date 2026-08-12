# 技术设计：Markdown 内部链接点击闪退修复 + 全局错误防护

## 1. 目标边界

- 前后端两个可独立验证的交付物：(A) Markdown 链接行为修复，(B) 前端错误上报到 Rust 日志 + 用户提示。
- 不触碰 Tauri 主窗口 navigation 拦截（受 Tauri 2 API 限制，见 §4）。

## 2. 架构约束

- `MarkdownPreview` 是共享纯 UI 组件（`src/ui/MarkdownPreview.tsx`），**不直接依赖 editor store / context**，通过 props 注入行为（现有 `basePath` 模式一致）。
- 打开文件能力已存在于 `FileActionsContext.onFileSelect`（`useAppShell.ts:187` → `fileView.openFile`，含 WSL/Remote 分发）。MarkdownPreview 的上层（FileEditor 的宿主）从 context 取该函数注入。
- 前端错误上报走新增 Rust 命令，命令注册必须进 `src-tauri/src/lib.rs` 的 `neeko_invoke_handler!`（单一事实源）。

## 3. 前端设计

### 3.1 MarkdownPreview 链接点击处理（交付物 A）

`src/ui/MarkdownPreview.tsx`：

- 新增 props：
  ```ts
  interface MarkdownPreviewProps {
    // ...existing
    /** 点击内部相对链接时的处理；返回 false/不返回则已由调用方处理 */
    onInternalLinkClick?: (absPath: string) => void;
  }
  ```
- `a` 组件改造：
  ```tsx
  a({ href, children, ...props }) {
    const isExternal = href && /^(https?:)?\/\//.test(href);
    return (
      <a
        href={href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        onClick={(e) => {
          if (isExternal) return;           // 外链保持默认（新窗口）
          e.preventDefault();               // 阻断 webview 导航（崩溃根因）
          if (href && basePath) {
            const abs = resolveInternalHref(href, basePath);
            onInternalLinkClick?.(abs);
          } else {
            onInternalLinkClick?.(href ?? ''); // 无 basePath 时交给调用方决定
          }
        }}
        {...props}
      >
        {children}
      </a>
    );
  }
  ```
- 新增纯函数 `resolveInternalHref(href, basePath)`：处理 `./`、`../`、`#锚点`（丢弃 hash 取路径）、绝对路径、Windows 反斜杠，产出绝对路径。可单测（Tier 1 纯函数）。

### 3.2 打开文件接入（交付物 A）

- FileEditor 场景（`src/features/editor/components/FileEditor.tsx`，有 `projectPath`/`basePath`）：
  - 从 `useFileActionsContext()` 取 `onFileSelect`。
  - 向 `<MarkdownPreview>` 传 `onInternalLinkClick={(abs) => onFileSelect(abs)}`。
  - `onFileSelect`（= `fileView.openFile`）内部已处理 tab 去重、内容读取、错误时 `setError`（见 `useFileViewTabOps.ts:35-112`）。打开失败时给出 toast：FileEditor 层包一层 `try/catch` → toast。
- 无 `basePath` 场景（conversation / PR / skill，不传 `onInternalLinkClick`）：
  - `onClick` 仍 `preventDefault`（阻断导航 = 不再崩溃）。
  - 无 handler 时给一次 toast 提示"该链接无法在应用中打开"——通过模块级轻量 toast 通道（`notificationStore.addNotification`，zustand 可脱离组件调用，`useAppShell.ts:48` 同款）。
  - 或者更简单：统一由 MarkdownPreview 内部调用 `notificationStore` 做兜底提示，不依赖调用方。选后者，保持调用方零改动。

> 决策：MarkdownPreview 内部在"无 `onInternalLinkClick` 或 resolve 为空"时调用 `notificationStore.addNotification({type:'error', ...})` 提示；有 handler 时交调用方。职责单一、调用方无需感知。

### 3.3 全局错误上报（交付物 B）

`src/app/registerGlobalErrorHandlers.ts` 增强：

- 保留 `preventDefault()`（阻断默认，防黑屏）。
- 新增 `reportFrontendError(source: string, error: unknown)`：
  - 节流：同一 source 5s 内只发一次（模块级 Map + timestamp），防刷屏。
  - 调用新增 Rust 命令 `log_frontend_error`（带 `source`、`message`、`stack`）。
  - 调 `notificationStore.addNotification({ type:'error', title:'前端错误', message: 截断到 200 字符 })` 提示用户。
- `ErrorBoundary.tsx` 的 `componentDidCatch` 追加调用 `reportFrontendError('render', error)`，并保留现有 `console.error`。

`invoke` 调用失败自身要静默（`.catch(() => {})`），避免上报链路二次崩溃。

## 4. 后端设计

### 4.1 主窗口 navigation 拦截（明确不做的原因）

Tauri 2.10 中 `on_navigation` / `on_new_window` 仅在 `WebviewWindowBuilder` / `WebviewBuilder` 提供（`tauri-2.10.3/src/webview/webview_window.rs:270,320`）；主窗口由 `tauri.conf.json` 的 `windows` 配置自动创建，运行期无法给已存在窗口附加该回调。因此"从源头阻断导航"必须在**前端 `preventDefault`** 完成，这是唯一可行且最低成本的拦截点。

### 4.2 新增日志命令（交付物 B）

`src-tauri/src/common/commands.rs`（或就近域模块）新增：

```rust
#[tauri::command]
pub fn log_frontend_error(source: String, message: String, stack: Option<String>) {
    match stack {
        Some(s) => log::error!("[Frontend][{source}] {message}\n{s}"),
        None => log::error!("[Frontend][{source}] {message}"),
    }
}
```

- 同步命令（无 I/O，仅写日志），无需 async。
- 注册：`src-tauri/src/lib.rs` 的 `neeko_invoke_handler!` 中加入 `$crate::common::commands::log_frontend_error,`。
- 不返回 `Result`：前端无需处理失败，保持极薄命令层。

## 5. 数据流

```
点击 <a href="./guide.md">
  → MarkdownPreview onClick
    → preventDefault()（阻断导航，崩溃根因消除）
    → basePath 存在 → resolveInternalHref() → onInternalLinkClick(abs)
      → onFileSelect(abs) → fileView.openFile(abs) → 编辑器 tab / toast
    → 无 handler / resolve 空 → notificationStore.addNotification(error toast)

前端任意未捕获 Error / PromiseRejection / 渲染错误
  → registerGlobalErrorHandlers / ErrorBoundary.componentDidCatch
    → reportFrontendError() [节流]
      → invoke('log_frontend_error', {source, message, stack}) → Rust log::error!
        → ~/.neeko/neeko.log
      → notificationStore.addNotification(error toast)   // 用户可见，不崩溃
```

## 6. 兼容性 / 回滚

- 纯增量：新增 prop（可选）、新增命令、增强现有 handler。旧调用方不受影响（`onInternalLinkClick` 未传时行为＝preventDefault + toast，优于现在的闪退）。
- 回滚：移除 `onClick` 逻辑 + 命令注册即可回到现状；无 schema/持久化变更。
- `notificationStore` 无头调用需确认 store 在 `AppProviders` 中已挂载（zustand store 模块级初始化，未挂载时 `getState()` 仍可用，toast 队列由 provider 消费；若 provider 未挂载仅不显示，不影响正确性）。

## 7. 测试策略

| 层级 | 用例 |
| --- | --- |
| 纯函数 `resolveInternalHref` | `./a.md`→basePath/a.md；`../x/y.md`；绝对路径；Windows 反斜杠；`#anchor` 去 hash |
| 组件（MarkdownPreview） | 点击内部链接调用 `preventDefault` + 触发 `onInternalLinkClick`；外链不拦截；无 handler 时触发 toast |
| Rust（`log_frontend_error`） | 命令存在且可被 `neeko_invoke_handler!` 解析（编译期）；日志写入正确格式 |
| 集成 | 全局 handler 捕获 `unhandledrejection` → mock invoke 断言参数 |
