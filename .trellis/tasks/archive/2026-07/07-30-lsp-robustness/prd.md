# LSP Robustness Improvements

## Goal

修复 LSP review 中标记为 Major 的健壮性问题：unwrap 线程启动、expect("infallible") 锁模式、远程项目文档 auto-open、LSP shutdown/exit 协议、shared store 分层循环。

## Requirements

### #5 线程启动错误处理

**文件**: `src-tauri/src/lsp/session/mod.rs`

- reader/writer 线程创建使用 `thread::Builder::spawn` 返回 `io::Result<JoinHandle>` 时，用 `AppError::from` 转换错误，不再 `unwrap()`
- 线程创建失败时清理已创建的 child process 和 channel，避免僵尸进程

### #6 替换 `expect("infallible")` 锁模式

**文件**: `src-tauri/src/lsp/manager.rs`、`session/mod.rs`、`request.rs`、`inflight.rs`、`installer.rs`

- 所有 `self.sessions.lock().expect("infallible")` 等改为 `match` 或 `if let Ok` 错误处理
- 锁失败时返回 `AppError::Lsp("lock poisoned".into())` 而不是 panic

### #8 修复远程项目文档 auto-open

**文件**: `src-tauri/src/lsp/commands.rs`

- `lsp_request` 中读取文档时，不再裸调 `std::fs::read_to_string`
- 调用统一的 `read_file_content` 抽象（与前端 `fileApi` 对应），支持 local/WSL/SSH
- 读取后调用 `register_open_document` 跟踪文档状态，确保 restart 后可恢复

### #9 修复 LSP shutdown/exit 协议

**文件**: `src-tauri/src/lsp/manager.rs`

- `close_session` 先发送 `shutdown` **request**（不是 notification），等待 response
- response 后发送 `exit` notification
- 最后 kill child process
- 超时未返回 response 时强制 kill

### #13 迁移 lspStore 到 feature 层

**文件**: `src/shared/store/lspStore.ts` → `src/features/lsp/store/lspStore.ts`

- 将 shared store 实现移到 feature 层
- shared 路径改为 re-export from feature
- 更新所有 import 路径（`src/features/lsp/store/lspStore.ts` 内部 import 不变，外部引用自动兼容）
- 确保无循环依赖：shared → features/lsp/store → features/lsp/api

## Acceptance Criteria

- [ ] 线程创建失败时优雅返回错误，不 panic，不残留子进程
- [ ] 任何 mutex 被 poison 时返回错误而非崩溃
- [ ] WSL/SSH 项目的文档 auto-open 通过正确路径读取
- [ ] `close_session` 遵循 LSP 协议：shutdown request → response → exit notification → kill
- [ ] `lspStore` 位于 `src/features/lsp/store/lspStore.ts`，shared 只 re-export
- [ ] 无循环依赖（`cargo check` 和 `pnpm type-check` 验证）
- [ ] `cargo test` 通过
- [ ] `pnpm lint:fe` 通过

## Constraints

- shutdown/exit 协议变更需兼容现有调用方（前端 `lspStopSession` 等）
- store 迁移保持所有现有引用不变（shared path 仍可用）
- 不引入新的 crate 依赖

## References

- Review finding: `history://LspCodeReview`
- Key files:
  - `src-tauri/src/lsp/session/mod.rs`
  - `src-tauri/src/lsp/manager.rs`
  - `src-tauri/src/lsp/commands.rs`
  - `src/shared/store/lspStore.ts`
  - `src/features/lsp/store/lspStore.ts`
