# 修复 Markdown 内部链接点击闪退与建立全局错误防护

## Goal

修复两个紧密关联的问题：

1. **点击 Markdown 文档内的内部相对链接（如 `[文档](./other.md)`、`[x](guide.md)`）导致应用闪退**，且 `~/.neeko/neeko.log` 无任何错误记录。
2. **建立全局错误防护**：即使前端发生未捕获错误，应用不退出、不重启，只让受影响的功能给出可感知的报错提示，同时把错误写入日志，杜绝"静默崩溃无从排查"。

## Background / 已确认事实

- **闪退根因**：`src/ui/MarkdownPreview.tsx:271-283` 渲染 `a` 链接时仅对 `http(s)` 外链设置 `target="_blank"`；内部相对链接（`./xxx.md`）不设置 `target`，点击后触发**主窗口 webview 页面导航**。主窗口由 `tauri.conf.json` 生成，`app.rs` 未挂 `on_navigation` / `on_new_window` 拦截（Tauri 2 中该回调只在 `WebviewWindowBuilder` / `WebviewBuilder` 上，config 自动创建的窗口无法挂载）。SPA 没有 `./other.md` 路由 → 渲染进程崩溃/白屏。
- **日志无错误的根因**：前端全局错误处理 `src/app/registerGlobalErrorHandlers.ts` 只 `console.error` 到 DevTools（release 构建不可见）；13 个文件用 `.catch(console.error)`、大量 `.catch(() => {})` 静默吞错；没有任何前端错误 → Rust `neeko.log` 的上报桥。
- **现有兜底**：`app.rs` 的 `spawn_heartbeat_monitor`（30s 心跳超时 reload 主窗口）只恢复不记录；`ErrorBoundary.tsx` 只捕获渲染错误且无日志上报；`FileActionsContext.onFileSelect`（`useAppShell.ts:187` → `fileView.openFile`）已具备"打开文件到编辑器"能力。
- `MarkdownPreview` 是共享 UI 组件，被 FileEditor（编辑器预览）、conversation MessageBlocks、skill ViewSkillDialog、git PRDescription 四类场景复用，其中仅 FileEditor 场景有 `basePath`。

## Requirements

### R1：Markdown 内部链接不再触发崩溃
1. `MarkdownPreview` 渲染的所有链接必须**拦截非 http(s) 的点击默认行为**（`preventDefault`），阻断 webview 页面导航。
2. 编辑器内 Markdown 预览（有 `basePath`）点击内部相对链接时：resolve 为绝对路径并在当前项目编辑器中**打开对应文件**（复用现有打开文件能力）。
3. 无法打开时（无 `basePath`、文件不存在、非文件类型）给出**可感知提示**（toast），而不是静默无响应。
4. 外链（http/https）保持现有 `target="_blank"` 行为不变。

### R2：全局错误防护（不崩溃 / 不重启 / 有提示 / 有日志）
5. 前端全局捕获 `window.onerror` 与 `unhandledrejection`：**阻断默认行为**，并向用户展示一次错误提示（toast，节流防刷屏）。
6. 捕获到的错误通过新增 Rust 命令写入 `~/.neeko/neeko.log`（带时间戳、来源、堆栈）。
7. `ErrorBoundary` 捕获到的渲染错误同样上报到该日志。
8. 保证不触发应用退出/重载：错误提示只针对受影响功能，不影响应用存活。

## Acceptance Criteria

- [ ] 在编辑器内打开含 `[x](./guide.md)` 的 markdown 预览，点击链接：不再闪退，目标 md 文件在新编辑器 tab 打开；若链接失效，弹出 error toast。
- [ ] 无 `basePath` 场景（对话/PR/skill 文档）点击内部链接：不崩溃，给出提示（toast 或静默，可配置）。
- [ ] 前端抛出的未捕获 `Error` 与 `PromiseRejection`：应用不崩溃/不重启，出现一次 error toast，且 `~/.neeko/neeko.log` 出现对应 `[Frontend]` 错误记录。
- [ ] `ErrorBoundary` 捕获的渲染错误写入 `neeko.log`。
- [ ] 外链（http/https）仍以新窗口/外部浏览器打开，行为不回归。
- [ ] `pnpm lint:fe`、`pnpm type-check`、`pnpm test:run` 全部通过。

## Out of Scope

- 修改 Tauri 主窗口的 navigation 拦截（config 窗口无法挂 builder 回调，非本任务范围）。
- 逐行排查并消除存量 `.catch(() => {})` 静默吞错（建议另立任务）。
- 新增 toast 之外的全局错误 UI（如错误面板）。
- WSL/SSH 远程场景下 markdown 预览的特殊处理（与本地行为一致即可）。

## Open Questions

- 无（行为已由需求确认）。
