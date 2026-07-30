# LSP Polish and Minor Fixes

## Goal

修复 LSP review 中标记为 Minor 的细节问题：React key、显示名、root markers、日志级别/时间戳、install 锁并行、spawn runtime 复用、cache 有界。

## Requirements

### #14 修复 install listener cleanup 返回 floating promise

**文件**: `src/features/status-bar/StatusBar.tsx`

- effect cleanup 必须是同步的
- 改为保存 unlisten handle，cleanup 直接调用

### #15 修复 DiagnosticsPanel React key

**文件**: `src/features/lsp/components/DiagnosticsPanel.tsx`

- 不再使用数组 index 作为 key
- 使用 `${message}-${range.start.line}-${range.start.character}` 或合成 id

### #16 添加 TypeScriptReact / JavaScriptReact root markers

**文件**: `src-tauri/src/lsp/plugin/builtins/typescript_family.rs`

- 为 `typescriptreact` / `javascriptreact` 添加 root markers（`package.json`、`tsconfig.json` 等）
- 与 sibling typescript / javascript 一致

### #17 统一 server 显示名

**文件**: `src/features/status-bar/LspStatusSection.tsx`

- `BUILTIN_SERVER_NAMES` 中 `typescript` / `javascript` 的值改为 `typescript-language-server`
- 与 plugin registry 中的 binary 名一致

### #18 复用 spawn runtime

**文件**: `src-tauri/src/lsp/process.rs`

- `spawn_lsp_process` 不再创建独立 Tokio runtime
- 使用 `AppRuntime` 的 blocking pool（已存在）

### #19 stderr 日志时间戳改为 ISO-8601

**文件**: `src-tauri/src/lsp/session/mod.rs`

- `chrono_like_now` 返回 ISO-8601 格式字符串

### #20 stderr 日志级别根据内容推断

**文件**: `src-tauri/src/lsp/session/mod.rs`

- 包含 `error` / `panic` 等关键词的行标记为 `error`
- 包含 `warn` 等标记为 `warn`
- 其余为 `info`

### #21 Install 锁改为按语言并行

**文件**: `src-tauri/src/lsp/installer.rs`

- 使用 `HashSet<String>`（language IDs）替代 `Option<String>`
- 不同语言的 install 可并行，同一语言串行

### #23 Definition cache 添加 LRU 有界

**文件**: `src/features/lsp/hooks/lspCache.ts`

- 为 `defCache` 和 `pendingCache` 添加最大容量限制（如 500 条目）
- 超限时移除最旧条目

## Acceptance Criteria

- [ ] install listener cleanup 不再返回 floating promise
- [ ] DiagnosticsPanel 使用稳定 React key
- [ ] JSX-only 项目正确检测为 TypeScript
- [ ] 状态栏显示名与二进制名一致
- [ ] spawn 不再创建额外 Tokio runtime
- [ ] 日志时间戳为 ISO-8601
- [ ] 日志级别根据内容正确推断
- [ ] 不同语言 install 可并行
- [ ] definition cache 有最大容量
- [ ] `pnpm lint:fe` 通过
- [ ] `cargo test` 通过

## Constraints

- minor 修复不应引入 breaking changes
- spawn 复用 runtime 需保证不阻塞主线程
- LRU cache 需考虑内存占用

## References

- Review finding: `history://LspCodeReview`
- Key files:
  - `src/features/status-bar/StatusBar.tsx`
  - `src/features/lsp/components/DiagnosticsPanel.tsx`
  - `src-tauri/src/lsp/plugin/builtins/typescript_family.rs`
  - `src/features/status-bar/LspStatusSection.tsx`
  - `src-tauri/src/lsp/process.rs`
  - `src-tauri/src/lsp/session/mod.rs`
  - `src-tauri/src/lsp/installer.rs`
  - `src/features/lsp/hooks/lspCache.ts`
