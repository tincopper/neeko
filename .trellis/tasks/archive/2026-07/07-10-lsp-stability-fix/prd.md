# LSP 稳定性修复与 UX 改进

## Goal

修复 LSP hover 失效、跳转失败，并增加 session 生命周期状态可视化及 restart/stop 控制，使 LSP 体验接近 VSCode 水平。

## 问题清单（已通过代码审查确认）

### Bug 1: Hover 偶发不显示

- **evidence**: `manager.rs:586-639` — Session 惰性创建，首次请求时才 spawn 子进程 + initialize handshake。在此期间 `@codemirror/lsp-client` 已发送 hover 请求，但 server 可能尚未就绪。
- **evidence**: `useLspCapabilities.ts:55-57` — 用 dummy hover 探测就绪，返回后硬编码所有能力为 true，不反映真实 server capabilities。
- **severity**: P1

### Bug 2: 跳转定义失败

- **evidence**: `commands.rs:332-353` — `lsp_go_to_definition` 的 auto-didOpen **未调用 `register_open_document()`**，session 重启后文档丢失。
- **evidence**: 对比 `commands.rs:289-295` 中 `lsp_transport` 的 didOpen 处理正确调用了 `register_open_document()`，两处行为不一致。
- **severity**: P1

### Bug 3: 无 LSP 加载反馈

- **evidence**: `manager.rs:438-480` — `handle_progress_notification` 只打日志，不推送到前端。`IpcTransport::push_progress()` 已实现但从未被调用。
- **evidence**: `LspSessionInfo` 只有 `connected: bool`，无状态枚举。
- **severity**: P1

### Bug 4: lsp_close_session 不终止子进程

- **evidence**: `commands.rs:182-189` — 仅从 HashMap 移除条目，不发送 shutdown，不 kill 子进程，留下僵尸进程。
- **severity**: P2

### Bug 5: 应用退出时不关闭 LSP session

- **evidence**: `app_state.rs:27-40` — `shutdown_background_and_exit` 关闭了 terminal/watcher 但未调用 `lsp_manager.close_all_sessions()`。
- **severity**: P2

### Bug 6: lsp_transport 中 shutdown 处理不完整

- **evidence**: `commands.rs:254-261` — 直接返回 null，不转发也不实际执行 shutdown/exit。
- **severity**: P2

### Bug 7: 前端死代码

- **evidence**: `useLsp.ts`, `useLspHover.ts`, `useLspCompletion.ts`, `useLspDiagnostics.ts`, `LspStatusBar.tsx` 未被 FileViewer 使用。是手动 LSP 集成时期的遗留代码。
- **severity**: P3

### Bug 8: 语言映射重复不一致

- **evidence**: `FileViewer.tsx:92-113` vs `useLsp.ts:12-34`，两份 LSP_LANGUAGE_MAP 内容不同步。
- **severity**: P3

## Requirements

### R1: Session 生命周期事件推送

后端在 session 状态变更时通过 Tauri event 通知前端：
- `lsp-session-{projectPath}` 事件，payload 包含 `{ languageId, status: "starting" | "initializing" | "indexing" | "ready" | "error" | "stopped", message?, progressPct?: number }`

### R2: $/progress 转发到前端

`handle_progress_notification` 通过 `IpcTransport::push_progress()` 转发 `$/progress` 和 `window/workDoneProgress` 到前端，包含百分比信息。前端展示 "rust-analyzer indexing 45%" 带进度条。

### R3: LspSessionInfo 增加状态字段

`LspSessionInfo` 增加 `status` 字段替代单一的 `connected: bool`，支持 "starting" / "ready" / "error"。

### R4: restart / stop LSP server

新增 Tauri 命令：
- `lsp_restart_session(project_path, language_id)` — 发送 shutdown → kill 进程 → 重新创建 session → 重新 didOpen
- `lsp_stop_session(project_path, language_id)` — 发送 shutdown → kill 进程 → 清理 session

### R5: 修复 lsp_go_to_definition 文档追踪缺失

`commands.rs:332-353` 的 auto-didOpen 增加 `register_open_document()` 调用。

### R6: 应用退出时关闭所有 LSP session

`shutdown_background_and_exit` 调用 `lsp_manager.close_all_sessions()`。

### R7: 清理前端死代码

移除未使用的 hooks 和组件，消除 LSP_LANGUAGE_MAP 重复。

### R8: 前端 LSP 状态 UI 改进

- StatusBar 展示当前活跃语言的 LSP 状态（类似 VSCode `{ }` 语言选择器）
- 多语言项目：默认显示当前文件对应的 LSP server 状态，hover/dropdown 可查看所有已加载 server
- Dropdown 内每项显示 language_id + status + restart/stop 操作
- 状态指示：加载动画 / 就绪 / 索引中 / 错误
- LSP server 未就绪时编辑器显示 loading 指示

## Acceptance Criteria

- [ ] 打开 `.rs` 文件时状态栏显示 "rust-analyzer starting..." → 索引进度 → "rust-analyzer ready"
- [ ] 鼠标悬停在符号上稳定显示 hover tooltip
- [ ] F12 跳转到定义在同文件和跨文件场景均正常工作
- [ ] 重启 LSP server 后所有功能正常恢复
- [ ] 停止 LSP server 后编辑器无错误日志
- [ ] 关闭 Neeko 后所有 LSP 子进程被正确终止
- [ ] 状态栏支持 restart/stop LSP server 操作

## Out of Scope

- 代码重构（rename、code actions）
- 格式化（formatting）
- 引用面板 UI（references 结果展示）
- Document highlight

## Open Questions

（无）
