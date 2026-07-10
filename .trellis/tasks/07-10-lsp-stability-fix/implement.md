# LSP 稳定性修复 — 执行计划 (TDD)

## 执行原则

- **垂直切片**: 每步 RED→GREEN→REFACTOR，不跨步批量写测试
- **行为测试**: 测试公共接口行为，不测内部结构
- **最小实现**: 只写使当前测试通过的代码，不预判未来需求

---

### Step 1: Session 状态模型 + child_process 持有

**RED** — 先写测试：
- [ ] `manager.rs` test: `test_session_status_transitions` — 验证 Starting → Initializing → Ready 状态流转
- [ ] `manager.rs` test: `test_child_killed_on_close` — 验证 close_session 后子进程被终止

**GREEN** — 最小实现：
- [ ] `manager.rs`: `LspSessionStatus` 枚举 (Starting, Initializing, Indexing, Ready, Error, Stopped)
- [ ] `manager.rs`: `LspSession` 增加 `status: LspSessionStatus` 和 `child: Option<Child>` 字段
- [ ] `manager.rs`: `LspSession::new()` 持有 `child`，状态流转
- [ ] `manager.rs`: `close_session()` → `child.kill()` + `child.wait()`
- [ ] `manager.rs`: `close_all_sessions()` → 遍历 kill
- [ ] `types.rs`: `LspSessionInfo` 替换 `connected` 为 `status` + `status_message` + `progress_pct`

**REFACTOR** — 清理：
- [ ] 提取 `kill_child()` 复用方法（close_session / close_all_sessions / restart 共用）

验证: `cargo test --manifest-path src-tauri/Cargo.toml -- lsp`

---

### Step 2: 状态事件发射

**RED** — 先写测试：
- [ ] `manager.rs` test: `test_session_event_emitted_on_status_change` — mock transport 验证事件被推送

**GREEN** — 最小实现：
- [ ] `transport.rs`: `IpcTransport` 增加 `push_session_event()` 方法，复用现有 `app_handle.emit()` 模式
- [ ] `manager.rs`: `LspSession` 持有 `Arc<IpcTransport>`
- [ ] `manager.rs`: 实现 `emit_session_event()` — 调用 `transport.push_session_event()`
- [ ] 在 spawn、handshake完成、$/progress begin/end、error 等关键点调用

**REFACTOR** — 清理：
- [ ] 确认 `push_session_event` 与 `push_diagnostics` / `push_progress` 无重复代码

验证: `cargo test --manifest-path src-tauri/Cargo.toml -- lsp`

---

### Step 3: $/progress 转发到前端

**RED** — 先写测试：
- [ ] `manager.rs` test: `test_progress_notification_forwards_to_transport`

**GREEN** — 最小实现：
- [ ] `manager.rs`: 改造 `handle_progress_notification`，调用 `IpcTransport::push_progress()`（复用已有方法）
- [ ] 在 `begin` 时调用 `emit_session_event(Indexing, ...)`
- [ ] 在 `end` 时调用 `emit_session_event(Ready)`
- [ ] 在 `report` 时更新 `progress_pct`

**REFACTOR** — 清理：
- [ ] `handle_progress_notification` 改为 `LspSession` 的方法（复用 `self.transport`）

验证: `cargo test --manifest-path src-tauri/Cargo.toml -- lsp`

---

### Step 4: 新增 restart/stop 命令 + Bug 修复

**RED** — 先写测试：
- [ ] `commands.rs` test: `test_restart_session_reopens_documents`
- [ ] `commands.rs` test: `test_stop_session_kills_child_and_cleans_up`
- [ ] `commands.rs` test: `test_go_to_definition_registers_open_document`

**GREEN** — 最小实现：
- [ ] `commands.rs`: `lsp_restart_session` → shutdown → kill_child() → remove → get_or_create → reopen
- [ ] `commands.rs`: `lsp_stop_session` → shutdown → kill_child() → cleanup
- [ ] `commands.rs`: `lsp_go_to_definition` auto-didOpen 增加 `register_open_document`
- [ ] `commands.rs`: `shutdown` 处理改为转发通知到 server
- [ ] `lib.rs`: `neeko_invoke_handler!` 注册 `lsp_restart_session`、`lsp_stop_session`
- [ ] `app_state.rs`: `shutdown_background_and_exit` 增加 `lsp_manager.close_all_sessions()`

**REFACTOR** — 清理：
- [ ] 提取 `do_close_session_with_shutdown()` 复用方法（restart / stop / exit 共用）

