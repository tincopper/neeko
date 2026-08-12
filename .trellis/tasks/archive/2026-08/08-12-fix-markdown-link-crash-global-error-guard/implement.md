# 执行计划：Markdown 内部链接点击闪退修复 + 全局错误防护

> 遵循 TDD：每个改动先红后绿再重构。
> 任务激活：`python3 ./.trellis/scripts/task.py start`（review 通过后）。
> 全程不 git commit（归属用户）。

## 阶段 0：基线验证

- [ ] 运行 `pnpm lint:fe`、`pnpm type-check`、`pnpm test:run`、`cargo check --manifest-path src-tauri/Cargo.toml`，确认基线绿。
- [ ] 人工复现：编辑器打开含 `[x](./guide.md)` 的 md 预览点击 → 确认崩溃（记录现场，验证 Red）。

## 阶段 1：交付物 A —— Markdown 链接行为修复

### 1.1 纯函数 resolveInternalHref（Red → Green）
- [ ] 在 `src/shared/utils/`（或 `src/features/file/utils/`）新增纯函数 `resolveInternalHref(href, basePath)`。
- [ ] 先写测试（Tier 1 纯函数，覆盖 ./、../、绝对、Windows 反斜杠、#anchor、空 href）并确认失败。
- [ ] 实现函数，确认测试绿。

### 1.2 MarkdownPreview 链接拦截（组件测试）
- [ ] 写组件测试：内部链接点击调用 `preventDefault` 且触发 `onInternalLinkClick`；外链不拦截（行为不回归）；无 handler 时触发 notificationStore。
- [ ] 修改 `src/ui/MarkdownPreview.tsx`：
  - `a` 组件加 `onClick`，内部链接 `preventDefault()`。
  - 有 `basePath` → resolve → `onInternalLinkClick?.(abs)`。
  - 无 handler / resolve 为空 → `notificationStore.addNotification` error toast（节流）。
- [ ] 测试转绿。

### 1.3 FileEditor 接入打开文件
- [ ] `src/features/editor/components/FileEditor.tsx`：`useFileActionsContext()` 取 `onFileSelect`，传给 `<MarkdownPreview onInternalLinkClick={...}>`，内部 `try/catch` 打开失败时 toast。
- [ ] 验证：点击有效内部链接打开新 tab；无效链接 toast 不崩溃。

## 阶段 2：交付物 B —— 全局错误上报

### 2.1 Rust 日志命令
- [ ] 在 `src-tauri/src/common/commands.rs`（如无则新建并挂到 `mod.rs`）新增 `log_frontend_error(source, message, stack)`，内部 `log::error!`。
- [ ] 注册进 `src-tauri/src/lib.rs` 的 `neeko_invoke_handler!`。
- [ ] `cargo check` 绿；补 Rust 单测（存在性/格式）。

### 2.2 前端全局 handler 增强
- [ ] 写测试：`registerGlobalErrorHandlers` 捕获 `window.error` / `unhandledrejection` → 调用 `invoke('log_frontend_error', ...)`（mock invoke）+ 触发 notification（节流断言）。
- [ ] 实现 `src/app/registerGlobalErrorHandlers.ts`：`preventDefault` + 节流 + `invoke` + notificationStore 提示。
- [ ] `ErrorBoundary.tsx` `componentDidCatch` 追加 `reportFrontendError('render', error)`。

## 阶段 3：收尾验证

- [ ] `pnpm lint:fe`、`pnpm type-check`、`pnpm test:run`、`cargo test --manifest-path src-tauri/Cargo.toml` 全绿。
- [ ] 人工回归：
  - 编辑器 md 预览点击内部链接 → 打开文件（不再闪退）。
  - 对话/PR 文档内内部链接 → toast 不崩溃。
  - 外链 `_blank` 行为不变。
  - 制造一个 `Promise.reject` → 应用存活 + neeko.log 出现 `[Frontend]` 记录 + 一次 toast。
  - 制造渲染错误 → ErrorBoundary 错误页 + neeko.log 记录。
- [ ] 检查 `~/.neeko/neeko.log` 确认 `[Frontend]` 条目落盘。
- [ ] 同步更新 docs（如 `docs/neeko-development-spec.md` 有涉及错误处理的红线说明）。

## Review Gates

1. `MarkdownPreview` 仍是纯 UI（不 import editor store，仅 props + notificationStore 兜底）。
2. 命令层极薄：`log_frontend_error` 无业务逻辑。
3. 无新增 `.catch(() => {})` 吞错；上报链路自身失败静默属例外。
4. 未改动主窗口 navigation（受 Tauri API 限制，已在 design.md 记录理由）。
