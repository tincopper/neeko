# LSP Critical Stability Fixes

## Goal

修复 LSP review 中标记为 Critical 的 4 个正确性/并发问题。

## Requirements

### #1 Per-View .hover tracker

**文件**: `src/features/lsp/hooks/lspHoverExtension.ts`

- 每个 CodeMirror editor 实例使用独立的 `LatestRequestTracker`，不再模块级共享
- 使用 `WeakMap<EditorView, LatestRequestTracker>` 或闭包绑定到 view
- 确保分屏/多 pane 下，一个 editor 的 hover 不 cancel 另一个的 tooltip

### #2 Restart backoff 正确递增

**文件**: `src-tauri/src/lsp/manager.rs`

- `send_request_async` 在 restart 路径上递增 `session.restart_count`
- 或在 `LspSession` 内部维护 `restart_count` 字段并提供 `increment_restart_count` 方法
- 退避计算应使用实际 attempt 数（从 1 开始），而非永远为 0

### #3 `lsp_notification` 改为异步

**文件**: `src-tauri/src/lsp/commands.rs`

- `lsp_notification` 命令不应在调用线程执行完整的 spawn + initialize
- 改为：先检查 session 是否存在，不存在时返回错误让前端先调 `lsp_get_or_create_session`
- 或拆分命令：`ensure_session`（异步创建）和 `send_notification`（已创建后调用）
- 前端 `lspClientManager` 适配：先发 `ensure_session`，等 ready 再发 notification

### #4 `get_or_create_session` 缩小锁粒度

**文件**: `src-tauri/src/lsp/manager.rs`

- 不持有 `sessions` 锁执行 spawn/initialize
- 方案：注册占位（锁内）→ 释放锁 → 异步创建 session → 重新获取锁写入
- 占位可防止并发重复创建同一 session

## Acceptance Criteria

- [ ] 分屏模式下，两个 editor 的 hover tooltip 互不影响
- [ ] 反复崩溃的服务端 restart 间隔呈指数退避（0s, 1s, 2s, 4s...）
- [ ] 首次 spawn 时状态栏不冻结，前端显示"Starting..."进度
- [ ] 并发请求同一 language 的 session 不会创建重复实例
- [ ] `pnpm lint:fe` 通过（0 errors）
- [ ] `pnpm type-check` 通过（0 errors）
- [ ] 现有测试 844+ 全部通过

## Constraints

- Rust 侧使用 `std::sync::Mutex`，但所有 `expect("infallible")` 在本任务中改为 `match` 或 `if let Ok` 避免 panic
- 前端 tracker 改用 per-view 方案，不引入新依赖
- 异步命令的拆分需保持向后兼容（旧调用路径仍可用）

## References

- Review finding: `history://LspCodeReview`
- Key files:
  - `src/features/lsp/hooks/lspHoverExtension.ts`
  - `src-tauri/src/lsp/manager.rs`
  - `src-tauri/src/lsp/commands.rs`
  - `src-tauri/src/lsp/session/mod.rs`