验证: `cargo test --manifest-path src-tauri/Cargo.toml -- lsp`

---

### Step 5: 前端类型更新 + API 扩展 + Hover 就绪保护

**RED** — 先写测试：
- [ ] Vitest: 测试 `lspSessionInfo` 新字段 type-check 通过

**GREEN** — 最小实现：
- [ ] `types.ts`: 更新 `LspSessionInfo` 接口
- [ ] `lspApi.ts`: 新增 `lspRestartSession()`、`lspStopSession()`
- [ ] `lspClientManager.ts`: 监听 `lsp-session-{projectPath}` ready 事件，触发 capability re-check

**REFACTOR** — 清理：
- [ ] 确认 API 层无重复代码

验证: `pnpm type-check && pnpm test:run`

---

### Step 6: LSP 状态 Store + StatusBar 改造

**RED** — 先写测试：
- [ ] `lspStore.test.ts`: 测试 store 正确响应 session 事件更新状态

**GREEN** — 最小实现：
- [ ] `lspStore.ts`: 新建 zustand store，管理 `Record<projectPath, LspSessionState[]>`
- [ ] 订阅 `lsp-session-{projectPath}` 和 `lsp-progress-{projectPath}` 事件
- [ ] `StatusBar.tsx`: 移除 5 秒轮询 → 改用 `useLspStore`
- [ ] Dropdown: 当前活跃 LSP + 所有 server 列表 + restart/stop 按钮

**REFACTOR** — 清理：
- [ ] 提取 `LspStatusDropdown` 独立组件（可被 StatusBar 和其他位置复用）

验证: `pnpm type-check && pnpm lint && pnpm test:run`

---

### Step 7: 死代码清理 + 语言映射统一

**GREEN** (无新行为，直接清理)：
- [ ] 创建 `src/features/lsp/languageMap.ts` 作为单一映射源
- [ ] 更新 `FileViewer.tsx` 从 `languageMap` 导入
- [ ] 删除 5 个死代码文件
- [ ] 验证: `pnpm type-check` 确认无未解析导入

验证: `pnpm type-check && pnpm lint`

---

### Step 8: Hover tooltip 三问题修复

**RED** — 先写测试：
- [ ] `lspHoverExtension.test.ts`: 测试 tooltip 添加 click 委托处理 `<a>` 链接点击
- [ ] `lspHoverExtension.test.ts`: 测试链接点击时调用 browser store navigateTo

**GREEN** — 最小实现：
- [ ] 新建 `src/features/lsp/hooks/lspHoverExtension.ts` — 自定义 hover tooltip source
  - 使用 `@codemirror/view` 的 `hoverTooltip()` + 自定义 source 函数
  - 复用 LSP 客户端的 `request("textDocument/hover", ...)` 进行 hover 请求
  - 自定义 tooltip view: 在 `dom` 上添加 click 事件委托, 拦截 `<a>` 标签
  - 链接点击 → `useBrowserStore.getState().navigateTo(url)` + `useDockStore.getState().activatePanel("right", "browser")`
  - 不传 `above` 或设 `above: undefined`，让 CodeMirror 自动选择方向
- [ ] `lspClientManager.ts`: 替换 `hoverTooltips()` 导入为 `createLspHoverTooltips()`
- [ ] `src/styles/index.css`: `.cm-lsp-hover-tooltip` 的 `overflow-x: hidden` → `overflow-x: auto`
- [ ] `src/styles/index.css`: `pre` 的 `overflow-x: auto` 保持，确保滚动条一致性

**REFACTOR** — 清理：
- [ ] 确认自定义 hover extension 与已有的 `lspClientManager` 架构一致

验证: `pnpm type-check && pnpm lint`

---

### Step 9: 全量质量回归

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm lint
pnpm type-check
pnpm test:run
```

---

## 风险文件

| 文件 | 风险 | 缓解 |
|------|------|------|
| `manager.rs` (910行) | 核心逻辑变动大 | TDD: 每个状态变更先写测试 |
| `commands.rs:254-261` | shutdown 转发 | 先转发再 kill，不等待 response |
| `app_state.rs:27-40` | close_all_sessions 阻塞退出 | kill 超时 2s，超时后强制 kill |

## Rollback 点

- Step 1-2 完成后独立可回滚
- Step 4 完成后所有 bug 修复独立可验证
- Step 5-6 UI 变更可独立 revert
